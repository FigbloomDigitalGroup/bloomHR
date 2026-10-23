import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MyMailbox from './MyMailbox';
import EmailPortal from '../EmailPortal';

const api = vi.hoisted(() => ({
  getMailbox: vi.fn(),
  testMailbox: vi.fn(),
  connectMailbox: vi.fn(),
  disconnectMailbox: vi.fn(),
  listFolders: vi.fn(),
  listMessages: vi.fn(),
  getMessage: vi.fn(),
  downloadAttachment: vi.fn(),
}));
const perms = vi.hoisted(() => ({ list: ['mailbox'] as string[] }));
const confirm = vi.hoisted(() => ({ answer: true }));
vi.mock('../../../lib/mailboxApi', () => api);
vi.mock('../../../lib/confirmDialog', () => ({ confirmDialog: async () => confirm.answer }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ loading: false, hasAnyPermission: (ps: string[]) => ps.some((p) => perms.list.includes(p)) }),
}));
vi.mock('../../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../SendEmail', () => ({ default: () => <div>compose screen</div> }));
vi.mock('../EmailDashboard', () => ({ default: () => <div>logs screen</div> }));

const DEFAULTS = { email: 'mary@client.co.ke', imap_host: 'mail.client.co.ke', imap_port: 993, smtp_host: 'mail.client.co.ke', smtp_port: 465, from_company_server: true };
const ACCOUNT = {
  email: 'mary@client.co.ke',
  imap_host: 'mail.client.co.ke',
  imap_port: 993,
  secure: true,
  username: 'mary@client.co.ke',
  smtp_host: 'mail.client.co.ke',
  smtp_port: 465,
  connected_at: null,
  last_ok_at: null,
  last_error: null,
  password_set: true,
};
const FOLDERS = [
  { path: 'INBOX', name: 'Inbox', special: 'inbox', unread: 1, total: 2, delimiter: '/' },
  { path: 'Sent', name: 'Sent', special: 'sent', unread: 0, total: 4, delimiter: '/' },
];
const ITEMS = [
  { uid: 12, from: { name: 'Payroll', address: 'payroll@client.co.ke' }, to: [], subject: 'October payslip', date: '2026-10-20T08:00:00Z', seen: false, flagged: false, answered: false, has_attachments: true, size: 1000 },
  { uid: 11, from: { name: '', address: 'joe@client.co.ke' }, to: [], subject: 'Lunch', date: '2026-10-19T08:00:00Z', seen: true, flagged: false, answered: false, has_attachments: false, size: 500 },
];
const MESSAGE = {
  uid: 12,
  folder: 'INBOX',
  subject: 'October payslip',
  from: [{ name: 'Payroll', address: 'payroll@client.co.ke' }],
  to: [{ name: 'Mary', address: 'mary@client.co.ke' }],
  cc: [{ name: '', address: 'boss@client.co.ke' }],
  reply_to: [],
  date: '2026-10-20T08:00:00Z',
  message_id: '<1@x>',
  seen: true,
  flagged: false,
  html: '<p>Hello Mary</p><img src="https://tracker.example/open.gif">',
  text: 'Hello Mary',
  attachments: [{ part: '2', filename: 'payslip.pdf', size: 30720, contentType: 'application/pdf' }],
};

beforeEach(() => {
  perms.list = ['mailbox'];
  confirm.answer = true;
  Object.values(api).forEach((f) => f.mockReset());
  api.getMailbox.mockResolvedValue({ account: null, defaults: DEFAULTS });
  api.listFolders.mockResolvedValue({ folders: FOLDERS });
  api.listMessages.mockResolvedValue({ folder: 'INBOX', page: 1, page_size: 50, total: 2, has_more: false, messages: ITEMS });
  api.getMessage.mockResolvedValue({ message: MESSAGE });
  api.downloadAttachment.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('connecting', () => {
  it('shows the suggested server, and Test logs in without saving', async () => {
    api.testMailbox.mockResolvedValue({ ok: false, message: 'Wrong email or password.' });
    render(<MyMailbox />);
    expect(await screen.findByText('Connect your mailbox')).toBeTruthy();
    expect((screen.getByLabelText('Email address') as HTMLInputElement).value).toBe('mary@client.co.ke');
    expect(screen.getByText('mail.client.co.ke')).toBeTruthy();
    expect(screen.getByText(/from your company’s mail settings/)).toBeTruthy();
    const test = screen.getByRole('button', { name: 'Test connection' }) as HTMLButtonElement;
    expect(test.disabled).toBe(true); // no password yet
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } });
    fireEvent.click(test);
    expect(await screen.findByText('Wrong email or password.')).toBeTruthy();
    expect(api.testMailbox).toHaveBeenCalledWith({
      email: 'mary@client.co.ke',
      password: 'hunter2',
      imap_host: 'mail.client.co.ke',
      imap_port: 993,
      username: 'mary@client.co.ke',
      smtp_host: 'mail.client.co.ke',
      smtp_port: 465,
    });
    expect(api.connectMailbox).not.toHaveBeenCalled();
  });

  it('without a company server, the server follows the email domain; port 143 can be chosen', async () => {
    api.getMailbox.mockResolvedValue({ account: null, defaults: { ...DEFAULTS, email: '', imap_host: '', smtp_host: '', from_company_server: false } });
    api.connectMailbox.mockResolvedValue({ account: ACCOUNT });
    render(<MyMailbox />);
    fireEvent.change(await screen.findByLabelText('Email address'), { target: { value: 'joe@acme.co.ke' } });
    expect(screen.getByText('mail.acme.co.ke')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Change server settings' }));
    fireEvent.change(screen.getByLabelText('Incoming port'), { target: { value: '143' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(api.connectMailbox).toHaveBeenCalled());
    expect(api.connectMailbox.mock.calls[0][0]).toMatchObject({ email: 'joe@acme.co.ke', imap_host: 'mail.acme.co.ke', imap_port: 143, username: 'joe@acme.co.ke' });
    // connected: the mailbox opens
    expect(await screen.findByText('October payslip')).toBeTruthy();
  });
});

describe('reading', () => {
  beforeEach(() => {
    api.getMailbox.mockResolvedValue({ account: ACCOUNT, defaults: DEFAULTS });
  });

  it('lists folders with unread counts and messages with unread in bold and an attachment icon', async () => {
    render(<MyMailbox />);
    const folders = await screen.findByRole('navigation', { name: 'Folders' });
    await waitFor(() => expect(within(folders).getByText('Inbox')).toBeTruthy());
    expect(within(folders).getByText('1')).toBeTruthy();
    const unread = await screen.findByText('October payslip');
    expect(unread.className).toContain('font-bold');
    expect(screen.getByText('Lunch').className).not.toContain('font-bold');
    expect(screen.getAllByLabelText('Has attachments')).toHaveLength(1);
    expect(screen.getByText('joe@client.co.ke')).toBeTruthy();
    fireEvent.click(within(folders).getByText('Sent'));
    await waitFor(() => expect(api.listMessages).toHaveBeenLastCalledWith('Sent', 1));
  });

  it('opens an email: headers, attachments to download, the body in a sandboxed frame, and marks it read in the list', async () => {
    render(<MyMailbox />);
    fireEvent.click(await screen.findByText('October payslip'));
    const pane = await screen.findByRole('region', { name: 'Email' });
    await waitFor(() => expect(within(pane).getByRole('heading', { name: 'October payslip' })).toBeTruthy());
    expect(within(pane).getByText('Payroll <payroll@client.co.ke>')).toBeTruthy();
    expect(within(pane).getByText('Mary <mary@client.co.ke>')).toBeTruthy();
    expect(within(pane).getByText('boss@client.co.ke')).toBeTruthy();
    expect(api.getMessage).toHaveBeenCalledWith('INBOX', 12);

    const frame = within(pane).getByTitle('Email content') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('allow-popups allow-popups-to-escape-sandbox');
    expect(frame.getAttribute('srcdoc')).toContain('Hello Mary');

    fireEvent.click(within(pane).getByTitle('Download payslip.pdf'));
    await waitFor(() => expect(api.downloadAttachment).toHaveBeenCalledWith('INBOX', 12, MESSAGE.attachments[0]));
    expect(within(pane).getByText('30 KB')).toBeTruthy();

    // read now: no longer bold, and the folder's count went down
    const list = screen.getByRole('region', { name: 'Inbox messages' });
    expect(within(list).getByText('October payslip').className).not.toContain('font-bold');
    expect(within(screen.getByRole('navigation', { name: 'Folders' })).queryByText('1')).toBeNull();
  });

  it('blocks images from the internet until "Show images", which widens the policy to https', async () => {
    render(<MyMailbox />);
    fireEvent.click(await screen.findByText('October payslip'));
    const frame = (await screen.findByTitle('Email content')) as HTMLIFrameElement;
    const csp = () => /Content-Security-Policy" content="([^"]+)"/.exec(frame.getAttribute('srcdoc') || '')?.[1];
    expect(csp()).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src data: cid:");
    fireEvent.click(screen.getByRole('button', { name: 'Show images' }));
    await waitFor(() => expect(csp()).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src https: data: cid:"));
    expect(screen.queryByRole('button', { name: 'Show images' })).toBeNull();
  });

  it('shows plain-text email as text, with web links that open in a new tab', async () => {
    api.getMessage.mockResolvedValue({ message: { ...MESSAGE, html: null, text: 'Pay here: https://client.co.ke/pay\n<b>not bold</b>' } });
    render(<MyMailbox />);
    fireEvent.click(await screen.findByText('October payslip'));
    const link = (await screen.findByRole('link', { name: 'https://client.co.ke/pay' })) as HTMLAnchorElement;
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    expect(screen.getByText(/<b>not bold<\/b>/)).toBeTruthy();
    expect(screen.queryByTitle('Email content')).toBeNull();
  });

  it('on a phone, the email replaces the list and Back returns to it', async () => {
    render(<MyMailbox />);
    fireEvent.click(await screen.findByText('October payslip'));
    const back = await screen.findByRole('button', { name: 'Back to messages' });
    const list = screen.getByRole('region', { name: 'Inbox messages' });
    expect(list.className).toContain('hidden md:flex');
    fireEvent.click(back);
    expect(list.className).not.toContain('hidden');
  });

  it('Disconnect asks first, then deletes the saved password and shows the Connect form', async () => {
    api.disconnectMailbox.mockResolvedValue({ ok: true });
    render(<MyMailbox />);
    await screen.findByText('October payslip');
    confirm.answer = false;
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.disconnectMailbox).not.toHaveBeenCalled();
    confirm.answer = true;
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByText('Connect your mailbox')).toBeTruthy();
    expect(api.disconnectMailbox).toHaveBeenCalledTimes(1);
  });
});

describe('Email Portal tabs', () => {
  it('opens My mailbox first for people with the module, with Compose and Logs for those who send', async () => {
    perms.list = ['mailbox', 'email-portal'];
    render(<EmailPortal />);
    expect(await screen.findByText('Connect your mailbox')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'My mailbox' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Compose & Send' }));
    expect(screen.getByText('compose screen')).toBeTruthy();
  });

  it('without the module there is no mailbox tab', async () => {
    perms.list = ['email-portal'];
    render(<EmailPortal />);
    expect(await screen.findByText('compose screen')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'My mailbox' })).toBeNull();
    expect(api.getMailbox).not.toHaveBeenCalled();
  });
});
