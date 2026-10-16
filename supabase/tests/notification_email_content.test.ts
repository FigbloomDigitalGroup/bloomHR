// The notification email the send-notification-emails Edge Function sends (FIG-771).
import { describe, expect, it } from 'vitest';
import {
  chatDigestHtml, chatDigestSubject, chatLink, describeChat, hrAlertHtml, hrAlertLink, hrAlertSubject, htmlFor, subjectFor,
} from '../functions/send-notification-emails/email';

const item = (title: string, message = 'x') => ({ type: 'document_rejected', title, message, at: '2026-10-13T10:00:00Z' });

describe('the notification email', () => {
  it('is named after the one update, or counts them', () => {
    expect(subjectFor({ items: [item('Document not accepted')], companyName: 'Figbloom Ltd' })).toBe('Document not accepted - Figbloom Ltd');
    expect(subjectFor({ items: [item('a'), item('b'), item('c')], companyName: null })).toBe('3 updates from HR');
  });

  it('lists each update, greets them by name and links to the portal', () => {
    const html = htmlFor({ firstName: 'Amina', companyName: 'Figbloom Ltd', appUrl: 'https://hr.figbloom.org', items: [item('Document not accepted', 'Reason: blurred.'), item('Payslip ready')] });
    expect(html).toContain('Hi Amina,');
    expect(html).toContain('There are 2 updates for you:');
    expect(html).toContain('Reason: blurred.');
    expect(html).toContain('href="https://hr.figbloom.org"');
  });

  it('escapes what HR typed, and keeps the subject on one line', () => {
    const html = htmlFor({ firstName: '<b>', companyName: null, appUrl: 'javascript:alert(1)', items: [item('<script>x</script>', 'a & "b"')] });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a &amp; &quot;b&quot;');
    expect(html).not.toContain('javascript:'); // only an https link
    expect(subjectFor({ items: [item('Line one\r\nBcc: x@y.z')], companyName: null })).toBe('Line one Bcc: x@y.z');
  });
});

describe('the HR alert email (FIG-890)', () => {
  const alert = (type: string, title: string) => ({ type, title, message: 'x', at: '2026-10-16T10:00:00Z' });

  it('is named after the one alert, or counts them, and links to the page that handles them', () => {
    expect(hrAlertSubject({ items: [alert('leave_recommended', 'Leave recommended')], companyName: 'Figbloom Ltd' })).toBe('Leave recommended - Figbloom Ltd');
    expect(hrAlertSubject({ items: [alert('a', 'a'), alert('b', 'b')], companyName: null })).toBe('2 things for HR to look at');
    expect(hrAlertLink('https://hr.figbloom.org/staff', [alert('leave_recommended', 'x')])).toBe('https://hr.figbloom.org/leaves');
    expect(hrAlertLink('https://hr.figbloom.org/staff', [alert('leave_recommended', 'x'), alert('loan_requested', 'y')])).toBe('https://hr.figbloom.org/');
    expect(hrAlertLink('http://insecure', [alert('leave_recommended', 'x')])).toBe('');
    const html = hrAlertHtml({ firstName: 'Grace', companyName: null, appUrl: 'https://hr.figbloom.org', items: [alert('application_received', 'New application')] });
    expect(html).toContain('Hi Grace,');
    expect(html).toContain('href="https://hr.figbloom.org/recruitment"');
  });
});

describe('the unread chat digest email (FIG-890)', () => {
  const dm = { channel_id: 'c1', kind: 'dm' as const, name: 'Hellen Rono', unread: 3, mentions: 0 };
  const ops = { channel_id: 'c2', kind: 'channel' as const, name: 'ops', unread: 5, mentions: 0 };
  const general = { channel_id: 'c3', kind: 'channel' as const, name: 'general', unread: 1, mentions: 1 };

  it('says who wrote and how many, never what', () => {
    expect(describeChat(dm)).toBe('3 new messages from Hellen Rono');
    expect(describeChat(ops)).toBe('5 new messages in #ops');
    expect(describeChat(general)).toBe('You were mentioned in #general');
    expect(describeChat({ ...ops, mentions: 2 })).toBe('5 new messages in #ops, 2 mentioning you');
    expect(chatDigestSubject({ items: [dm], companyName: 'Figbloom Ltd' })).toBe('3 new messages from Hellen Rono - Figbloom Ltd');
    expect(chatDigestSubject({ items: [dm, ops, general], companyName: null })).toBe('9 unread messages in 3 conversations');
  });

  it('links staff to the portal and everyone else to Teams, and escapes names', () => {
    expect(chatLink('https://hr.figbloom.org/staff', 'STAFF')).toBe('https://hr.figbloom.org/staff');
    expect(chatLink('https://hr.figbloom.org/staff', 'ADMIN')).toBe('https://hr.figbloom.org/teams');
    const html = chatDigestHtml({ firstName: null, companyName: null, link: 'https://x.co/teams', items: [{ ...dm, name: '<b>x</b>' }] });
    expect(html).toContain('Hi,');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('href="https://x.co/teams"');
  });
});
