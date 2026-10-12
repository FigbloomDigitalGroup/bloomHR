import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, Plus, X } from 'lucide-react';
import { Button } from '../UI';
import { Field, TextField } from './Fields';
import { ACCEPTED_FILES } from '../../lib/employeeDocuments';
import { type PolicyAdminRow, createPolicy, loadPoliciesForAdmin, publishPolicyVersion, updatePolicy } from '../../lib/companyPolicies';

// HR's company policies and agreements: add one, publish a new version (employees accept it again), and choose which
// are required for onboarding.

const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

interface Draft {
  policyId: string | null; // null: a new policy
  title: string;
  required: boolean;
  body: string;
  file: File | null;
}

export default function PoliciesModal({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<PolicyAdminRow[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await loadPoliciesForAdmin());
    } catch (err) {
      setRows([]);
      toast.error(errorText(err, 'Could not load the policies.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      if (draft.policyId) await publishPolicyVersion(draft.policyId, draft.body, draft.file);
      else await createPolicy(draft.title, draft.required, draft.body, draft.file);
      toast.success(draft.policyId ? 'New version published: employees will be asked to accept it' : 'Policy published');
      setDraft(null);
      await load();
    } catch (err) {
      toast.error(errorText(err, 'The policy was not published.'));
    } finally {
      setBusy(false);
    }
  };

  const change = async (id: string, changes: { required?: boolean; active?: boolean }) => {
    try {
      await updatePolicy(id, changes);
      await load();
    } catch (err) {
      toast.error(errorText(err, 'The policy was not updated.'));
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" role="dialog" aria-label="Company policies">
      <div className="bg-white rounded-[10px] border border-border shadow-lg w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">Company policies and agreements</h2>
            <p className="text-xs text-muted-foreground">Each employee accepts each policy with its own checkbox, as their signature.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 text-muted-foreground hover:text-ink"><X className="h-4 w-4" /></button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-3">
          {!rows && <Loader2 className="h-5 w-5 animate-spin text-brand" aria-label="Loading" />}
          {rows?.length === 0 && !draft && <p className="text-sm text-muted-foreground">No policies yet.</p>}
          {rows?.map((p) => (
            <div key={p.id} className={`rounded-lg border border-border px-3 py-2 ${p.active ? '' : 'opacity-60'}`}>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[200px]">
                  <p className="text-sm font-medium text-ink">{p.title}</p>
                  <p className="text-xs text-muted-foreground">
                    Version {p.version ?? '—'}{p.file_name ? ` · ${p.file_name}` : ''} · accepted by {p.accepted}
                  </p>
                </div>
                <label className="inline-flex items-center gap-1.5 text-xs text-ink">
                  <input type="checkbox" checked={p.required} onChange={(e) => void change(p.id, { required: e.target.checked })} /> Required
                </label>
                <label className="inline-flex items-center gap-1.5 text-xs text-ink">
                  <input type="checkbox" checked={p.active} onChange={(e) => void change(p.id, { active: e.target.checked })} /> In use
                </label>
                <Button variant="ghost" onClick={() => setDraft({ policyId: p.id, title: p.title, required: p.required, body: p.body ?? '', file: null })}>
                  New version
                </Button>
              </div>
            </div>
          ))}

          {draft ? (
            <div className="rounded-lg border border-border p-3 space-y-3">
              {draft.policyId ? (
                <p className="text-sm font-medium text-ink">New version of {draft.title}</p>
              ) : (
                <>
                  <TextField label="Title" required value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} placeholder="Code of conduct" />
                  <label className="inline-flex items-center gap-2 text-sm text-ink">
                    <input type="checkbox" checked={draft.required} onChange={(e) => setDraft({ ...draft, required: e.target.checked })} />
                    Every employee must accept it to complete onboarding
                  </label>
                </>
              )}
              <Field label="Wording" hint="Paste the policy, or attach it as a file below (or both)">
                <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={6}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm" />
              </Field>
              <Field label="File (optional)">
                <input type="file" accept={ACCEPTED_FILES} onChange={(e) => setDraft({ ...draft, file: e.target.files?.[0] ?? null })} className="text-sm" />
              </Field>
              <div className="flex gap-2">
                <Button disabled={busy || (!draft.policyId && !draft.title.trim()) || (!draft.body.trim() && !draft.file)} onClick={() => void save()}>
                  {busy ? 'Publishing…' : 'Publish'}
                </Button>
                <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
              </div>
              {draft.policyId && <p className="text-xs text-muted-foreground">Published wording can’t be edited; everyone accepts the new version again.</p>}
            </div>
          ) : (
            <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setDraft({ policyId: null, title: '', required: true, body: '', file: null })}>
              Add a policy
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
