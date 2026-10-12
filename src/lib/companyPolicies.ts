import { supabase } from './supabase';
import { currentUserAndTenant, openPrivateFile } from './privateFiles';
import { fileProblem } from './employeeDocuments';

// Company agreements and policies (20261012600000). HR publishes each policy's wording (text and/or a file); every
// published version is fixed, and a change is a new version. Employees accept each with its own checkbox, which is
// recorded as their signature for that exact version.

export interface PolicyItem {
  policy_id: string;
  title: string;
  required: boolean;
  version_id: string;
  version: number;
  body: string | null;
  file_path: string | null;
  file_name: string | null;
  published_at: string;
  accepted_at: string | null;
}

export interface PolicyAdminRow {
  id: string;
  title: string;
  required: boolean;
  active: boolean;
  version: number | null;
  body: string | null;
  file_name: string | null;
  published_at: string | null;
  accepted: number;
}

const fail = (err: unknown, fallback: string): never => {
  const message = (err as { message?: unknown } | null)?.message;
  throw new Error(typeof message === 'string' && message ? message : fallback);
};

/** Active policies with their latest version and whether the employee accepted it (no id: the signed-in employee). */
export async function loadPolicyChecklist(employeeId?: string): Promise<PolicyItem[]> {
  const { data, error } = await supabase.rpc('policy_checklist', employeeId ? { p_employee: employeeId } : {});
  if (error) fail(error, 'Could not load the company policies.');
  return (data ?? []) as PolicyItem[];
}

/** The employee's checkbox: accepts this version, as their signature. */
export async function acceptPolicy(versionId: string): Promise<void> {
  const agent = typeof navigator === 'undefined' ? null : navigator.userAgent;
  const { error } = await supabase.rpc('accept_policy', { p_version: versionId, p_user_agent: agent });
  if (error) fail(error, 'Your acceptance was not saved.');
}

export const openPolicyFile = (path: string) => openPrivateFile('documents', path);

// ---------------------------------------------------------------------------------------------
// HR
// ---------------------------------------------------------------------------------------------
export async function loadPoliciesForAdmin(): Promise<PolicyAdminRow[]> {
  const [policies, versions, acceptances] = await Promise.all([
    supabase.from('company_policies').select('id, title, required, active').order('created_at'),
    supabase.from('company_policy_versions').select('id, policy_id, version, body, file_name, published_at').order('version', { ascending: false }),
    supabase.from('policy_acceptances').select('version_id'),
  ]);
  for (const r of [policies, versions, acceptances]) if (r.error) fail(r.error, 'Could not load the policies.');
  const latest = new Map<string, Record<string, unknown>>();
  for (const v of (versions.data ?? []) as Record<string, unknown>[]) if (!latest.has(String(v.policy_id))) latest.set(String(v.policy_id), v);
  const count = new Map<string, number>();
  for (const a of (acceptances.data ?? []) as { version_id: string }[]) count.set(a.version_id, (count.get(a.version_id) ?? 0) + 1);
  return ((policies.data ?? []) as { id: string; title: string; required: boolean; active: boolean }[]).map((p) => {
    const v = latest.get(p.id);
    return {
      ...p,
      version: v ? Number(v.version) : null,
      body: v ? (v.body as string | null) : null,
      file_name: v ? (v.file_name as string | null) : null,
      published_at: v ? String(v.published_at) : null,
      accepted: v ? count.get(String(v.id)) ?? 0 : 0,
    };
  });
}

async function uploadPolicyFile(file: File): Promise<{ file_path: string; file_name: string }> {
  const problem = fileProblem(file);
  if (problem) throw new Error(problem);
  const { userId, tenantId } = await currentUserAndTenant();
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${tenantId}/${userId}/policies/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from('documents').upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) fail(error, 'The file was not uploaded.');
  return { file_path: path, file_name: file.name };
}

/** Publishes a version of a policy: its wording, a file, or both. */
export async function publishPolicyVersion(policyId: string, body: string, file?: File | null): Promise<void> {
  if (!body.trim() && !file) throw new Error('Add the policy’s wording or a file.');
  const stored = file ? await uploadPolicyFile(file) : { file_path: null, file_name: null };
  const { error } = await supabase.from('company_policy_versions').insert({ policy_id: policyId, body: body.trim() || null, ...stored });
  if (error) {
    if (stored.file_path) await supabase.storage.from('documents').remove([stored.file_path]);
    fail(error, 'The policy was not published.');
  }
}

export async function createPolicy(title: string, required: boolean, body: string, file?: File | null): Promise<void> {
  if (!title.trim()) throw new Error('Give the policy a title.');
  if (!body.trim() && !file) throw new Error('Add the policy’s wording or a file.');
  const { data, error } = await supabase.from('company_policies').insert({ title: title.trim(), required }).select('id').single();
  if (error) fail(error, 'The policy was not created.');
  const id = String((data as { id: string }).id);
  try {
    await publishPolicyVersion(id, body, file);
  } catch (err) {
    await supabase.from('company_policies').delete().eq('id', id);
    throw err;
  }
}

export async function updatePolicy(id: string, changes: { required?: boolean; active?: boolean }): Promise<void> {
  const { error } = await supabase.from('company_policies').update(changes).eq('id', id);
  if (error) fail(error, 'The policy was not updated.');
}
