import { supabase } from './supabase';
import { chunks, IN_LIST_SIZE } from './fetchAll';

// Saving a bulk employee upload (FIG-818): a few hundred rows per call to save_employees_batch() (migration
// 20261014300000) instead of one request per row, so 10,000 employees take a minute, not hours. The function runs
// as the signed-in person (the same rules as saving one row at a time) and answers for each row.

/** Rows per call: small enough for the database's statement time limit with every employees trigger running. */
export const UPLOAD_BATCH_SIZE = 200;

export interface UploadRow {
  /** the spreadsheet row, for messages ("Row 4") */
  row: number;
  data: Record<string, unknown>;
}

export interface SavedRow {
  row_no: number;
  employee_number: string | null;
  outcome: 'created' | 'updated' | 'error';
  employee_id: string | null;
  work_email: string | null;
  error_code: string | null;
  error_message: string | null;
}

/** Why a row was not saved, in words HR can act on. */
export function describeSaveError(code: string | null | undefined, message: string | null | undefined): string {
  const text = String(message ?? '');
  if (code === '23505' && /work email/i.test(text)) return 'another employee already has this work email';
  if (code === '23505' && /id_number/i.test(text)) return 'another employee already has this ID number';
  if (code === '23505' && /tax_pin/i.test(text)) return 'another employee already has this KRA PIN';
  if (code === '23505' && /nssf/i.test(text)) return 'another employee already has this NSSF number';
  if (code === '23505' && /sha_number|shif/i.test(text)) return 'another employee already has this SHIF number';
  if (/row-level security/i.test(text)) return 'you may not add or change employees';
  return text || 'could not be saved';
}

/**
 * Which of these work emails and employee numbers the company's employees already have. save_employees_batch updates
 * the employee a row's number or work email belongs to, so a caller that only means to add people checks first.
 */
export async function findExistingEmployees(
  workEmails: string[],
  numbers: string[] = []
): Promise<{ emails: Set<string>; numbers: Set<string> }> {
  const found = { emails: new Set<string>(), numbers: new Set<string>() };
  const add = (rows: { 'Employee Number': string | null; 'Work Email': string | null }[] | null) => {
    for (const r of rows ?? []) {
      if (r['Work Email']) found.emails.add(String(r['Work Email']).trim().toLowerCase());
      if (r['Employee Number']) found.numbers.add(String(r['Employee Number']).trim());
    }
  };
  for (const [column, values] of [['Work Email', workEmails], ['Employee Number', numbers]] as const) {
    for (const chunk of chunks(values, IN_LIST_SIZE)) {
      const { data, error } = await supabase.from('employees').select('"Employee Number", "Work Email"').in(column, chunk);
      if (error) throw new Error(describeSaveError((error as { code?: string }).code, error.message));
      add(data as { 'Employee Number': string | null; 'Work Email': string | null }[] | null);
    }
  }
  return found;
}

/**
 * Saves the rows in batches, in order. A batch the database could not take at all (network, time limit) is reported
 * as an error for each of its rows and the next batch is still tried. `onProgress` is told after each batch.
 */
export async function saveEmployeesInBatches(
  rows: UploadRow[],
  onProgress?: (saved: SavedRow[], done: number, total: number) => void,
  batchSize = UPLOAD_BATCH_SIZE
): Promise<SavedRow[]> {
  const results: SavedRow[] = [];
  for (const batch of chunks(rows, batchSize)) {
    const { data, error } = await supabase.rpc('save_employees_batch', { p_rows: batch });
    const saved: SavedRow[] = error
      ? batch.map((r) => ({
          row_no: r.row,
          employee_number: String(r.data['Employee Number'] ?? '') || null,
          outcome: 'error',
          employee_id: null,
          work_email: null,
          error_code: (error as { code?: string }).code ?? null,
          error_message: `not saved: ${(error as { message?: string }).message || 'the database did not answer'}`,
        }))
      : ((data ?? []) as SavedRow[]);
    results.push(...saved);
    onProgress?.(saved, results.length, rows.length);
  }
  return results;
}
