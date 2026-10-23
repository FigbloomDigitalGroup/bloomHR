import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import toast from 'react-hot-toast';
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
  sendMail: vi.fn(),
}));
const perms = vi.hoisted(() => ({ list: ['mailbox'] as string[] }));
const confirm = vi.hoisted(() => ({ answer: true }));
vi.mock('../../../lib/mailboxApi', () => ({ ...api, MAX_UPLOAD_BYTES: 3 * 1024 * 1024, MAX_SEND_BYTES: 20 * 1024 * 1024, MAX_RECIPIENTS: 50 }));
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
  api.sendMail.mockResolvedValue({ ok: true, saved_to_sent: true, sent_folder: 'Sent', rejected: [], message: 'Sent.' });
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
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

describe('sending', () => {
  beforeEach(() => {
    api.getMailbox.mockResolvedValue({ account: ACCOUNT, defaults: DEFAULTS });
  });

  const openEmail = async () => {
    render(<MyMailbox />);
    fireEvent.click(await screen.findByText('October payslip'));
    return screen.findByRole('button', { name: 'Reply' });
  };
  const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
  const body = () => screen.getByLabelText('Message') as HTMLTextAreaElement;

  it('New message: recipients (plain or "Name <address>"), subject and text, then Send refreshes the folders', async () => {
    render(<MyMailbox />);
    fireEvent.click(await screen.findByRole('button', { name: 'New message' }));
    const form = screen.getByRole('form', { name: 'New message' });
    expect(within(form).getByText('From mary@client.co.ke')).toBeTruthy();
    fireEvent.change(field('To'), { target: { value: 'joe@client.co.ke; Ann Kariuki <ann@client.co.ke>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cc / Bcc' }));
    fireEvent.change(field('Bcc'), { target: { value: 'boss@client.co.ke' } });
    fireEvent.change(field('Subject'), { target: { value: 'Team lunch' } });
    fireEvent.change(body(), { target: { value: 'Friday at 1?' } });
    api.listFolders.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.sendMail).toHaveBeenCalledTimes(1));
    expect(api.sendMail).toHaveBeenCalledWith({
      to: [
        { name: '', address: 'joe@client.co.ke' },
        { name: 'Ann Kariuki', address: 'ann@client.co.ke' },
      ],
      cc: [],
      bcc: [{ name: '', address: 'boss@client.co.ke' }],
      subject: 'Team lunch',
      text: 'Friday at 1?',
      attachments: [],
    });
    await waitFor(() => expect(screen.queryByRole('form', { name: 'New message' })).toBeNull());
    expect(toast.success).toHaveBeenCalledWith('Sent.');
    expect(api.listFolders).toHaveBeenCalled();
  });

  it('checks the addresses before sending, and shows the server\'s plain error', async () => {
    render(<MyMailbox />);
    fireEvent.click(await screen.findByRole('button', { name: 'New message' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Add at least one recipient.');
    fireEvent.change(field('To'), { target: { value: 'joe@client.co.ke, joe at client' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect((await screen.findByRole('alert')).textContent).toBe('This is not a valid email address: joe at client');
    expect(api.sendMail).not.toHaveBeenCalled();

    api.sendMail.mockRejectedValue(new Error('Your mail server refused your password for sending.'));
    fireEvent.change(field('To'), { target: { value: 'joe@client.co.ke' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Your mail server refused your password for sending.'));
    // still open, nothing lost
    expect(field('To').value).toBe('joe@client.co.ke');
  });

  it('Reply: the sender, "Re:", the original quoted, threaded by the server from the original', async () => {
    fireEvent.click(await openEmail());
    const form = await screen.findByRole('form', { name: 'Reply' });
    expect(field('To').value).toBe('Payroll <payroll@client.co.ke>');
    expect(field('Subject').value).toBe('Re: October payslip');
    expect(body().value).toMatch(/Payroll <payroll@client\.co\.ke> wrote:\n> Hello Mary\n$/);
    expect(within(form).queryByLabelText('Cc')).toBeNull();
    fireEvent.change(body(), { target: { value: `Thanks!${body().value}` } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.sendMail).toHaveBeenCalled());
    const sent = api.sendMail.mock.calls[0][0];
    expect(sent).toMatchObject({ to: [{ name: 'Payroll', address: 'payroll@client.co.ke' }], cc: [], subject: 'Re: October payslip', reply: { folder: 'INBOX', uid: 12 } });
    expect(sent.text).toMatch(/^Thanks!/);
    expect(sent.forward).toBeUndefined();
    // back to the email
    expect(await screen.findByRole('button', { name: 'Reply' })).toBeTruthy();
  });

  it('Reply all: everyone else on the email in Cc, never yourself', async () => {
    api.getMessage.mockResolvedValue({ message: { ...MESSAGE, subject: 'Re: October payslip', to: [{ name: 'Mary', address: 'MARY@client.co.ke' }, { name: 'Joe', address: 'joe@client.co.ke' }] } });
    await openEmail();
    fireEvent.click(screen.getByRole('button', { name: 'Reply all' }));
    await screen.findByRole('form', { name: 'Reply all' });
    expect(field('To').value).toBe('Payroll <payroll@client.co.ke>');
    expect(field('Cc').value).toBe('Joe <joe@client.co.ke>, boss@client.co.ke');
    // already "Re:": not twice
    expect(field('Subject').value).toBe('Re: October payslip');
  });

  it('Forward: "Fwd:", the original headers, and its attachments, which can be removed; the server adds them', async () => {
    api.getMessage.mockResolvedValue({
      message: { ...MESSAGE, attachments: [...MESSAGE.attachments, { part: '3', filename: 'p9.pdf', size: 2048, contentType: 'application/pdf' }] },
    });
    await openEmail();
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    const form = await screen.findByRole('form', { name: 'Forward' });
    expect(field('To').value).toBe('');
    expect(field('Subject').value).toBe('Fwd: October payslip');
    expect(body().value).toContain('---------- Forwarded message ---------\nFrom: Payroll <payroll@client.co.ke>');
    expect(body().value).toContain('Subject: October payslip\nTo: Mary <mary@client.co.ke>\nCc: boss@client.co.ke');
    expect(body().value).toContain('Hello Mary');
    const files = within(form).getByRole('list', { name: 'Attachments' });
    expect(within(files).getByText('payslip.pdf')).toBeTruthy();
    expect(within(form).getByText(/forwarded: 32 KB/)).toBeTruthy();
    fireEvent.click(within(files).getByRole('button', { name: 'Remove p9.pdf' }));
    expect(within(files).queryByText('p9.pdf')).toBeNull();
    fireEvent.change(field('To'), { target: { value: 'hr@client.co.ke' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.sendMail).toHaveBeenCalled());
    expect(api.sendMail.mock.calls[0][0]).toMatchObject({ forward: { folder: 'INBOX', uid: 12, parts: ['2'] }, attachments: [] });
    expect(api.sendMail.mock.calls[0][0].reply).toBeUndefined();
  });

  it('adds files with a size meter, refuses more than 3 MB, and sends them as base64', async () => {
    render(<MyMailbox />);
    fireEvent.click(await screen.findByRole('button', { name: 'New message' }));
    const input = screen.getByLabelText('Attach files') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['hello'], 'notes.txt', { type: 'text/plain' })] } });
    expect(await screen.findByText('notes.txt')).toBeTruthy();
    expect(screen.getByText(/^Files added: 5 B of 3\.0 MB/)).toBeTruthy();
    const big = new File([new Uint8Array(3 * 1024 * 1024)], 'video.mp4', { type: 'video/mp4' });
    fireEvent.change(input, { target: { files: [big] } });
    expect(toast.error).toHaveBeenCalledWith('video.mp4 is too large: files added here can be up to 3.0 MB in all.');
    expect(screen.queryByText('video.mp4')).toBeNull();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
    fireEvent.change(field('To'), { target: { value: 'joe@client.co.ke' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.sendMail).toHaveBeenCalled());
    expect(api.sendMail.mock.calls[0][0].attachments).toEqual([{ filename: 'notes.txt', content_type: 'text/plain', data: btoa('hello') }]);
  });

  it('sent but not saved to Sent: says so; viewing Sent refreshes it', async () => {
    api.sendMail.mockResolvedValue({ ok: true, saved_to_sent: false, sent_folder: null, rejected: [], message: "Sent, but couldn't save a copy to Sent." });
    render(<MyMailbox />);
    fireEvent.click(await screen.findByRole('button', { name: 'New message' }));
    fireEvent.change(field('To'), { target: { value: 'joe@client.co.ke' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Sent, but couldn't save a copy to Sent."));

    api.sendMail.mockResolvedValue({ ok: true, saved_to_sent: true, sent_folder: 'Sent', rejected: [], message: 'Sent.' });
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Folders' })).getByText('Sent'));
    await waitFor(() => expect(api.listMessages).toHaveBeenLastCalledWith('Sent', 1));
    api.listMessages.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'New message' }));
    fireEvent.change(field('To'), { target: { value: 'joe@client.co.ke' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.listMessages).toHaveBeenCalledWith('Sent', 1));
  });

  it('Discard asks first when something was written', async () => {
    render(<MyMailbox />);
    fireEvent.click(await screen.findByRole('button', { name: 'New message' }));
    fireEvent.change(field('To'), { target: { value: 'joe@client.co.ke' } });
    confirm.answer = false;
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByRole('form', { name: 'New message' })).toBeTruthy();
    confirm.answer = true;
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByRole('form', { name: 'New message' })).toBeNull());
    expect(api.sendMail).not.toHaveBeenCalled();
  });

  it('Settings: the outgoing server can be changed, keeping the saved password; a failing send check is reported', async () => {
    api.connectMailbox.mockResolvedValue({ account: { ...ACCOUNT, smtp_port: 587 }, smtp: { ok: false, message: 'Your mail server refused your password for sending.' } });
    render(<MyMailbox />);
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    expect(await screen.findByText('Mailbox settings')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Outgoing port'), { target: { value: '587' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.connectMailbox).toHaveBeenCalled());
    const input = api.connectMailbox.mock.calls[0][0];
    expect(input).toMatchObject({ email: 'mary@client.co.ke', imap_host: 'mail.client.co.ke', smtp_host: 'mail.client.co.ke', smtp_port: 587 });
    expect('password' in input).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("Your mailbox is connected, but sending doesn't work yet: Your mail server refused your password for sending.");
    expect(await screen.findByRole('button', { name: 'New message' })).toBeTruthy();
  });
});
