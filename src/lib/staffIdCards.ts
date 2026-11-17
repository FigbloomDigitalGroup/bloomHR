import { supabase } from './supabase';

// Staff ID cards ("job cards", migration 20261027400000). Each employee sees their own card in the staff portal; the
// 'staff-id-cards' module (ADMIN and HR to begin with) views, prints and reissues anyone's. The QR code on the back
// opens /verify/<token>, a public page that says whether the person is a current employee.

export const STAFF_ID_CARDS_MODULE = 'staff-id-cards';

/** One employee's card, as my_staff_id_card() and staff_id_cards() return it. */
export interface StaffIdCardData {
  employee_id: string;
  employee_number: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  job_title: string | null;
  department: string | null;
  branch: string | null;
  work_phone: string | null;
  work_email: string | null;
  /** only when the company has chosen to show it */
  date_of_birth: string | null;
  date_joined: string | null;
  contract_end_date: string | null;
  photo_url: string | null;
  is_active: boolean;
  token: string;
  issued_at: string;
  /** how the photo sits in the hexagon (20261027600000); centred when missing or set for an earlier photo */
  photo_x?: number | string | null;
  photo_y?: number | string | null;
  photo_zoom?: number | string | null;
}

/** What the company has chosen for its cards (staff_id_card_settings); a company with no row gets the defaults. */
export interface StaffIdCardSettings {
  show_date_of_birth: boolean;
  signatory_name: string | null;
  signatory_title: string | null;
  /** a PNG data: URL */
  signature: string | null;
}

export const DEFAULT_CARD_SETTINGS: StaffIdCardSettings = {
  show_date_of_birth: false, signatory_name: null, signatory_title: null, signature: null,
};

/** What the public check shows (verify_staff_id_card). */
export interface VerifiedCard {
  company_name: string;
  company_logo_url: string | null;
  full_name: string;
  photo_url: string | null;
  job_title: string | null;
  is_active: boolean;
}

const fail = (error: { message?: string } | null, fallback: string): never => {
  throw new Error(error?.message || fallback);
};

/** The signed-in person's own card; null when they have no employee record in this company. */
export async function loadMyStaffIdCard(): Promise<StaffIdCardData | null> {
  const { data, error } = await supabase.rpc('my_staff_id_card');
  if (error) fail(error, 'Could not load your ID card.');
  return ((data as StaffIdCardData[] | null) ?? [])[0] ?? null;
}

/** Anyone's cards (the module): one, a selection or a whole department. */
export async function loadStaffIdCards(employeeIds: string[]): Promise<StaffIdCardData[]> {
  if (employeeIds.length === 0) return [];
  const { data, error } = await supabase.rpc('staff_id_cards', { p_employee_ids: employeeIds });
  if (error) fail(error, 'Could not load the ID cards.');
  return (data as StaffIdCardData[] | null) ?? [];
}

/** Reissues a card: a new QR code, and the old card no longer verifies. */
export async function regenerateStaffIdCard(employeeId: string): Promise<{ token: string; issued_at: string }> {
  const { data, error } = await supabase.rpc('regenerate_staff_id_card', { p_employee_id: employeeId });
  if (error) fail(error, 'The card was not reissued.');
  const row = (Array.isArray(data) ? data[0] : data) as { token: string; issued_at: string } | undefined;
  if (!row) throw new Error('The card was not reissued.');
  return row;
}

/** Moves or zooms the photo on a card (the card holder their own, the module anyone's). The photo itself is unchanged. */
export async function setStaffIdCardPhotoFraming(employeeId: string, framing: PhotoFraming): Promise<void> {
  const { error } = await supabase.rpc('set_staff_id_card_photo_framing', {
    p_employee_id: employeeId, p_x: framing.x, p_y: framing.y, p_zoom: framing.zoom,
  });
  if (error) fail(error, 'The photo position was not saved.');
}

/** The public check behind the QR code; null when the card is unknown or has been reissued. */
export async function verifyStaffIdCard(token: string): Promise<VerifiedCard | null> {
  const { data, error } = await supabase.rpc('verify_staff_id_card', { p_token: token });
  if (error) fail(error, 'Could not check this card.');
  return ((data as VerifiedCard[] | null) ?? [])[0] ?? null;
}

export async function loadCardSettings(): Promise<StaffIdCardSettings> {
  const { data, error } = await supabase
    .from('staff_id_card_settings')
    .select('show_date_of_birth, signatory_name, signatory_title, signature')
    .maybeSingle();
  if (error) return DEFAULT_CARD_SETTINGS; // e.g. before the migration is applied: the cards still show
  return { ...DEFAULT_CARD_SETTINGS, ...((data as Partial<StaffIdCardSettings> | null) ?? {}) };
}

export async function saveCardSettings(settings: StaffIdCardSettings): Promise<StaffIdCardSettings> {
  const blank = (v: string | null) => (v ?? '').trim() || null;
  const { data, error } = await supabase
    .from('staff_id_card_settings')
    .upsert(
      { ...settings, signatory_name: blank(settings.signatory_name), signatory_title: blank(settings.signatory_title) },
      { onConflict: 'tenant_id' },
    )
    .select('show_date_of_birth, signatory_name, signatory_title, signature')
    .single();
  if (error) fail(error, 'The card settings were not saved.');
  return data as StaffIdCardSettings;
}

// ---------------------------------------------------------------------------------------------
// what the card shows
// ---------------------------------------------------------------------------------------------

/** The address the QR code opens. */
export const verifyUrl = (token: string, origin: string = window.location.origin) => `${origin}/verify/${token}`;

/** First name, and the rest (middle and last), so the card can set the first name in bold. */
export function nameParts(card: Pick<StaffIdCardData, 'first_name' | 'middle_name' | 'last_name'>): { first: string; rest: string } {
  const first = (card.first_name ?? '').trim();
  const rest = [card.middle_name, card.last_name].map((v) => (v ?? '').trim()).filter(Boolean).join(' ');
  if (!first && !rest) return { first: 'Unnamed', rest: 'employee' };
  return { first, rest };
}

export const fullName = (card: Pick<StaffIdCardData, 'first_name' | 'middle_name' | 'last_name'>) => {
  const { first, rest } = nameParts(card);
  return [first, rest].filter(Boolean).join(' ');
};

/** Which point of the photo sits in the middle of the hexagon (0 to 1 across and down), and the zoom (1 to 4). */
export interface PhotoFraming {
  x: number;
  y: number;
  zoom: number;
}

export const CENTRED: PhotoFraming = { x: 0.5, y: 0.5, zoom: 1 };

const between = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: number | string | null | undefined, fallback: number) => {
  const n = Number(v);
  return v === null || v === undefined || v === '' || !Number.isFinite(n) ? fallback : n;
};

export function framingOf(card: Pick<StaffIdCardData, 'photo_x' | 'photo_y' | 'photo_zoom'>): PhotoFraming {
  return {
    x: between(num(card.photo_x, 0.5), 0, 1),
    y: between(num(card.photo_y, 0.5), 0, 1),
    zoom: between(num(card.photo_zoom, 1), 1, 4),
  };
}

/**
 * Where to draw a photo of `natural` size (null while it loads: taken as square) so that it covers a `size` square
 * centred on (cx, cy), zoomed, with the framing's point in the middle. The photo never leaves a gap: near an edge it
 * stops, and `framing` is that reachable point.
 */
export function placePhoto(
  natural: { w: number; h: number } | null,
  framing: PhotoFraming,
  cx: number,
  cy: number,
  size: number,
): { x: number; y: number; width: number; height: number; framing: PhotoFraming } {
  const w = natural?.w || 1;
  const h = natural?.h || 1;
  const zoom = between(framing.zoom, 1, 4);
  const scale = Math.max(size / w, size / h) * zoom;
  const width = w * scale;
  const height = h * scale;
  const x = between(cx - framing.x * width, cx + size / 2 - width, cx - size / 2);
  const y = between(cy - framing.y * height, cy + size / 2 - height, cy - size / 2);
  return { x, y, width, height, framing: { x: (cx - x) / width, y: (cy - y) / height, zoom } };
}

/** Up to two letters for when there is no photo: first and last name. */
export function initials(card: Pick<StaffIdCardData, 'first_name' | 'last_name'>): string {
  const letters = [card.first_name, card.last_name].map((v) => (v ?? '').trim().charAt(0)).filter(Boolean).join('');
  return letters.toUpperCase() || '?';
}

/**
 * A date as the employee record keeps it (text: '2024-03-01', '01/03/2024', ...), or null when it can't be read.
 * Day-first, as dates are written in East Africa.
 */
export function parseRecordDate(value: string | null | undefined): Date | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

export const formatCardDate = (d: Date | null) =>
  d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';

/** A record date for the card: formatted when it can be read, as typed otherwise. */
export const cardDate = (value: string | null | undefined) => formatCardDate(parseRecordDate(value)) || (value ?? '').trim();

/** How long a card lasts from when it was issued, unless the contract ends first. */
export const CARD_VALID_YEARS = 2;

/** When the card expires: two years from issue, or the end of the employee's contract if that comes first. */
export function cardExpiry(card: Pick<StaffIdCardData, 'issued_at' | 'contract_end_date'>): Date | null {
  const issued = card.issued_at ? new Date(card.issued_at) : null;
  const twoYears = issued && !Number.isNaN(issued.getTime())
    ? new Date(Date.UTC(issued.getUTCFullYear() + CARD_VALID_YEARS, issued.getUTCMonth(), issued.getUTCDate()))
    : null;
  const contractEnd = parseRecordDate(card.contract_end_date);
  if (twoYears && contractEnd) return contractEnd < twoYears ? contractEnd : twoYears;
  return twoYears ?? contractEnd;
}
