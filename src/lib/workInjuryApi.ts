import { supabase } from './supabase';
import { currentUserAndTenant, openPrivateFile, randomFileName } from './privateFiles';
import { fileProblem } from './employeeDocuments';
import type { WibaCover, WorkInjuryCase } from './workInjury';
import type { ReportEmployee } from './workInjuryPdf';

// Reads and writes for work injury cases (20261022800000_work_injury_cases.sql). The database lets in whoever holds
// the Incidents module ('incident-reports'), in their own company.

const fail = (error: { message?: string; code?: string } | null, fallback: string): never => {
  if (error?.code === '42501' || /row-level security/i.test(error?.message || '')) {
    throw new Error('Only people who handle incident reports can change work injury cases.');
  }
  throw new Error(error?.message || fallback);
};

export async function loadWorkInjuryCases(): Promise<WorkInjuryCase[]> {
  const { data, error } = await supabase.from('work_injury_cases').select('*').order('occurred_at', { ascending: false });
  if (error) fail(error, 'Could not load the work injury cases.');
  return (data || []) as WorkInjuryCase[];
}

/** The fields HR fills in (the rest the database works out). */
export type CaseFields = Partial<Omit<WorkInjuryCase, 'id' | 'created_at' | 'updated_at' | 'employee_name'>> &
  Pick<WorkInjuryCase, 'employee_number' | 'occurred_at'>;

export async function saveWorkInjuryCase(id: string | null, fields: CaseFields): Promise<WorkInjuryCase> {
  const query = id
    ? supabase.from('work_injury_cases').update(fields).eq('id', id).select('*').single()
    : supabase.from('work_injury_cases').insert(fields).select('*').single();
  const { data, error } = await query;
  if (error) fail(error, 'The case was not saved.');
  return data as WorkInjuryCase;
}

export async function loadWibaCover(): Promise<WibaCover | null> {
  const { data, error } = await supabase
    .from('company_wiba_cover')
    .select('insurer_name, policy_number, cover_start, cover_expiry, dosh_registration_no, notes')
    .maybeSingle();
  if (error) return null;
  return (data as WibaCover | null) ?? null;
}

export async function saveWibaCover(cover: WibaCover): Promise<void> {
  const { tenantId } = await currentUserAndTenant();
  const { error } = await supabase.from('company_wiba_cover').upsert({ tenant_id: tenantId, ...cover }, { onConflict: 'tenant_id' });
  if (error) fail(error, 'The insurance details were not saved.');
}

/**
 * The employee's basic salary to start the estimate from, when the signed-in person may read pay; null otherwise. HR
 * adds regular allowances (the Act's "earnings" include them) or types the figure in.
 */
export async function loadMonthlyEarnings(employeeNumber: string): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from('employees')
      .select('"Basic Salary"')
      .eq('"Employee Number"', employeeNumber)
      .maybeSingle();
    if (error || !data) return null;
    const basic = Number((data as Record<string, unknown>)['Basic Salary']);
    return Number.isFinite(basic) && basic > 0 ? basic : null;
  } catch {
    return null;
  }
}

/** The employee's details the accident report asks for, as far as the signed-in person may read them. */
export async function loadEmployeeReportDetails(employeeNumber: string): Promise<ReportEmployee> {
  try {
    const { data, error } = await supabase
      .from('employees')
      .select('"ID Number", "Gender", "Date of Birth", "Job Title"')
      .eq('"Employee Number"', employeeNumber)
      .maybeSingle();
    if (!error && data) {
      const row = data as Record<string, string | null>;
      return { idNumber: row['ID Number'], gender: row.Gender, dateOfBirth: row['Date of Birth'], jobTitle: row['Job Title'] };
    }
    const dir = await supabase.from('employee_directory').select('"Job Title"').eq('"Employee Number"', employeeNumber).maybeSingle();
    return { jobTitle: (dir.data as Record<string, string | null> | null)?.['Job Title'] ?? null };
  } catch {
    return {};
  }
}

export interface IncidentForCase {
  id: string;
  employee_number: string | null;
  is_anonymous: boolean;
  incident_type: string;
  title: string;
  description: string;
  incident_date: string | null;
  location: string | null;
  witnesses: string | null;
  created_at: string;
}

export async function loadIncident(id: string): Promise<IncidentForCase | null> {
  const { data, error } = await supabase
    .from('incident_reports')
    .select('id, employee_number, is_anonymous, incident_type, title, description, incident_date, location, witnesses, created_at')
    .eq('id', id)
    .maybeSingle();
  if (error) return null;
  return (data as IncidentForCase | null) ?? null;
}

// ---------------------------------------------------------------------------------------------
// files
// ---------------------------------------------------------------------------------------------
export interface CaseDocument {
  id: string;
  case_id: string;
  label: string | null;
  file_path: string;
  file_name: string;
  created_at: string;
}

export async function loadCaseDocuments(caseId: string): Promise<CaseDocument[]> {
  const { data, error } = await supabase
    .from('work_injury_documents')
    .select('id, case_id, label, file_path, file_name, created_at')
    .eq('case_id', caseId)
    .order('created_at');
  if (error) fail(error, 'Could not load the files.');
  return (data || []) as CaseDocument[];
}

/** Uploads a file into <company>/<login>/work-injuries/<case>/ and records it with the case. */
export async function addCaseDocument(caseId: string, file: File, label: string): Promise<void> {
  const problem = fileProblem(file);
  if (problem) throw new Error(problem);
  const { userId, tenantId } = await currentUserAndTenant();
  const path = `${tenantId}/${userId}/work-injuries/${caseId}/${randomFileName(file.name)}`;
  const stored = await supabase.storage.from('documents').upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (stored.error) fail(stored.error, 'The file was not uploaded.');
  const { error } = await supabase.from('work_injury_documents').insert({ case_id: caseId, file_path: path, file_name: file.name, label: label.trim() || null });
  if (error) {
    await supabase.storage.from('documents').remove([path]);
    fail(error, 'The file was not saved with the case.');
  }
}

export async function removeCaseDocument(doc: CaseDocument): Promise<void> {
  const { error } = await supabase.from('work_injury_documents').delete().eq('id', doc.id);
  if (error) fail(error, 'The file was not removed.');
  await supabase.storage.from('documents').remove([doc.file_path]);
}

export const openCaseDocument = (doc: CaseDocument) => openPrivateFile('documents', doc.file_path);
