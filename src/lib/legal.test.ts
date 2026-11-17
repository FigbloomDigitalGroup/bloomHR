import { describe, expect, it } from 'vitest';
import { SITE } from './landing';
import { PRIVACY, TERMS, placeholdersIn } from './legal';
import { LEGAL_PATHS, LEGAL_REVIEWED } from './legalGate';

// The Privacy Policy and Terms are drafts for a lawyer. They go live only when every [[PLACEHOLDER]] is filled in and
// LEGAL_REVIEWED (src/lib/legalGate.ts) is set to true.

describe('the legal pages', () => {
  const left = [...placeholdersIn(PRIVACY), ...placeholdersIn(TERMS)];

  it('cannot go live while any [[placeholder]] is left in the text', () => {
    if (LEGAL_REVIEWED) expect(left).toEqual([]);
  });

  it('keep their placeholders in one recognisable shape, so none is missed', () => {
    for (const text of left) expect(text).toMatch(/^\[\[[A-Z0-9 ,.'"():/-]+\]\]$/);
  });

  it('are served at /privacy and /terms', () => {
    expect([...LEGAL_PATHS]).toEqual(['/privacy', '/terms']);
  });

  it('give the same contact address as the rest of the site', () => {
    for (const doc of [PRIVACY, TERMS]) {
      const text = doc.sections.flatMap((s) => s.paragraphs ?? []).join(' ');
      expect(text).toContain(SITE.email);
    }
  });

  it('name the providers the product really uses, and the Kenyan law and regulator', () => {
    const privacy = [...PRIVACY.intro, ...PRIVACY.sections.flatMap((s) => [...(s.paragraphs ?? []), ...(s.items ?? [])])].join('\n');
    for (const name of ['Supabase', 'Vercel', 'Resend', 'Celcom Africa', 'OpenAI', 'Jitsi', 'Cloudflare', 'Google Fonts']) expect(privacy).toContain(name);
    expect(privacy).toContain('Data Protection Act, 2019');
    expect(privacy).toContain('Office of the Data Protection Commissioner');
  });

  it('say where the database is hosted (FIG-836, confirmed 2026-10-14), and what happens to a connected mailbox', () => {
    const privacy = PRIVACY.sections.flatMap((s) => [...(s.paragraphs ?? []), ...(s.items ?? [])]).join('\n');
    expect(privacy).toContain('Frankfurt');
    expect(privacy).toMatch(/Mailbox:[^\n]*stored encrypted[^\n]*not stored by Figbloom/);
  });

  it('tell the company that payroll does not send salary payments', () => {
    const terms = TERMS.sections.flatMap((s) => [...(s.paragraphs ?? []), ...(s.items ?? [])]).join('\n');
    expect(terms).toMatch(/Payroll in Figbloom does not send salary payments/);
  });

  // Each of these was found wrong against the code when the drafts were checked, so they must not come back
  it('keep to what the code does', () => {
    const everything = [PRIVACY, TERMS]
      .flatMap((doc) => [...doc.intro, ...doc.sections.flatMap((s) => [...(s.paragraphs ?? []), ...(s.items ?? [])])])
      .join('\n');
    expect(everything).not.toMatch(/by email or SMS/i); // no screen registers a phone number, so codes go by email
    expect(everything).not.toMatch(/only what it needs/i); // some providers get whole records or identifiers
    expect(everything).not.toMatch(/record of your sign-ins/i); // only the last sign-in time is kept
    expect(everything).not.toMatch(/payslip PDFs[^.]*signed links/i); // payslip PDFs are never opened through a link
    expect(everything).toContain('While you have the app open'); // the idle sign-out only runs while the app is open
  });
});
