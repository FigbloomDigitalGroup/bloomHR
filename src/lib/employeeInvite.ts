import { companyApi, inviteLink } from './companyApi';

// A new employee gets an email at their Work Email with a link to join the company (it creates their login).
// Their login finds their employee record by that same address, so it is saved exactly as the login will have it.

/** A work email as logins store it: trimmed, lower case. The employee record must match it exactly to link. */
export const normaliseWorkEmail = (value: unknown) => String(value ?? '').trim().toLowerCase();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Why a work email cannot be used to add an employee, or null when it can. */
export const workEmailProblem = (value: unknown): string | null => {
  const email = normaliseWorkEmail(value);
  if (!email) return 'no work email (the invitation to join is sent there)';
  if (!EMAIL.test(email)) return `work email "${String(value).trim()}" is not a valid address`;
  return null;
};

export type InviteOutcome =
  | { status: 'sent'; email: string }
  /** they already have access to this company: nothing to send */
  | { status: 'member'; email: string }
  /** the invitation exists but the email did not go out: the link can be sent by hand */
  | { status: 'not-emailed'; email: string; link: string; reason: string }
  /** no invitation was made (for example the person adding employees may not invite) */
  | { status: 'failed'; email: string; reason: string };

/**
 * Creates an invitation to join the company with this role and emails the link (a new invitation replaces any
 * earlier one for the address, so this is also how an invitation is sent again). Never throws.
 */
export async function sendInvitation(address: string | null | undefined, role: string): Promise<InviteOutcome> {
  const email = normaliseWorkEmail(address);
  let token: string;
  try {
    token = (await companyApi.createInvitation(email, role)).token;
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Could not create the invitation.';
    if (/already in this company/i.test(reason)) return { status: 'member', email };
    return { status: 'failed', email, reason };
  }
  try {
    await companyApi.emailInvitation(token);
    return { status: 'sent', email };
  } catch (err) {
    return { status: 'not-emailed', email, link: inviteLink(token), reason: err instanceof Error ? err.message : 'The email could not be sent.' };
  }
}

/** Invites a new employee to join as staff and emails them the link. Never throws: the outcome says what happened. */
export const inviteEmployee = (workEmail: string | null | undefined) => sendInvitation(workEmail, 'STAFF');

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends several invitations one after another, spaced out because the email service accepts only a few sends a
 * second. `onProgress` is told after each one.
 */
export async function sendInvitations(
  people: { email: string; role: string }[],
  onProgress?: (done: number, total: number) => void,
  gapMs = 600
): Promise<InviteOutcome[]> {
  const outcomes: InviteOutcome[] = [];
  for (const [i, person] of people.entries()) {
    if (i > 0 && gapMs > 0) await pause(gapMs);
    outcomes.push(await sendInvitation(person.email, person.role));
    onProgress?.(i + 1, people.length);
  }
  return outcomes;
}

/** The outcomes grouped for a summary: who got the email, who already had access, and who still needs one. */
export const summariseInvites = (outcomes: InviteOutcome[]) => ({
  sent: outcomes.filter((o) => o.status === 'sent').length,
  members: outcomes.filter((o) => o.status === 'member').length,
  notSent: outcomes.filter((o): o is Extract<InviteOutcome, { status: 'not-emailed' | 'failed' }> => o.status === 'not-emailed' || o.status === 'failed'),
});
