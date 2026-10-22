import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { toDirectoryEmployee } from '../../lib/employeeDirectory';
import type { Scanner } from '../../lib/attendanceScanners';

const api = vi.hoisted(() => ({
  loadScanners: vi.fn(),
  saveScanner: vi.fn(),
  setScannerActive: vi.fn(),
  checkSerialTried: vi.fn(),
  loadScannerUsers: vi.fn(),
  loadUnmatched: vi.fn(),
  saveScannerUser: vi.fn(),
  removeScannerUser: vi.fn(),
  loadIgnored: vi.fn(),
  loadScannerNames: vi.fn(),
  ignoreScannerUser: vi.fn(),
  unignoreScannerUser: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/attendanceScanners', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/attendanceScanners')>()),
  ...api,
}));
const staff = [
  toDirectoryEmployee({ 'Employee Number': 'FBL-000006', 'First Name': 'Amina', 'Last Name': 'Otieno' }),
  toDirectoryEmployee({ 'Employee Number': 'FBL-000007', 'First Name': 'Baraka', 'Last Name': 'Juma' }),
  toDirectoryEmployee({ 'Employee Number': 'FBL-000009', 'First Name': 'Chebet', 'Last Name': 'Kirui' }),
  toDirectoryEmployee({ 'Employee Number': 'FBL-000010', 'First Name': 'Daudi', 'Last Name': 'Otieno' }),
];
vi.mock('../../hooks/useEmployeeDirectory', () => ({
  useEmployeeDirectory: () => ({ employees: staff, loading: false, error: null }),
}));

import Scanners from './Scanners';

const FRONT: Scanner = {
  id: 'd1', name: 'Front door', serialNumber: 'BRAV260421021', brand: 'zkteco', allowedIp: '41.90.12.34', active: true,
  lastSeenAt: '2026-10-22T05:05:00Z', lastIp: '41.90.12.34', lastError: null, lastErrorAt: null,
  clockWarning: null, clockWarningAt: null, usersReceivedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.loadScanners.mockResolvedValue([FRONT, { ...FRONT, id: 'd2', name: 'Back gate', serialNumber: 'XYZ123', lastSeenAt: null, lastIp: null, allowedIp: null }]);
  api.saveScanner.mockResolvedValue(undefined);
  api.setScannerActive.mockResolvedValue(undefined);
  api.checkSerialTried.mockResolvedValue({ tried: true, lastSeenAt: '2026-10-22T06:00:00Z' });
  api.loadScannerUsers.mockResolvedValue([{ id: 'm1', scannerUserId: '9', employeeNumber: 'FBL-000009' }]);
  api.loadUnmatched.mockResolvedValue([
    { scannerUserId: '6', punches: 3, firstAt: '2026-10-20T05:00:00Z', lastAt: '2026-10-22T05:00:00Z' },
    { scannerUserId: '7', punches: 1, firstAt: '2026-10-22T05:10:00Z', lastAt: '2026-10-22T05:10:00Z' },
    { scannerUserId: '42', punches: 1, firstAt: '2026-10-22T05:10:00Z', lastAt: '2026-10-22T05:10:00Z' },
  ]);
  api.saveScannerUser.mockResolvedValue(undefined);
  api.removeScannerUser.mockResolvedValue(undefined);
  api.loadIgnored.mockResolvedValue([]);
  api.loadScannerNames.mockResolvedValue(new Map());
  api.ignoreScannerUser.mockResolvedValue(undefined);
  api.unignoreScannerUser.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('Scanners tab', () => {
  it('lists the scanners: last seen, from where, the IP lock and on/off', async () => {
    render(<Scanners />);
    const row = (await screen.findByText('Front door')).closest('tr') as HTMLElement;
    expect(within(row).getAllByRole('cell').map((c) => c.textContent).slice(1, 6))
      .toEqual(['BRAV260421021', 'Thu 22 Oct 2026, 8:05 am', '41.90.12.34', '41.90.12.34', 'On']);
    const back = screen.getByText('Back gate').closest('tr') as HTMLElement;
    expect(within(back).getByText('Never connected')).toBeTruthy();
    expect(within(back).getByText('Any')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Switch off Front door' }));
    await waitFor(() => expect(api.setScannerActive).toHaveBeenCalledWith('d1', false));
  });

  it('warns HR when a scanner’s clock is ahead and its punches are held back', async () => {
    api.loadScanners.mockResolvedValue([{
      ...FRONT, clockWarning: "The scanner's clock is about 5 hours ahead of Nairobi time, so 2 punches were held back. Restart the scanner so it takes the time zone again; punches from then on count.",
      clockWarningAt: '2026-10-22T09:30:00Z',
    }]);
    render(<Scanners />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/about 5 hours ahead.*Restart the scanner/);
  });

  it('adds a scanner, saying whether one with that serial tried to connect', async () => {
    render(<Scanners />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a scanner' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByRole('alert').textContent).toMatch(/Give the scanner a name/);
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Side door' } });
    fireEvent.change(within(dialog).getByLabelText('Serial number'), { target: { value: 'new0000001' } });
    expect((await within(dialog).findByRole('status', {}, { timeout: 2000 })).textContent).toMatch(/tried to connect/);
    expect(api.checkSerialTried).toHaveBeenCalledWith('NEW0000001');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.saveScanner).toHaveBeenCalledWith(null, { name: 'Side door', serialNumber: 'new0000001', allowedIp: '', active: true })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.loadScanners).toHaveBeenCalledTimes(2);
  });

  it('shows a refusal in the form', async () => {
    api.saveScanner.mockRejectedValue(new Error('A scanner with this serial number is already registered. If it is yours, contact support.'));
    render(<Scanners />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Back gate' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/already registered/);
    // the serial didn't change: nothing to check
    expect(api.checkSerialTried).not.toHaveBeenCalled();
  });

  it('gives setup steps with the relay address or "ask your administrator"', async () => {
    vi.stubEnv('VITE_ICLOCK_RELAY_HOST', '');
    try {
      render(<Scanners />);
      const steps = await screen.findByLabelText('Setting up a scanner');
      expect(steps.textContent).toMatch(/Menu → COMM → Ethernet/);
      expect(steps.textContent).toMatch(/Gateway: your office router, e\.g\. 192\.168\.100\.1/);
      expect(steps.textContent).toMatch(/DNS: 8\.8\.8\.8/);
      expect(steps.textContent).toMatch(/Server mode: ADMS/);
      expect(steps.textContent).toMatch(/ask your administrator/);
      expect(steps.textContent).toMatch(/Count attendance from/);
      cleanup();
      vi.stubEnv('VITE_ICLOCK_RELAY_HOST', 'scanners.example.com');
      render(<Scanners />);
      expect((await screen.findByLabelText('Setting up a scanner')).textContent).toMatch(/Server address: scanners\.example\.com, with Server port 80/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('Match automatically suggests by employee number, and nothing is saved until HR confirms', async () => {
    render(<Scanners />);
    const users = await screen.findByLabelText('Scanner users');
    const waiting = await within(users).findByLabelText('Waiting for a match');
    expect(within(waiting).getByText('Scanner user 6')).toBeTruthy();
    fireEvent.click(within(waiting).getByRole('button', { name: 'Match automatically' }));
    expect(within(waiting).getByRole('status').textContent).toMatch(/2 suggestions/);
    expect((within(waiting).getByLabelText('Employee for scanner user 6') as HTMLInputElement).value).toBe('Amina Otieno (FBL-000006)');
    expect((within(waiting).getByLabelText('Employee for scanner user 7') as HTMLInputElement).value).toBe('Baraka Juma (FBL-000007)');
    // 42 matches nobody; 9's employee is already matched
    expect((within(waiting).getByLabelText('Employee for scanner user 42') as HTMLInputElement).value).toBe('');
    expect(api.saveScannerUser).not.toHaveBeenCalled();
    fireEvent.click(within(waiting).getByRole('button', { name: 'Save all' }));
    await waitFor(() => expect(api.saveScannerUser).toHaveBeenCalledTimes(2));
    expect(api.saveScannerUser).toHaveBeenCalledWith(null, '6', 'FBL-000006');
    expect(api.saveScannerUser).toHaveBeenCalledWith(null, '7', 'FBL-000007');
    await waitFor(() => expect(api.loadUnmatched).toHaveBeenCalledTimes(2));
  });

  it('matches one person by hand, and changes or removes a match', async () => {
    render(<Scanners />);
    const users = await screen.findByLabelText('Scanner users');
    const picker = await within(users).findByLabelText('Employee for scanner user 42');
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: 'chebet' } });
    fireEvent.mouseDown(await screen.findByRole('option'));
    fireEvent.click(within(users).getByRole('button', { name: 'Save scanner user 42' }));
    await waitFor(() => expect(api.saveScannerUser).toHaveBeenCalledWith(null, '42', 'FBL-000009'));

    const matched = within(users).getByLabelText('Matched');
    expect((within(matched).getByLabelText('Employee for scanner user 9') as HTMLInputElement).value).toBe('Chebet Kirui (FBL-000009)');
    expect((within(matched).getByRole('button', { name: 'Save scanner user 9' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(matched).getByRole('button', { name: 'Remove scanner user 9' }));
    await waitFor(() => expect(api.removeScannerUser).toHaveBeenCalledWith('m1'));
  });

  it('shows the name each scanner user has on the scanner, waiting and matched', async () => {
    api.loadScannerNames.mockResolvedValue(new Map([['6', 'Baraka'], ['9', 'Chebet']]));
    api.loadScanners.mockResolvedValue([{ ...FRONT, usersReceivedAt: '2026-10-22T06:00:00Z' }]);
    render(<Scanners />);
    const users = await screen.findByLabelText('Scanner users');
    expect(await within(within(users).getByLabelText('Waiting for a match')).findByText('Scanner user 6 · Baraka')).toBeTruthy();
    expect(within(within(users).getByLabelText('Waiting for a match')).getByText('Scanner user 7')).toBeTruthy();
    expect(within(within(users).getByLabelText('Matched')).getByText('Scanner user 9 · Chebet')).toBeTruthy();
    expect(screen.getByText('User names received Thu 22 Oct 2026, 9:00 am')).toBeTruthy();
  });

  it('Match automatically goes by the name: one person is suggested, several are named, a number the name disagrees with is not', async () => {
    api.loadScannerNames.mockResolvedValue(new Map([['6', 'Baraka'], ['7', 'Zilpar'], ['42', 'Otieno']]));
    render(<Scanners />);
    const waiting = await within(await screen.findByLabelText('Scanner users')).findByLabelText('Waiting for a match');
    await within(waiting).findByText('Scanner user 42 · Otieno');
    fireEvent.click(within(waiting).getByRole('button', { name: 'Match automatically' }));
    expect(within(waiting).getByRole('status').textContent).toBe('1 suggestion by the name on the scanner. Check them, then save.');
    // 6 is "Baraka" on the scanner: Baraka Juma, not Amina (FBL-000006)
    expect((within(waiting).getByLabelText('Employee for scanner user 6') as HTMLInputElement).value).toBe('Baraka Juma (FBL-000007)');
    expect(within(waiting).getByText(/Suggested by name/)).toBeTruthy();
    // 7 "Zilpar" fits nobody: no suggestion by number either
    expect((within(waiting).getByLabelText('Employee for scanner user 7') as HTMLInputElement).value).toBe('');
    // 42 "Otieno" is Amina Otieno or Daudi Otieno
    expect(within(waiting).getByText("Several people match 'Otieno'. Pick the right one.")).toBeTruthy();
    expect((within(waiting).getByLabelText('Employee for scanner user 42') as HTMLInputElement).value).toBe('');
    expect(api.saveScannerUser).not.toHaveBeenCalled();
  });

  it('"Not staff, ignore" asks why, then the scanner user is ignored', async () => {
    render(<Scanners />);
    const waiting = await within(await screen.findByLabelText('Scanner users')).findByLabelText('Waiting for a match');
    fireEvent.click(await within(waiting).findByRole('button', { name: 'Not staff, ignore scanner user 42' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ignore' }));
    expect(within(dialog).getByRole('alert').textContent).toMatch(/Say why/);
    expect(api.ignoreScannerUser).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText('Why they aren’t staff'), { target: { value: 'The cook' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ignore' }));
    await waitFor(() => expect(api.ignoreScannerUser).toHaveBeenCalledWith('42', 'The cook'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.loadIgnored).toHaveBeenCalledTimes(2);
  });

  it('lists the ignored with Undo, and allows matching one to an employee later', async () => {
    api.loadScannerNames.mockResolvedValue(new Map([['22', 'Beatrice']]));
    api.loadIgnored.mockResolvedValue([{ id: 'i1', scannerUserId: '22', reason: 'The cook', ignoredAt: '2026-10-22T07:00:00Z' }]);
    render(<Scanners />);
    const ignored = await within(await screen.findByLabelText('Scanner users')).findByLabelText('Ignored');
    expect(within(ignored).getByText('Scanner user 22 · Beatrice')).toBeTruthy();
    expect(within(ignored).getByText(/The cook/)).toBeTruthy();
    fireEvent.click(within(ignored).getByRole('button', { name: 'Undo ignore scanner user 22' }));
    await waitFor(() => expect(api.unignoreScannerUser).toHaveBeenCalledWith('i1'));

    const picker = within(ignored).getByLabelText('Employee for scanner user 22');
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: 'chebet' } });
    fireEvent.mouseDown(await screen.findByRole('option'));
    fireEvent.click(within(ignored).getByRole('button', { name: 'Save scanner user 22' }));
    await waitFor(() => expect(api.saveScannerUser).toHaveBeenCalledWith(null, '22', 'FBL-000009'));
  });

  it('no Ignored section when nobody is ignored', async () => {
    render(<Scanners />);
    await within(await screen.findByLabelText('Scanner users')).findByLabelText('Waiting for a match');
    expect(screen.queryByLabelText('Ignored')).toBeNull();
  });
});
