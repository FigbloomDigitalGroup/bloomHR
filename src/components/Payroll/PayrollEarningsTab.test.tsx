import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { toDirectoryEmployee } from '../../lib/employeeDirectory';
import type { EarningType, EmployeeEarning } from '../../lib/earnings';

const db = vi.hoisted(() => ({
  types: [] as EarningType[],
  earnings: [] as EmployeeEarning[],
  addEarningType: vi.fn(),
  updateEarningType: vi.fn(),
  saveEmployeeEarning: vi.fn(),
  removeEmployeeEarning: vi.fn(),
  importEarningRows: vi.fn(),
}));
const confirmDialog = vi.hoisted(() => vi.fn());

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/confirmDialog', () => ({ confirmDialog }));
vi.mock('../../lib/earningsDb', () => ({
  loadEarningSetup: () => Promise.resolve({ types: db.types, earnings: db.earnings }),
  addEarningType: db.addEarningType,
  updateEarningType: db.updateEarningType,
  saveEmployeeEarning: db.saveEmployeeEarning,
  removeEmployeeEarning: db.removeEmployeeEarning,
  importEarningRows: db.importEarningRows,
}));
vi.mock('../../hooks/useEmployeeDirectory', () => ({
  useEmployeeDirectory: () => ({
    employees: [
      toDirectoryEmployee({ id: 'e1', 'Employee Number': 'E1', 'First Name': 'Ann', 'Last Name': 'Wanjiru' }),
      toDirectoryEmployee({ id: 'e2', 'Employee Number': 'E2', 'First Name': 'Ben', 'Last Name': 'Otieno' }),
    ],
    loading: false,
    error: null,
  }),
}));
// the picker as a plain list of employee numbers
vi.mock('../UI/EmployeePicker', () => ({
  default: ({ value, onChange }: { value: string; onChange: (e: { employeeNumber: string } | null) => void }) => (
    <select aria-label="Employee" value={value} onChange={(e) => onChange(e.target.value ? { employeeNumber: e.target.value } : null)}>
      <option value="" />
      <option value="E1">E1</option>
      <option value="E2">E2</option>
    </select>
  ),
}));

import PayrollEarningsTab from './PayrollEarningsTab';

const type = (id: string, name: string, extra: Partial<EarningType> = {}): EarningType => ({
  id, name, taxable: true, pensionable: true, description: null, active: true, ...extra,
});
const earning = (id: string, employee_number: string, earning_type_id: string, amount: number, start_period: string, end_period: string | null = start_period): EmployeeEarning => ({
  id, employee_number, earning_type_id, amount, start_period, end_period, notes: null,
});

const onChanged = vi.fn();
const renderTab = () =>
  render(<PayrollEarningsTab payPeriod="2026-10" periodLabel="October 2026" onChanged={onChanged} draftNotice={null} />);

beforeEach(() => {
  db.types = [type('bonus', 'Bonus'), type('comm', 'Commission'), type('meal', 'Meal refund', { taxable: false })];
  db.earnings = [
    earning('x1', 'E1', 'bonus', 10000, '2026-10'),
    earning('x2', 'E2', 'comm', 2500, '2026-08', null),
    earning('x3', 'E2', 'meal', 500, '2026-10', '2026-12'),
    earning('x4', 'E1', 'bonus', 7000, '2026-11'), // next month
  ];
  Object.values(db).forEach((v) => typeof v === 'function' && 'mockReset' in v && v.mockReset());
  db.saveEmployeeEarning.mockResolvedValue(undefined);
  db.removeEmployeeEarning.mockResolvedValue(undefined);
  db.addEarningType.mockResolvedValue(undefined);
  confirmDialog.mockReset();
  onChanged.mockReset();
});

afterEach(cleanup);

describe('PayrollEarningsTab', () => {
  it("lists the month's earnings with totals, and the company's earning types", async () => {
    renderTab();
    const table = await screen.findByRole('table');
    await within(table).findByText('Ann Wanjiru');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell').slice(0, 4).map((c) => c.textContent))).toEqual([
      ['Ann WanjiruE1', 'Bonus', 'KSh 10,000', 'Oct 2026 only'],
      ['Ben OtienoE2', 'Commission', 'KSh 2,500', 'Every month from Aug 2026'],
      ['Ben OtienoE2', 'Meal refund(not taxed)', 'KSh 500', 'Every month, Oct 2026 – Dec 2026'],
    ]);
    const totals = screen.getByTestId('earnings-totals').textContent;
    expect(totals).toContain('KSh 13,000 to 2 employees');
    expect(totals).toContain('Taxed: KSh 12,500');
    expect(totals).toContain('Not taxed: KSh 500');
    expect(screen.getByRole('button', { name: 'Pause Bonus' })).toBeTruthy();
  });

  it('adds a one-off earning for the month on screen', async () => {
    renderTab();
    await screen.findByText('Ann Wanjiru');
    fireEvent.click(screen.getByRole('button', { name: /Add earning/ }));
    fireEvent.change(screen.getByLabelText('Employee'), { target: { value: 'E2' } });
    fireEvent.change(screen.getByLabelText('Earning'), { target: { value: 'bonus' } });
    fireEvent.change(screen.getByLabelText('Amount (KSh)'), { target: { value: '10000' } });
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Q3 target' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(db.saveEmployeeEarning).toHaveBeenCalled());
    expect(db.saveEmployeeEarning).toHaveBeenCalledWith({
      id: undefined, employee_number: 'E2', earning_type_id: 'bonus', amount: 10000, start_period: '2026-10', end_period: '2026-10', notes: 'Q3 target',
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('adds a recurring earning with no end month', async () => {
    renderTab();
    await screen.findByText('Ann Wanjiru');
    fireEvent.click(screen.getByRole('button', { name: /Add earning/ }));
    fireEvent.change(screen.getByLabelText('Employee'), { target: { value: 'E1' } });
    fireEvent.change(screen.getByLabelText('Amount (KSh)'), { target: { value: '3000' } });
    fireEvent.click(screen.getByLabelText('Every month'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(db.saveEmployeeEarning).toHaveBeenCalled());
    expect(db.saveEmployeeEarning.mock.calls[0][0]).toMatchObject({ employee_number: 'E1', earning_type_id: 'bonus', amount: 3000, start_period: '2026-10', end_period: null });
  });

  it('removes an earning only once confirmed', async () => {
    renderTab();
    await screen.findByText('Ann Wanjiru');
    const [first] = screen.getAllByRole('button', { name: 'Remove' });

    confirmDialog.mockResolvedValueOnce(false);
    fireEvent.click(first);
    await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1));
    expect(confirmDialog.mock.calls[0][0]).toMatchObject({ title: 'Remove Bonus for Ann Wanjiru?', tone: 'danger' });
    expect(db.removeEmployeeEarning).not.toHaveBeenCalled();

    confirmDialog.mockResolvedValueOnce(true);
    fireEvent.click(first);
    await waitFor(() => expect(db.removeEmployeeEarning).toHaveBeenCalledWith('x1'));
  });

  it('adds an earning type, taxed or not', async () => {
    renderTab();
    await screen.findByText('Ann Wanjiru');
    fireEvent.click(screen.getByRole('button', { name: /New type/ }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '13th month pay' } });
    fireEvent.click(screen.getByLabelText('Counts for NSSF'));
    fireEvent.click(screen.getByRole('button', { name: 'Add type' }));
    await waitFor(() =>
      expect(db.addEarningType).toHaveBeenCalledWith({ name: '13th month pay', taxable: true, pensionable: false, description: '' })
    );
  });

  it('says whether a new earning type is taxed in Kenya, and "Use this" sets Taxed', async () => {
    renderTab();
    await screen.findByText('Ann Wanjiru');
    fireEvent.click(screen.getByRole('button', { name: /New type/ }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Christmas bonus' } });
    fireEvent.click(screen.getByLabelText('Taxed (PAYE)')); // untick it
    expect(await screen.findByText(/Taxable/, {}, { timeout: 2000 })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Use this/ }));
    expect((screen.getByLabelText('Taxed (PAYE)') as HTMLInputElement).checked).toBe(true);
  });
});
