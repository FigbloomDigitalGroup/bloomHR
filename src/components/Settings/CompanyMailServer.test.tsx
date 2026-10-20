import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import CompanyMailServerCard from './CompanyMailServer';
import type { MailServerSettings } from '../../lib/emailApi';

const state = vi.hoisted(() => ({ perms: ['settings'] as string[], settings: null as MailServerSettings | null }));
const api = vi.hoisted(() => ({ getMailServer: vi.fn(), saveMailServer: vi.fn(), testMailServer: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: toast }));
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ loading: false, hasAnyPermission: (ps: string[]) => ps.some((p) => state.perms.includes(p)) }),
}));
vi.mock('../../lib/emailApi', () => api);

const saved: MailServerSettings = {
  host: 'mail.client.co.ke',
  port: 465,
  secure: true,
  username: 'hr@client.co.ke',
  from_name: 'Client HR',
  from_address: 'hr@client.co.ke',
  enabled: true,
  password_set: true,
  last_test_ok: null,
  last_test_at: null,
  last_test_message: null,
  updated_at: null,
};

beforeEach(() => {
  state.perms = ['settings'];
  state.settings = null;
  api.getMailServer.mockReset().mockImplementation(async () => ({ settings: state.settings }));
  api.saveMailServer.mockReset().mockImplementation(async (s) => ({ settings: { ...saved, ...s, password_set: true } }));
  api.testMailServer.mockReset().mockResolvedValue({ ok: true, message: 'Test email sent to me@client.co.ke.', tested_at: '2026-10-20T08:00:00Z' });
  toast.success.mockReset();
  toast.error.mockReset();
});
afterEach(cleanup);

const input = (label: string) => screen.getByLabelText(label, { exact: false }) as HTMLInputElement;

describe('Send from your own mail server', () => {
  it('sets up a cPanel mailbox: port 465 with SSL/TLS by default, and saves the password once', async () => {
    render(<CompanyMailServerCard />);
    expect(await screen.findByText('Send from your own mail server')).toBeTruthy();
    expect(screen.getByText(/mail.yourdomain.com/)).toBeTruthy();
    expect(screen.getByText('Not in use: email is sent via Figbloom HR mail')).toBeTruthy();
    // nothing saved yet, so nothing to test
    expect((screen.getByRole('button', { name: 'Send test email' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(input('Mail server'), { target: { value: 'mail.client.co.ke' } });
    fireEvent.change(input('Username'), { target: { value: 'hr@client.co.ke' } });
    fireEvent.change(input('Password'), { target: { value: 'hunter2' } });
    fireEvent.change(input('From name'), { target: { value: 'Client HR' } });
    fireEvent.change(input('From address'), { target: { value: 'hr@client.co.ke' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Send our company/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(api.saveMailServer).toHaveBeenCalledWith({
        host: 'mail.client.co.ke', port: 465, secure: true, username: 'hr@client.co.ke', password: 'hunter2',
        from_name: 'Client HR', from_address: 'hr@client.co.ke', enabled: true,
      }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Email will now be sent from hr@client.co.ke'));
    expect(input('Password').value).toBe(''); // never kept in the page after saving
  });

  it('keeps the saved password when it is left empty, and switching to 587 picks STARTTLS', async () => {
    state.settings = saved;
    render(<CompanyMailServerCard />);
    await screen.findByText('Sending from hr@client.co.ke');
    expect(screen.getByText('Saved. Leave empty to keep it.')).toBeTruthy();
    fireEvent.change(input('Port'), { target: { value: '587' } });
    expect((input('Security') as unknown as HTMLSelectElement).value).toBe('starttls');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveMailServer).toHaveBeenCalled());
    expect(api.saveMailServer.mock.calls[0][0]).toMatchObject({ port: 587, secure: false, password: undefined });
  });

  it('sends a test email and shows how it went', async () => {
    state.settings = saved;
    render(<CompanyMailServerCard />);
    await screen.findByText('Sending from hr@client.co.ke');
    fireEvent.click(screen.getByRole('button', { name: 'Send test email' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Test email sent to me@client.co.ke.'));
    expect(await screen.findByText(/worked\. Test email sent/)).toBeTruthy();

    api.testMailServer.mockResolvedValueOnce({ ok: false, message: 'The mail server refused the username or password.', tested_at: '2026-10-20T08:05:00Z' });
    fireEvent.click(screen.getByRole('button', { name: 'Send test email' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('The mail server refused the username or password.'));
  });

  it('asks to save changes before testing them', async () => {
    state.settings = saved;
    render(<CompanyMailServerCard />);
    await screen.findByText('Sending from hr@client.co.ke');
    fireEvent.change(input('Mail server'), { target: { value: 'smtp.other.co.ke' } });
    expect((screen.getByRole('button', { name: 'Send test email' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('is not shown, or loaded, without the Settings permission', async () => {
    state.perms = ['employees', 'email-portal'];
    const { container } = render(<CompanyMailServerCard />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.innerHTML).toBe('');
    expect(api.getMailServer).not.toHaveBeenCalled();
  });
});
