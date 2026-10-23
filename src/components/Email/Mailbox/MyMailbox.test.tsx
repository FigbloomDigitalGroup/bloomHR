import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import toast from 'react-hot-toast';
import MyMailbox from './MyMailbox';
import EmailPortal from '../EmailPortal';

const api = vi.hoisted(() => ({
  getMailbox: vi.fn(),
  findMailServers: vi.fn(),
  testMailbox: vi.fn(),
  connectMailbox: vi.fn(),
  disconnectMailbox: vi.fn(),
  listFolders: vi.fn(),
  listMessages: vi.fn(),
  getMessage: vi.fn(),
  downloadAttachment: vi.fn(),
  sendMail: vi.fn(),
  setFlags: vi.fn(),
  moveMessages: vi.fn(),
  deleteMessages: vi.fn(),
  searchMessages: vi.fn(),
}));
const perms = vi.hoisted(() => ({ list: ['mailbox'] as string[] }));
const confirm = vi.hoisted(() => ({ answer: true }));
// the real folder helpers (findTrash, findArchive), the calls to the server mocked
vi.mock('../../../lib/mailboxApi', async (actual) => ({ ...(await actual<Record<string, unknown>>()), ...api }));
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
  // the server's answer for an address: mail.<domain> unless a test says otherwise
  api.findMailServers.mockImplementation(async (email: string) => {
    const domain = email.split('@')[1];
    return { email, imap_host: `mail.${domain}`, imap_port: 993, smtp_host: `mail.${domain}`, smtp_port: 465, provider: null, supported: true, note: null, found: 'name' };
  });
  api.listFolders.mockResolvedValue({ folders: FOLDERS });
  api.listMessages.mockResolvedValue({ folder: 'INBOX', page: 1, page_size: 50, total: 2, has_more: false, messages: ITEMS });
  api.getMessage.mockResolvedValue({ message: MESSAGE });
  api.downloadAttachment.mockResolvedValue(undefined);
  api.sendMail.mockResolvedValue({ ok: true, saved_to_sent: true, sent_folder: 'Sent', rejected: [], message: 'Sent.' });
  api.setFlags.mockResolvedValue({ ok: true });
  api.moveMessages.mockResolvedValue({ ok: true });
  api.deleteMessages.mockResolvedValue({ ok: true, permanent: false, trash: 'Trash' });
  api.searchMessages.mockResolvedValue({ folder: 'INBOX', q: 'pay', page: 1, page_size: 50, total: 1, capped: false, has_more: false, messages: [ITEMS[0]] });
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

describe('finding the mail server', () => {
  const NO_COMPANY = { ...DEFAULTS, email: '', imap_host: '', smtp_host: '', from_company_server: false };
  const answer = (over: Record<string, unknown>) =>
    api.findMailServers.mockImplementation(async (email: string) => ({
      email, imap_port: 993, smtp_port: 465, provider: null, supported: true, note: null, found: 'name', ...over,
    }));

  it("uses the server found from the domain's mail records, for reading and sending", async () => {
    api.getMailbox.mockResolvedValue({ account: null, defaults: NO_COMPANY });
    answer({ imap_host: 'lon105.truehost.cloud', smtp_host: 'lon105.truehost.cloud', found: 'mx' });
    api.testMailbox.mockResolvedValue({ ok: true, message: 'Connected.' });
    render(<MyMailbox />);
    fireEvent.change(await screen.findByLabelText('Email address'), { target: { value: 'michael@figbloom.org' } });
    // the guess first, then the server's answer once typing stops
    expect(screen.getByText('mail.figbloom.org')).toBeTruthy();
    expect(await screen.findByText('lon105.truehost.cloud', {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.getByText(/found from your domain’s mail records/)).toBeTruthy();
    expect(api.findMailServers).toHaveBeenLastCalledWith('michael@figbloom.org');
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    await waitFor(() => expect(api.testMailbox).toHaveBeenCalled());
    expect(api.testMailbox.mock.calls[0][0]).toMatchObject({ imap_host: 'lon105.truehost.cloud', smtp_host: 'lon105.truehost.cloud' });
  });

  it('Google: its own servers and the app password note', async () => {
    api.getMailbox.mockResolvedValue({ account: null, defaults: NO_COMPANY });
    answer({ imap_host: 'imap.gmail.com', smtp_host: 'smtp.gmail.com', provider: 'google', found: 'provider', note: 'Google mail needs an app password.' });
    render(<MyMailbox />);
    fireEvent.change(await screen.findByLabelText('Email address'), { target: { value: 'joe@gmail.com' } });
    expect(await screen.findByText('Google mail needs an app password.', {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.getByText('imap.gmail.com')).toBeTruthy();
    expect(screen.getByText(/sending through/).textContent).toContain('smtp.gmail.com');
  });

  it("Microsoft: says it can't be connected and doesn't let anyone try", async () => {
    api.getMailbox.mockResolvedValue({ account: null, defaults: NO_COMPANY });
    answer({ imap_host: 'outlook.office365.com', smtp_host: 'smtp.office365.com', provider: 'microsoft', supported: false, found: 'provider', note: "Microsoft can't be connected here yet." });
    render(<MyMailbox />);
    fireEvent.change(await screen.findByLabelText('Email address'), { target: { value: 'joe@hotmail.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    expect(await screen.findByText("Microsoft can't be connected here yet.", {}, { timeout: 2000 })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Test connection' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps the company's mail server when it has one", async () => {
    answer({ imap_host: 'somewhere.else', smtp_host: 'somewhere.else', found: 'mx' });
    render(<MyMailbox />);
    await screen.findByText('Connect your mailbox');
    await waitFor(() => expect(api.findMailServers).toHaveBeenCalled(), { timeout: 2000 });
    expect(screen.getByText('mail.client.co.ke')).toBeTruthy();
    expect(screen.queryByText('somewhere.else')).toBeNull();
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

describe('managing mail', () => {
  const MANY_FOLDERS = [
    ...FOLDERS,
    { path: 'Projects', name: 'Projects', special: null, unread: 0, total: 0, delimiter: '/' },
    { path: 'Trash', name: 'Trash', special: 'trash', unread: 0, total: 3, delimiter: '/' },
  ];
  const ITEMS3 = [...ITEMS, { ...ITEMS[1], uid: 10, subject: 'Old news', seen: true }];

  beforeEach(() => {
    api.getMailbox.mockResolvedValue({ account: ACCOUNT, defaults: DEFAULTS });
    api.listFolders.mockResolvedValue({ folders: MANY_FOLDERS });
    api.listMessages.mockResolvedValue({ folder: 'INBOX', page: 1, page_size: 50, total: 3, has_more: false, messages: ITEMS3 });
  });

  const toolbar = () => screen.getByRole('toolbar', { name: 'Selected emails' });
  const list = () => screen.getByRole('region', { name: /messages$/ });
  const select = (subject: string) => fireEvent.click(screen.getByLabelText(`Select ${subject}`));

  it('multi-select: the toolbar marks read and unread, flags, moves and deletes the chosen emails', async () => {
    render(<MyMailbox />);
    await screen.findByText('October payslip');
    await waitFor(() => expect(within(screen.getByRole('navigation', { name: 'Folders' })).getByText('Projects')).toBeTruthy());
    expect(within(toolbar()).getByText(/Select emails to act on several/)).toBeTruthy();
    select('October payslip');
    select('Lunch');
    expect(within(toolbar()).getByText('2 selected')).toBeTruthy();

    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Mark read' }));
    await waitFor(() => expect(api.setFlags).toHaveBeenCalledWith('INBOX', [12, 11], { seen: true }));
    // read now: not bold, and the Inbox's count went down
    await waitFor(() => expect(within(list()).getByText('October payslip').className).not.toContain('font-bold'));
    expect(within(screen.getByRole('navigation', { name: 'Folders' })).queryByText('1')).toBeNull();

    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Mark unread' }));
    await waitFor(() => expect(api.setFlags).toHaveBeenLastCalledWith('INBOX', [12, 11], { seen: false }));
    await waitFor(() => expect(within(list()).getByText('Lunch').className).toContain('font-bold'));

    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Flag' }));
    await waitFor(() => expect(api.setFlags).toHaveBeenLastCalledWith('INBOX', [12, 11], { flagged: true }));
    // all flagged: the same button unflags
    fireEvent.click(await within(toolbar()).findByRole('button', { name: 'Unflag' }));
    await waitFor(() => expect(api.setFlags).toHaveBeenLastCalledWith('INBOX', [12, 11], { flagged: false }));

    // move: a folder picker of the other folders
    const picker = within(toolbar()).getByLabelText('Move to…') as HTMLSelectElement;
    expect([...picker.options].map((o) => o.value)).toEqual(['', 'Sent', 'Projects', 'Trash']);
    fireEvent.change(picker, { target: { value: 'Projects' } });
    await waitFor(() => expect(api.moveMessages).toHaveBeenCalledWith('INBOX', [12, 11], 'Projects'));
    await waitFor(() => expect(within(list()).queryByText('October payslip')).toBeNull());
    expect(toast.success).toHaveBeenCalledWith('Moved 2 emails to Projects.');
    expect(within(list()).getByText('Old news')).toBeTruthy();

    // delete outside Trash: to Trash, no question asked
    select('Old news');
    confirm.answer = false;
    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.deleteMessages).toHaveBeenCalledWith('INBOX', [10], false));
    expect(toast.success).toHaveBeenCalledWith('Moved 1 email to Trash.');
  });

  it('in Trash, Delete asks "Delete permanently?" first, and only then deletes for good', async () => {
    const dialog = await import('../../../lib/confirmDialog');
    const spy = vi.spyOn(dialog, 'confirmDialog');
    api.deleteMessages.mockResolvedValue({ ok: true, permanent: true, trash: 'Trash' });
    render(<MyMailbox />);
    await waitFor(() => expect(within(screen.getByRole('navigation', { name: 'Folders' })).getByText('Trash')).toBeTruthy());
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Folders' })).getByText('Trash'));
    await waitFor(() => expect(api.listMessages).toHaveBeenLastCalledWith('Trash', 1));
    select(await screen.findByText('Lunch').then(() => 'Lunch'));
    confirm.answer = false;
    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({ title: 'Delete permanently?', tone: 'danger' })));
    await new Promise((r) => setTimeout(r, 0));
    expect(api.deleteMessages).not.toHaveBeenCalled();
    confirm.answer = true;
    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.deleteMessages).toHaveBeenCalledWith('Trash', [11], true));
    expect(toast.success).toHaveBeenCalledWith('Deleted 1 email permanently.');
    spy.mockRestore();
  });

  it('a star per message flags and unflags it', async () => {
    render(<MyMailbox />);
    fireEvent.click(await screen.findByRole('button', { name: 'Flag October payslip' }));
    await waitFor(() => expect(api.setFlags).toHaveBeenCalledWith('INBOX', [12], { flagged: true }));
    const star = await screen.findByRole('button', { name: 'Unflag October payslip' });
    expect(star.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(star);
    await waitFor(() => expect(api.setFlags).toHaveBeenLastCalledWith('INBOX', [12], { flagged: false }));
    expect(api.getMessage).not.toHaveBeenCalled();
  });

  it('the reader: flag, Mark unread (back to the list), and deleting goes on to the next email', async () => {
    render(<MyMailbox />);
    fireEvent.click(await screen.findByText('October payslip'));
    const pane = await screen.findByRole('region', { name: 'Email' });
    fireEvent.click(await within(pane).findByRole('button', { name: 'Flag' }));
    await waitFor(() => expect(api.setFlags).toHaveBeenCalledWith('INBOX', [12], { flagged: true }));
    expect(await within(pane).findByRole('button', { name: 'Unflag' })).toBeTruthy();

    fireEvent.click(within(pane).getByRole('button', { name: 'Mark unread' }));
    await waitFor(() => expect(api.setFlags).toHaveBeenLastCalledWith('INBOX', [12], { seen: false }));
    await waitFor(() => expect(within(pane).queryByRole('button', { name: 'Reply' })).toBeNull());
    expect(within(list()).getByText('October payslip').className).toContain('font-bold');

    // open it again, delete: the next (older) email opens
    api.getMessage.mockImplementation(async (_f: string, uid: number) => ({ message: { ...MESSAGE, uid, subject: uid === 11 ? 'Lunch' : MESSAGE.subject } }));
    fireEvent.click(within(list()).getByText('October payslip'));
    fireEvent.click(await within(pane).findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.deleteMessages).toHaveBeenCalledWith('INBOX', [12], false));
    await waitFor(() => expect(api.getMessage).toHaveBeenLastCalledWith('INBOX', 11));
    expect(await within(pane).findByRole('heading', { name: 'Lunch' })).toBeTruthy();

    // moving from the reader: the same
    fireEvent.change(within(pane).getByLabelText('Move this email to'), { target: { value: 'Projects' } });
    await waitFor(() => expect(api.moveMessages).toHaveBeenCalledWith('INBOX', [11], 'Projects'));
    await waitFor(() => expect(api.getMessage).toHaveBeenLastCalledWith('INBOX', 10));
  });

  it('search: results in the list, with a way back to the folder, and Clear', async () => {
    render(<MyMailbox />);
    await screen.findByText('Lunch');
    fireEvent.change(screen.getByLabelText('Search mail'), { target: { value: '  payslip ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search filters' }));
    fireEvent.click(screen.getByLabelText('Unread only'));
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-10-01' } });
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() => expect(api.searchMessages).toHaveBeenCalledWith('INBOX', { q: 'payslip', unread: true, since: '2026-10-01' }, 1));
    expect(await screen.findByRole('status')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('1 result'));
    expect(within(list()).queryByText('Lunch')).toBeNull();
    expect(within(list()).getByText('October payslip')).toBeTruthy();

    // back to the folder
    api.listMessages.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Inbox' }));
    await waitFor(() => expect(api.listMessages).toHaveBeenCalledWith('INBOX', 1));
    expect(await within(list()).findByText('Lunch')).toBeTruthy();
    expect((screen.getByLabelText('Search mail') as HTMLInputElement).value).toBe('');

    // Clear does the same
    api.searchMessages.mockResolvedValue({ folder: 'INBOX', q: 'x', page: 1, page_size: 50, total: 500, capped: true, has_more: true, messages: [ITEMS[1]] });
    fireEvent.change(screen.getByLabelText('Search mail'), { target: { value: 'x' } });
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('The newest 500 results'));
    expect(screen.getByRole('button', { name: 'More results' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect((screen.getByLabelText('Search mail') as HTMLInputElement).value).toBe('');
  });

  it('keyboard: j / k move through the list, # deletes, not while typing; the shortcuts are explained', async () => {
    render(<MyMailbox />);
    await screen.findByText('Lunch');
    expect(screen.getByLabelText(/^Keyboard shortcuts: j \/ k next \/ previous email/)).toBeTruthy();
    fireEvent.keyDown(window, { key: 'j' });
    await waitFor(() => expect(api.getMessage).toHaveBeenLastCalledWith('INBOX', 12));
    fireEvent.keyDown(window, { key: 'j' });
    await waitFor(() => expect(api.getMessage).toHaveBeenLastCalledWith('INBOX', 11));
    fireEvent.keyDown(window, { key: 'k' });
    await waitFor(() => expect(api.getMessage).toHaveBeenLastCalledWith('INBOX', 12));
    // typing in the search box is not a shortcut
    fireEvent.keyDown(screen.getByLabelText('Search mail'), { key: '#' });
    expect(api.deleteMessages).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: '#' });
    await waitFor(() => expect(api.deleteMessages).toHaveBeenCalledWith('INBOX', [12], false));
  });
});
