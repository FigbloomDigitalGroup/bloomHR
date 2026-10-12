import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  loadHealth: vi.fn(),
  giveHealthConsent: vi.fn(),
  withdrawHealthConsent: vi.fn(),
  saveHealthRecord: vi.fn(),
  openHealthFile: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/employeeHealth', async (importOriginal) => ({ ...(await importOriginal<object>()), ...api }));

import HealthSection from './HealthSection';
import HealthReview from './HealthReview';

const asthma = { id: 'h1', kind: 'condition', title: 'Asthma', details: 'Uses an inhaler', institution: 'Kenyatta National Hospital',
  diagnosed_on: '2019-05-01', files: [{ id: 'f1', file_path: 't/u/health/x.pdf', file_name: 'report.pdf' }] };

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.giveHealthConsent.mockResolvedValue(undefined);
  api.saveHealthRecord.mockResolvedValue('h2');
  api.withdrawHealthConsent.mockResolvedValue(undefined);
  api.openHealthFile.mockResolvedValue(undefined);
});
afterEach(() => cleanup());

describe('HealthSection (employee)', () => {
  it('asks for consent before anything can be added', async () => {
    api.loadHealth.mockResolvedValue({ consent_given_at: null, records: [] });
    render(<HealthSection employeeId="e1" />);
    const button = (await screen.findByRole('button', { name: /I consent/ })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(button);
    await waitFor(() => expect(api.giveHealthConsent).toHaveBeenCalledWith('e1'));
  });

  it('adds a condition once consent is given', async () => {
    api.loadHealth.mockResolvedValue({ consent_given_at: '2026-10-12T10:00:00Z', records: [] });
    render(<HealthSection employeeId="e1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Add health information/ }));
    fireEvent.change(screen.getByPlaceholderText('Asthma'), { target: { value: 'Diabetes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveHealthRecord).toHaveBeenCalledWith('e1', expect.objectContaining({ kind: 'condition', title: 'Diabetes' })));
  });

  it('withdrawing consent, after confirming, deletes everything', async () => {
    const info = { consent_given_at: '2026-10-12T10:00:00Z', records: [asthma] };
    api.loadHealth.mockResolvedValue(info);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<HealthSection employeeId="e1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Withdraw consent and delete it/ }));
    await waitFor(() => expect(api.withdrawHealthConsent).toHaveBeenCalledWith('e1', info));
  });
});

describe('HealthReview (HR)', () => {
  it('loads nothing until HR asks, then shows the records and opens documents', async () => {
    api.loadHealth.mockResolvedValue({ consent_given_at: '2026-10-12T10:00:00Z', records: [asthma] });
    render(<HealthReview employeeId="e1" />);
    expect(screen.getByText(/each time you look is recorded/)).toBeTruthy();
    expect(api.loadHealth).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Show health information/ }));
    expect(await screen.findByText('Asthma')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /report.pdf/ }));
    expect(api.openHealthFile).toHaveBeenCalledWith(asthma.files[0]);
  });

  it('says when the employee shared nothing', async () => {
    api.loadHealth.mockResolvedValue({ consent_given_at: null, records: [] });
    render(<HealthReview employeeId="e1" />);
    fireEvent.click(screen.getByRole('button', { name: /Show health information/ }));
    expect(await screen.findByText(/has not shared any health information/)).toBeTruthy();
  });
});
