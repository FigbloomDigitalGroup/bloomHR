import { useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle2, Mail, XCircle } from 'lucide-react';
import { Button, Card } from '../../UI';
import ShowPasswordButton from '../../UI/ShowPasswordButton';
import { connectMailbox, testMailbox, type MailboxAccount, type MailboxDefaults, type MailboxInput } from '../../../lib/mailboxApi';

const inputClass =
  'w-full rounded-tile border border-border bg-white px-3 py-2 text-[12.5px] text-ink outline-none focus:border-brand disabled:bg-secondary disabled:text-muted-foreground';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-semibold text-ink">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

const domainOf = (email: string) => (/^[^\s@]+@([^\s@]+\.[^\s@]+)$/.exec(email.trim())?.[1] || '').toLowerCase();

/**
 * Connecting your own mailbox: usually just the email address and password, the server being suggested from the
 * company's mail server (or mail.<your domain>). Sending uses the same login on the outgoing server (the same host on
 * cPanel, port 465 SSL/TLS or 587 STARTTLS). Test logs in to both without saving; Connect logs in and saves.
 *
 * With `account`, it changes a connected mailbox's settings: the password can be left empty to keep the saved one.
 */
export default function MailboxConnect({
  defaults,
  account,
  onConnected,
  onCancel,
}: {
  defaults: MailboxDefaults;
  account?: MailboxAccount;
  onConnected: (a: MailboxAccount) => void;
  onCancel?: () => void;
}) {
  const [email, setEmail] = useState(account?.email ?? defaults.email);
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [advanced, setAdvanced] = useState(Boolean(account));
  // the servers follow the email's domain until someone types their own (or the company's server is suggested)
  const [host, setHost] = useState<string | null>(account?.imap_host ?? (defaults.from_company_server ? defaults.imap_host : null));
  const [port, setPort] = useState(account?.imap_port || defaults.imap_port || 993);
  const [username, setUsername] = useState<string | null>(account?.username ?? null);
  const [smtpHost, setSmtpHost] = useState<string | null>(account?.smtp_host ?? (defaults.from_company_server ? defaults.smtp_host : null));
  const [smtpPort, setSmtpPort] = useState(account?.smtp_port || defaults.smtp_port || 465);
  const [busy, setBusy] = useState<'' | 'testing' | 'saving'>('');
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const guessed = domainOf(email) ? `mail.${domainOf(email)}` : defaults.imap_host;
  const input: MailboxInput = {
    email: email.trim(),
    password,
    imap_host: (host ?? guessed).trim(),
    imap_port: port,
    username: (username ?? email).trim(),
    smtp_host: (smtpHost ?? host ?? guessed).trim(),
    smtp_port: smtpPort,
  };
  // changing settings: an empty password keeps the saved one
  if (account && !password) delete input.password;
  const ready = Boolean(input.email && (password || account) && input.imap_host);

  const test = async () => {
    setBusy('testing');
    setResult(null);
    try {
      setResult(await testMailbox(input));
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message });
    } finally {
      setBusy('');
    }
  };

  const save = async () => {
    setBusy('saving');
    setResult(null);
    try {
      const { account: saved, smtp } = await connectMailbox(input);
      setPassword('');
      if (smtp && !smtp.ok) toast.error(`Your mailbox is connected, but sending doesn't work yet: ${smtp.message}`);
      onConnected(saved);
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message });
    } finally {
      setBusy('');
    }
  };

  return (
    <Card className="max-w-xl">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-brand shrink-0">
          <Mail className="w-5 h-5" aria-hidden />
        </div>
        <div>
          <h2 className="text-[15px] font-bold text-ink">{account ? 'Mailbox settings' : 'Connect your mailbox'}</h2>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {account
              ? 'Change how the app reaches your mailbox. Leave the password empty to keep the saved one.'
              : 'Read and send your work email here. Enter your email address and its password; your password is stored encrypted and only you can use this mailbox.'}
          </p>
        </div>
      </div>

      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !busy) save();
        }}
      >
        <Field label="Email address">
          <input className={inputClass} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" hint={account ? 'Only if it changed.' : 'The password you use for webmail or your mail app.'}>
          <div className="relative">
            <input
              className={`${inputClass} pr-10`}
              type={shown ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-label="Password"
            />
            <ShowPasswordButton shown={shown} onToggle={() => setShown((s) => !s)} />
          </div>
        </Field>

        <p className="text-[11.5px] text-muted-foreground">
          Mail server: <span className="font-semibold text-ink">{input.imap_host || '—'}</span>, port {port}
          {defaults.from_company_server && host === defaults.imap_host ? ' (from your company’s mail settings)' : ''}; sending through{' '}
          {input.smtp_host || '—'}, port {smtpPort}.{' '}
          <button type="button" className="text-brand font-semibold hover:underline" onClick={() => setAdvanced((a) => !a)}>
            {advanced ? 'Hide server settings' : 'Change server settings'}
          </button>
        </p>

        {advanced && (
          <div className="grid gap-3 sm:grid-cols-2 rounded-tile border border-border p-3">
            <Field label="Incoming mail server (IMAP)">
              <input className={inputClass} value={host ?? guessed} onChange={(e) => setHost(e.target.value)} aria-label="Incoming mail server" />
            </Field>
            <Field label="Port">
              <select className={inputClass} value={port} onChange={(e) => setPort(Number(e.target.value))} aria-label="Incoming port">
                <option value={993}>993 (SSL/TLS)</option>
                <option value={143}>143 (STARTTLS)</option>
              </select>
            </Field>
            <Field label="Username" hint="Usually your full email address.">
              <input className={inputClass} value={username ?? email} onChange={(e) => setUsername(e.target.value)} aria-label="Username" />
            </Field>
            <div />
            <Field label="Outgoing mail server (SMTP)" hint="Usually the same as the incoming server. Uses the same username and password.">
              <input
                className={inputClass}
                value={smtpHost ?? host ?? guessed}
                onChange={(e) => setSmtpHost(e.target.value)}
                aria-label="Outgoing mail server"
              />
            </Field>
            <Field label="Outgoing port">
              <select className={inputClass} value={smtpPort} onChange={(e) => setSmtpPort(Number(e.target.value))} aria-label="Outgoing port">
                <option value={465}>465 (SSL/TLS)</option>
                <option value={587}>587 (STARTTLS)</option>
                <option value={25}>25</option>
                <option value={2525}>2525</option>
              </select>
            </Field>
          </div>
        )}

        {result && (
          <p
            role="status"
            className={`flex items-start gap-1.5 text-[12px] ${result.ok ? 'text-status-success' : 'text-status-danger'}`}
          >
            {result.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden /> : <XCircle className="w-4 h-4 shrink-0" aria-hidden />}
            {result.message}
          </p>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="secondary" onClick={test} disabled={!ready || Boolean(busy)}>
            {busy === 'testing' ? 'Testing…' : 'Test connection'}
          </Button>
          <Button type="submit" disabled={!ready || Boolean(busy)}>
            {busy === 'saving' ? (account ? 'Saving…' : 'Connecting…') : account ? 'Save' : 'Connect'}
          </Button>
          {onCancel && (
            <Button variant="ghost" onClick={onCancel} disabled={Boolean(busy)}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}
