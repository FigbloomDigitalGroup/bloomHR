// The notification email the send-notification-emails Edge Function sends (FIG-771).
import { describe, expect, it } from 'vitest';
import { htmlFor, subjectFor } from '../functions/send-notification-emails/email';

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
