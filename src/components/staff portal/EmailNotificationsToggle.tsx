import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  CHAT_LEVELS, UPDATE_LEVELS, loadEmailPreferences, loadUpdatesLevel, saveEmailPreferences, saveUpdatesLevel,
  type EmailLevel, type EmailPreferences,
} from '../../lib/notificationPreferences';
import LevelSelect from './LevelSelect';

// What is emailed, in the notifications panel (FIG-771, FIG-890): their own updates and chat messages, each
// everything / important only / off. Warnings, suspensions and payslips are emailed either way.

export default function EmailNotificationsToggle() {
  const [updates, setUpdates] = useState<EmailLevel | null>(null);
  const [prefs, setPrefs] = useState<EmailPreferences | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadUpdatesLevel().then(setUpdates, () => setUpdates(null));
    loadEmailPreferences().then(setPrefs, () => setPrefs(null));
  }, []);

  if (updates === null && prefs === null) return null;

  const save = async (fn: () => Promise<void>, done: () => void) => {
    setSaving(true);
    try {
      await fn();
      done();
      toast.success('Email settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Not saved');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-6 py-3 border-b border-gray-100 text-xs text-gray-700 space-y-2">
      <div className="font-semibold text-gray-900">Email me</div>
      {updates !== null && (
        <LevelSelect
          label="My updates"
          value={updates}
          options={UPDATE_LEVELS}
          disabled={saving}
          onChange={(level) => void save(() => saveUpdatesLevel(level), () => setUpdates(level))}
        />
      )}
      {prefs !== null && (
        <LevelSelect
          label="Chat messages"
          value={prefs.chat}
          options={CHAT_LEVELS}
          disabled={saving}
          onChange={(chat) => void save(() => saveEmailPreferences({ ...prefs, chat }), () => setPrefs({ ...prefs, chat }))}
        />
      )}
      <span className="block text-[11px] text-gray-500">
        Warnings, suspensions and payslips are always emailed. Mute a chat with the bell at its top.
      </span>
    </div>
  );
}
