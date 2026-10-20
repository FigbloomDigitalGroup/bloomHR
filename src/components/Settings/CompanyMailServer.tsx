import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Card } from '../UI';
import { usePermissions } from '../../hooks/usePermissions';
import { getMailServer, saveMailServer, testMailServer, type MailServerInput, type MailServerSettings } from '../../lib/emailApi';

/** Where the card is on the page, so the Email Portal can link straight to it. */
export const MAIL_SERVER_ANCHOR = 'own-mail-server';

const inputClass =
  'w-full rounded-tile border border-border bg-white px-3 py-2 text-[12.5px] text-ink outline-none focus:border-brand disabled:bg-secondary disabled:text-muted-foreground';

const EMPTY: MailServerInput = { host: '', port: 465, secure: true, username: '', from_name: '', from_address: '', enabled: false };

const asForm = (s: MailServerSettings | null): MailServerInput =>
  s
    ? { host: s.host, port: s.port, secure: s.secure, username: s.username, from_name: s.from_name, from_address: s.from_address, enabled: s.enabled }
    : EMPTY;

const sameForm = (a: MailServerInput, b: MailServerInput) =>
  a.host === b.host &&
  Number(a.port) === Number(b.port) &&
  a.secure === b.secure &&
  a.username === b.username &&
  a.from_name === b.from_name &&
  a.from_address === b.from_address &&
  a.enabled === b.enabled;

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-semibold text-ink">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

/**
 * Sending the company's email from its own mail server (cPanel or any SMTP) instead of Figbloom HR mail. Only people
 * with the Settings permission see it. The password is kept encrypted on the server and never shown again: leaving the
 * box empty keeps the saved one.
 */
export default function CompanyMailServerCard({ className = '' }: { className?: string }) {
  const { hasAnyPermission, loading: permissionsLoading } = usePermissions();
  const canEdit = !permissionsLoading && hasAnyPermission(['settings']);
  const [saved, setSaved] = useState<MailServerSettings | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState<MailServerInput>(EMPTY);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'' | 'saving' | 'testing'>('');

  useEffect(() => {
    if (!canEdit) return;
    let live = true;
    getMailServer()
      .then(({ settings }) => {
        if (!live) return;
        setSaved(settings);
        setForm(asForm(settings));
        setLoaded(true);
      })
      .catch((e) => {
        console.error('Could not load the mail server settings:', e);
        if (live) setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, [canEdit]);

  // opened from the Email Portal's link (/settings/company#own-mail-server): the card appears after the page has
  // loaded, so scroll to it then
  useEffect(() => {
    if (loaded && window.location.hash === `#${MAIL_SERVER_ANCHOR}`) {
      document.getElementById(MAIL_SERVER_ANCHOR)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }
  }, [loaded]);

  if (!canEdit || !loaded) return null;

  const changed = !sameForm(form, asForm(saved)) || password !== '';
  const set = <K extends keyof MailServerInput>(key: K, value: MailServerInput[K]) => setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    setBusy('saving');
    try {
      const { settings } = await saveMailServer({ ...form, port: Number(form.port), password: password || undefined });
      setSaved(settings);
      setForm(asForm(settings));
      setPassword('');
      toast.success(settings.enabled ? `Email will now be sent from ${settings.from_address}` : 'Mail server settings saved');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const test = async () => {
    setBusy('testing');
    try {
      const result = await testMailServer();
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
      setSaved((s) => (s ? { ...s, last_test_ok: result.ok, last_test_at: result.tested_at, last_test_message: result.message } : s));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const disabled = busy !== '';

  return (
    <Card className={className} id={MAIL_SERVER_ANCHOR}>
      <h2 className="m-0 text-[14px] font-bold text-ink">Send from your own mail server</h2>
      <p className="mt-0.5 mb-3.5 text-[12px] text-muted-foreground">
        Send your company&apos;s email (the Email Portal, letters, reminders) from your own address, through your own mail
        server, instead of Figbloom HR mail. For cPanel hosting the server is usually <strong>mail.yourdomain.com</strong>,
        port <strong>465</strong> with SSL/TLS, and the username is the full email address. Other providers: port 587 with
        STARTTLS.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Mail server (SMTP host)">
          <input className={inputClass} placeholder="mail.yourdomain.com" value={form.host} disabled={disabled} onChange={(e) => set('host', e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Port">
            <select
              className={inputClass}
              value={form.port}
              disabled={disabled}
              onChange={(e) => {
                const port = Number(e.target.value);
                // the usual security for each port, which can still be changed
                setForm((f) => ({ ...f, port, secure: port === 465 }));
              }}
            >
              {[465, 587, 25, 2525].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Security">
            <select className={inputClass} value={form.secure ? 'ssl' : 'starttls'} disabled={disabled} onChange={(e) => set('secure', e.target.value === 'ssl')}>
              <option value="ssl">SSL/TLS</option>
              <option value="starttls">STARTTLS</option>
            </select>
          </Field>
        </div>
        <Field label="Username" hint="Usually the full email address of the mailbox">
          <input className={inputClass} placeholder="hr@yourdomain.com" autoComplete="off" value={form.username} disabled={disabled} onChange={(e) => set('username', e.target.value)} />
        </Field>
        <Field label="Password" hint={saved?.password_set ? 'Saved. Leave empty to keep it.' : 'The mailbox password'}>
          <input
            className={inputClass}
            type="password"
            autoComplete="new-password"
            placeholder={saved?.password_set ? '••••••••' : ''}
            value={password}
            disabled={disabled}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Field label="From name" hint="What people see as the sender, e.g. your company's HR team">
          <input className={inputClass} placeholder="Acme HR" value={form.from_name} disabled={disabled} onChange={(e) => set('from_name', e.target.value)} />
        </Field>
        <Field label="From address">
          <input className={inputClass} type="email" placeholder="hr@yourdomain.com" value={form.from_address} disabled={disabled} onChange={(e) => set('from_address', e.target.value)} />
        </Field>
      </div>

      <label className="mt-3.5 flex cursor-pointer items-start gap-2 text-[12.5px]">
        <input type="checkbox" className="mt-0.5" checked={form.enabled} disabled={disabled} onChange={(e) => set('enabled', e.target.checked)} />
        <span className="font-semibold text-ink">Send our company&apos;s email through this server</span>
      </label>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-[12px] text-muted-foreground" role="status" aria-live="polite">
          {saved?.last_test_at
            ? `Last test ${new Date(saved.last_test_at).toLocaleString()}: ${saved.last_test_ok ? 'worked' : 'failed'}${saved.last_test_message ? `. ${saved.last_test_message}` : ''}`
            : saved?.enabled
              ? `Sending from ${saved.from_address}`
              : 'Not in use: email is sent via Figbloom HR mail'}
        </p>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => void test()}
            disabled={disabled || changed || !saved?.password_set}
            title={changed ? 'Save your changes first' : undefined}
          >
            {busy === 'testing' ? 'Sending...' : 'Send test email'}
          </Button>
          <Button onClick={() => void save()} disabled={disabled || !changed}>
            {busy === 'saving' ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </Card>
  );
}
