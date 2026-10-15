import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AuditEntry } from '../../lib/auditTrail';

const state = vi.hoisted(() => ({ perms: ['settings'] as string[] }));
const loadAuditTrail = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ loading: false, hasPermission: (p: string) => state.perms.includes(p) }),
}));
vi.mock('../../lib/auditTrail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/auditTrail')>()),
  loadAuditTrail,
  loadAuditPeople: () => Promise.resolve({ 'u-1': 'Ada Admin' }),
}));

import AuditTrailPage from './AuditTrail';
import { fieldChanges, fieldLabel, valueText } from '../../lib/auditTrail';

const ENTRY: AuditEntry = {
  id: 'a1',
  performed_at: '2026-10-14T09:30:00Z',
  performed_by: 'u-1',
  action_type: 'UPDATE',
  table_name: 'employees',
  record_id: null,
  record_key: 'MCL-000012',
  old_data: { 'Basic Salary': 50000, updated_at: 'x' },
  new_data: { 'Basic Salary': 55000, updated_at: 'y' },
};

const renderPage = () => render(<MemoryRouter><AuditTrailPage /></MemoryRouter>);

beforeEach(() => {
  state.perms = ['settings'];
  loadAuditTrail.mockReset();
  loadAuditTrail.mockResolvedValue({ rows: [ENTRY], more: false });
});
afterEach(() => cleanup());

describe('Audit trail page', () => {
  it('lists who changed which record and shows the field before and after', async () => {
    renderPage();
    expect(await screen.findByText('Ada Admin')).toBeTruthy();
    const table = within(screen.getByRole('table'));
    expect(table.getByText('Employee record')).toBeTruthy();
    expect(table.getByText('MCL-000012')).toBeTruthy();
    expect(table.getByText('Changed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show the changes' }));
    expect(screen.getByText('50000')).toBeTruthy();
    expect(screen.getByText('55000')).toBeTruthy();
  });

  it('filters by record type from the first page', async () => {
    renderPage();
    await screen.findByText('Ada Admin');
    fireEvent.change(screen.getByLabelText('Record type'), { target: { value: 'job_groups' } });
    await waitFor(() => expect(loadAuditTrail).toHaveBeenLastCalledWith(expect.objectContaining({ table: 'job_groups' }), 0));
  });

  it('says when nothing is recorded yet', async () => {
    loadAuditTrail.mockResolvedValue({ rows: [], more: false });
    renderPage();
    expect(await screen.findByText('No changes recorded yet')).toBeTruthy();
  });

  it('tells someone without Settings they may not see it', () => {
    state.perms = [];
    renderPage();
    expect(screen.getByRole('status').textContent).toMatch(/Only an admin or someone with Settings/);
    expect(loadAuditTrail).not.toHaveBeenCalled();
  });
});

describe('audit entries', () => {
  it('leaves out bookkeeping fields and tidies names and values', () => {
    expect(fieldChanges(ENTRY).map((c) => c.field)).toEqual(['Basic Salary']);
    expect(fieldLabel('next_of_kin_phone')).toBe('Next of kin phone');
    expect(valueText(null)).toBe('—');
    expect(valueText(true)).toBe('Yes');
  });
});
