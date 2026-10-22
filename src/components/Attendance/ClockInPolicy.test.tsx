import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  loadClockInSettings: vi.fn(),
  saveClockInSettings: vi.fn(),
  loadScannerAddresses: vi.fn(),
  loadBranchLocations: vi.fn(),
  saveBranchLocation: vi.fn(),
  currentLocation: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: toast }));
vi.mock('../../lib/attendanceApi', () => api);

import ClockInPolicy from './ClockInPolicy';

beforeEach(() => {
  vi.clearAllMocks();
  api.loadClockInSettings.mockResolvedValue({ policy: 'anywhere', networks: [], radiusM: 300 });
  api.loadScannerAddresses.mockResolvedValue(['41.90.12.7']);
  api.loadBranchLocations.mockResolvedValue([{ id: 'b1', name: 'Nairobi', active: true, latitude: null, longitude: null }]);
  api.saveClockInSettings.mockImplementation(async (s) => s);
  api.saveBranchLocation.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('ClockInPolicy', () => {
  it('starts at Anywhere; choosing Only from an office shows the networks, prefilled from the scanners', async () => {
    render(<ClockInPolicy />);
    const anywhere = (await screen.findByLabelText(/^Anywhere/)) as HTMLInputElement;
    expect(anywhere.checked).toBe(true);
    expect(screen.queryByLabelText(/Office networks/)).toBeNull();
    fireEvent.click(screen.getByLabelText(/^Only from an office/));
    expect((screen.getByLabelText(/Office networks/) as HTMLTextAreaElement).value).toBe('41.90.12.7');
    expect(screen.getByText(/Filled in from the addresses your scanners call from/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Office networks/), { target: { value: '41.90.12.7\n102.68.0.0/24, 41.90.12.7' } });
    fireEvent.change(screen.getByLabelText(/within \(metres\)/), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveClockInSettings).toHaveBeenCalledWith({ policy: 'office', networks: ['41.90.12.7', '102.68.0.0/24'], radiusM: 250 }));
    expect(toast.success).toHaveBeenCalledWith('Clock-in policy saved');
  });

  it('saves Scanner only', async () => {
    render(<ClockInPolicy />);
    fireEvent.click(await screen.findByLabelText(/^Scanner only/));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveClockInSettings).toHaveBeenCalledWith(expect.objectContaining({ policy: 'scanner_only' })));
  });

  it('shows the database’s refusal (a private address) and a bad distance', async () => {
    api.loadClockInSettings.mockResolvedValue({ policy: 'office', networks: ['41.90.12.7'], radiusM: 300 });
    api.saveClockInSettings.mockRejectedValue(new Error('192.168.1.0/24 is a private address: list the office\'s public address (the one its scanners call from)'));
    render(<ClockInPolicy />);
    fireEvent.change(await screen.findByLabelText(/within \(metres\)/), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/25 to 5000 metres/);
    fireEvent.change(screen.getByLabelText(/within \(metres\)/), { target: { value: '300' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/private address/);
  });

  it('sets a branch’s location from the phone and saves it', async () => {
    api.loadClockInSettings.mockResolvedValue({ policy: 'office', networks: [], radiusM: 300 });
    api.currentLocation.mockResolvedValue({ latitude: -1.2864, longitude: 36.8172, accuracy: 10 });
    render(<ClockInPolicy />);
    fireEvent.click(await screen.findByRole('button', { name: 'Use my location for Nairobi' }));
    await waitFor(() => expect((screen.getByLabelText('Latitude') as HTMLInputElement).value).toBe('-1.286400'));
    fireEvent.click(screen.getByRole('button', { name: 'Save Nairobi location' }));
    await waitFor(() => expect(api.saveBranchLocation).toHaveBeenCalledWith('b1', -1.2864, 36.8172));
  });
});
