import { describe, expect, it } from 'vitest';
import { forwardDraft, originalText, parseRecipients, replyDraft } from './mailCompose';
import type { MailMessage } from './mailboxApi';

const message = (extra: Partial<MailMessage> = {}): MailMessage => ({
  uid: 7,
  folder: 'INBOX.Sent',
  subject: 'Fw: Budget',
  from: [{ name: 'Mary', address: 'mary@client.co.ke' }],
  to: [{ name: 'Joe', address: 'joe@client.co.ke' }],
  cc: [],
  reply_to: [],
  date: null,
  message_id: '<7@x>',
  seen: true,
  flagged: false,
  html: null,
  text: 'Line one\n\nLine two',
  attachments: [],
  ...extra,
});

describe('mail compose helpers', () => {
  it('reads addresses separated by commas, semicolons or lines, with or without a name', () => {
    expect(parseRecipients(' a@b.co ;"Ann K" <ann@b.co>,\n bad, Joe <joe@b.co> ,')).toEqual({
      people: [
        { name: '', address: 'a@b.co' },
        { name: 'Ann K', address: 'ann@b.co' },
        { name: 'Joe', address: 'joe@b.co' },
      ],
      invalid: ['bad'],
    });
  });

  it('quotes every line of the original, blank ones too', () => {
    expect(replyDraft(message({ from: [{ name: 'Joe', address: 'joe@client.co.ke' }] }), 'mary@client.co.ke', false).text).toBe(
      '\n\nOn an earlier date, Joe <joe@client.co.ke> wrote:\n> Line one\n>\n> Line two\n'
    );
  });

  it('replying to your own sent email goes to the people it went to', () => {
    const draft = replyDraft(message(), 'MARY@client.co.ke', true);
    expect(draft.to).toBe('Joe <joe@client.co.ke>');
    expect(draft.cc).toBe('');
    expect(draft.subject).toBe('Re: Fw: Budget');
    expect(draft.reply).toEqual({ folder: 'INBOX.Sent', uid: 7 });
  });

  it('uses Reply-To when the email has one', () => {
    expect(replyDraft(message({ reply_to: [{ name: '', address: 'help@client.co.ke' }] }), 'x@y.co', false).to).toBe('help@client.co.ke');
  });

  it('an HTML-only email is quoted as its text, without its styles', () => {
    const html = '<style>p{color:red}</style><p>Hello<br>there</p><div>Bye</div>';
    expect(originalText(message({ text: '', html }))).toBe('Hello\nthere\nBye');
  });

  it('"Fw:" is already a forward', () => {
    expect(forwardDraft(message()).subject).toBe('Fw: Budget');
  });
});
