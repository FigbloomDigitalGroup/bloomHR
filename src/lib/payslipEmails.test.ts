import { describe, expect, it } from 'vitest';
import { pdfPassword, progressLabel, stillSending, summarizePayslipEmails, type PayslipEmailStatus } from './payslipEmails';
import { clampReminderDays, reminderSummary } from './companyEmailSettings';

const rows = (...s: PayslipEmailStatus[]) => s.map((status) => ({ status }));

describe('payslip email progress', () => {
  it('counts each state; "Sent x of y" leaves out the skipped', () => {
    const s = summarizePayslipEmails(rows('sent', 'sent', 'pending', 'sending', 'waiting_pdf', 'failed', 'skipped', 'skipped'));
    expect(s).toEqual({ total: 8, waiting: 1, queued: 2, sent: 2, failed: 1, skipped: 2 });
    expect(progressLabel(s)).toBe('Sent 2 of 6');
    expect(stillSending(s)).toBe(true);
  });

  it('is done when nothing is waiting or being sent', () => {
    const s = summarizePayslipEmails(rows('sent', 'failed', 'skipped'));
    expect(stillSending(s)).toBe(false);
    expect(progressLabel(summarizePayslipEmails([]))).toBe('Sent 0 of 0');
  });
});

describe('the PDF password', () => {
  it('is the ID number as HR keeps it: upper case, no spaces', () => {
    expect(pdfPassword(' 1234 5678 ')).toBe('12345678');
    expect(pdfPassword('a1234567')).toBe('A1234567');
    expect(pdfPassword(12345678)).toBe('12345678');
  });

  it('is nothing without an ID number', () => {
    expect(pdfPassword(null)).toBeNull();
    expect(pdfPassword(undefined)).toBeNull();
    expect(pdfPassword('   ')).toBeNull();
  });
});

describe('event reminder settings', () => {
  it('days before are a whole number from 0 to 30', () => {
    expect(clampReminderDays(1.6)).toBe(2);
    expect(clampReminderDays(-3)).toBe(0);
    expect(clampReminderDays(99)).toBe(30);
    expect(clampReminderDays('x')).toBe(0);
  });

  it('in words', () => {
    expect(reminderSummary({ eventReminders: true, eventReminderDays: 1 })).toBe('Event reminders 1 day before and on the day');
    expect(reminderSummary({ eventReminders: true, eventReminderDays: 3 })).toBe('Event reminders 3 days before and on the day');
    expect(reminderSummary({ eventReminders: true, eventReminderDays: 0 })).toBe('Event reminders on the day');
    expect(reminderSummary({ eventReminders: false, eventReminderDays: 3 })).toBe('No event reminders');
  });
});
