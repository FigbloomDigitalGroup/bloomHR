import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MinimumWage } from '../../lib/minimumWage';

const api = vi.hoisted(() => ({
  rows: [] as MinimumWage[],
  company: { enabled: true, daysPerMonth: 26, minimum: { country: 'Kenya', monthly: null as number | null, currency: 'KES' } },
  added: [] as unknown[],
  settings: [] as unknown[],
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/confirmDialog', () => ({ confirmDialog: () => Promise.resolve(true) }));
vi.mock('../../lib/minimumWageApi', () => ({
  loadMinimumWages: () => Promise.resolve(api.rows),
  loadCompanyMinimum: () => Promise.resolve(api.company),
  addMinimumWage: (input: unknown) => {
    api.added.push(input);
    return Promise.resolve();
  },
  deleteMinimumWage: vi.fn(() => Promise.resolve()),
  saveMinimumWageSettings: (patch: unknown) => {
    api.settings.push(patch);
    return Promise.resolve();
  },
}));

import MinimumWageCard from './MinimumWageCard';

beforeEach(() => {
  api.rows = [];
  api.added = [];
  api.settings = [];
  api.company = { enabled: true, daysPerMonth: 26, minimum: { country: 'Kenya', monthly: null, currency: 'KES' } };
});
afterEach(cleanup);

describe('MinimumWageCard', () => {
  it('shows a hint, not a figure, when nothing is set', async () => {
    render(<MinimumWageCard canEdit />);
    expect(await screen.findByText(/No minimum wage set yet, so nothing is checked/)).toBeTruthy();
    expect(screen.getByText(/latest wage order/)).toBeTruthy();
    expect((screen.getByLabelText('Monthly amount') as HTMLInputElement).value).toBe('');
  });

  it('adds an amount for a country with the date it takes effect', async () => {
    render(<MinimumWageCard canEdit />);
    await screen.findByText(/No minimum wage set yet/);
    expect((screen.getByLabelText('Country') as HTMLInputElement).value).toBe('Kenya');
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'Tanzania' } });
    expect(screen.getByText('Monthly amount (TZS)')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Monthly amount'), { target: { value: '250,000' } });
    fireEvent.change(screen.getByLabelText('Takes effect'), { target: { value: '2026-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add amount' }));
    await waitFor(() => expect(api.added).toEqual([{ country: 'Tanzania', monthly_amount: 250000, effective_from: '2026-01-01', notes: '' }]));
  });

  it("lists each country's history with the per-day amount, marking the one in force", async () => {
    api.rows = [
      { id: '3', country: 'Kenya', monthly_amount: 20000, currency: 'KES', effective_from: '2099-01-01' },
      { id: '2', country: 'Kenya', monthly_amount: 16000, currency: 'KES', effective_from: '2026-05-01' },
      { id: '1', country: 'Kenya', monthly_amount: 15600, currency: 'KES', effective_from: '2024-11-01', notes: 'Wage order 2024' },
    ];
    render(<MinimumWageCard canEdit />);
    expect(await screen.findByText('KES 16,000 a month')).toBeTruthy();
    expect(screen.getByText('KES 15,600 a month')).toBeTruthy();
    expect(screen.getByText(/KES 600 a day/)).toBeTruthy();
    expect(screen.getByText('Wage order 2024')).toBeTruthy();
    expect(screen.getByText('KES 16,000 a month').closest('li')!.textContent).toContain('In force');
    expect(screen.getByText('KES 15,600 a month').closest('li')!.textContent).not.toContain('In force');
    expect(screen.getByText('KES 20,000 a month').closest('li')!.textContent).toContain('Coming');
  });

  it('saves the check and the working days', async () => {
    render(<MinimumWageCard canEdit />);
    await screen.findByText(/No minimum wage set yet/);
    fireEvent.click(screen.getByLabelText('Warn when pay is below the minimum wage'));
    const days = screen.getByLabelText('Working days in a month');
    fireEvent.change(days, { target: { value: '22' } });
    fireEvent.blur(days);
    await waitFor(() => expect(api.settings).toEqual([{ enabled: false }, { daysPerMonth: 22 }]));
  });

  it('is read-only without payroll access', async () => {
    api.rows = [{ id: '1', country: 'Kenya', monthly_amount: 15600, currency: 'KES', effective_from: '2024-11-01' }];
    render(<MinimumWageCard canEdit={false} />);
    await screen.findByText('KES 15,600 a month');
    expect(screen.queryByRole('button', { name: 'Add amount' })).toBeNull();
    expect(screen.queryByLabelText(/Remove Kenya/)).toBeNull();
    expect((screen.getByLabelText('Warn when pay is below the minimum wage') as HTMLInputElement).disabled).toBe(true);
  });
});
