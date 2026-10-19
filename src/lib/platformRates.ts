import { supabase } from './supabase';
import type { RateChange, RateVersion } from './payroll/rateVersions';

// The platform's default statutory rates (statutory_rates rows with no company), as Figbloom's platform admins manage
// them (FIG-813, migration 20261021800000_finance_bill_readiness.sql). Everyone signed in reads them; only a platform
// admin adds a version, through add_platform_rate (validated, audited in platform_rate_changes).

const fail = (err: unknown, fallback: string): never => {
  const message = (err as { message?: unknown } | null)?.message;
  throw new Error(typeof message === 'string' && message ? message : fallback);
};

/** Whether the signed-in person is a Figbloom platform admin (false when the database doesn't know yet). */
export async function isPlatformAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_platform_admin');
  return !error && data === true;
}

/** Every platform version of every rate for a country, oldest first within each code. */
export async function platformRows(country: string): Promise<RateVersion[]> {
  const { data, error } = await supabase
    .from('statutory_rates')
    .select('tenant_id, country, code, value, bands, effective_from, effective_to, source')
    .is('tenant_id', null)
    .eq('country', country)
    .order('code')
    .order('effective_from');
  if (error) fail(error, 'Could not load the platform rates.');
  return ((data ?? []) as RateVersion[]).map((r) => ({ ...r, value: r.value === null ? null : Number(r.value) }));
}

/** The latest month any company has approved for a country (a rate before its end reaches back into approved payslips). */
export async function latestApprovedMonth(country: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('platform_latest_approved_month', { p_country: country });
  if (error) fail(error, 'Could not check the approved months.');
  return (data as string | null) ?? null;
}

/** Adds a platform version of a rate from a date (the database checks it again and records who did it). */
export async function addPlatformRate(change: RateChange, confirmBackdate: boolean): Promise<string> {
  const { data, error } = await supabase.rpc('add_platform_rate', {
    p_country: change.country,
    p_code: change.code,
    p_value: change.value,
    p_bands: change.bands,
    p_from: change.from,
    p_source: change.source,
    p_confirm_backdate: confirmBackdate,
  });
  if (error) fail(error, 'The rate was not saved.');
  return data as string;
}

/** A platform rate change payroll people are told about: "New Kenya rates from 1 July 2026". */
export interface RateAnnouncement {
  country: string;
  from: string;
  codes: string[];
  addedAt: string;
}

/** Platform versions added by a platform admin in the last `days` days, grouped by country and start date. */
export async function recentPlatformChanges(days = 45): Promise<RateAnnouncement[]> {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabase
    .from('statutory_rates')
    .select('country, code, effective_from, created_at')
    .is('tenant_id', null)
    .not('created_by', 'is', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false });
  if (error) return [];
  return groupAnnouncements((data ?? []) as { country: string; code: string; effective_from: string; created_at: string }[]);
}

export function groupAnnouncements(rows: { country: string; code: string; effective_from: string; created_at: string }[]): RateAnnouncement[] {
  const by = new Map<string, RateAnnouncement>();
  for (const r of rows) {
    const key = `${r.country}|${r.effective_from}`;
    const seen = by.get(key);
    if (seen) {
      if (!seen.codes.includes(r.code)) seen.codes.push(r.code);
      if (r.created_at > seen.addedAt) seen.addedAt = r.created_at;
    } else {
      by.set(key, { country: r.country, from: r.effective_from, codes: [r.code], addedAt: r.created_at });
    }
  }
  return [...by.values()].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

/** "1 July 2026" */
export const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
