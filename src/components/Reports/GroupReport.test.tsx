import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import * as XLSX from 'xlsx';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
const saved = vi.hoisted(() => ({ files: [] as { name: string; blob: Blob }[] }));
vi.mock('file-saver', () => ({ saveAs: (blob: Blob, name: string) => saved.files.push({ blob, name }) }));

import { GroupReportView } from './GroupReport';
import { GroupOverviewView } from '../Dashboard/GroupOverview';
import { BRANCHES, EMPLOYEES, PAYSLIPS, RATES } from '../../lib/reports/groupFixtures';
import { PER_CURRENCY_NOTE, SUMMARY_SHEET } from '../../lib/reports/groupReports';

// FIG-905 stage 5: the group report and the dashboard cards, for a KE/TZ/UG company and for a company in Kenya only.

const readBytes = (blob: Blob) =>
  new Promise<ArrayBuffer>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(blob);
  });

const kenyaOnly = {
  branches: [BRANCHES[0]],
  employees: EMPLOYEES.filter((e) => e['Employee Number'].startsWith('K')).map((e) => ({ ...e, branch_id: 'b-nbo' })),
  payslips: PAYSLIPS.filter((p) => p.country === 'Kenya'),
};

beforeEach(() => {
  saved.files = [];
});
afterEach(() => cleanup());

describe('the group report', () => {
  const mixed = (extra: Partial<Parameters<typeof GroupReportView>[0]> = {}) =>
    render(
      <GroupReportView month="2026-10" branches={BRANCHES} employees={EMPLOYEES} payslips={PAYSLIPS} ratesByCountry={RATES} canPeople canPayroll {...extra} />
    );

  it('shows the payroll per currency, with no grand total across currencies', () => {
    mixed({ initialTab: 'payroll' });
    const table = screen.getByTestId('currency-summary');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['KES', 'TZS', 'UGX']);
    expect(within(rows[0]).getByText('KSh 109,305')).toBeTruthy();
    expect(within(rows[1]).getByText('TSh 1,500,000')).toBeTruthy();
    expect(within(rows[2]).getByText('USh 1,069,250')).toBeTruthy();
    expect(screen.getByText(PER_CURRENCY_NOTE)).toBeTruthy();
    expect(screen.queryByText(/grand total/i)).toBeNull();
    // each country in its own currency, with its own lines
    expect(within(screen.getByTestId('payroll-Tanzania')).getByText('SDL (skills levy)')).toBeTruthy();
    expect(within(screen.getByTestId('payroll-Uganda')).getByText('Local service tax')).toBeTruthy();
    expect(within(screen.getByTestId('payroll-Kenya')).getByText('SHIF')).toBeTruthy();
  });

  it('narrows to a country with the filter', () => {
    mixed({ initialTab: 'payroll' });
    fireEvent.change(screen.getByLabelText('Country or branch'), { target: { value: 'country:Uganda' } });
    expect(screen.queryByTestId('currency-summary')).toBeNull();
    expect(screen.queryByTestId('payroll-Kenya')).toBeNull();
    expect(screen.getByTestId('payroll-Uganda')).toBeTruthy();
  });

  it('downloads Excel with one sheet per country and the summary by currency', async () => {
    mixed({ initialTab: 'payroll' });
    fireEvent.click(screen.getByText('Download Excel'));
    expect(saved.files.map((f) => f.name)).toEqual(['payroll-summary-2026-10.xlsx']);
    const book = XLSX.read(await readBytes(saved.files[0].blob), { type: 'array' });
    expect(book.SheetNames).toEqual(['Kenya (KES)', 'Tanzania (TZS)', 'Uganda (UGX)', SUMMARY_SHEET]);
  });

  it('lists each country’s remittances in its own currency', () => {
    mixed({ initialTab: 'remittances' });
    const tz = screen.getByTestId('remit-Tanzania');
    expect(within(tz).getByText('WCF')).toBeTruthy();
    expect(within(tz).getByText('TSh 780,000 in all')).toBeTruthy();
    expect(within(screen.getByTestId('remit-Kenya')).getByText('SHA')).toBeTruthy();
    expect(within(screen.getByTestId('remit-Uganda')).getByText('URA')).toBeTruthy();
  });

  it('shows cost by branch per currency', () => {
    mixed({ initialTab: 'cost' });
    expect(within(screen.getByTestId('cost-KES')).getByText('Total (KES)')).toBeTruthy();
    expect(screen.getByTestId('cost-TZS')).toBeTruthy();
    expect(screen.getByTestId('cost-UGX')).toBeTruthy();
  });

  it('adds up headcount across countries', () => {
    mixed();
    expect(screen.getByTestId('headcount-total').textContent).toBe('4');
  });

  it('hides the money tabs without payroll, and the people tab without reports or employees', () => {
    mixed({ canPayroll: false });
    expect(screen.queryByText('Payroll summary')).toBeNull();
    cleanup();
    mixed({ canPeople: false });
    expect(screen.queryByText('People')).toBeNull();
    expect(screen.getByText('Payroll summary')).toBeTruthy();
  });

  it('looks as before for a company in one currency: no filter, no summary by currency, no per-currency note', () => {
    render(<GroupReportView month="2026-10" {...kenyaOnly} ratesByCountry={RATES} canPeople canPayroll initialTab="payroll" />);
    expect(screen.queryByLabelText('Country or branch')).toBeNull();
    expect(screen.queryByTestId('currency-summary')).toBeNull();
    expect(screen.queryByText(PER_CURRENCY_NOTE)).toBeNull();
    expect(within(screen.getByTestId('payroll-Kenya')).getByText('KSh 109,305')).toBeTruthy();
  });
});

describe('the dashboard cards', () => {
  it('shows a card per currency and the note when there is more than one currency', () => {
    render(<GroupOverviewView branches={BRANCHES} employees={EMPLOYEES} payslips={PAYSLIPS} payPeriod="2026-10" ratesByCountry={RATES} canPayroll />);
    expect(screen.getByTestId('currency-card-KES')).toBeTruthy();
    expect(within(screen.getByTestId('currency-card-TZS')).getByText('TSh 1,500,000')).toBeTruthy();
    expect(within(screen.getByTestId('currency-card-UGX')).getByText('USh 1,069,250')).toBeTruthy();
    expect(screen.getByText(PER_CURRENCY_NOTE)).toBeTruthy();
    expect(screen.getByText('All 4')).toBeTruthy();
  });

  it('shows plain cards in the one currency for a company in Kenya only', () => {
    render(<GroupOverviewView {...kenyaOnly} payPeriod="2026-10" ratesByCountry={RATES} canPayroll />);
    expect(screen.queryByTestId('currency-card-KES')).toBeNull();
    expect(screen.queryByText(PER_CURRENCY_NOTE)).toBeNull();
    expect(screen.queryByLabelText('Country or branch')).toBeNull();
    expect(screen.getByText('Net pay · October 2026')).toBeTruthy();
    expect(screen.getByText('KSh 109,305')).toBeTruthy();
  });

  it('shows no money without payroll', () => {
    const { container } = render(<GroupOverviewView {...kenyaOnly} payPeriod="2026-10" ratesByCountry={RATES} canPayroll={false} />);
    expect(container.textContent).toBe('');
  });
});
