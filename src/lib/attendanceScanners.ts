import { supabase } from './supabase';
import { clockLabel, dayLabel, nairobiParts } from './attendance';

// Door scanners (migration 20261023600000): a company's ZKTeco scanners, which employee each scanner user ID is, and
// the scanner user IDs whose punches are still waiting for a match; the name each ID has on the scanner and the ones
// HR marked "Not staff, ignore" (20261024000000). The scanners send their punches to the server
// themselves (iclock_routes.js); HR only registers them and matches people here. The database decides who may do
// what; these turn its answers into plain shapes and its refusals into plain messages.

/** A database refusal as something a person can act on. */
export function scannerError(err: unknown): string {
  const e = (err ?? {}) as { message?: string; code?: string };
  const msg = e.message ?? '';
  if (/attendance_devices_serial_key/.test(msg) || (e.code === '23505' && /serial/i.test(msg))) {
    return 'A scanner with this serial number is already registered. If it is yours, contact support.';
  }
  if (/attendance_scanner_ignored_key/.test(msg)) return 'That scanner user is already ignored';
  if (/attendance_scanner_users_key/.test(msg) || e.code === '23505') return 'That scanner user ID is already matched to someone';
  if (e.code === '42501' && /row-level security|permission denied/.test(msg)) return 'You are not allowed to do that';
  return msg || 'Something went wrong';
}
const fail = (error: unknown): never => {
  throw new Error(scannerError(error));
};

// ---------------------------------------------------------------------------------------------
// the scanners
// ---------------------------------------------------------------------------------------------
export interface Scanner {
  id: string;
  name: string;
  serialNumber: string;
  brand: string;
  /** the office address the scanner must call from (one address or a range); null: from anywhere */
  allowedIp: string | null;
  active: boolean;
  lastSeenAt: string | null;
  lastIp: string | null;
  /** why the last call was refused (e.g. outside the IP lock); cleared when one is accepted */
  lastError: string | null;
  lastErrorAt: string | null;
  /** the scanner's clock is ahead: its punches are held back until it is restarted (20261023700000) */
  clockWarning: string | null;
  clockWarningAt: string | null;
  /** when the scanner last sent its users' names (20261024000000); null: not yet */
  usersReceivedAt: string | null;
}

export interface ScannerInput {
  name: string;
  serialNumber: string;
  allowedIp: string;
  active: boolean;
}

const str = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));

export const toScanner = (r: Record<string, unknown>): Scanner => ({
  id: String(r.id),
  name: String(r.name ?? ''),
  serialNumber: String(r.serial_number ?? ''),
  brand: String(r.brand ?? 'zkteco'),
  allowedIp: str(r.allowed_ip),
  active: r.active !== false,
  lastSeenAt: str(r.last_seen_at),
  lastIp: str(r.last_ip),
  lastError: str(r.last_error),
  lastErrorAt: str(r.last_error_at),
  clockWarning: str(r.clock_warning),
  clockWarningAt: str(r.clock_warning_at),
  usersReceivedAt: str(r.users_received_at),
});

/** A serial number as the database keeps it: trimmed, in capitals. */
export const normaliseSerial = (s: string) => s.trim().toUpperCase();
/** What a scanner serial number looks like (letters, digits, - and _). */
export const serialLooksRight = (s: string) => /^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(normaliseSerial(s));

export async function loadScanners(): Promise<Scanner[]> {
  const { data, error } = await supabase
    .from('attendance_devices')
    .select('id, name, serial_number, brand, allowed_ip, active, last_seen_at, last_ip, last_error, last_error_at, clock_warning, clock_warning_at, users_received_at')
    .order('created_at');
  if (error) fail(error);
  return ((data ?? []) as Record<string, unknown>[]).map(toScanner);
}

/** Adds a scanner (id null) or changes one. */
export async function saveScanner(id: string | null, input: ScannerInput): Promise<void> {
  const row = {
    name: input.name.trim(),
    serial_number: normaliseSerial(input.serialNumber),
    allowed_ip: input.allowedIp.trim() || null,
    active: input.active,
  };
  const { error } = id
    ? await supabase.from('attendance_devices').update(row).eq('id', id)
    : await supabase.from('attendance_devices').insert(row);
  if (error) fail(error);
}

export async function setScannerActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.from('attendance_devices').update({ active }).eq('id', id);
  if (error) fail(error);
}

export interface SerialCheck {
  /** a scanner with this serial number called in without being registered */
  tried: boolean;
  lastSeenAt: string | null;
}

/** Has a scanner with this serial number tried to connect (before it was registered)? */
export async function checkSerialTried(serial: string): Promise<SerialCheck> {
  const { data, error } = await supabase.rpc('attendance_scanner_tried', { p_serial: normaliseSerial(serial) });
  if (error) fail(error);
  const d = (data ?? {}) as Record<string, unknown>;
  return { tried: !!d.tried, lastSeenAt: str(d.last_seen_at) };
}

// ---------------------------------------------------------------------------------------------
// scanner users -> employees
// ---------------------------------------------------------------------------------------------
export interface ScannerUser {
  id: string;
  scannerUserId: string;
  employeeNumber: string;
}

export interface UnmatchedScannerUser {
  scannerUserId: string;
  punches: number;
  firstAt: string | null;
  lastAt: string | null;
}

export async function loadScannerUsers(): Promise<ScannerUser[]> {
  const { data, error } = await supabase
    .from('attendance_scanner_users')
    .select('id, scanner_user_id, employee_number');
  if (error) fail(error);
  return ((data ?? []) as Record<string, unknown>[])
    .map((r) => ({ id: String(r.id), scannerUserId: String(r.scanner_user_id ?? ''), employeeNumber: String(r.employee_number ?? '') }))
    .sort((a, b) => compareScannerIds(a.scannerUserId, b.scannerUserId));
}

/** The scanner user IDs seen in punches that aren't matched to anyone yet. */
export async function loadUnmatched(): Promise<UnmatchedScannerUser[]> {
  const { data, error } = await supabase.rpc('attendance_scanner_unmatched');
  if (error) fail(error);
  return ((data ?? []) as Record<string, unknown>[])
    .map((r) => ({
      scannerUserId: String(r.scanner_user_id ?? ''),
      punches: Number(r.punches ?? 0),
      firstAt: str(r.first_at),
      lastAt: str(r.last_at),
    }))
    .sort((a, b) => compareScannerIds(a.scannerUserId, b.scannerUserId));
}

/**
 * Matches a scanner user ID to an employee (a new match, or a change to one). The database then records that ID's
 * waiting punches as the employee's attendance.
 */
export async function saveScannerUser(id: string | null, scannerUserId: string, employeeNumber: string): Promise<void> {
  const row = { scanner_user_id: scannerUserId.trim(), employee_number: employeeNumber };
  const { error } = id
    ? await supabase.from('attendance_scanner_users').update(row).eq('id', id)
    : await supabase.from('attendance_scanner_users').insert(row);
  if (error) fail(error);
}

/** Removes a match. Attendance already recorded from it stays. */
export async function removeScannerUser(id: string): Promise<void> {
  const { error } = await supabase.from('attendance_scanner_users').delete().eq('id', id);
  if (error) fail(error);
}

/**
 * The name each scanner user ID has on the company's scanners (sent by the scanners themselves). When two scanners
 * name one ID differently, the one received last counts. Scanner user ID -> name.
 */
export async function loadScannerNames(): Promise<Map<string, string>> {
  const { data, error } = await supabase.from('attendance_scanner_names').select('scanner_user_id, name, updated_at');
  if (error) fail(error);
  const rows = ((data ?? []) as Record<string, unknown>[])
    .map((r) => ({ id: String(r.scanner_user_id ?? ''), name: String(r.name ?? '').trim(), at: String(r.updated_at ?? '') }))
    .filter((r) => r.id && r.name)
    .sort((a, b) => a.at.localeCompare(b.at));
  return new Map(rows.map((r) => [r.id, r.name]));
}

// ---------------------------------------------------------------------------------------------
// "Not staff, ignore"
// ---------------------------------------------------------------------------------------------
export interface IgnoredScannerUser {
  id: string;
  scannerUserId: string;
  reason: string;
  ignoredAt: string | null;
}

export async function loadIgnored(): Promise<IgnoredScannerUser[]> {
  const { data, error } = await supabase.from('attendance_scanner_ignored').select('id, scanner_user_id, reason, ignored_at');
  if (error) fail(error);
  return ((data ?? []) as Record<string, unknown>[])
    .map((r) => ({ id: String(r.id), scannerUserId: String(r.scanner_user_id ?? ''), reason: String(r.reason ?? ''), ignoredAt: str(r.ignored_at) }))
    .sort((a, b) => compareScannerIds(a.scannerUserId, b.scannerUserId));
}

/** Marks a scanner user as not staff: they leave "Waiting for a match" and their punches never count. */
export async function ignoreScannerUser(scannerUserId: string, reason: string): Promise<void> {
  const { error } = await supabase.from('attendance_scanner_ignored').insert({ scanner_user_id: scannerUserId.trim(), reason: reason.trim() });
  if (error) fail(error);
}

/** Undo: the scanner user waits for a match again. */
export async function unignoreScannerUser(id: string): Promise<void> {
  const { error } = await supabase.from('attendance_scanner_ignored').delete().eq('id', id);
  if (error) fail(error);
}

// ---------------------------------------------------------------------------------------------
// pure helpers
// ---------------------------------------------------------------------------------------------
/** Scanner user IDs in a natural order: 2 before 10. */
export function compareScannerIds(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** The number in an ID, without leading zeros ("FBL-000006" -> "6", "007" -> "7"); null when it has no digits. */
export function idDigits(id: string): string | null {
  const digits = id.replace(/\D/g, '');
  if (!digits) return null;
  return digits.replace(/^0+(?=\d)/, '');
}

/**
 * Suggested matches for "Match automatically": the employee whose employee number's digits are the scanner user ID
 * (FBL-000006 <-> 6). Only clear cases: a scanner ID that isn't all digits, two employees with the same digits, or an
 * employee already matched (`taken`) gets no suggestion. Returns scanner user ID -> employee number.
 */
export function suggestMatches(
  scannerUserIds: string[],
  employees: { employeeNumber: string }[],
  taken: Iterable<string> = []
): Map<string, string> {
  const busy = new Set(taken);
  const byDigits = new Map<string, string | null>();
  for (const e of employees) {
    const d = idDigits(e.employeeNumber);
    if (!d || busy.has(e.employeeNumber)) continue;
    // two people with the same digits: neither is a clear match
    byDigits.set(d, byDigits.has(d) ? null : e.employeeNumber);
  }
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const id of scannerUserIds) {
    if (!/^\d+$/.test(id.trim())) continue;
    const emp = byDigits.get(idDigits(id) ?? '');
    if (!emp || used.has(emp)) continue;
    out.set(id, emp);
    used.add(emp);
  }
  return out;
}

/** A name the way matching compares it: letters and digits only, lower case, accents dropped ("Ng'ang'a" -> "nganga"). */
export function nameKey(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

export interface NameMatchEmployee {
  employeeNumber: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  status?: string;
}

/** The separate parts of a person's name: "Morris Bundi Maina" -> morris, bundi, maina. */
function nameParts(e: NameMatchEmployee): string[] {
  return [e.firstName, e.middleName ?? '', e.lastName]
    .join(' ')
    .split(/[\s-]+/)
    .map(nameKey)
    .filter(Boolean);
}

/** Someone who has left can't be matched. */
const isActive = (e: { status?: string }) => !/terminat|resign|exit|left|inactive|deceas|dismiss/i.test(e.status ?? '');

/**
 * Does the name on the scanner name this person? Compared without case or spaces, it must be one whole part of their
 * name ("Esther", "Katam"), or parts run together in order ("Franciskiprono" = Francis Kiprono, "Esther Nalenyi");
 * several words must each be a part ("Kiprono Francis"). "Ann" is not "Anne".
 */
export function nameFits(scannerName: string, e: NameMatchEmployee): boolean {
  const key = nameKey(scannerName);
  if (!key) return false;
  const parts = nameParts(e);
  if (parts.includes(key)) return true;
  // parts run together, in order: first+last, first+middle, middle+last, first+middle+last...
  for (let i = 0; i < parts.length; i += 1) {
    for (let j = i + 1; j < parts.length; j += 1) {
      if (parts[i] + parts[j] === key || parts.slice(i, j + 1).join('') === key) return true;
    }
  }
  const words = scannerName.split(/\s+/).map(nameKey).filter(Boolean);
  return words.length > 1 && words.every((w) => parts.includes(w));
}

/** The active employees the scanner's name fits. */
export function employeesNamed<T extends NameMatchEmployee>(scannerName: string, employees: T[]): T[] {
  return employees.filter((e) => isActive(e) && nameFits(scannerName, e));
}

export interface ScannerSuggestions {
  /** scanner user ID -> the employee suggested, and why */
  matches: Map<string, { employeeNumber: string; by: 'name' | 'number' }>;
  /** scanner user ID -> its name on the scanner, when that name fits several people */
  ambiguous: Map<string, string>;
}

/**
 * "Match automatically", for each scanner user ID waiting (with its name on the scanner, when the scanner sent one):
 *   - a name that fits exactly one active employee suggests them;
 *   - a name that fits several suggests nobody (it is listed in ambiguous);
 *   - a name that fits nobody suggests nobody;
 *   - only with no name: the employee whose number has the ID's digits (FBL-000006 <-> 6), as suggestMatches. Once the
 *     scanner sends a name, it decides: scanner user IDs don't follow employee numbers (Figbloom's ID 3 is Esther,
 *     FBL-000010, not FBL-000003), so a name that disagrees always wins over the number.
 * Employees already matched (taken) aren't suggested, and an employee two IDs point at is suggested for neither.
 */
export function suggestScannerMatches(
  waiting: { scannerUserId: string; name?: string | null }[],
  employees: NameMatchEmployee[],
  taken: Iterable<string> = []
): ScannerSuggestions {
  const busy = new Set(taken);
  const active = employees.filter(isActive);
  const nameOf = (w: { name?: string | null }) => (w.name ?? '').trim();
  const byNumber = suggestMatches(waiting.filter((w) => !nameOf(w)).map((w) => w.scannerUserId), active, busy);
  const ambiguous = new Map<string, string>();
  const picked = new Map<string, { employeeNumber: string; by: 'name' | 'number' }>(
    [...byNumber].map(([id, employeeNumber]) => [id, { employeeNumber, by: 'number' as const }])
  );
  for (const w of waiting) {
    const name = nameOf(w);
    if (!name) continue;
    const named = employeesNamed(name, active);
    if (named.length > 1) ambiguous.set(w.scannerUserId, name);
    else if (named.length === 1 && !busy.has(named[0].employeeNumber)) {
      picked.set(w.scannerUserId, { employeeNumber: named[0].employeeNumber, by: 'name' });
    }
  }
  // one employee for two scanner users: neither is clear
  const count = new Map<string, number>();
  for (const m of picked.values()) count.set(m.employeeNumber, (count.get(m.employeeNumber) ?? 0) + 1);
  return { matches: new Map([...picked].filter(([, m]) => count.get(m.employeeNumber) === 1)), ambiguous };
}

/** "Thu 22 Oct 2026, 8:05 am" (Nairobi time), or the fallback when there is no time. */
export function seenLabel(at: string | null | undefined, never = 'Never connected'): string {
  if (!at) return never;
  const p = nairobiParts(at);
  return `${dayLabel(p.date)} ${p.date.slice(0, 4)}, ${clockLabel(p.time)}`;
}

/** Where scanners send their punches: the relay for plain-HTTP scanners (port 80), and this app for HTTPS ones (443). */
export function scannerServers(
  relayHost: string | undefined = import.meta.env.VITE_ICLOCK_RELAY_HOST,
  appHost: string = typeof window !== 'undefined' ? window.location.host : ''
): { relay: string | null; app: string } {
  const clean = (h: string | undefined) => (h ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  return { relay: clean(relayHost) || null, app: clean(appHost) };
}
