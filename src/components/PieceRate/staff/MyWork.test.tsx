import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { WorkRate, WorkType } from '../../../lib/pieceRate';
import type { MyEarnings, MyEntry, MyJob, MyWorkProfile } from '../../../lib/myWork';

const api = vi.hoisted(() => ({
  entries: [] as unknown[],
  jobs: [] as unknown[],
  earnings: null as unknown,
  loadMyEntries: vi.fn(),
  loadMyJobs: vi.fn(),
  loadMyEarnings: vi.fn(),
  completeMyJob: vi.fn(),
  saveDayCells: vi.fn(),
  submitEntries: vi.fn(),
  loadWorkTypes: vi.fn(),
  loadWorkRates: vi.fn(),
}));

vi.mock('../../../lib/supabase', () => ({ supabase: {} }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../lib/privateFiles', () => ({ openPrivateFile: vi.fn(() => Promise.resolve()) }));
vi.mock('../../../lib/pieceRateApi', () => ({
  saveDayCells: api.saveDayCells,
  submitEntries: api.submitEntries,
  loadWorkTypes: api.loadWorkTypes,
  loadWorkRates: api.loadWorkRates,
}));
vi.mock('../../../lib/myWorkApi', () => ({
  MAX_JOB_FILE_BYTES: 10 * 1024 * 1024,
  loadMyEntries: api.loadMyEntries,
  loadMyJobs: api.loadMyJobs,
  loadMyEarnings: api.loadMyEarnings,
  completeMyJob: api.completeMyJob,
}));

import MyWork from './MyWork';
import RecordMyWork from './RecordMyWork';
import MyEntries from './MyEntries';
import MyJobs from './MyJobs';
import MyEarningsView from './MyEarnings';

const TODAY = '2026-10-18';
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const TYPES: WorkType[] = [
  { id: 'tea', name: 'Tea picked', unit: 'kg', rate: 12, active: true, effective_from: null, effective_to: null },
  { id: 'weed', name: 'Weeding', unit: 'row', rate: 35, active: true, effective_from: null, effective_to: null },
];
// tea paid 10/kg until 15 Oct, 12 from then
const RATES: WorkRate[] = [
  { id: 'r1', work_type_id: 'tea', rate: 10, effective_from: '-infinity' },
  { id: 'r2', work_type_id: 'tea', rate: 12, effective_from: '2026-10-15' },
  { id: 'r3', work_type_id: 'weed', rate: 35, effective_from: '-infinity' },
];
const entry = (id: string, type: string, quantity: number, over: Partial<MyEntry> = {}): MyEntry => ({
  id, employee_number: 'W1', work_date: TODAY, work_type_id: type, quantity, rate: type === 'tea' ? 12 : 35,
  amount: quantity * (type === 'tea' ? 12 : 35), status: 'draft', source: 'self', notes: null, rejection_reason: null,
  entered_by: 'me', paid_out_at: null, reopened_at: null, ...over,
});
const job = (id: string, over: Partial<MyJob> = {}): MyJob => ({
  id, employee_number: 'W1', title: 'Fence the east block', description: null, amount: 15000, start_date: null, due_date: '2026-10-25',
  status: 'open', completed_at: null, completion_notes: null, sent_back_reason: null, approved_at: null, paid_out_at: null,
  created_at: '2026-10-10T08:00:00Z', ...over,
});
const EARNINGS: MyEarnings = {
  from: '2026-10-01', to: '2026-10-31', approved_work: 1200, waiting_work: 300, approved_jobs: 15000, waiting_jobs: 0,
  approved_entries: 4, waiting_entries: 1, approved_job_count: 1, waiting_job_count: 0,
  by_type: [{ work_type: 'Tea picked', unit: 'kg', quantity: 100, amount: 1200, waiting_quantity: 25, waiting_amount: 300 }],
  by_week: [
    { from: '2026-10-01', to: '2026-10-04', work: 0, jobs: 0, waiting: 0 },
    { from: '2026-10-12', to: '2026-10-18', work: 1200, jobs: 15000, waiting: 300 },
  ],
};
const recordProps = { employeeNumber: 'W1', types: TYPES, rates: RATES, today: TODAY, pastDays: 7, closedMonths: [] as string[] };

beforeEach(() => {
  for (const f of [api.loadMyEntries, api.loadMyJobs, api.loadMyEarnings, api.completeMyJob, api.saveDayCells, api.submitEntries, api.loadWorkTypes, api.loadWorkRates]) f.mockReset();
  api.entries = [];
  api.jobs = [];
  api.earnings = EARNINGS;
  api.loadMyEntries.mockImplementation(() => Promise.resolve(api.entries));
  api.loadMyJobs.mockImplementation(() => Promise.resolve(api.jobs));
  api.loadMyEarnings.mockImplementation(() => Promise.resolve(api.earnings));
  api.completeMyJob.mockResolvedValue(undefined);
  api.saveDayCells.mockResolvedValue([]);
  api.submitEntries.mockResolvedValue({ submitted: 1, approved: 0, problem: null });
  api.loadWorkTypes.mockResolvedValue(TYPES);
  api.loadWorkRates.mockResolvedValue(RATES);
});
afterEach(() => cleanup());

describe('the My work section', () => {
  const profile = (over: Partial<MyWorkProfile>): MyWorkProfile => ({
    employee_number: 'W1', qualifies: true, pay_basis: 'work', has_jobs: false, past_days: 7, today: TODAY, closed_months: [], ...over,
  });

  it('someone paid by work records work, sees entries and earnings; jobs only when they have some', async () => {
    render(<MyWork profile={profile({})} />);
    await settle();
    for (const label of ['Record my work', 'My entries', 'Earnings']) expect(screen.getByRole('button', { name: label })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'My jobs' })).toBeNull();
    expect(await screen.findByLabelText('Tea picked')).toBeTruthy();
  });

  it('someone on a salary with a job sees only their jobs and earnings', async () => {
    api.jobs = [job('j1')];
    render(<MyWork profile={profile({ pay_basis: 'salary', has_jobs: true })} />);
    await settle();
    expect(screen.queryByRole('button', { name: 'Record my work' })).toBeNull();
    expect(screen.getByRole('button', { name: 'My jobs' })).toBeTruthy();
    expect(await screen.findByText('Fence the east block')).toBeTruthy();
    expect(api.loadWorkTypes).not.toHaveBeenCalled();
  });
});

describe('record my work', () => {
  it('shows amounts live at the rate for the day, and saves a draft', async () => {
    render(<RecordMyWork {...recordProps} />);
    await settle();
    fireEvent.change(screen.getByLabelText('Tea picked'), { target: { value: '10' } });
    expect(screen.getByLabelText('Tea picked amount').textContent).toBe('KSh 120');
    // before the rate went up: 10 a kg
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '2026-10-14' } });
    await settle();
    fireEvent.change(screen.getByLabelText('Tea picked'), { target: { value: '10' } });
    expect(screen.getByLabelText('Tea picked amount').textContent).toBe('KSh 100');
    fireEvent.click(screen.getByRole('button', { name: /Save draft/ }));
    await waitFor(() => expect(api.saveDayCells).toHaveBeenCalledWith('2026-10-14', [
      { employee_number: 'W1', work_type_id: 'tea', quantity: 10, existing: undefined },
    ]));
    expect(api.submitEntries).not.toHaveBeenCalled();
  });

  it('submits drafts and rejected work with submit_work_entries', async () => {
    api.entries = [entry('d1', 'tea', 10), entry('r1', 'weed', 2, { status: 'rejected', rejection_reason: 'Only 1 row' })];
    render(<RecordMyWork {...recordProps} />);
    await settle();
    expect(screen.getByText(/Not approved: Only 1 row/)).toBeTruthy();
    expect((screen.getByLabelText('Weeding') as HTMLInputElement).value).toBe('2');
    fireEvent.change(screen.getByLabelText('Weeding'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }));
    await waitFor(() => expect(api.submitEntries).toHaveBeenCalledWith(['d1', 'r1']));
    expect(api.saveDayCells).toHaveBeenCalledWith(TODAY, [expect.objectContaining({ work_type_id: 'weed', quantity: 1 })]);
  });

  it("refuses a future day or one older than the limit, and doesn't let approved work be typed over", async () => {
    api.entries = [entry('a1', 'tea', 10, { status: 'approved' })];
    render(<RecordMyWork {...recordProps} pastDays={3} />);
    await settle();
    expect(screen.getByText('10 kg · KSh 120')).toBeTruthy();
    expect(screen.getByText('Approved')).toBeTruthy();
    expect((screen.getByLabelText('Day') as HTMLInputElement).min).toBe('2026-10-15');
    expect((screen.getByLabelText('Day') as HTMLInputElement).max).toBe(TODAY);
    expect((screen.getByRole('button', { name: 'Next day' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '2026-10-10' } });
    await settle();
    expect(screen.getByRole('alert').textContent).toMatch(/last 3 days only/);
    expect(screen.queryByLabelText('Tea picked')).toBeNull();
    expect((screen.getByRole('button', { name: /Submit/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('my entries', () => {
  it('groups by day with each status; only drafts and rejected open for editing', async () => {
    api.entries = [
      entry('a', 'tea', 10, { status: 'approved' }),
      entry('b', 'weed', 1, { status: 'submitted', reopened_at: '2026-10-18T09:00:00Z' }),
      entry('c', 'tea', 5, { work_date: '2026-10-16', status: 'rejected', rejection_reason: 'Scale says 4' }),
      entry('d', 'tea', 3, { work_date: '2026-10-15', status: 'submitted', source: 'supervisor' }),
    ];
    const onEdit = vi.fn();
    render(<MyEntries employeeNumber="W1" types={TYPES} today={TODAY} pastDays={7} closedMonths={[]} onEdit={onEdit} />);
    await settle();
    expect(api.loadMyEntries).toHaveBeenCalledWith('W1', '2026-10-01', '2026-10-31');
    expect(screen.getByText('Approved')).toBeTruthy();
    expect(screen.getByText('Reopened')).toBeTruthy();
    expect(screen.getByText('Not approved: Scale says 4')).toBeTruthy();
    expect(screen.getByText('recorded for you')).toBeTruthy();
    const edits = screen.getAllByRole('button', { name: /Edit and submit/ });
    expect(edits).toHaveLength(1);
    fireEvent.click(edits[0]);
    expect(onEdit).toHaveBeenCalledWith('2026-10-16');
  });

  it('a locked month is read-only', async () => {
    api.entries = [entry('c', 'tea', 5, { work_date: '2026-10-16', status: 'draft' })];
    render(<MyEntries employeeNumber="W1" types={TYPES} today={TODAY} pastDays={7} closedMonths={['2026-10']} onEdit={vi.fn()} />);
    await settle();
    expect(screen.queryByRole('button', { name: /Edit and submit/ })).toBeNull();
    expect(screen.getByLabelText('Read-only')).toBeTruthy();
  });
});

describe('my jobs', () => {
  it('marks an open job done with a note and a file', async () => {
    api.jobs = [job('j1'), job('j2', { title: 'Dig the drain', status: 'completed', completion_notes: 'Done Friday' })];
    render(<MyJobs employeeNumber="W1" today={TODAY} />);
    await settle();
    expect(screen.getByText('Waiting for approval')).toBeTruthy();
    expect(screen.getByText('Your note: Done Friday')).toBeTruthy();
    const card = screen.getByText('Fence the east block').closest('li') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: /Mark done/ }));
    fireEvent.change(within(card).getByLabelText('Note'), { target: { value: 'All posts in' } });
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    fireEvent.change(within(card).getByLabelText('Photo or document'), { target: { files: [file] } });
    fireEvent.click(within(card).getByRole('button', { name: 'Confirm done' }));
    await waitFor(() => expect(api.completeMyJob).toHaveBeenCalledWith('j1', 'All posts in', file));
    expect(api.loadMyJobs).toHaveBeenCalledTimes(2);
  });
});

describe('earnings', () => {
  it('approved gross from work and jobs, waiting apart, by kind of work and week, before deductions', async () => {
    render(<MyEarningsView today={TODAY} />);
    await settle();
    expect(api.loadMyEarnings).toHaveBeenCalledWith('2026-10-01');
    expect(screen.getByLabelText('Approved gross').textContent).toBe('KSh 16,200');
    expect(screen.getByLabelText('Waiting').textContent).toBe('KSh 300');
    expect(screen.getByText('Before deductions. Payouts and the month-end payslip will show what you take home.')).toBeTruthy();
    expect(screen.getByText('Contract jobs')).toBeTruthy();
    expect(screen.getByText('+ KSh 300 waiting')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-09-01' } });
    await settle();
    expect(api.loadMyEarnings).toHaveBeenLastCalledWith('2026-09-01');
  });
});
