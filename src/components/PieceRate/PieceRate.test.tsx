import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ImportRow, WorkEntry, WorkPerson, WorkRate, WorkType } from '../../lib/pieceRate';
import { today } from '../../lib/casualPay';

const api = vi.hoisted(() => ({
  entries: [] as unknown[],
  waiting: [] as unknown[],
  checked: [] as unknown[],
  loadEntries: vi.fn(),
  loadWaitingEntries: vi.fn(),
  saveDayCells: vi.fn(),
  submitEntries: vi.fn(),
  decideEntries: vi.fn(),
  reopenEntries: vi.fn(),
  checkImport: vi.fn(),
  importEntries: vi.fn(),
  loadImports: vi.fn(),
}));
const sheet = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('file-saver', () => ({ saveAs: vi.fn() }));
vi.mock('../../lib/employeeSheet', () => ({ readEmployeeRows: () => sheet.rows }));
vi.mock('../../lib/pieceRateApi', () => ({
  loadEntries: api.loadEntries,
  loadWaitingEntries: api.loadWaitingEntries,
  saveDayCells: api.saveDayCells,
  submitEntries: api.submitEntries,
  decideEntries: api.decideEntries,
  reopenEntries: api.reopenEntries,
  checkImport: api.checkImport,
  importEntries: api.importEntries,
  loadImports: api.loadImports,
}));

import DailyEntry from './DailyEntry';
import WorkApprovals from './WorkApprovals';
import WorkUpload from './WorkUpload';

const DAY = today();
// let the day's entries load (they reset the boxes) before typing
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const person = (n: string, first: string, over: Partial<WorkPerson> = {}): WorkPerson => ({
  employee_number: n, first_name: first, last_name: 'Worker', job_title: null, department: 'Farm', worker_kind: 'employee',
  pay_basis: 'work', pay_frequency: 'daily', wht_category: null, supervisor: 'sup@a.co', status: 'Active', is_team: true, ...over,
});
const PEOPLE = [person('W1', 'Wanjiru'), person('W2', 'Otieno', { worker_kind: 'contractor', wht_category: 'contractual' }), person('M1', 'Mary', { pay_basis: 'salary' })];
const TYPES: WorkType[] = [
  { id: 'tea', name: 'Tea picked', unit: 'kg', rate: 12, active: true, effective_from: null, effective_to: null },
  { id: 'weed', name: 'Weeding', unit: 'row', rate: 35, active: true, effective_from: null, effective_to: null },
  { id: 'old', name: 'Old work', unit: 'piece', rate: 5, active: false, effective_from: null, effective_to: null },
];
const RATES: WorkRate[] = [{ id: 'r1', work_type_id: 'tea', rate: 12, effective_from: '-infinity' }, { id: 'r2', work_type_id: 'weed', rate: 35, effective_from: '-infinity' }];
const entry = (id: string, emp: string, type: string, quantity: number, over: Partial<WorkEntry> = {}): WorkEntry => ({
  id, employee_number: emp, work_date: DAY, work_type_id: type, quantity, rate: type === 'tea' ? 12 : 35,
  amount: quantity * (type === 'tea' ? 12 : 35), status: 'draft', source: 'supervisor', notes: null, rejection_reason: null,
  entered_by: 'sup', paid_out_at: null, ...over,
});

beforeEach(() => {
  for (const f of [api.loadEntries, api.loadWaitingEntries, api.saveDayCells, api.submitEntries, api.decideEntries, api.reopenEntries,
    api.checkImport, api.importEntries, api.loadImports]) f.mockReset();
  api.entries = [];
  api.loadEntries.mockImplementation(() => Promise.resolve(api.entries));
  api.loadWaitingEntries.mockImplementation(() => Promise.resolve(api.waiting));
  api.saveDayCells.mockResolvedValue([]);
  api.submitEntries.mockResolvedValue({ submitted: 1, approved: 0, problem: null });
  api.decideEntries.mockResolvedValue({ done: 1, problem: null });
  api.reopenEntries.mockResolvedValue({ done: 1, problem: null });
  api.checkImport.mockImplementation(() => Promise.resolve(api.checked));
  api.importEntries.mockResolvedValue({ import_id: 'i1', imported: 1, problems: [{ row: 3, error: 'Unknown worker X' }] });
  api.loadImports.mockResolvedValue([]);
});
afterEach(() => cleanup());

describe('daily entry', () => {
  it('lists workers paid by work, with the kinds of work in use, and works out amounts as you type', async () => {
    render(<DailyEntry people={PEOPLE} types={TYPES} rates={RATES} canManage={false} />);
    await waitFor(() => expect(api.loadEntries).toHaveBeenCalledWith(DAY, DAY));
    await settle();
    expect(screen.getByText('Wanjiru Worker')).toBeTruthy();
    expect(screen.getByText('Contractor')).toBeTruthy();
    expect(screen.queryByText('Mary Worker')).toBeNull(); // paid a salary
    expect(screen.queryByLabelText('Wanjiru Worker Old work')).toBeNull(); // paused

    fireEvent.change(screen.getByLabelText('Wanjiru Worker Tea picked'), { target: { value: '42.5' } });
    fireEvent.change(screen.getByLabelText('Wanjiru Worker Weeding'), { target: { value: '2' } });
    expect(screen.getByLabelText('Wanjiru Worker total').textContent).toBe('KSh 580');
    expect(screen.getByText(/Day total/).textContent).toMatch(/KSh 580/);
    expect(screen.getByText(/2 unsaved/)).toBeTruthy();
  });

  it('saves the changed boxes as drafts', async () => {
    render(<DailyEntry people={PEOPLE} types={TYPES} rates={RATES} canManage={false} />);
    await waitFor(() => expect(api.loadEntries).toHaveBeenCalled());
    await settle();
    fireEvent.change(screen.getByLabelText('Otieno Worker Tea picked'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /Save draft/ }));
    await waitFor(() => expect(api.saveDayCells).toHaveBeenCalled());
    expect(api.saveDayCells).toHaveBeenCalledWith(DAY, [{ employee_number: 'W2', work_type_id: 'tea', quantity: 10, existing: undefined }]);
    expect(api.submitEntries).not.toHaveBeenCalled();
  });

  it("refuses a quantity that isn't a number", async () => {
    render(<DailyEntry people={PEOPLE} types={TYPES} rates={RATES} canManage={false} />);
    await waitFor(() => expect(api.loadEntries).toHaveBeenCalled());
    await settle();
    const box = screen.getByLabelText('Otieno Worker Tea picked');
    fireEvent.change(box, { target: { value: 'lots' } });
    expect(box.getAttribute('aria-invalid')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Save draft/ }));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.saveDayCells).not.toHaveBeenCalled();
  });

  it("submits the day's drafts and corrected rejected work, changes to what's there included", async () => {
    api.entries = [entry('e1', 'W1', 'tea', 20), entry('e2', 'W2', 'weed', 3, { status: 'rejected', rejection_reason: 'Only 2 rows' })];
    render(<DailyEntry people={PEOPLE} types={TYPES} rates={RATES} canManage={false} />);
    await waitFor(() => expect((screen.getByLabelText('Wanjiru Worker Tea picked') as HTMLInputElement).value).toBe('20'));
    expect(screen.getByText('Rejected: Only 2 rows')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Otieno Worker Weeding'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }));
    await waitFor(() => expect(api.submitEntries).toHaveBeenCalled());
    expect(api.saveDayCells).toHaveBeenCalledWith(DAY, [{ employee_number: 'W2', work_type_id: 'weed', quantity: 2, existing: api.entries[1] }]);
    expect(api.submitEntries).toHaveBeenCalledWith(['e1', 'e2']);
  });

  it('approved work is locked; payroll can reopen it', async () => {
    api.entries = [entry('e1', 'W1', 'tea', 20, { status: 'approved' })];
    const { unmount } = render(<DailyEntry people={PEOPLE} types={TYPES} rates={RATES} canManage={false} />);
    await waitFor(() => expect(screen.getByText('Approved')).toBeTruthy());
    expect(screen.queryByLabelText('Wanjiru Worker Tea picked')).toBeNull();
    expect(screen.queryByText('Reopen approved work')).toBeNull();
    unmount();

    render(<DailyEntry people={PEOPLE} types={TYPES} rates={RATES} canManage />);
    fireEvent.click(await screen.findByText('Reopen approved work'));
    await waitFor(() => expect(api.reopenEntries).toHaveBeenCalledWith(['e1']));
  });
});

describe('approval queue', () => {
  beforeEach(() => {
    api.waiting = [
      entry('s1', 'W1', 'tea', 20, { status: 'submitted', source: 'self' }),
      entry('s2', 'W2', 'tea', 10, { status: 'submitted', source: 'self' }),
      entry('p1', 'W1', 'weed', 2, { status: 'submitted', source: 'supervisor' }),
    ];
  });

  it("a supervisor decides their workers' own submissions; what they entered waits for payroll", async () => {
    render(<WorkApprovals people={PEOPLE} types={TYPES} canManage={false} />);
    expect(await screen.findByText(/2 entries waiting/)).toBeTruthy();
    expect(screen.getByText('Waiting for payroll (1)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve all 2' }));
    await waitFor(() => expect(api.decideEntries).toHaveBeenCalledWith(['s1', 's2'], 'approved', undefined));
  });

  it('payroll approves any; picks some; a rejection needs a reason', async () => {
    render(<WorkApprovals people={PEOPLE} types={TYPES} canManage />);
    expect(await screen.findByText(/3 entries waiting/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(`Pick Otieno Worker, ${DAY}`));
    fireEvent.click(screen.getByRole('button', { name: 'Approve 1' }));
    await waitFor(() => expect(api.decideEntries).toHaveBeenCalledWith(['s2'], 'approved', undefined));

    fireEvent.click(screen.getAllByRole('button', { name: `Reject Wanjiru Worker, ${DAY}` })[0]);
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Reject' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'Scale says 15' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(api.decideEntries).toHaveBeenCalledWith(['s1'], 'rejected', 'Scale says 15'));
  });
});

describe('spreadsheet upload', () => {
  const result = (row: number, ok: boolean, over: Partial<ImportRow> = {}): ImportRow => ({
    row, ok, error: ok ? null : 'Unknown worker X', employee_number: ok ? 'W1' : 'X', worker_name: ok ? 'Wanjiru Worker' : null,
    work_date: DAY, work_type: 'Tea picked', unit: 'kg', quantity: 10, rate: 12, amount: ok ? 120 : null, ...over,
  });
  const choose = (name = 'october.xlsx') =>
    fireEvent.change(screen.getByLabelText('Spreadsheet'), {
      target: { files: [{ name, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }] },
    });

  it('checks every row, shows the problems, and imports the good rows', async () => {
    sheet.rows = [
      { 'Employee Number': 'W1', Date: DAY, 'Kind of Work': 'Tea picked', Quantity: 10 },
      { 'Employee Number': 'X', Date: DAY, 'Kind of Work': 'Tea picked', Quantity: 10 },
    ];
    api.checked = [result(2, true), result(3, false)];
    render(<WorkUpload people={PEOPLE} types={TYPES} />);
    choose();
    await waitFor(() => expect(api.checkImport).toHaveBeenCalled());
    expect(api.checkImport.mock.calls[0][0]).toEqual([
      { employee_number: 'W1', work_date: DAY, work_type: 'Tea picked', quantity: '10', notes: '', sheet_row: 2 },
      { employee_number: 'X', work_date: DAY, work_type: 'Tea picked', quantity: '10', notes: '', sheet_row: 3 },
    ]);
    const table = await screen.findByRole('table', { name: 'Rows checked' });
    expect(within(table).getByText('Ready')).toBeTruthy();
    expect(within(table).getByText('Unknown worker X')).toBeTruthy();
    expect(screen.getByText('1 ready')).toBeTruthy();
    expect(screen.getByText('1 with problems')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Import 1 row/ }));
    await waitFor(() => expect(api.importEntries).toHaveBeenCalledWith('october.xlsx', api.checkImport.mock.calls[0][0]));
    await waitFor(() => expect(screen.queryByRole('table', { name: 'Rows checked' })).toBeNull());
  });

  it('says so when the sheet has no rows', async () => {
    sheet.rows = [{ 'Employee Number': '', Quantity: '' }];
    render(<WorkUpload people={PEOPLE} types={TYPES} />);
    choose();
    expect((await screen.findByRole('alert')).textContent).toMatch(/no rows of work/);
    expect(api.checkImport).not.toHaveBeenCalled();
  });

  it('nothing to import when no row is good', async () => {
    sheet.rows = [{ 'Employee Number': 'X', Date: DAY, 'Kind of Work': 'Tea picked', Quantity: 10 }];
    api.checked = [result(2, false)];
    render(<WorkUpload people={PEOPLE} types={TYPES} />);
    choose();
    const button = await screen.findByRole('button', { name: /Import 0 rows/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
