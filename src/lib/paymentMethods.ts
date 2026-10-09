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
