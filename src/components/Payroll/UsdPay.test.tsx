import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('html2pdf.js', () => ({ default: () => ({ from: () => ({ set: () => ({ save: vi.fn() }) }) }) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import UsdRatePanel from './UsdRatePanel';
import CountryReadinessPanel from './CountryReadinessPanel';
import { PayslipDocument } from './PayrollPayslipModal';
import type { Branch } from '../../lib/branches';
import { calculateRun, countryReadiness } from '../../lib/payroll/multiCountry';
import { KENYA_RATES, baseContext } from '../../lib/payroll/countries/kenyaFixtures';
import type { FxRate } from '../../lib/payroll/usdPayApi';

// FIG-906 on screen: the Run tab's "USD rate for Kenya this month" (only for countries paid in USD, last month's rate
// offered but not used until confirmed, locked once approved), the readiness check holding a USD country back without
// this month's rate, and the payslip's statutory section in local currency.

afterEach(cleanup);

const rate = (country: string, value: number, period = '2026-09'): FxRate => ({ pay_period: period, country, rate: value, local_currency: 'KES', entered_at: null });
const panel = (over: Partial<Parameters<typeof UsdRatePanel>[0]> = {}) => {
  const onConfirm = vi.fn().mockResolvedValue(undefined);
  render(
    <UsdRatePanel countries={['Kenya']} periodLabel="October 2026" confirmed={new Map()} previous={new Map()} locked={new Set()} canEdit onConfirm={onConfirm} {...over} />
  );
  return onConfirm;
};

describe('the USD rate field', () => {
  it('shows only for countries paid in USD', () => {
    panel({ countries: [] });
    expect(screen.queryByTestId('usd-rates')).toBeNull();
    cleanup();
    panel({ countries: ['Kenya'] });
    expect(screen.getByLabelText('USD rate for Kenya this month')).toBeTruthy();
    expect(screen.queryByLabelText('USD rate for Tanzania this month')).toBeNull();
  });

  it("offers last month's rate as a suggestion, and saves it only when confirmed", async () => {
    const onConfirm = panel({ previous: new Map([['Kenya', rate('Kenya', 129)]]) });
    const input = screen.getByLabelText('USD rate for Kenya this month') as HTMLInputElement;
    expect(input.value).toBe('129');
    expect(screen.getByTestId('usd-rate-Kenya').textContent).toMatch(/Last used: 1 USD = 129 KES \(2026-09\).*isn't worked out until you do/);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '130' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm rate' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('Kenya', 130));
  });

  it("refuses something that isn't a rate", () => {
    panel();
    fireEvent.change(screen.getByLabelText('USD rate for Kenya this month'), { target: { value: 'abc' } });
    expect((screen.getByRole('button', { name: 'Confirm rate' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('usd-rate-Kenya').textContent).toMatch(/Type a number, like 129/);
  });

  it('is locked once the country is approved', () => {
    panel({ confirmed: new Map([['Kenya', rate('Kenya', 129, '2026-10')]]), locked: new Set(['Kenya']) });
    expect((screen.getByLabelText('USD rate for Kenya this month') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/Locked: Kenya is approved/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /rate/ })).toBeNull();
  });
});

describe('readiness for a USD country', () => {
  const branches: Branch[] = [{ id: 'nbo', name: 'Nairobi', country: 'Kenya', currency: 'KES', city: null, address: null, active: true, is_default: true }];
  const staff = [{ 'Employee Number': 'U1', 'First Name': 'Wanjiru', 'Basic Salary': 2000, branch_id: 'nbo', 'Tax PIN': 'A012345678Z', 'NSSF Number': '1', 'SHIF Number': 'CR1' }];
  const payCurrencies = new Map([['Kenya', 'USD']]);
  const actions = { onApprove: vi.fn(), onReopen: vi.fn(), onMarkPaid: vi.fn(), onDiscard: vi.fn() };

  it("holds Kenya back until this month's rate is entered", () => {
    const run = calculateRun(staff, branches, () => baseContext(), { payCurrencies, fxRates: new Map() });
    const readiness = countryReadiness({
      employees: staff, branches, payslips: run.records, runCountries: [], runStarted: false, ratesByCountry: new Map([['Kenya', KENYA_RATES]]), payCurrencies, fxRates: new Map(),
    });
    render(<CountryReadinessPanel readiness={readiness} runStarted={false} busy={false} actions={actions} />);
    const row = within(screen.getByTestId('country-Kenya'));
    expect(row.getByText('Held back')).toBeTruthy();
    expect(row.getByText('USD')).toBeTruthy();
    expect(row.getByText("Enter this month's USD rate for Kenya")).toBeTruthy();
  });

  it('is ready once the rate is confirmed', () => {
    const fxRates = new Map([['Kenya', 129]]);
    const run = calculateRun(staff, branches, () => baseContext(), { payCurrencies, fxRates });
    const readiness = countryReadiness({
      employees: staff, branches, payslips: run.records, runCountries: [], runStarted: false, ratesByCountry: new Map([['Kenya', KENYA_RATES]]), payCurrencies, fxRates,
    });
    expect(readiness[0]).toMatchObject({ country: 'Kenya', state: 'ready', currency: 'USD', blocking: [] });
  });
});

describe('a USD payslip', () => {
  const record = {
    employee_id: 'U1', employee_name: 'Wanjiru Otieno', pay_period: '2026-10', country: 'Kenya', currency: 'USD', basic_salary: 2000, gross_pay: 2000,
    paye_tax: 310.8, nssf_deduction: 50.23, nhif_deduction: 36.85, housing_levy: 20.1, total_deductions: 417.98, net_pay: 1582.02, tax_relief: 18.6,
    fx_rate: 129, local_currency: 'KES',
    local_amounts: { gross_pay: 258000, taxable_pay: 159033.45, paye_tax: 40093.39, nssf_deduction: 6480, nhif_deduction: 4753.65, housing_levy: 2592.9, nita_levy: 50 },
  };

  it('shows USD amounts and the statutory deductions in KES at the month’s rate', () => {
    render(<PayslipDocument record={record} companyInfo={{ company_name: 'Acme' }} />);
    expect(screen.getAllByText(/USD 2,000/).length).toBeGreaterThan(0);
    const local = within(screen.getByTestId('local-statutory'));
    expect(local.getByText('Statutory deductions in KES at 1 USD = 129 KES')).toBeTruthy();
    expect(local.getByText('PAYE').nextSibling?.textContent).toBe('KSh 40,093.39');
    expect(local.getByText('NSSF').nextSibling?.textContent).toBe('KSh 6,480.00');
    expect(local.getByText('SHIF').nextSibling?.textContent).toBe('KSh 4,753.65');
    expect(local.getByText('Housing levy').nextSibling?.textContent).toBe('KSh 2,592.90');
    expect(local.getByText('Gross pay').nextSibling?.textContent).toBe('KSh 258,000.00');
  });

  it('a local payslip has no such section', () => {
    render(<PayslipDocument record={{ ...record, currency: 'KES', fx_rate: null, local_amounts: null }} companyInfo={{}} />);
    expect(screen.queryByTestId('local-statutory')).toBeNull();
  });
});
