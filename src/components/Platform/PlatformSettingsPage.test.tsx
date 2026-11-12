import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AutoApproveSettings } from '../../lib/platformAutoApprove';

const api = vi.hoisted(() => ({
  role: 'owner' as import('../../lib/platformRoles').PlatformRole | null,
  settings: null as AutoApproveSettings | null,
  loadError: null as Error | null,
  changes: [] as unknown[][],
  changeError: null as Error | null,
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: toast }));
vi.mock('../../lib/platformRoles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/platformRoles')>()),
  myPlatformRole: () => Promise.resolve(api.role),
}));
vi.mock('../../lib/platformAutoApprove', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/platformAutoApprove')>()),
  getAutoApprove: () => (api.loadError ? Promise.reject(api.loadError) : Promise.resolve(api.settings)),
  setProductAutoApprove: (module: string, enabled: boolean | null, reason: string) => {
    api.changes.push([module, enabled, reason]);
    if (api.changeError) return Promise.reject(api.changeError);
    const s = api.settings!;
    api.settings = {
      ...s,
      products: s.products.map((p) => (p.module === module ? { ...p, own: enabled, effective: enabled ?? s.default, inherited: enabled === null } : p)),
    };
    return Promise.resolve(api.settings);
  },
}));

import PlatformSettingsPage from './PlatformSettingsPage';

afterEach(cleanup);
beforeEach(() => {
  api.role = 'owner';
  api.loadError = null;
  api.changeError = null;
  api.changes = [];
  api.settings = {
    default: false,
    can_change: true,
    products: [
      { module: 'hr', label: 'Figbloom HR', own: null, effective: false, inherited: true },
      { module: 'schools', label: 'Figbloom Schools', own: null, effective: false, inherited: true },
      { module: 'fleet', label: 'Figbloom Fleet', own: null, effective: false, inherited: true },
    ],
  };
  toast.success.mockReset();
  toast.error.mockReset();
});

const box = async (label: string) => (await screen.findByLabelText(`Approve new ${label} organisations automatically`)) as HTMLInputElement;
const rowOf = async (label: string) => (await box(label)).closest('li') as HTMLElement;

describe('the platform settings page', () => {
  it('shows one switch per product with its value and whether it follows the platform default', async () => {
    api.settings!.products[2] = { module: 'fleet', label: 'Figbloom Fleet', own: true, effective: true, inherited: false };
    render(<PlatformSettingsPage />);
    expect((await box('Figbloom HR')).checked).toBe(false);
    expect((await box('Figbloom Schools')).checked).toBe(false);
    expect((await box('Figbloom Fleet')).checked).toBe(true);
    expect(within(await rowOf('Figbloom HR')).getByText('Platform default')).toBeTruthy();
    expect(within(await rowOf('Figbloom HR')).getByText(/Follows the platform default \(off\)/)).toBeTruthy();
    const fleet = await rowOf('Figbloom Fleet');
    expect(within(fleet).getByText('Own setting')).toBeTruthy();
    expect(within(fleet).getByText(/On: a new organisation starts active\. Set for this product\./)).toBeTruthy();
    expect(within(fleet).getByText('Use platform default')).toBeTruthy();
    expect(within(await rowOf('Figbloom HR')).queryByText('Use platform default')).toBeNull();
  });

  it("switches Fleet on with a reason, after confirming", async () => {
    render(<PlatformSettingsPage />);
    fireEvent.click(await box('Figbloom Fleet'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/starts active at once/)).toBeTruthy();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'No real clients to vet yet' } });
    fireEvent.click(within(dialog).getByText('Save'));
    await waitFor(() => expect(api.changes).toEqual([['fleet', true, 'No real clients to vet yet']]));
    await waitFor(() => expect((screen.getByLabelText('Approve new Figbloom Fleet organisations automatically') as HTMLInputElement).checked).toBe(true));
    expect(toast.success).toHaveBeenCalledWith('Figbloom Fleet: new organisations start active.');
    expect((await box('Figbloom Schools')).checked).toBe(false);
  });

  it('sets a product back to the platform default', async () => {
    api.settings!.products[0] = { module: 'hr', label: 'Figbloom HR', own: true, effective: true, inherited: false };
    render(<PlatformSettingsPage />);
    fireEvent.click(within(await rowOf('Figbloom HR')).getByText('Use platform default'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByText('Save'));
    await waitFor(() => expect(api.changes).toEqual([['hr', null, '']]));
    await waitFor(async () => expect(within(await rowOf('Figbloom HR')).getByText('Platform default')).toBeTruthy());
  });

  it('keeps the switch as it was when saving fails', async () => {
    api.changeError = new Error('Only an owner or admin can change how new companies are approved.');
    render(<PlatformSettingsPage />);
    fireEvent.click(await box('Figbloom Fleet'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByText('Save'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Only an owner or admin can change how new companies are approved.'));
    expect((await box('Figbloom Fleet')).checked).toBe(false);
  });

  it('shows why it could not load', async () => {
    api.loadError = new Error("The Figbloom platform isn't connected to the console yet.");
    render(<PlatformSettingsPage />);
    expect((await screen.findByRole('alert')).textContent).toContain("isn't connected");
  });
});

describe('the platform settings page: console roles', () => {
  it.each(['support', 'viewer'] as const)('%s sees the switches but cannot change them', async (role) => {
    api.role = role;
    render(<PlatformSettingsPage />);
    for (const label of ['Figbloom HR', 'Figbloom Schools', 'Figbloom Fleet']) expect((await box(label)).disabled).toBe(true);
    expect(screen.getByText('Only owners and admins change these.')).toBeTruthy();
    expect(screen.queryByText('Use platform default')).toBeNull();
  });

  it('an admin changes them', async () => {
    api.role = 'admin';
    render(<PlatformSettingsPage />);
    expect((await box('Figbloom Fleet')).disabled).toBe(false);
  });

  it('someone who is not a platform admin sees nothing', async () => {
    api.role = null;
    render(<PlatformSettingsPage />);
    expect(await screen.findByText('Only Figbloom platform admins can see the platform settings.')).toBeTruthy();
    expect(screen.queryByLabelText(/organisations automatically/)).toBeNull();
  });
});
