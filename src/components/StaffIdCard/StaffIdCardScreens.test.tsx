import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// Where the card shows: the employee's own in the staff portal (My ID card), and anyone's from their profile for the
// staff-id-cards module, which can reissue it (the old QR code stops working).

const api = vi.hoisted(() => ({
  loadMyStaffIdCard: vi.fn(),
  loadStaffIdCards: vi.fn(),
  regenerateStaffIdCard: vi.fn(),
  loadCardSettings: vi.fn(),
  saveCardSettings: vi.fn(),
  setStaffIdCardPhotoFraming: vi.fn(),
}));
vi.mock('../../lib/staffIdCards', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/staffIdCards')>()), ...api }));
vi.mock('../../lib/offers', () => ({ loadBranding: () => Promise.resolve({ name: 'Acme Ltd', primary_color: '#0F766E' }) }));
vi.mock('../../lib/signatures', () => ({ loadMySignature: vi.fn() }));
const confirm = vi.hoisted(() => vi.fn());
vi.mock('../../lib/confirmDialog', () => ({ confirmDialog: confirm }));
vi.mock('../../lib/staffIdCardExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/staffIdCardExport')>()),
  downloadCardPng: vi.fn(), downloadCardPdf: vi.fn(), printCards: vi.fn(),
}));

import MyIdCard from '../staff portal/MyIdCard';
import StaffIdCardDialog from './StaffIdCardDialog';
import { DEFAULT_CARD_SETTINGS } from '../../lib/staffIdCards';

const card = {
  employee_id: 'e1', employee_number: 'E1', first_name: 'Esther', middle_name: null, last_name: 'One', job_title: 'Accountant',
  department: 'Finance', branch: null, work_phone: null, work_email: null, date_of_birth: null, date_joined: '2024-03-01',
  contract_end_date: null, photo_url: null, is_active: true, token: 'a'.repeat(32), issued_at: '2026-10-27T08:00:00Z',
};
// the QR code's dark squares (its first path is the white background)
const qrOf = (container: HTMLElement) => container.querySelectorAll('svg svg path')[1]?.getAttribute('d');

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  confirm.mockReset();
  api.loadCardSettings.mockResolvedValue(DEFAULT_CARD_SETTINGS);
});
afterEach(cleanup);

describe('My ID card (staff portal)', () => {
  it('shows the employee their own card with Download and Print, and nothing to reissue', async () => {
    api.loadMyStaffIdCard.mockResolvedValue(card);
    render(<MyIdCard />);
    expect(await screen.findByRole('img', { name: 'Staff ID card of Esther One, front' })).toBeTruthy();
    for (const name of ['Download PNG', 'Download PDF', 'Print']) expect(screen.getByRole('button', { name })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Reissue/ })).toBeNull();
    expect(api.loadStaffIdCards).not.toHaveBeenCalled();
  });

  it('says so when the login has no employee record', async () => {
    api.loadMyStaffIdCard.mockResolvedValue(null);
    render(<MyIdCard />);
    expect(await screen.findByText('No ID card yet')).toBeTruthy();
  });
});

describe('adjusting the photo', () => {
  const photoX = (container: HTMLElement) => Number(container.querySelector('[data-card-image="photo"]')!.getAttribute('x'));

  it('moves and zooms the photo in its hexagon, shows it on the card as it moves, and saves it', async () => {
    api.loadMyStaffIdCard.mockResolvedValue({ ...card, photo_url: 'https://cdn/e1.png' });
    api.setStaffIdCardPhotoFraming.mockResolvedValue(undefined);
    const { container } = render(<MyIdCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Adjust photo' }));
    const before = photoX(container);

    fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: '2' } });
    fireEvent.keyDown(screen.getByRole('application'), { key: 'ArrowRight' });
    expect(photoX(container)).toBeLessThan(before); // the card shows it moved: more of the right of the photo
    expect(screen.queryByRole('button', { name: 'Download PNG' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.setStaffIdCardPhotoFraming).toHaveBeenCalled());
    const [id, f] = api.setStaffIdCardPhotoFraming.mock.calls[0];
    expect(id).toBe('e1');
    expect(f.zoom).toBe(2);
    expect(f.x).toBeCloseTo(0.52);
    expect(f.y).toBeCloseTo(0.5);
    // back to the buttons, the card keeping the new position
    expect(await screen.findByRole('button', { name: 'Download PNG' })).toBeTruthy();
    expect(photoX(container)).toBeLessThan(before);
  });

  it('Cancel puts the photo back, and a card without a photo has nothing to adjust', async () => {
    api.loadMyStaffIdCard.mockResolvedValue({ ...card, photo_url: 'https://cdn/e1.png' });
    const { container, unmount } = render(<MyIdCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Adjust photo' }));
    const before = photoX(container);
    fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: '3' } });
    expect(photoX(container)).not.toBe(before);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(photoX(container)).toBe(before);
    expect(api.setStaffIdCardPhotoFraming).not.toHaveBeenCalled();
    unmount();

    api.loadMyStaffIdCard.mockResolvedValue(card);
    render(<MyIdCard />);
    await screen.findByRole('button', { name: 'Download PNG' });
    expect(screen.queryByRole('button', { name: 'Adjust photo' })).toBeNull();
  });
});

describe('the ID card from an employee’s profile', () => {
  it('loads that employee’s card, and reissuing gives it a new QR code after a warning', async () => {
    api.loadStaffIdCards.mockResolvedValue([card]);
    api.regenerateStaffIdCard.mockResolvedValue({ token: 'b'.repeat(32), issued_at: '2026-10-28T08:00:00Z' });
    const { baseElement } = render(<StaffIdCardDialog employeeId="e1" open onClose={() => {}} />);
    await screen.findByRole('img', { name: 'Staff ID card of Esther One, back' });
    expect(api.loadStaffIdCards).toHaveBeenCalledWith(['e1']);
    const before = qrOf(baseElement);

    confirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Reissue card' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(api.regenerateStaffIdCard).not.toHaveBeenCalled();

    confirm.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Reissue card' }));
    await waitFor(() => expect(api.regenerateStaffIdCard).toHaveBeenCalledWith('e1'));
    await waitFor(() => expect(qrOf(baseElement)).not.toBe(before));
    // issued again today: two years from now
    expect(baseElement.textContent).toContain('Expiry Date: 28 Oct 2028');
  });

  it('shows the error when the person may not see the card', async () => {
    api.loadStaffIdCards.mockRejectedValue(new Error('Only people with Staff ID cards can see other employees’ cards'));
    render(<StaffIdCardDialog employeeId="e2" open onClose={() => {}} />);
    expect(await screen.findByText(/Only people with Staff ID cards/)).toBeTruthy();
  });
});
