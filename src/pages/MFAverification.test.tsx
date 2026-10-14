import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const navigate = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn(() => Promise.resolve({ error: null })));
const sendMfaCode = vi.hoisted(() => vi.fn());
const verifyMfaCode = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../lib/supabase', () => ({
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 't' } } }), signOut } },
}));
vi.mock('../lib/mfaApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/mfaApi')>()),
  sendMfaCode,
  verifyMfaCode,
}));

import { MfaError } from '../lib/mfaApi';
import MFAVerification from './MFAverification';

const SENT = { sent: true, method: 'email', destination: 'j***@company.com', expiresAt: '2030-01-01T00:00:00Z', resendIn: 30 };
const typeCode = (code: string) => {
  code.split('').forEach((d, i) => fireEvent.change(screen.getByLabelText(`Digit ${i + 1}`), { target: { value: d } }));
};

beforeEach(() => {
  navigate.mockReset();
  signOut.mockClear();
  sendMfaCode.mockReset().mockResolvedValue(SENT);
  verifyMfaCode.mockReset();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('two-step sign-in page', () => {
  it('asks the server for a code and says where it went', async () => {
    render(<MFAVerification />);
    expect(await screen.findByText('j***@company.com')).toBeTruthy();
    expect(screen.getByText(/We emailed a 6-digit code to/)).toBeTruthy();
    expect(sendMfaCode).toHaveBeenCalledWith(false);
    expect(screen.getByRole('button', { name: /Send a new code in 30s/ })).toHaveProperty('disabled', true);
  });

  it('checks the typed code on the server and goes on when it is right', async () => {
    verifyMfaCode.mockResolvedValue({ verified: true });
    sessionStorage.setItem('isMFAProcess', 'true');
    render(<MFAVerification />);
    await screen.findByText('j***@company.com');
    typeCode('123456');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/dashboard', { replace: true }));
    expect(verifyMfaCode).toHaveBeenCalledWith('123456');
    expect(sessionStorage.getItem('isMFAProcess')).toBeNull();
  });

  it('takes a pasted code in the first box', async () => {
    verifyMfaCode.mockResolvedValue({ verified: true });
    render(<MFAVerification />);
    await screen.findByText('j***@company.com');
    fireEvent.change(screen.getByLabelText('Digit 1'), { target: { value: '654321' } });
    await waitFor(() => expect(verifyMfaCode).toHaveBeenCalledWith('654321'));
  });

  it('shows a wrong code with the tries left and lets them try again', async () => {
    verifyMfaCode.mockRejectedValue(new MfaError('That code is not right. 3 tries left.', 400, 'wrong', 3));
    render(<MFAVerification />);
    await screen.findByText('j***@company.com');
    typeCode('111111');
    expect((await screen.findByRole('alert')).textContent).toMatch(/3 tries left/);
    expect(screen.getByLabelText('Digit 1')).toHaveProperty('disabled', false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('after an expired code or too many tries, only a new code helps', async () => {
    verifyMfaCode.mockRejectedValue(new MfaError('This code has expired. Send a new one.', 410, 'expired'));
    render(<MFAVerification />);
    await screen.findByText('j***@company.com');
    typeCode('111111');
    expect((await screen.findByRole('alert')).textContent).toMatch(/expired/);
    expect(screen.getByLabelText('Digit 1')).toHaveProperty('disabled', true);

    verifyMfaCode.mockRejectedValue(new MfaError('Too many wrong tries. Send a new code.', 429, 'too_many'));
    cleanup();
    render(<MFAVerification />);
    await screen.findByText('j***@company.com');
    typeCode('222222');
    expect((await screen.findByRole('alert')).textContent).toMatch(/Too many wrong tries/);
  });

  it('resends once the cooldown is over', async () => {
    sendMfaCode.mockResolvedValueOnce({ ...SENT, resendIn: 1 });
    render(<MFAVerification />);
    await screen.findByText('j***@company.com');
    const resend = await screen.findByRole('button', { name: 'Send a new code' }, { timeout: 3000 });
    sendMfaCode.mockResolvedValueOnce({ ...SENT, destination: 'j***@company.com' });
    await act(async () => {
      fireEvent.click(resend);
    });
    expect(sendMfaCode).toHaveBeenLastCalledWith(true);
    expect(await screen.findByText('A new code is on its way.')).toBeTruthy();
  });

  it('shows a send failure, such as the rate limit', async () => {
    sendMfaCode.mockReset().mockRejectedValue(new MfaError('Too many codes asked for. Wait 15 minutes and try again.', 429, 'rate_limited'));
    render(<MFAVerification />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Too many codes/);
  });

  it('goes straight on when the company does not ask this person for a code', async () => {
    sendMfaCode.mockReset().mockRejectedValue(new MfaError('Two-step sign-in is not on for your account', 409, 'not_required'));
    render(<MFAVerification />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/dashboard', { replace: true }));
  });

  it('back to sign in signs out', async () => {
    render(<MFAVerification />);
    await screen.findByText('j***@company.com');
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login', { replace: true }));
    expect(signOut).toHaveBeenCalled();
  });
});
