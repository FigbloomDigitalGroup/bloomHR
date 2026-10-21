import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Kpi, KpiAssignment, KpiPeriod, KpiPerson } from '../../../lib/kpiApi';

const api = vi.hoisted(() => ({
  saveKpi: vi.fn(),
  loadKpis: vi.fn(),
  assignKpi: vi.fn(),
  loadAssignments: vi.fn(),
  addCheckin: vi.fn(),
}));
vi.mock('../../../lib/kpiApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/kpiApi')>()),
  ...api,
}));

import KpiUploadModal from './KpiUploadModal';

const SALES: Kpi = {
  id: 'k1', name: 'Sales revenue', description: null, unit: 'currency_ksh', direction: 'higher_is_better',
  default_target: 1000000, default_weight: 60, frequency: 'quarterly', category: null, measure: 'manual', archived: false,
};
const Q4: KpiPeriod = { id: 'p1', name: 'Q4 2026', starts_on: '2026-10-01', ends_on: '2026-12-31', status: 'open' };
const person = (n: string, first: string): KpiPerson => ({
  employeeNumber: n, firstName: first, middleName: '', lastName: 'Test', fullName: `${first} Test`, jobTitle: 'Rep', branch: '',
  town: '', email: '', id: n, departmentId: 'd1', department: 'Sales', reportsToId: null, photo: '', status: 'Active', jobGroup: '',
});
const HAS: KpiAssignment = {
  id: 'a1', period_id: 'p1', kpi_id: 'k1', employee_number: 'E1', target: 1000000, weight: 60, assigned_via: 'person',
  self_value: null, self_comment: null, self_at: null, actual_value: null, manager_comment: null, scored_at: null,
};

const upload = (text: string) =>
  fireEvent.change(screen.getByLabelText('KPI spreadsheet'), {
    target: { files: [{ name: 'results.csv', arrayBuffer: () => Promise.resolve(new TextEncoder().encode(text).buffer) }] },
  });

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.loadKpis.mockResolvedValue([SALES]);
  api.loadAssignments.mockResolvedValue([HAS]);
  api.addCheckin.mockResolvedValue(undefined);
});
afterEach(() => cleanup());

const renderModal = (onDone = vi.fn()) =>
  render(
    <KpiUploadModal open onClose={vi.fn()} kpis={[SALES]} periods={[Q4]} people={[person('E1', 'Amina'), person('E2', 'Brian')]} departments={[]} onDone={onDone} />
  );

describe('KpiUploadModal', () => {
  it('previews the rows, refuses the ones it cannot save with why, and saves only after confirming', async () => {
    const onDone = vi.fn();
    renderModal(onDone);
    upload('Employee number,KPI name,Actual,Comment\nE1,Sales revenue,"1,200,000",Great\nE2,Sales revenue,5,');

    expect(await screen.findByText(/Results for Q4 2026/)).toBeTruthy();
    expect(screen.getByText(/KSh 1,200,000/)).toBeTruthy();
    expect(screen.getByText(/Brian Test \(E2\) doesn't have Sales revenue in Q4 2026; assign it first/)).toBeTruthy();
    expect(screen.getByText('Results, row 3:')).toBeTruthy();
    expect(api.addCheckin).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Save 1 row' }));
    await waitFor(() => expect(api.addCheckin).toHaveBeenCalledWith('a1', 'final', 1200000, 'Great'));
    expect(await screen.findByText('1 result saved as final scores')).toBeTruthy();
    expect(onDone).toHaveBeenCalled();
  });

  it('says when the file has no rows', async () => {
    renderModal();
    upload('Employee number,KPI name,Actual\n');
    expect(await screen.findByText(/The file has no rows to upload/)).toBeTruthy();
  });
});
