import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Card } from '../UI';
import { runErrorMessage } from '../../lib/payrollRuns';
import {
  DEFAULT_PAYSLIP_EMAIL_SETTINGS,
  loadPayslipEmailSettings,
  savePayslipEmailSettings,
  type PayslipEmailSettings,
} from '../../lib/payslipEmails';

// Payroll settings for payslips emailed as PDFs (FIG-732, company_payroll_settings): email them automatically when a
// month is approved, protect each PDF with the employee's ID number (on unless turned off), and how long the PDF is
// kept after it is sent.

const KEEP_CHOICES: { days: number; label: string }[] = [
  { days: 0, label: 'Delete it once sent' },
  { days: 7, label: 'Keep it 7 days' },
  { days: 30, label: 'Keep it 30 days' },
  { days: 90, label: 'Keep it 90 days' },
];

export default function PayslipEmailSetting({ canEdit }: { canEdit: boolean }) {
  const [settings, setSettings] = useState<PayslipEmailSettings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    loadPayslipEmailSettings()
      .then((s) => live && setSettings(s))
      .catch(() => live && setSettings(DEFAULT_PAYSLIP_EMAIL_SETTINGS));
    return () => {
      live = false;
    };
  }, []);

  const change = async (patch: Partial<PayslipEmailSettings>) => {
    if (!settings || busy) return;
    const before = settings;
    const next = { ...settings, ...patch };
    setSettings(next);
    setBusy(true);
    try {
      await savePayslipEmailSettings(next);
      toast.success('Saved the payslip email settings.');
    } catch (err) {
      setSettings(before);
      toast.error(runErrorMessage(err, 'Could not save the setting.'));
    } finally {
      setBusy(false);
    }
  };

  const disabled = !canEdit || busy || settings === null;
  const keepChoices = settings && !KEEP_CHOICES.some((c) => c.days === settings.keepDays)
    ? [...KEEP_CHOICES, { days: settings.keepDays, label: `Keep it ${settings.keepDays} days` }]
    : KEEP_CHOICES;

  return (
    <Card>
      <h2 className="text-sm font-bold text-ink">Payslip emails</h2>
      <p className="text-[11.5px] text-muted-foreground mb-3">
        Once a month is approved, "Email payslips" on the Run tab sends each employee their payslip as a PDF attached to
        an email to their work email. Employees with no work email are listed as skipped.
      </p>
      <div className="space-y-2.5 text-xs">
        <label className={`flex items-start gap-2 ${canEdit ? 'cursor-pointer' : 'opacity-80'}`}>
          <input
            type="checkbox"
            className="mt-0.5"
            checked={!!settings?.auto}
            disabled={disabled}
            onChange={(e) => void change({ auto: e.target.checked })}
          />
          <span>
            <span className="font-semibold text-ink">Email payslips automatically when a month is approved</span>
            <span className="block text-[11px] text-muted-foreground">
              They start sending as soon as you approve; keep the page open while the PDFs are made.
            </span>
          </span>
        </label>
        <label className={`flex items-start gap-2 ${canEdit ? 'cursor-pointer' : 'opacity-80'}`}>
          <input
            type="checkbox"
            className="mt-0.5"
            checked={settings ? settings.password : true}
            disabled={disabled}
            onChange={(e) => void change({ password: e.target.checked })}
          />
          <span>
            <span className="font-semibold text-ink">Protect payslip PDFs with the employee's ID number</span>
            <span className="text-muted-foreground"> (recommended)</span>
            <span className="block text-[11px] text-muted-foreground">
              The email tells them the password is their ID number, but never contains it. Employees with no ID number
              are skipped while this is on.
            </span>
          </span>
        </label>
        <label className="block">
          <span className="block font-semibold text-ink mb-1">After a payslip is emailed, its PDF copy</span>
          <select
            className="rounded-tile border border-border bg-white px-2 py-1.5 text-[12px] text-ink outline-none focus:border-brand disabled:bg-secondary"
            value={String(settings?.keepDays ?? 0)}
            disabled={disabled}
            onChange={(e) => void change({ keepDays: Number(e.target.value) })}
            aria-label="Keep the emailed PDF"
          >
            {keepChoices.map((c) => (
              <option key={c.days} value={String(c.days)}>{c.label}</option>
            ))}
          </select>
        </label>
      </div>
    </Card>
  );
}
