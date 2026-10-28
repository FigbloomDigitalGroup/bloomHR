import { money } from '../../lib/payroll/currency';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

vi.mock('html2pdf.js', () => ({ default: () => ({ from: () => ({ set: () => ({ save: vi.fn() }) }) }) }));

import { PayslipDocument } from './PayslipDocument';
import { KENYA_RATES, baseContext } from '../../lib/payroll/countries/kenyaFixtures';
import { TANZANIA_RATES } from '../../lib/payroll/countries/tanzaniaFixtures';
import { UGANDA_RATES } from '../../lib/payroll/countries/ugandaFixtures';
import { kenyaEngine, tanzaniaEngine, ugandaEngine } from '../../lib/payroll/countries';
import { calculateInUsd } from '../../lib/payroll/usdPay';
import { DEFAULT_DESIGN } from '../../lib/payslipDesign';
import type { PayslipExtras } from '../../lib/payslipExtras';

// FIG-814: one payslip layout, every section from the engine's own figures, for Kenya, Tanzania, Uganda and USD.

const employee = (number: string, extra: Record<string, unknown> = {}) => ({
  id: `id-${number}`, 'Employee Number': number, 'First Name': 'Amina', 'Last Name': number, 'Job Title': 'Accountant', Department: 'Finance',
  'Basic Salary': 100000, house_allowance: 20000, 'Tax PIN': 'A012345678Z', 'NSSF Number': '123456789', 'SHIF Number': 'CR123', 'ID Number': '12345678',
  payment_method: 'bank', Bank: 'Equity Bank', 'Account Number': '0123456789', ...extra,
});

// the statutory numbers shown, so each country's own labels can be checked
const WITH_NUMBERS = { ...DEFAULT_DESIGN, show_statutory_numbers: true };

const extrasFor = (country: string, over: Partial<PayslipExtras> = {}): PayslipExtras => ({
  design: WITH_NUMBERS,
  employer: {
    name: 'Acme Ltd', logoUrl: null, letterheadUrl: null, address: 'Plot 7, Mombasa Road, Nairobi', phone: '+254 700 000000', email: 'pay@acme.co', website: null,
    taxLabel: country === 'Kenya' ? 'KRA PIN' : 'TIN', taxNumber: country === 'Kenya' ? 'P051234567X' : '123456789',
  },
  employee: {
    taxNumber: country === 'Kenya' ? 'A012345678Z' : '100123456', nssfNumber: '123456789', shaNumber: country === 'Kenya' ? 'CR123' : null, idNumber: '12345678',
    branch: 'Head office', department: 'Finance', position: 'Accountant', jobGroup: 'G5',
  },
  run: { runId: 'abcd1234-0000-0000-0000-000000000000', ref: '2026-10 · ABCD1234', status: 'paid', approvedAt: '2026-10-28T09:00:00Z', paidAt: '2026-10-30T09:00:00Z' },
  ytd: null,
  ...over,
});

afterEach(() => cleanup());

const amountOf = (testId: string) => screen.getByTestId(testId).textContent ?? '';
const section = (testId: string) => within(screen.getByTestId(testId));

describe('a Kenya payslip', () => {
  const rates = { ...KENYA_RATES, personal_relief: 2500 }; // not the old 2,400
  const record = kenyaEngine.calculate({ employee: employee('KE1', { insurance_premium: 4000, car_benefit: 5000 }), ctx: baseContext({ rates }) }).record;

  it('shows the employer and employee blocks with the Kenyan numbers', () => {
    render(<PayslipDocument record={record} companyInfo={{ company_name: 'Acme Ltd' }} extras={extrasFor('Kenya')} />);
    const employer = section('payslip-employer');
    expect(employer.getByText('Acme Ltd')).toBeTruthy();
    expect(employer.getByText('Plot 7, Mombasa Road, Nairobi')).toBeTruthy();
    expect(employer.getByText('KRA PIN: P051234567X')).toBeTruthy();
    expect(amountOf('employee-tax-number')).toBe('KRA PIN:A012345678Z');
    expect(amountOf('employee-sha-number')).toBe('SHA number:CR123');
    const emp = section('payslip-employee');
    expect(emp.getByText('ID number:')).toBeTruthy();
    expect(emp.getByText('Kenya')).toBeTruthy();
    expect(emp.getByText('Head office')).toBeTruthy();
  });

  it('groups deductions before tax, tax and after tax, from the engine', () => {
    render(<PayslipDocument record={record} companyInfo={{}} extras={extrasFor('Kenya')} />);
    const before = section('deductions-before-tax');
    expect(before.getByText('NSSF').nextSibling?.textContent).toBe(money(record.nssf_deduction, 'KES'));
    expect(before.getByText('SHIF').nextSibling?.textContent).toBe(money(record.nhif_deduction, 'KES'));
    expect(before.getByText('Housing levy')).toBeTruthy();
    expect(section('deductions-tax').getByText('PAYE').nextSibling?.textContent).toBe(money(record.paye_tax, "KES"));
  });

  it('shows taxable pay and the reliefs with their real amounts (personal relief from the rate)', () => {
    render(<PayslipDocument record={record} companyInfo={{}} extras={extrasFor('Kenya')} />);
    expect(amountOf('taxable-pay')).toContain(`KSh ${record.taxable_pay.toLocaleString()}`);
    expect(amountOf('relief-personal')).toContain('−KSh 2,500');
    expect(screen.queryByText(/2,400/)).toBeNull();
    expect(amountOf('relief-insurance')).toContain('−KSh 600'); // 15% of 4,000
    expect(section('taxable-benefits').getByText('Car benefit')).toBeTruthy();
    expect(section('payslip-taxable-pay').getByText('Allowed before tax')).toBeTruthy();
  });

  it('marks employer contributions as paid by the employer', () => {
    render(<PayslipDocument record={record} companyInfo={{}} extras={extrasFor('Kenya')} />);
    const er = section('employer-contributions');
    expect(er.getByText('Paid by your employer, not deducted from your pay')).toBeTruthy();
    expect(er.getByText('NSSF (employer)').nextSibling?.textContent).toBe(`KSh ${record.nssf_deduction.toLocaleString()}`);
    expect(er.getByText('Housing levy (employer)')).toBeTruthy();
    expect(er.getByText('NITA levy').nextSibling?.textContent).toBe('KSh 50');
  });

  it('shows the run reference, pay date and that it is computer generated', () => {
    render(<PayslipDocument record={record} companyInfo={{}} extras={extrasFor('Kenya')} />);
    const footer = amountOf('payslip-footer');
    expect(footer).toContain('Payroll run 2026-10 · ABCD1234');
    expect(footer).toContain('Paid 30 Oct 2026');
    expect(footer).toContain('This payslip is computer generated');
  });

  it('shows the year to date in the payslip currency', () => {
    const ytd = {
      currency: 'KES', country: 'Kenya', taxYear: { start: '2026-01', end: '2026-12', label: '2026' }, months: 10, gross_pay: 1200000, taxable_pay: 1100000,
      taxable_missing: 0, paye_tax: 250000, nssf_deduction: 43200, net_pay: 850000, other_currencies: [],
    };
    render(<PayslipDocument record={record} companyInfo={{}} extras={extrasFor('Kenya', { ytd })} />);
    expect(section('payslip-ytd').getByText(/Kenya tax year 2026, 10 months, in KES/)).toBeTruthy();
    expect(amountOf('ytd-gross')).toBe('KSh 1,200,000');
    expect(amountOf('ytd-paye')).toBe('KSh 250,000');
    expect(amountOf('ytd-net')).toBe('KSh 850,000');
  });

  it('hides the sections the design turns off, but never deductions or net pay', () => {
    const ytd = { currency: 'KES', country: 'Kenya', taxYear: { start: '2026-01', end: '2026-12', label: '2026' }, months: 1, gross_pay: 1, taxable_pay: 1, taxable_missing: 0, paye_tax: 1, nssf_deduction: 1, net_pay: 1, other_currencies: [] };
    const design = { ...DEFAULT_DESIGN, show_employer_contributions: false, show_ytd: false, show_bank_details: false, footer_text: 'Payroll queries: pay@acme.co', brand_color: '#17402A' };
    render(<PayslipDocument record={record} companyInfo={{}} extras={extrasFor('Kenya', { ytd })} design={design} />);
    expect(screen.queryByTestId('employer-contributions')).toBeNull();
    expect(screen.queryByTestId('payslip-ytd')).toBeNull();
    expect(screen.queryByTestId('payslip-payment')).toBeNull();
    expect(screen.getByTestId('payslip-deductions')).toBeTruthy();
    expect(screen.getByTestId('payslip-net')).toBeTruthy();
    expect(amountOf('payslip-footer')).toContain('Payroll queries: pay@acme.co');
    expect((screen.getByText('Earnings') as HTMLElement).style.color).toBe('rgb(23, 64, 42)');
  });

  it("by default shows the KRA PIN with the employee's details, and no NSSF, SHA or ID numbers", () => {
    render(<PayslipDocument record={record} companyInfo={{}} extras={extrasFor('Kenya', { design: DEFAULT_DESIGN })} />);
    expect(amountOf('employee-tax-number')).toBe('KRA PIN:A012345678Z');
    expect(screen.queryByTestId('payslip-statutory-numbers')).toBeNull();
    expect(screen.queryByTestId('employee-sha-number')).toBeNull();
    expect(screen.queryByText('NSSF number:')).toBeNull();
    expect(screen.queryByText('ID number:')).toBeNull();
    expect(screen.getByTestId('payslip-payment')).toBeTruthy();
  });

  it("carries the approver's signature, name and approval date as the authorised signatory", () => {
    const signature = 'data:image/png;base64,iVBORw0KGgo=';
    const extras = extrasFor('Kenya');
    render(<PayslipDocument record={record} companyInfo={{}} extras={{ ...extras, run: { ...extras.run!, approvedSignature: signature, approvedBy: 'Wanjiru Kamau' } }} />);
    const signatory = section('payslip-signatory');
    expect((signatory.getByTestId('payslip-signature') as HTMLImageElement).src).toBe(signature);
    expect(signatory.getByText('Wanjiru Kamau')).toBeTruthy();
    expect(amountOf('payslip-signatory')).toContain('Date: 28 Oct 2026');
  });

  it('leaves the signatory line blank when the approver had no signature', () => {
    render(<PayslipDocument record={record} companyInfo={{}} extras={extrasFor('Kenya')} />);
    expect(screen.queryByTestId('payslip-signature')).toBeNull();
    expect(amountOf('payslip-signatory')).toContain('Date: ____');
  });

  it('uses the letterhead image the design picks', () => {
    const extras = extrasFor('Kenya');
    render(<PayslipDocument record={record} companyInfo={{}} extras={{ ...extras, employer: { ...extras.employer!, letterheadUrl: 'https://cdn.example/lh.png' } }} />);
    expect((screen.getByTestId('payslip-letterhead') as HTMLImageElement).src).toBe('https://cdn.example/lh.png');
  });
});

describe('a Tanzania payslip', () => {
  const record = tanzaniaEngine.calculate({ employee: employee('TZ1', { 'Basic Salary': 1500000, house_allowance: 0 }), ctx: baseContext({ rates: TANZANIA_RATES }) }).record;

  it('shows the TIN, no SHA number, NSSF before tax and no Kenyan relief', () => {
    render(<PayslipDocument record={record} companyInfo={{}} extras={extrasFor('Tanzania')} />);
    expect(amountOf('employee-tax-number')).toBe('TRA TIN:100123456');
    expect(screen.queryByTestId('employee-sha-number')).toBeNull();
    expect(section('payslip-employee').getByText('NIDA number:')).toBeTruthy();
    expect(section('payslip-employer').getByText('TIN: 123456789')).toBeTruthy();
    expect(section('deductions-before-tax').getByText('NSSF').nextSibling?.textContent).toBe('TSh 150,000');
    expect(amountOf('taxable-pay')).toContain('TSh 1,350,000');
    expect(amountOf('no-reliefs')).toMatch(/Tanzania has no personal relief/);
    expect(screen.queryByText(/Personal relief/)).toBeNull();
    expect(screen.queryByText('Per diem')).toBeNull();
  });

  it('marks NSSF, SDL and WCF as paid by the employer', () => {
    render(<PayslipDocument record={record} companyInfo={{}} extras={extrasFor('Tanzania')} />);
    const er = section('employer-contributions');
    expect(er.getByText('Paid by your employer, not deducted from your pay')).toBeTruthy();
    expect(er.getByText('NSSF (employer)').nextSibling?.textContent).toBe('TSh 150,000');
    expect(er.getByText('SDL (skills levy)')).toBeTruthy();
    expect(er.getByText('WCF (workers compensation)')).toBeTruthy();
  });
});

describe('a Uganda payslip', () => {
  const record = ugandaEngine.calculate({ employee: employee('UG1', { 'Basic Salary': 2000000, house_allowance: 0 }), ctx: baseContext({ rates: UGANDA_RATES, period: '2026-10' }) }).record;

  it('takes LST before tax in the month it is taken, NSSF after tax, and no relief', () => {
    render(<PayslipDocument record={record} companyInfo={{}} extras={extrasFor('Uganda')} />);
    expect(amountOf('employee-tax-number')).toBe('URA TIN:100123456');
    expect(screen.queryByTestId('employee-sha-number')).toBeNull();
    expect(section('payslip-employee').getByText('NIN:')).toBeTruthy();
    const lst = Number(record.lst_deduction);
    expect(lst).toBeGreaterThan(0);
    expect(section('deductions-before-tax').getByText('Local service tax').nextSibling?.textContent).toBe(`USh ${lst.toLocaleString()}`);
    expect(section('deductions-after-tax').getByText('NSSF').nextSibling?.textContent).toBe('USh 100,000');
    expect(amountOf('taxable-pay')).toContain(`USh ${(2000000 - lst).toLocaleString()}`);
    expect(amountOf('no-reliefs')).toMatch(/Uganda has no personal relief/);
    expect(section('employer-contributions').getByText('NSSF (employer)').nextSibling?.textContent).toBe('USh 200,000');
  });
});

describe('a USD payslip', () => {
  const outcome = calculateInUsd(kenyaEngine, employee('US1', { 'Basic Salary': 2000, house_allowance: 0 }), baseContext({ rates: KENYA_RATES }), 129);
  const record = outcome.record!;

  it('is in USD throughout, keeps the KES statutory section, and its YTD is in USD', () => {
    const ytd = { currency: 'USD', country: 'Kenya', taxYear: { start: '2026-01', end: '2026-12', label: '2026' }, months: 3, gross_pay: 6000, taxable_pay: 5500, taxable_missing: 0, paye_tax: 900, nssf_deduction: 150, net_pay: 4500, other_currencies: [{ currency: 'KES', months: 7 }] };
    render(<PayslipDocument record={record} companyInfo={{}} extras={extrasFor('Kenya', { ytd })} />);
    expect(section('local-statutory').getByText('Statutory deductions in KES at 1 USD = 129 KES')).toBeTruthy();
    expect(amountOf('taxable-pay')).toContain(`USD ${record.taxable_pay.toLocaleString()}`);
    expect(amountOf('relief-personal')).toContain('−USD 18.6'); // KES 2,400 at 129
    expect(amountOf('ytd-gross')).toBe('USD 6,000');
    expect(section('payslip-ytd').getByText(/7 months paid in KES/)).toBeTruthy();
  });
});

describe('a contractor and an older payslip', () => {
  it('a contractor shows withholding tax and no reliefs', () => {
    const record = kenyaEngine.calculate({ employee: employee('C1', { worker_kind: 'contractor', wht_category: 'contractual' }), ctx: baseContext() }).record;
    render(<PayslipDocument record={record} companyInfo={{}} />);
    expect(screen.getByTestId('wht-line').textContent).toContain('Withholding tax (3%)');
    expect(amountOf('no-reliefs')).toBe('None (withholding tax)');
  });

  it('a Kenya payslip saved before the working was kept shows its saved personal relief, and says taxable pay was not kept', () => {
    render(<PayslipDocument record={{ employee_id: 'K9', pay_period: '2026-09', gross_pay: 50000, paye_tax: 5000, nssf_deduction: 3000, tax_relief: 2400 }} companyInfo={{}} />);
    expect(section('payslip-taxable-pay').getByText(/wasn’t kept/)).toBeTruthy();
    expect(amountOf('relief-personal')).toContain('KSh 2,400');
  });
});
