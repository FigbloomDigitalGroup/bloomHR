import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { WibaCover, WorkInjuryCase } from '../../lib/workInjury';

const state = vi.hoisted(() => ({ cases: [] as unknown[], cover: null as unknown }));
const api = vi.hoisted(() => ({
  saveWorkInjuryCase: vi.fn(),
  saveWibaCover: vi.fn(),
  loadIncident: vi.fn(),
  loadMonthlyEarnings: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../hooks/useEmployeeDirectory', () => ({
  useEmployeeDirectory: () => ({
    employees: [{ employeeNumber: 'MCL-000001', firstName: 'Amina', middleName: '', lastName: 'Wanjiru', fullName: 'Amina Wanjiru', jobTitle: 'Driver', branch: '', town: '', email: '', id: 'e1', departmentId: null, department: '', reportsToId: null, photo: '', status: 'Active' }],
    loading: false,
    error: null,
  }),
}));
vi.mock('../../lib/companyProfile', () => ({ loadCompanyProfile: () => Promise.resolve(null) }));
vi.mock('../../lib/workInjuryApi', () => ({
  loadWorkInjuryCases: () => Promise.resolve(state.cases),
  loadWibaCover: () => Promise.resolve(state.cover),
  loadCaseDocuments: () => Promise.resolve([]),
  loadEmployeeReportDetails: () => Promise.resolve({}),
  addCaseDocument: vi.fn(),
  removeCaseDocument: vi.fn(),
  openCaseDocument: vi.fn(),
  ...api,
}));

import WorkInjuries from './WorkInjuries';
import WibaCoverBanner from './WibaCoverBanner';

const today = new Date();
const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = (n: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - n, 9, 0);

const aCase = (over: Partial<WorkInjuryCase> = {}): WorkInjuryCase => ({
  id: 'c1', incident_report_id: null, employee_number: 'MCL-000001', employee_name: 'Amina Wanjiru', country: 'Kenya', currency: 'KES',
  kind: 'accident', is_fatal: false, occurred_at: daysAgo(2).toISOString(), employer_notified_on: dayKey(daysAgo(2)), place: 'Warehouse',
  what_happened: 'Slipped on a wet floor', injury_nature: 'Broken wrist', body_parts: 'Left wrist', witnesses: null, first_aid: null,
  hospital: null, doctor: null, on_duty: true, stopped_work_on: null, returned_to_work_on: null, days_off: 10, incapacity_percent: null,
  monthly_earnings: 36500, medical_costs: null, status: 'reported', authority_notified_on: null, authority_reference: null,
  claim_lodged_on: null, insurer_claim_number: null, assessed_on: null, assessed_amount: null, paid_on: null, paid_amount: null,
  closed_on: null, notes: null, created_at: daysAgo(2).toISOString(), updated_at: daysAgo(2).toISOString(), ...over,
});

const cover: WibaCover = { insurer_name: 'Jubilee', policy_number: 'WIBA-1', cover_start: null, cover_expiry: dayKey(daysAgo(-200)), dosh_registration_no: null, notes: null };

const page = (url = '/work-injuries') => render(<MemoryRouter initialEntries={[url]}><WorkInjuries /></MemoryRouter>);

beforeEach(() => {
  state.cases = [aCase()];
  state.cover = cover;
  api.saveWorkInjuryCase.mockReset().mockImplementation((_id: string | null, fields: Partial<WorkInjuryCase>) => Promise.resolve(aCase({ ...fields, id: 'c2' })));
  api.loadIncident.mockReset().mockResolvedValue(null);
  api.loadMonthlyEarnings.mockReset().mockResolvedValue(null);
});
afterEach(() => cleanup());

describe('Work injuries page', () => {
  it('lists cases with the countdown to the DOSH report, and explains how it works', async () => {
    page();
    expect(await screen.findByText('Amina Wanjiru')).toBeTruthy();
    expect(screen.getByText(/Report to DOSH by .* — 5 days left/)).toBeTruthy();
    expect(screen.getByText('How this works')).toBeTruthy();
    expect(screen.getAllByText('A guide, not legal advice.').length).toBeGreaterThan(0);
    expect(screen.getByTestId('cover-state').textContent).toContain('Jubilee');
  });

  it('a case shows the estimate, clearly an estimate, never payroll', async () => {
    page();
    fireEvent.click(await screen.findByLabelText('Open the case of Amina Wanjiru'));
    const estimate = await screen.findByLabelText('Compensation estimate');
    expect(within(estimate).getByText(/An estimate only/).textContent).toContain('Nothing here is added to payroll');
    // 36,500 x 12 / 365 = 1,200 a day x 10 days
    expect(within(estimate).getByTestId('estimate-total').textContent).toContain('12,000');
    expect(screen.getByText('Accident report (PDF)')).toBeTruthy();
    expect(screen.getByText(/not taken from the employee.s annual or sick leave/)).toBeTruthy();
  });

  it('opens a new case from an incident report, filled in from it', async () => {
    state.cases = [];
    api.loadIncident.mockResolvedValue({
      id: 'inc-1', employee_number: 'MCL-000001', is_anonymous: false, incident_type: 'workplace_injury', title: 'Fell from ladder',
      description: 'In the store', incident_date: '2026-10-19', location: 'Store room', witnesses: 'Juma', created_at: '2026-10-19T12:00:00Z',
    });
    page('/work-injuries?incident=inc-1');
    expect(await screen.findByText('New work injury case')).toBeTruthy();
    expect((screen.getByLabelText('Where (place, machine or vehicle)') as HTMLInputElement).value).toBe('Store room');
    expect((screen.getByLabelText('What happened') as HTMLTextAreaElement).value).toContain('Fell from ladder');
    fireEvent.click(screen.getByText('Open case'));
    await waitFor(() => expect(api.saveWorkInjuryCase).toHaveBeenCalled());
    const [id, fields] = api.saveWorkInjuryCase.mock.calls[0];
    expect(id).toBeNull();
    expect(fields).toMatchObject({ incident_report_id: 'inc-1', employee_number: 'MCL-000001', place: 'Store room', witnesses: 'Juma', status: 'reported' });
  });

  it('warns when there is no insurance', async () => {
    state.cover = null;
    page();
    expect((await screen.findByTestId('cover-state')).textContent).toMatch(/No work injury \(WIBA\) insurance/);
  });
});

describe('WibaCoverBanner', () => {
  it('shows when the cover is missing or expired, nothing when it is in place', async () => {
    state.cover = { ...cover, cover_expiry: dayKey(daysAgo(3)) };
    render(<MemoryRouter><WibaCoverBanner /></MemoryRouter>);
    expect((await screen.findByRole('alert')).textContent).toMatch(/expired/);
    cleanup();
    state.cover = cover;
    const { container } = render(<MemoryRouter><WibaCoverBanner /></MemoryRouter>);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
  });
});
