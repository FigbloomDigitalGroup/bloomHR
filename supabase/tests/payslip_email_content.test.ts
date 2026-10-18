// The payslip email the send-notification-emails Edge Function sends with the PDF attached (FIG-732), and the daily
// company digest in the notification email (FIG-771). Plain TypeScript, no Deno.
import { describe, expect, it } from 'vitest';
import {
  htmlFor, payslipEmailHtml, payslipEmailSubject, payslipFileName, payslipPasswordNote, periodLabel,
} from '../functions/send-notification-emails/email';
import { toBase64 } from '../functions/send-notification-emails/sending';

const base = { firstName: 'Amina', companyName: 'Acme Ltd', period: '2026-10', appUrl: 'https://hr.acme.co/staff' };

describe('the payslip email', () => {
  it('is named after the month, as the "Payslip ready" notification names it', () => {
    expect(periodLabel('2026-10')).toBe('October 2026');
    expect(periodLabel('2027-01')).toBe('January 2027');
    expect(periodLabel('2026-13')).toBe('2026-13');
    expect(payslipEmailSubject({ period: '2026-10', companyName: 'Acme Ltd' })).toBe('Your payslip for October 2026 - Acme Ltd');
    expect(payslipEmailSubject({ period: '2026-10', companyName: null })).toBe('Your payslip for October 2026');
  });

  it('says the PDF is attached, greets them, and links to the portal', () => {
    const html = payslipEmailHtml({ ...base, passwordProtected: true });
    expect(html).toContain('Hi Amina,');
    expect(html).toContain('Your payslip for October 2026 is attached to this email as a PDF.');
    expect(html).toContain('href="https://hr.acme.co/staff"');
    expect(html).toContain('confidential');
  });

  it('says which password opens the PDF, never the password itself', () => {
    const html = payslipEmailHtml({ ...base, passwordProtected: true });
    expect(html).toContain('your ID number');
    expect(payslipPasswordNote(true)).toMatch(/protected with a password: your ID number/);
    // nothing that looks like an ID number: the builder is never given one
    expect(html).not.toMatch(/\d{6,}/);
  });

  it('without a password, says so', () => {
    const html = payslipEmailHtml({ ...base, passwordProtected: false });
    expect(html).toContain('not password protected');
    expect(html).not.toContain('your ID number');
  });

  it('escapes the company name and first name', () => {
    const html = payslipEmailHtml({ ...base, firstName: '<b>x</b>', companyName: 'A & B <Ltd>', passwordProtected: true });
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('A &amp; B &lt;Ltd&gt;');
  });

  it("the attachment's name has safe characters only", () => {
    expect(payslipFileName('2026-10', 'MCL-000001')).toBe('payslip-2026-10-MCL-000001.pdf');
    expect(payslipFileName('2026-10', 'A/1 "x"')).toBe('payslip-2026-10-A_1_x_.pdf');
  });
});

describe('attachments as base64', () => {
  it('matches the standard encoding, also for a file larger than one chunk', () => {
    expect(toBase64(new TextEncoder().encode('%PDF-1.3 hello'))).toBe(Buffer.from('%PDF-1.3 hello').toString('base64'));
    const big = new Uint8Array(100_000).map((_, i) => (i * 7) % 256);
    expect(toBase64(big)).toBe(Buffer.from(big).toString('base64'));
    expect(toBase64(new Uint8Array())).toBe('');
  });
});

describe('the daily company digest in the notification email', () => {
  it('keeps each line of the digest on its own line', () => {
    const html = htmlFor({
      firstName: 'Yusuf', companyName: 'Acme Ltd', appUrl: 'https://hr.acme.co',
      items: [{ type: 'company_digest', title: 'Today at Acme Ltd', message: "Today is Mia Me's birthday 🎉\nToday: Town hall", at: '2026-10-20T05:00:00Z' }],
    });
    expect(html).toContain('Today is Mia Me&#39;s birthday 🎉<br>Today: Town hall');
  });
});
