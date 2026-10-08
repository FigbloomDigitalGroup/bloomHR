import { supabase } from './supabase';

// Offered in the employee forms' Department list alongside the departments the company already uses, so a new
// company is not starting from an empty list. Anything else can be typed in.
export const STARTER_DEPARTMENTS = [
  'Administration',
  'Customer Service',
  'Finance',
  'Human Resources',
  'IT',
  'Operations',
  'Procurement',
  'Sales & Marketing',
];

/** The company's own values (from its employees) followed by any starters it doesn't use yet, without blanks. */
export function optionsWithStarters(existing: (string | null | undefined)[] = [], starters: string[] = []): string[] {
  const own = [...new Set(existing.map((v) => (v || '').trim()).filter(Boolean))];
  const seen = new Set(own.map((v) => v.toLowerCase()));
  return [...own, ...starters.filter((s) => !seen.has(s.toLowerCase()))];
}

/**
 * A branch typed in on an employee also goes on the company's branch list (kenya_branches), which the top bar's
 * Region/Town filters read. Best effort: adding to that list needs the Settings permission, and the employee is
 * saved either way.
 */
export async function ensureBranchListed(branch: string | null | undefined, town?: string | null): Promise<void> {
  const name = (branch || '').trim();
  if (!name || name === 'all') return;
  try {
    const { data } = await supabase.from('kenya_branches').select('id').ilike('Branch Office', name).limit(1);
    if (data && data.length > 0) return;
    await supabase.from('kenya_branches').insert({ 'Branch Office': name, Town: (town || '').trim() || null });
  } catch {
    /* the employee is saved; the filter list just doesn't get this branch */
  }
}
