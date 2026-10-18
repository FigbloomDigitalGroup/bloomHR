import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Card } from '../UI';
import { usePermissions } from '../../hooks/usePermissions';
import {
  MAX_REMINDER_DAYS,
  clampReminderDays,
  loadCompanyEmailSettings,
  reminderSummary,
  saveCompanyEmailSettings,
  type CompanyEmailSettings,
} from '../../lib/companyEmailSettings';

/**
 * The daily email about company events and birthdays (FIG-771): one email a morning per employee, only when there is
 * something to say. Settings admins and HR (employees) change it; everyone else sees it.
 */
export default function CompanyEmailSettingsCard({ className = '' }: { className?: string }) {
  const { hasAnyPermission, loading: permissionsLoading } = usePermissions();
  const canEdit = !permissionsLoading && hasAnyPermission(['settings', 'employees']);
  const [saved, setSaved] = useState<CompanyEmailSettings | null>(null);
  const [form, setForm] = useState<CompanyEmailSettings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    loadCompanyEmailSettings()
      .then((s) => {
        if (live) {
          setSaved(s);
          setForm(s);
        }
      })
      .catch((e) => console.error('Could not load the email settings:', e));
    return () => {
      live = false;
    };
  }, []);

  if (!saved || !form) return null;
  const changed =
    form.eventReminders !== saved.eventReminders ||
    form.birthdayEmails !== saved.birthdayEmails ||
    clampReminderDays(form.eventReminderDays) !== saved.eventReminderDays;

  const save = async () => {
    setBusy(true);
    try {
      const next = { ...form, eventReminderDays: clampReminderDays(form.eventReminderDays) };
      await saveCompanyEmailSettings(next);
      setSaved(next);
      setForm(next);
      toast.success('Email settings saved');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={className}>
      <h2 className="m-0 text-[14px] font-bold text-ink">Daily events and birthdays email</h2>
      <p className="mt-0.5 mb-3.5 text-[12px] text-muted-foreground">
        Each morning, employees get one email (and a notification) about the day&apos;s company events and colleagues&apos;
        birthdays, only when there is something to say. Birthdays show first and last name only, never the year or an
        age, and nobody is told about their own: they get a happy birthday from the company instead. Each person can turn
        these off for themselves.
      </p>
      <div className="space-y-3 text-[12.5px]">
        <label className={`flex items-start gap-2 ${canEdit ? 'cursor-pointer' : 'opacity-80'}`}>
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.eventReminders}
            disabled={!canEdit || busy}
            onChange={(e) => setForm({ ...form, eventReminders: e.target.checked })}
          />
          <span className="font-semibold text-ink">Remind everyone of company events</span>
        </label>
        <label className="flex items-center gap-2 pl-6">
          <span className="text-ink">Remind them</span>
          <input
            type="number"
            min={0}
            max={MAX_REMINDER_DAYS}
            className="w-16 rounded-tile border border-border bg-white px-2 py-1 text-[12px] text-ink outline-none focus:border-brand disabled:bg-secondary"
            value={form.eventReminderDays}
            disabled={!canEdit || busy || !form.eventReminders}
            onChange={(e) => setForm({ ...form, eventReminderDays: Number(e.target.value) })}
            aria-label="Days before an event"
          />
          <span className="text-ink">days before, and on the day</span>
        </label>
        <label className={`flex items-start gap-2 ${canEdit ? 'cursor-pointer' : 'opacity-80'}`}>
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.birthdayEmails}
            disabled={!canEdit || busy}
            onChange={(e) => setForm({ ...form, birthdayEmails: e.target.checked })}
          />
          <span className="font-semibold text-ink">Tell colleagues about birthdays</span>
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-[12.5px] text-ink" role="status" aria-live="polite">
          {reminderSummary(form)} · {form.birthdayEmails ? 'Birthdays on' : 'No birthday emails'}
        </p>
        {canEdit && (
          <Button onClick={() => void save()} disabled={busy || !changed}>
            {busy ? 'Saving...' : 'Save'}
          </Button>
        )}
      </div>
    </Card>
  );
}
