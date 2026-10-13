import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { loadEmailNotifications, saveEmailNotifications } from '../../lib/notificationPreferences';

// "Email me these" in the notifications panel (FIG-771). Warnings, suspensions and payslips are emailed either way.

export default function EmailNotificationsToggle() {
  const [on, setOn] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadEmailNotifications().then(setOn, () => setOn(null));
  }, []);

  if (on === null) return null;

  const toggle = async () => {
    const next = !on;
    setSaving(true);
    try {
      await saveEmailNotifications(next);
      setOn(next);
      toast.success(next ? 'You will get these by email too' : 'Emails turned off (warnings, suspensions and payslips still come)');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Not saved');
    } finally {
      setSaving(false);
    }
  };

  return (
    <label className="flex items-start gap-2.5 px-6 py-3 border-b border-gray-100 text-xs text-gray-700 cursor-pointer">
      <input type="checkbox" checked={on} disabled={saving} onChange={() => void toggle()} className="mt-0.5 h-4 w-4 accent-brand" />
      <span>
        <span className="font-semibold">Email me these too</span>
        <span className="block text-[11px] text-gray-500">Warnings, suspensions and payslips are always emailed.</span>
      </span>
    </label>
  );
}
