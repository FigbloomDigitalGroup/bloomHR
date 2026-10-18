// How an employee's salary is paid. Older records and forms saved the same method several ways ("MPESA",
// "Mobile Money", "M-Pesa"), and payroll, payslips and filters compare exact text, so everything reads it through here.

/** The methods offered in the employee forms, spelled as they are saved. */
export const PAYMENT_METHODS = ['M-Pesa', 'Airtel Money', 'Bank Transfer', 'Cash'] as const;

const text = (value: unknown) => (value === null || value === undefined ? '' : String(value).trim());

/** The standard spelling of a method, from however it was typed or saved. Undefined when blank or not one we know. */
export const normalisePaymentMethod = (value: unknown): string | undefined => {
  const v = text(value).toLowerCase().replace(/[\s_-]/g, '');
  if (/^(mpesa|mobilemoney|mobile|safaricom)$/.test(v)) return 'M-Pesa';
  if (/^airtel(money)?$/.test(v)) return 'Airtel Money';
  if (/^(bank|banktransfer|eft|rtgs)$/.test(v)) return 'Bank Transfer';
  if (v === 'cash') return 'Cash';
  return undefined;
};

/** The method as payroll and payslips show it. No method set means M-Pesa, as payroll pays it; unknown text is kept. */
export const paymentMethodLabel = (value: unknown): string => {
  if (!text(value)) return 'M-Pesa';
  return normalisePaymentMethod(value) ?? text(value);
};

/** The value for a payment method dropdown: the standard spelling when known, blank stays blank. */
export const paymentMethodOption = (value: unknown): string => (text(value) ? paymentMethodLabel(value) : '');

/**
 * What the method needs: mobile money needs a phone number, cash needs nothing, anything else is a bank transfer.
 * No method set counts as mobile, as payroll pays it by M-Pesa.
 */
export type PaymentKind = 'mobile' | 'cash' | 'bank';

export const paymentKind = (value: unknown): PaymentKind => {
  const label = paymentMethodLabel(value);
  if (label === 'M-Pesa' || label === 'Airtel Money') return 'mobile';
  if (label === 'Cash') return 'cash';
  return 'bank';
};

/**
 * Whether M-Pesa bulk pay may pay this payroll record: only staff paid by M-Pesa (no method set counts, as payroll
 * pays it by M-Pesa). Bank, cash and Airtel staff are paid another way; M-Pesa cannot pay an Airtel number.
 */
export const isPaidByMpesa = (record: { payment_method?: unknown } | null | undefined) => paymentMethodLabel(record?.payment_method) === 'M-Pesa';

/**
 * Whether M-Pesa Kenya may pay this payslip: it pays Kenyan shillings only, so only KES payslips (no currency counts,
 * as payslips saved before they had one are Kenya's). TZS, UGX and USD payslips go out by their own currency's bank or
 * mobile money file. The server's M-Pesa route refuses any other currency too (mpesa.js).
 */
export const isKesPayslip = (record: { currency?: unknown } | null | undefined) => {
  const c = text(record?.currency).toUpperCase();
  return c === '' || c === 'KES';
};

/** The payslips M-Pesa Kenya may pay (KES) and the ones it must leave out (any other currency). */
export function splitForMpesaKenya<T extends { currency?: unknown }>(records: readonly T[]): { kes: T[]; other: T[] } {
  const kes: T[] = [];
  const other: T[] = [];
  for (const r of records) (isKesPayslip(r) ? kes : other).push(r);
  return { kes, other };
}

/**
 * "2 payslips in TZS/USD aren't paid through M-Pesa Kenya. Use the bank or mobile money file for their currency.",
 * or null when every payslip is in KES.
 */
export function mpesaKenyaNote(records: readonly { currency?: unknown }[]): string | null {
  const other = records.filter((r) => !isKesPayslip(r));
  if (other.length === 0) return null;
  const currencies = [...new Set(other.map((r) => text(r.currency).toUpperCase()))].sort();
  const one = other.length === 1;
  return `${other.length} ${one ? 'payslip' : 'payslips'} in ${currencies.join('/')} ${one ? "isn't" : "aren't"} paid through M-Pesa Kenya. Use the bank or mobile money file for ${one ? 'its' : 'their'} currency.`;
}
