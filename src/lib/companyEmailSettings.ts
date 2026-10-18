import { supabase } from './supabase';

// The company's daily email about events and birthdays (FIG-771, migration 20261019600000, company_email_settings):
// event reminders on or off and how many days before (as well as on the day), and birthday emails on or off. Each
// person can also leave events or birthdays out of theirs (notification_preferences, lib/notificationPreferences).

export interface CompanyEmailSettings {
  eventReminders: boolean;
  /** a reminder this many days before an event (0 = only on the day) */
  eventReminderDays: number;
  birthdayEmails: boolean;
}

export const DEFAULT_COMPANY_EMAIL_SETTINGS: CompanyEmailSettings = { eventReminders: true, eventReminderDays: 1, birthdayEmails: true };

export const MAX_REMINDER_DAYS = 30;

/** Days before, as a whole number from 0 to 30. */
export const clampReminderDays = (n: unknown) => Math.max(0, Math.min(MAX_REMINDER_DAYS, Math.round(Number(n)) || 0));

export async function loadCompanyEmailSettings(): Promise<CompanyEmailSettings> {
  const { data, error } = await supabase
    .from('company_email_settings')
    .select('event_reminders, event_reminder_days, birthday_emails')
    .maybeSingle();
  if (error) {
    // a database without the migration yet: the defaults
    if (['42P01', 'PGRST205', '42703', 'PGRST204'].includes(String(error.code))) return DEFAULT_COMPANY_EMAIL_SETTINGS;
    throw new Error(error.message);
  }
  const row = data as { event_reminders?: boolean; event_reminder_days?: number; birthday_emails?: boolean } | null;
  return {
    eventReminders: row?.event_reminders ?? DEFAULT_COMPANY_EMAIL_SETTINGS.eventReminders,
    eventReminderDays: row?.event_reminder_days ?? DEFAULT_COMPANY_EMAIL_SETTINGS.eventReminderDays,
    birthdayEmails: row?.birthday_emails ?? DEFAULT_COMPANY_EMAIL_SETTINGS.birthdayEmails,
  };
}

export async function saveCompanyEmailSettings(s: CompanyEmailSettings): Promise<void> {
  const { error } = await supabase.from('company_email_settings').upsert(
    {
      event_reminders: s.eventReminders,
      event_reminder_days: clampReminderDays(s.eventReminderDays),
      birthday_emails: s.birthdayEmails,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id' },
  );
  if (error) throw new Error(error.message);
}

/** What a reminder setting means, in words: "1 day before and on the day". */
export function reminderSummary(s: Pick<CompanyEmailSettings, 'eventReminders' | 'eventReminderDays'>): string {
  if (!s.eventReminders) return 'No event reminders';
  const d = clampReminderDays(s.eventReminderDays);
  if (d === 0) return 'Event reminders on the day';
  return `Event reminders ${d} ${d === 1 ? 'day' : 'days'} before and on the day`;
}
