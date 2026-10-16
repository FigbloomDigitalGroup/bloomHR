import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Card } from '../UI';
import LevelSelect from '../staff portal/LevelSelect';
import {
  CHAT_LEVELS, UPDATE_LEVELS, loadEmailPreferences, loadUpdatesLevel, saveEmailPreferences, saveUpdatesLevel,
  type EmailLevel, type EmailPreferences,
} from '../../lib/notificationPreferences';

/**
 * What is emailed to the signed-in admin or HR person (FIG-890): HR alerts (leave to approve, contracts ending, exits,
 * applications, loan requests, signed contracts), unread chat messages, and their own updates when they are also an
 * employee. Each everything / important only / off. Works for a login with no employee record.
 */
export default function EmailNotifications() {
  const [prefs, setPrefs] = useState<EmailPreferences | null>(null);
  const [updates, setUpdates] = useState<EmailLevel | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    loadEmailPreferences().then((p) => live && setPrefs(p), () => undefined);
    loadUpdatesLevel().then((l) => live && setUpdates(l), () => undefined);
    return () => {
      live = false;
    };
  }, []);

  if (!prefs) return null;

  const save = async (fn: () => Promise<void>, done: () => void) => {
    setSaving(true);
    try {
      await fn();
      done();
      toast.success('Email settings saved');
    } catch (e) {
      toast.error((e as Error).message || 'Not saved');
    } finally {
      setSaving(false);
    }
  };
  const savePrefs = (next: EmailPreferences) => void save(() => saveEmailPreferences(next), () => setPrefs(next));

  return (
    <Card className="mb-4">
      <div className="space-y-3 text-[13px] text-ink">
        <div>
          <h2 className="m-0 text-[14px] font-bold text-ink">Email notifications</h2>
          <p className="text-[12px] text-muted-foreground">
            What is emailed to you, in case you miss it in the app. Important only means things waiting for your
            decision; for chat, direct messages and @mentions.
          </p>
        </div>
        <LevelSelect label="HR alerts" value={prefs.hrAlerts} options={UPDATE_LEVELS} disabled={saving}
          onChange={(hrAlerts) => savePrefs({ ...prefs, hrAlerts })} />
        <LevelSelect label="Chat messages" value={prefs.chat} options={CHAT_LEVELS} disabled={saving}
          onChange={(chat) => savePrefs({ ...prefs, chat })} />
        {updates !== null && (
          <LevelSelect label="My own updates" value={updates} options={UPDATE_LEVELS} disabled={saving}
            onChange={(level) => void save(() => saveUpdatesLevel(level), () => setUpdates(level))} />
        )}
        <p className="text-[11.5px] text-muted-foreground">
          At most 20 emails a day; anything more comes in your next email. Mute a chat with the bell at its top.
        </p>
      </div>
    </Card>
  );
}
