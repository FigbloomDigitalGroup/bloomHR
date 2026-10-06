// How complete an employee's own information is. Staff fill in most of it themselves; HR only enters the company
// basics, so both the staff portal ("Complete your profile") and the employees list use the same checklist.

export type EmployeeRecord = Record<string, unknown>;

export interface ProfileItem {
  key: 'photo' | 'mobile' | 'personalEmail' | 'dob' | 'idNumber' | 'taxPin' | 'payment' | 'emergency';
  label: string;
  hint: string;
  done: boolean;
}

const filled = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  return String(value).trim() !== '';
};

/** Paid by mobile money or cash needs no bank account; anything else needs the bank and account number. */
function paymentDone(employee: EmployeeRecord): boolean {
  const method = String(employee['payment_method'] ?? '').toLowerCase();
  if (/mpesa|m-pesa|mobile|cash/.test(method)) return true;
  return filled(employee['Bank']) && filled(employee['Account Number']);
}

/**
 * The checklist for one employee. `hasEmergencyContact` comes from a separate table: pass null when it is not known
 * (the item is then left out rather than shown as missing).
 */
export function profileItems(employee: EmployeeRecord | null | undefined, hasEmergencyContact: boolean | null): ProfileItem[] {
  const e = employee ?? {};
  const items: ProfileItem[] = [
    { key: 'photo', label: 'Profile picture', hint: 'So colleagues recognise you', done: filled(e['Profile Image']) },
    { key: 'mobile', label: 'Mobile number', hint: 'Used for SMS and payments', done: filled(e['Mobile Number']) },
    { key: 'personalEmail', label: 'Personal email', hint: 'For account recovery', done: filled(e['Personal Email']) },
    { key: 'dob', label: 'Date of birth', hint: 'For birthdays and statutory records', done: filled(e['Date of Birth']) },
    { key: 'idNumber', label: 'National ID number', hint: 'Needed for payroll and statutory filings', done: filled(e['ID Number']) },
    { key: 'taxPin', label: 'Tax PIN (KRA)', hint: 'Needed for payroll tax', done: filled(e['Tax PIN']) },
    { key: 'payment', label: 'Payment details', hint: 'Where your salary is paid', done: paymentDone(e) },
  ];
  if (hasEmergencyContact !== null) {
    items.push({ key: 'emergency', label: 'Emergency contact', hint: 'Who to call if something happens', done: hasEmergencyContact });
  }
  return items;
}

export interface ProfileScore {
  done: number;
  total: number;
  percent: number;
  missing: ProfileItem[];
  complete: boolean;
}

export function profileScore(items: ProfileItem[]): ProfileScore {
  const done = items.filter((i) => i.done).length;
  const total = items.length;
  return {
    done,
    total,
    percent: total === 0 ? 100 : Math.round((done / total) * 100),
    missing: items.filter((i) => !i.done),
    complete: done === total,
  };
}
