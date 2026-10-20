import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SendEmail from './SendEmail';

const state = vi.hoisted(() => ({ perms: ['email-portal'] as string[] }));
const api = vi.hoisted(() => ({ getEmailSender: vi.fn(), queueBulkEmail: vi.fn(), sendEmailViaServer: vi.fn() }));
vi.mock('../../lib/emailApi', () => api);
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() } }));
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ loading: false, hasAnyPermission: (ps: string[]) => ps.some((p) => state.perms.includes(p)) }),
}));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../UI/EmployeePicker', () => ({ default: () => null }));
vi.mock('../../lib/fetchAll', () => ({
  fetchAllResult: async () => ({
    data: [
      { 'Employee Number': 'E1', 'First Name': 'Amina', 'Work Email': 'amina@client.co.ke', Branch: 'Nairobi', 'Employee Type': 'Ops' },
      { 'Employee Number': 'E2', 'First Name': 'Otieno', 'Work Email': 'otieno@client.co.ke', Branch: 'Nairobi', 'Employee Type': 'Ops' },
    ],
    error: null,
  }),
}));

beforeEach(() => {
  state.perms = ['email-portal'];
  api.getEmailSender.mockReset().mockResolvedValue({ own_server: false, from_address: null, from_name: '' });
  api.queueBulkEmail.mockReset().mockResolvedValue({ id: 'b1', queued: 2, skipped: 0 });
  api.sendEmailViaServer.mockReset().mockResolvedValue({ message: 'ok' });
});
afterEach(cleanup);

const show = () => render(<MemoryRouter><SendEmail /></MemoryRouter>);
const compose = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Bulk / Groups' }));
  fireEvent.change(screen.getByPlaceholderText('Enter email subject...'), { target: { value: 'Hello' } });
  fireEvent.change(screen.getByPlaceholderText(/Type your message here/), { target: { value: '<p>Hi</p>' } });
  fireEvent.click(screen.getByRole('button', { name: /Send Email/ }));
};

describe('Compose Email: who it comes from', () => {
  it('has no provider choice or mailbox box any more, and says Figbloom HR mail is used', async () => {
    show();
    expect(await screen.findByText('Sending via Figbloom HR mail')).toBeTruthy();
    expect(screen.queryByText('Resend API')).toBeNull();
    expect(screen.queryByText('cPanel (SMTP)')).toBeNull();
    expect(screen.queryByPlaceholderText('Username/Email')).toBeNull();
    // only people who can change Settings get the link
    expect(screen.queryByRole('link')).toBeNull();
  });

  it("names the company's own address when it has its own mail server, linking to its settings", async () => {
    state.perms = ['email-portal', 'settings'];
    api.getEmailSender.mockResolvedValue({ own_server: true, from_address: 'hr@client.co.ke', from_name: 'Client HR' });
    show();
    expect(await screen.findByText('hr@client.co.ke')).toBeTruthy();
    expect(screen.getByText(/\(your mail server\)/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Mail server settings' }).getAttribute('href')).toBe('/settings/company#own-mail-server');
  });

  it('queues a group email through Figbloom HR mail', async () => {
    show();
    await screen.findByText('Sending via Figbloom HR mail');
    compose();
    await waitFor(() => expect(api.queueBulkEmail).toHaveBeenCalled());
    expect(api.sendEmailViaServer).not.toHaveBeenCalled();
  });

  it("sends a group email one by one through the company's own server (the queue only uses Figbloom HR mail)", async () => {
    api.getEmailSender.mockResolvedValue({ own_server: true, from_address: 'hr@client.co.ke', from_name: '' });
    show();
    await screen.findByText('hr@client.co.ke');
    compose();
    await waitFor(() => expect(api.sendEmailViaServer).toHaveBeenCalledTimes(2));
    expect(api.queueBulkEmail).not.toHaveBeenCalled();
    expect(api.sendEmailViaServer.mock.calls[0][0]).not.toHaveProperty('provider');
  });
});
