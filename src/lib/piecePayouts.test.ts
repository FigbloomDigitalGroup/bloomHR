import { describe, expect, it } from 'vitest';
import { toCsv } from './payrollExports';
import {
  cleanAccount, defaultPeriod, isValidAccount, lineHeld, myPayoutTotals, payoutBankFile, payoutEquityFile, payoutFileSlug, payoutHoldbacks,
  payoutMpesaFile, payoutReference, PAYOUT_MPESA_HEADERS, type PayoutLine,
} from './piecePayouts';

const EMPLOYEE = { contractor: false, ahlRate: 0.015, reserveRate: 0.1, whtRate: 0 };
const CONTRACTOR = { contractor: true, ahlRate: 0.015, reserveRate: 0.1, whtRate: 0.03 };

describe('holdbacks', () => {
  it('employees: AHL 1.5% and the reserve, net in whole shillings', () => {
    expect(payoutHoldbacks(1000, EMPLOYEE)).toEqual({ gross: 1000, ahl: 15, reserve: 100, wht: 0, net: 885, rounding: 0 });
  });

  it('rounds the net down, holding the cents back so everything adds up to gross', () => {
    const h = payoutHoldbacks(86.38, EMPLOYEE);
    expect(h).toEqual({ gross: 86.38, ahl: 1.3, reserve: 8.64, wht: 0, net: 76, rounding: 0.44 });
    expect(Math.round((h.net + h.ahl + h.reserve + h.wht + h.rounding) * 100) / 100).toBe(h.gross);
  });

  it('contractors: withholding tax only, unless the company holds the reserve from them too', () => {
    expect(payoutHoldbacks(1000, CONTRACTOR)).toMatchObject({ ahl: 0, reserve: 0, wht: 30, net: 970 });
    expect(payoutHoldbacks(500, { ...CONTRACTOR, whtRate: 0.05 })).toMatchObject({ wht: 25, net: 475 });
    expect(payoutHoldbacks(500, { ...CONTRACTOR, contractorReserve: true })).toMatchObject({ wht: 15, reserve: 50, net: 435 });
  });

  it('never below 0', () => {
    expect(payoutHoldbacks(0.5, EMPLOYEE)).toEqual({ gross: 0.5, ahl: 0.01, reserve: 0.05, wht: 0, net: 0, rounding: 0.44 });
    expect(payoutHoldbacks(-20, EMPLOYEE).net).toBe(0);
    expect(payoutHoldbacks(100, { ...EMPLOYEE, reserveRate: 0.5 }).net).toBe(48);
  });

  it('held back on a line, and my totals', () => {
    expect(lineHeld({ gross: '86.38', net: '76.00' })).toBe(10.38);
    expect(myPayoutTotals(null)).toEqual({ paid: 0, held: 0, count: 0 });
  });
});

describe('default days', () => {
  it('daily today; weekly from Monday, kept in the month; jobs and ad hoc the month so far', () => {
    expect(defaultPeriod('daily', '2026-10-18')).toEqual({ from: '2026-10-18', to: '2026-10-18' });
    expect(defaultPeriod('weekly', '2026-10-15')).toEqual({ from: '2026-10-12', to: '2026-10-15' });
    expect(defaultPeriod('weekly', '2026-10-02')).toEqual({ from: '2026-10-01', to: '2026-10-02' }); // Monday was 28 Sep
    expect(defaultPeriod('job', '2026-10-18')).toEqual({ from: '2026-10-01', to: '2026-10-18' });
  });
});

const line = (over: Partial<PayoutLine>): PayoutLine => ({
  id: 'l', batch_id: 'b', employee_number: 'W1', worker_name: 'Wanjiru One', worker_kind: 'employee', wht_category: null,
  work_from: '2026-10-12', work_to: '2026-10-18', work_amount: 1000, jobs_amount: 0, gross: 1000, ahl_rate: 0.015, reserve_rate: 0.1,
  wht_rate: 0, ahl: 15, reserve: 100, wht: 0, rounding: 0, net: 885, payment_method: 'M-Pesa', payment_kind: 'mobile',
  phone: '254712345678', bank: null, bank_branch: null, bank_code: null, branch_code: null, account_name: null, account_number: null,
  payroll_number: null, id_number: '12345678', problem: null, ...over,
});
const WEEK = { kind: 'weekly' as const, period_from: '2026-10-12', period_to: '2026-10-18' };
const LINES = [
  line({}),
  line({ id: 'l2', employee_number: 'W2', worker_name: 'Otieno, "Big" Two', payment_method: 'Bank Transfer', payment_kind: 'bank', phone: null,
    bank: 'KCB', bank_code: '01', bank_branch: 'Moi Avenue', branch_code: '094', account_name: null, account_number: '1100 2233-44', net: 442 }),
  line({ id: 'l3', employee_number: 'W3', worker_name: '=HYPERLINK("x")', payment_kind: 'mobile', phone: '0722 000 111', net: 300 }),
  line({ id: 'l4', employee_number: 'W4', worker_name: 'Cash Person', payment_method: 'Cash', payment_kind: 'cash', phone: null, net: 100 }),
  line({ id: 'l5', employee_number: 'W5', worker_name: 'Zero Net', net: 0 }),
  line({ id: 'l6', employee_number: 'W6', worker_name: 'Bad Phone', phone: '12345', net: 50 }),
  line({ id: 'l7', employee_number: 'W7', worker_name: 'Equity Person', payment_kind: 'bank', bank: 'Equity Bank', account_number: '0123456789', net: 1000 }),
];

describe('references and names', () => {
  it('say what the payment is for', () => {
    expect(payoutReference(WEEK)).toBe('Weekly pay 2026-10-12 to 2026-10-18');
    expect(payoutReference({ kind: 'daily', period_from: '2026-10-12', period_to: '2026-10-12' })).toBe('Daily pay 2026-10-12');
    expect(payoutFileSlug({ kind: 'ad_hoc', period_from: '2026-10-01', period_to: '2026-10-18' })).toBe('payout-ad-hoc-2026-10-01-to-2026-10-18');
  });
});

describe('accounts', () => {
  it('spaces and dashes dropped; 5 to 20 letters or digits', () => {
    expect(cleanAccount(' 1100 2233-44 ')).toBe('1100223344');
    expect(isValidAccount('1100 2233-44')).toBe(true);
    expect(isValidAccount('123')).toBe(false);
    expect(isValidAccount('12345678901234567890123')).toBe(false);
    expect(isValidAccount('12#45678')).toBe(false);
  });
});

describe('the M-Pesa bulk (B2C) file', () => {
  it('phones as 2547XXXXXXXX, whole shillings, only M-Pesa lines with something to pay, problems listed', () => {
    const f = payoutMpesaFile(LINES, WEEK);
    expect(f.headers).toEqual(PAYOUT_MPESA_HEADERS);
    expect(f.rows).toEqual([
      ['254712345678', '885', 'Wanjiru One', 'Weekly pay 2026-10-12 to 2026-10-18'],
      ['254722000111', '300', '=HYPERLINK("x")', 'Weekly pay 2026-10-12 to 2026-10-18'],
      ['', '50', 'Bad Phone', 'Weekly pay 2026-10-12 to 2026-10-18'],
    ]);
    expect(f.problems).toEqual([{ name: 'Bad Phone', employeeNumber: 'W6', missing: ['M-Pesa number (07XXXXXXXX or 2547XXXXXXXX)'] }]);
  });

  it('M-Pesa Kenya pays KES only: a TZS or UGX payout gets no rows, with a note', () => {
    for (const currency of ['TZS', 'UGX']) {
      const f = payoutMpesaFile(LINES, { ...WEEK, currency });
      expect(f.rows).toEqual([]);
      expect(f.note).toBe(`3 payslips in ${currency} aren't paid through M-Pesa Kenya. Use the bank or mobile money file for their currency.`);
    }
    expect(payoutMpesaFile(LINES, { ...WEEK, currency: 'KES' }).rows).toHaveLength(3);
  });

  it('CSV: names quoted when needed, formulas kept as text', () => {
    const csv = toCsv(payoutMpesaFile(LINES, WEEK).headers, payoutMpesaFile(LINES, WEEK).rows);
    expect(csv.split('\r\n')[0]).toBe('Phone Number,Amount,Name,Reference');
    expect(csv).toContain(`254722000111,300,"'=HYPERLINK(""x"")",Weekly pay`);
  });
});

describe('the bank file', () => {
  it('name, ID, bank, branch, account, amount, reference; only bank lines', () => {
    const f = payoutBankFile(LINES, WEEK);
    expect(f.headers.slice(0, 3)).toEqual(['Name', 'ID Number', 'Bank']);
    expect(f.rows[0]).toEqual([
      'Otieno, "Big" Two', '12345678', 'KCB', '01', 'Moi Avenue', '094', 'Otieno, "Big" Two', '1100223344', '442.00',
      'Weekly pay 2026-10-12 to 2026-10-18', 'W2',
    ]);
    expect(f.rows).toHaveLength(2);
    expect(toCsv(f.headers, f.rows)).toContain('"Otieno, ""Big"" Two"');
  });

  it('lists a missing bank or a bad account number', () => {
    const f = payoutBankFile([line({ payment_kind: 'bank', bank: null, account_number: '12' })], WEEK);
    expect(f.problems[0].missing).toEqual(['Bank', 'Account number (5 to 20 letters or digits)']);
  });
});

describe('the Equity Eazzy Biz file', () => {
  it("reuses payroll's generator: MW for M-Pesa, BT within Equity, LBT to other banks with the 5-digit code", () => {
    const f = payoutEquityFile(LINES, '1234567890');
    const byName = Object.fromEntries(f.rows.map((r) => [r[3], r]));
    expect(byName['Wanjiru One'].slice(0, 2)).toEqual(['MW', '1234567890']);
    expect(byName['Wanjiru One'][7]).toBe('885.00');
    expect(byName['Wanjiru One'][10]).toBe('0712345678');
    expect(byName['Otieno, "Big" Two']).toEqual(
      ['LBT', '1234567890', '1100223344', 'Otieno, "Big" Two', '01094', 'SAL', 'KES', '442.00', 'EFT', '', '', '']);
    expect(byName['Equity Person'].slice(0, 5)).toEqual(['BT', '1234567890', '0123456789', 'Equity Person', '68000']);
    expect(byName['Cash Person']).toBeUndefined();
    expect(byName['Zero Net']).toBeUndefined();
    expect(f.problems.map((p) => p.name)).toEqual(['Bad Phone']);
  });
});
