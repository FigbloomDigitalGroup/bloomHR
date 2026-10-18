// Money on payslips, the register and the Run tab in the payslip's own currency (FIG-905): KSh for Kenya, TSh for
// Tanzania, USh for Uganda. Amounts in different currencies are never added together (see totalsByCurrency).

const SYMBOLS: Record<string, string> = { KES: 'KSh', TZS: 'TSh', UGX: 'USh', RWF: 'FRw' };

/** The currency code on a payslip; KES for payslips saved before payslips had one. */
export const currencyOf = (record: { currency?: unknown } | null | undefined): string => {
  const c = String(record?.currency ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : 'KES';
};

/** "KSh", "TSh", "USh"; the code itself for other currencies. */
export const currencySymbol = (currency: string | null | undefined): string => {
  const c = String(currency ?? '').trim().toUpperCase() || 'KES';
  return SYMBOLS[c] ?? c;
};

/** "KSh 12,345.5", the way payslips always showed amounts (the number as it is, with thousands separators). */
export const money = (amount: number | null | undefined, currency?: string | null): string =>
  `${currencySymbol(currency)} ${(Number(amount) || 0).toLocaleString()}`;

/** "KSh 12,346": rounded to a whole amount. */
export const moneyRounded = (amount: number | null | undefined, currency?: string | null): string =>
  `${currencySymbol(currency)} ${Math.round(Number(amount) || 0).toLocaleString()}`;

/** "KSh 3.1M", "TSh 850K": for summaries. */
export const moneyShort = (amount: number, currency?: string | null): string => {
  const n = Number(amount) || 0;
  const abs = Math.abs(n);
  const short =
    abs >= 1_000_000_000 ? `${+(n / 1_000_000_000).toFixed(1)}B` : abs >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : abs >= 10_000 ? `${Math.round(n / 1000)}K` : Math.round(n).toLocaleString();
  return `${currencySymbol(currency)} ${short}`;
};
