import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ send: vi.fn(), archive: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: {} }));
vi.mock('./emailApi', () => ({ sendEmailViaServer: (...a: unknown[]) => mocks.send(...a) }));
vi.mock('./generatedDocuments', () => ({ archiveDocument: (...a: unknown[]) => mocks.archive(...a) }));

import { fillPlaceholders, unknownPlaceholders } from './offers';
import { EXIT_LETTER_PLACEHOLDERS, exitLetterEmailHtml, exitLetterFileName, exitLetterValues, sendExitLetter, startingTemplate } from './exitLetters';

const EXIT = {
  id: 'x1', employee_number: 'MCL-000007', kind: 'termination' as const, reason_category: 'poor_performance',
  notice_given_on: '2026-10-26', notice_days: 7, last_working_day: '2026-11-03',
};
const RECIPIENT = { firstName: 'Jane', lastName: 'Wanjiku', jobTitle: 'Sales Associate', startDate: '2026-07-01', workEmail: 'jane@acme.co', personalEmail: 'jane@gmail.com' };
const PDF = new Blob(['%PDF-1.4'], { type: 'application/pdf' });

beforeEach(() => {
  mocks.send.mockReset().mockResolvedValue({ message: 'ok' });
  mocks.archive.mockReset().mockResolvedValue({ id: 'd1' });
});

describe('filling an exit letter', () => {
  it('fills each placeholder from the exit, the employee, the company and the sender', () => {
    const values = exitLetterValues(EXIT, RECIPIENT, { companyName: 'Acme Ltd', sender: { name: 'Mary Hr', title: 'HR Officer' }, letterDate: '2026-10-26' });
    const text = fillPlaceholders(
      'To: {{employee_name}}\nPosition: {{job_title}}\nDear {{first_name}}, effective {{last_working_day}} ({{reason}}, {{notice_days}} days from {{notice_given_on}}).\n{{signature}}\n{{sender_name}}\n{{sender_title}}\n{{company_name}} {{letter_date}} {{employee_number}} {{start_date}}',
      values
    );
    expect(text).toBe(
      'To: Jane Wanjiku\nPosition: Sales Associate\nDear Jane, effective 3 November 2026 (Poor performance, 7 days from 26 October 2026).\n{{signature}}\nMary Hr\nHR Officer\nAcme Ltd 26 October 2026 MCL-000007 1 July 2026'
    );
  });

  it('knows every placeholder the seeded templates use, and {{signature}}', () => {
    expect(unknownPlaceholders('{{employee_name}} {{signature}} {{sender_title}} {{basic_salary}}', EXIT_LETTER_PLACEHOLDERS)).toEqual(['basic_salary']);
  });

  it('a resignation reads as one; blanks show a dash', () => {
    const values = exitLetterValues({ ...EXIT, kind: 'resignation', reason_category: null }, { ...RECIPIENT, jobTitle: '', startDate: null }, { companyName: 'Acme', sender: { name: 'M', title: '' } });
    expect(values.reason).toBe('Resignation');
    expect(values.job_title).toBe('—');
    expect(values.start_date).toBe('—');
  });

  it('starts from the default template, else the first active one', () => {
    const t = (id: string, is_default: boolean, active = true) => ({ id, title: id, body: 'x', is_default, active });
    expect(startingTemplate([t('a', false), t('b', true)])?.id).toBe('b');
    expect(startingTemplate([t('a', false, false), t('b', true, false), t('c', false)])?.id).toBe('c');
    expect(startingTemplate([])).toBeNull();
  });

  it('the email is escaped and the file is named after the employee', () => {
    expect(exitLetterEmailHtml({ firstName: '<b>Jane</b>', companyName: 'A & B', title: 'RE: TERMINATION' })).toContain('&lt;b&gt;Jane&lt;/b&gt;');
    expect(exitLetterFileName({ firstName: 'Jane', lastName: "O'Neil Wanjiku" })).toBe('letter-jane-o-neil-wanjiku.pdf');
  });
});

describe('sending an exit letter', () => {
  const send = () =>
    sendExitLetter({ exit: EXIT, title: 'RE: TERMINATION OF EMPLOYMENT', pdf: PDF, to: ['jane@acme.co', 'jane@gmail.com'], recipient: RECIPIENT, branding: { name: 'Acme Ltd' } });

  it('emails the PDF as an attachment (as a termination email), then keeps it with who it went to', async () => {
    const outcome = await send();
    expect(outcome).toMatchObject({ status: 'sent', to: ['jane@acme.co', 'jane@gmail.com'] });
    const [email, options] = mocks.send.mock.calls[0];
    expect(options).toEqual({ purpose: 'termination' });
    expect(email.to).toEqual(['jane@acme.co', 'jane@gmail.com']);
    expect(email.attachments).toEqual([{ filename: 'letter-jane-wanjiku.pdf', content: btoa('%PDF-1.4') }]);
    expect(mocks.archive).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'exit_letter', employeeNumber: 'MCL-000007', referenceId: 'x1', pdf: PDF, emailedTo: ['jane@acme.co', 'jane@gmail.com'],
    }));
  });

  it('a letter that could not be emailed is still kept, as not emailed', async () => {
    mocks.send.mockRejectedValue(new Error('Mail server down'));
    const outcome = await send();
    expect(outcome).toMatchObject({ status: 'not-emailed', reason: 'Mail server down' });
    expect(mocks.archive).toHaveBeenCalledWith(expect.objectContaining({ emailedTo: [] }));
  });

  it('says so when the archive fails, without losing that the email went', async () => {
    mocks.archive.mockRejectedValue(new Error('Storage full'));
    expect(await send()).toMatchObject({ status: 'sent', document: null, archiveProblem: 'Storage full' });
  });
});
