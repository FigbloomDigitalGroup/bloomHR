import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const db = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/payslipEmails', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/payslipEmails')>()),
  loadPayslipEmailSettings: db.load,
  savePayslipEmailSettings: db.save,
}));

import PayslipEmailSetting from './PayslipEmailSetting';

beforeEach(() => {
  db.load.mockReset().mockResolvedValue({ auto: false, password: true, keepDays: 0 });
  db.save.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

const auto = () => screen.getByRole('checkbox', { name: /automatically/ }) as HTMLInputElement;
const password = () => screen.getByRole('checkbox', { name: /ID number/ }) as HTMLInputElement;

describe('Payslip email settings', () => {
  it('password protection is on, and emailing by hand, unless chosen otherwise', async () => {
    render(<PayslipEmailSetting canEdit />);
    await waitFor(() => expect(password().disabled).toBe(false));
    expect(password().checked).toBe(true);
    expect(auto().checked).toBe(false);
    expect((screen.getByLabelText('Keep the emailed PDF') as HTMLSelectElement).value).toBe('0');
  });

  it('saves each change', async () => {
    render(<PayslipEmailSetting canEdit />);
    await waitFor(() => expect(auto().disabled).toBe(false));
    fireEvent.click(auto());
    await waitFor(() => expect(db.save).toHaveBeenCalledWith({ auto: true, password: true, keepDays: 0 }));
    await waitFor(() => expect(password().disabled).toBe(false));
    fireEvent.click(password());
    await waitFor(() => expect(db.save).toHaveBeenLastCalledWith({ auto: true, password: false, keepDays: 0 }));
    await waitFor(() => expect(password().disabled).toBe(false));
    fireEvent.change(screen.getByLabelText('Keep the emailed PDF'), { target: { value: '30' } });
    await waitFor(() => expect(db.save).toHaveBeenLastCalledWith({ auto: true, password: false, keepDays: 30 }));
  });

  it('goes back when saving fails', async () => {
    db.save.mockRejectedValue(new Error('no'));
    render(<PayslipEmailSetting canEdit />);
    await waitFor(() => expect(password().disabled).toBe(false));
    fireEvent.click(password());
    await waitFor(() => expect(password().checked).toBe(true));
  });

  it('is read-only without payroll access', async () => {
    render(<PayslipEmailSetting canEdit={false} />);
    await waitFor(() => expect(db.load).toHaveBeenCalled());
    expect(password().disabled).toBe(true);
    expect(auto().disabled).toBe(true);
  });
});
