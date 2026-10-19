import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const api = vi.hoisted(() => ({
  admin: true,
  latest: null as string | null,
  saved: [] as unknown[][],
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/platformRates', async (importOriginal) => {
  const { PLATFORM_RATE_ROWS } = await import('../../lib/payroll/platformRateRows');
  return {
    ...(await importOriginal<typeof import('../../lib/platformRates')>()),
    isPlatformAdmin: () => Promise.resolve(api.admin),
    platformRows: (country: string) => Promise.resolve(PLATFORM_RATE_ROWS.filter((r) => r.country === country)),
    latestApprovedMonth: () => Promise.resolve(api.latest),
    addPlatformRate: (...args: unknown[]) => {
      api.saved.push(args);
      return Promise.resolve('new-id');
    },
  };
});

import PlatformRatesPage from './PlatformRatesPage';

afterEach(cleanup);
beforeEach(() => {
  api.admin = true;
  api.latest = null;
  api.saved = [];
});

/** Opens "New version" for a rate (the row of its version in force). */
const openVersion = async (label: string) => {
  const cell = (await screen.findAllByText(label)).find((el) => el.closest('tr')?.textContent?.includes('in force'));
  fireEvent.click(within(cell!.closest('tr') as HTMLElement).getByText('New version'));
};
const field = (label: string) => screen.getByLabelText(label, { exact: false }) as HTMLInputElement;

describe('the platform rates screen', () => {
  it('is for platform admins only', async () => {
    api.admin = false;
    render(<PlatformRatesPage />);
    expect(await screen.findByText(/Only Figbloom platform admins can change the platform rates/)).toBeTruthy();
    expect(screen.queryByText('New version')).toBeNull();
  });

  it("lists every version of a country's rates, and switches country", async () => {
    render(<PlatformRatesPage />);
    expect((await screen.findAllByText('NSSF upper earnings limit')).length).toBe(3);
    fireEvent.click(screen.getByRole('tab', { name: 'Uganda' }));
    expect(await screen.findByText('Local service tax bands (annual amount)')).toBeTruthy();
  });

  it('previews old vs new for the sample salaries, then saves the version for every company', async () => {
    render(<PlatformRatesPage />);
    await openVersion('Housing levy rate (employee)');
    fireEvent.change(field('Rate (%)'), { target: { value: '2' } });
    fireEvent.change(field('From'), { target: { value: '2027-07-01' } });
    fireEvent.change(field('Source'), { target: { value: 'Finance Act 2027' } });
    const preview = await screen.findByRole('table', { name: 'Preview' });
    // 100,000 basic: the levy 1,005 -> 1,340
    expect(within(preview).getByText('KSh 1,005 → KSh 1,340')).toBeTruthy();
    expect(within(preview).getAllByRole('row')).toHaveLength(4);
    // another salary
    fireEvent.change(field('Another salary'), { target: { value: '250000' } });
    expect(within(screen.getByRole('table', { name: 'Preview' })).getAllByRole('row')).toHaveLength(5);
    fireEvent.click(screen.getByText('Save for every company in Kenya'));
    await waitFor(() => expect(api.saved).toHaveLength(1));
    expect(api.saved[0]).toEqual([
      { country: 'Kenya', code: 'ahl_rate', value: 0.02, bands: null, from: '2027-07-01', source: 'Finance Act 2027' },
      false,
    ]);
  });

  it('refuses bands that do not go up and rates above 100%', async () => {
    render(<PlatformRatesPage />);
    await openVersion('PAYE bands');
    fireEvent.change(field('Source'), { target: { value: 'Finance Act 2027' } });
    fireEvent.change(field('Band 2 up to'), { target: { value: '1000' } });
    expect(await screen.findByText(/Band 2: each band's "up to" must be above the one before/)).toBeTruthy();
    fireEvent.change(field('Band 2 up to'), { target: { value: '32333' } });
    fireEvent.change(field('Band 1 rate'), { target: { value: '150' } });
    expect(await screen.findByText('Band 1: a rate is a share between 0 and 1')).toBeTruthy();
    expect((screen.getByText('Save for every company in Kenya') as HTMLButtonElement).disabled).toBe(true);
  });

  it('asks for confirmation before reaching back into an approved month', async () => {
    api.latest = '2026-09';
    render(<PlatformRatesPage />);
    await openVersion('Personal relief (monthly)');
    fireEvent.change(field('Value'), { target: { value: '2600' } });
    fireEvent.change(field('From'), { target: { value: '2026-07-01' } });
    fireEvent.change(field('Source'), { target: { value: 'Backdated notice' } });
    expect(await screen.findByText(/Payroll for 2026-09 is already approved/, { selector: 'li' })).toBeTruthy();
    const save = screen.getByText('Save for every company in Kenya') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(api.saved).toHaveLength(1));
    expect(api.saved[0][1]).toBe(true);
  });
});
