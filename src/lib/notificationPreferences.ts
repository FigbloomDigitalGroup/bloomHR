import { supabase } from './supabase';

// What is emailed to the signed-in person (FIG-771, FIG-890; migrations 20261013800000, 20261017600000).
//   * their own updates (an employee's bell): notification_preferences.email_level, per employee record. The older
//     on/off `email` is kept in step (off = off, anything else = on). Warnings, suspensions and payslips are emailed
//     whatever is chosen.
//   * HR alerts and chat: email_preferences, per login and company.
//   * a chat muted for email: chat_email_mutes.
// Each category is everything, important only, or off.

export type EmailLevel = 'all' | 'important' | 'off';

export const EMAIL_LEVELS: EmailLevel[] = ['all', 'important', 'off'];

export const UPDATE_LEVELS: { id: EmailLevel; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'important', label: 'Important only' },
  { id: 'off', label: 'Off' },
];

/** For chat, "important only" is direct messages and @mentions. */
export const CHAT_LEVELS: { id: EmailLevel; label: string }[] = [
  { id: 'all', label: 'Everything unread' },
  { id: 'important', label: 'Direct messages and mentions' },
  { id: 'off', label: 'Off' },
];

async function me(): Promise<{ id: string; email: string | null } | null> {
  const { data: auth } = await supabase.auth.getUser();
  return auth.user ? { id: auth.user.id, email: auth.user.email ?? null } : null;
}

async function myEmployeeId(): Promise<string | null> {
  const email = (await me())?.email;
  if (!email) return null;
  const { data } = await supabase.from('employees').select('id').eq('Work Email', email).maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

/** The level a notification_preferences row means (a missing row: everything). */
export function levelOf(row: { email?: boolean | null; email_level?: string | null } | null | undefined): EmailLevel {
  if (row?.email_level && (EMAIL_LEVELS as string[]).includes(row.email_level)) return row.email_level as EmailLevel;
  return row?.email === false ? 'off' : 'all';
}

/** How much of their own updates they get by email; null when they aren't linked to an employee record. */
export async function loadUpdatesLevel(): Promise<EmailLevel | null> {
  const id = await myEmployeeId();
  if (!id) return null;
  const { data, error } = await supabase.from('notification_preferences').select('email, email_level').eq('employee_id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return levelOf(data as { email?: boolean; email_level?: string } | null);
}

export async function saveUpdatesLevel(level: EmailLevel): Promise<void> {
  const id = await myEmployeeId();
  if (!id) throw new Error('Your login is not linked to an employee record.');
  const { error } = await supabase
    .from('notification_preferences')
    .upsert({ employee_id: id, email: level !== 'off', email_level: level, updated_at: new Date().toISOString() }, { onConflict: 'employee_id' });
  if (error) throw new Error(error.message);
}

/** The daily company email (FIG-771): company events and colleagues' birthdays, each can be left out. */
export interface DigestPreferences {
  events: boolean;
  birthdays: boolean;
}

/** Both on unless they turned one off; null when they aren't linked to an employee record. */
export async function loadDigestPreferences(): Promise<DigestPreferences | null> {
  const id = await myEmployeeId();
  if (!id) return null;
  const { data, error } = await supabase.from('notification_preferences').select('event_emails, birthday_emails').eq('employee_id', id).maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as { event_emails?: boolean | null; birthday_emails?: boolean | null } | null;
  return { events: row?.event_emails !== false, birthdays: row?.birthday_emails !== false };
}

export async function saveDigestPreferences(prefs: DigestPreferences): Promise<void> {
  const id = await myEmployeeId();
  if (!id) throw new Error('Your login is not linked to an employee record.');
  const { error } = await supabase
    .from('notification_preferences')
    .upsert({ employee_id: id, event_emails: prefs.events, birthday_emails: prefs.birthdays, updated_at: new Date().toISOString() }, { onConflict: 'employee_id' });
  if (error) throw new Error(error.message);
}

export interface EmailPreferences {
  hrAlerts: EmailLevel;
  chat: EmailLevel;
}

/** HR alerts and chat (everything unless they chose otherwise). */
export async function loadEmailPreferences(): Promise<EmailPreferences> {
  const user = await me();
  if (!user) throw new Error('Not signed in');
  const { data, error } = await supabase.from('email_preferences').select('hr_alerts, chat').eq('user_id', user.id).maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as { hr_alerts?: EmailLevel; chat?: EmailLevel } | null;
  return { hrAlerts: row?.hr_alerts ?? 'all', chat: row?.chat ?? 'all' };
}

export async function saveEmailPreferences(prefs: EmailPreferences): Promise<void> {
  const user = await me();
  if (!user) throw new Error('Not signed in');
  const { error } = await supabase
    .from('email_preferences')
    .upsert({ user_id: user.id, hr_alerts: prefs.hrAlerts, chat: prefs.chat, updated_at: new Date().toISOString() }, { onConflict: 'user_id,tenant_id' });
  if (error) throw new Error(error.message);
}

/** The chats (database channel ids) they muted for email. */
export async function loadMutedChats(): Promise<Set<string>> {
  const { data, error } = await supabase.from('chat_email_mutes').select('channel_id');
  if (error) throw new Error(error.message);
  return new Set(((data || []) as { channel_id: string }[]).map((r) => r.channel_id));
}

export async function setChatMuted(channelId: string, muted: boolean): Promise<void> {
  const user = await me();
  if (!user) throw new Error('Not signed in');
  const { error } = muted
    ? await supabase.from('chat_email_mutes').upsert({ user_id: user.id, channel_id: channelId }, { onConflict: 'user_id,channel_id' })
    : await supabase.from('chat_email_mutes').delete().eq('user_id', user.id).eq('channel_id', channelId);
  if (error) throw new Error(error.message);
}
