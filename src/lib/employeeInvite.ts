import { companyApi, inviteLink } from './companyApi';

// A new employee gets an email at their Work Email with a link to join the company (it creates their login).
// Their login finds their employee record by that same address, so it is saved exactly as the login will have it.

/** A work email as logins store it: trimmed, lower case. The employee record must match it exactly to link. */
export const normaliseWorkEmail = (value: unknown) => String(value ?? '').trim().toLowerCase();

export type InviteOutcome =
  | { status: 'sent'; email: string }
  /** they already have access to this company: nothing to send */
  | { status: 'member'; email: string }
  /** the invitation exists but the email did not go out: the link can be sent by hand */
  | { status: 'not-emailed'; email: string; link: string; reason: string }
  /** no invitation was made (for example the person adding employees may not invite) */
  | { status: 'failed'; email: string; reason: string };

/** Invites a new employee to join as staff and emails them the link. Never throws: the outcome says what happened. */
export async function inviteEmployee(workEmail: string | null | undefined): Promise<InviteOutcome> {
  const email = normaliseWorkEmail(workEmail);
  let token: string;
  try {
    token = (await companyApi.createInvitation(email, 'STAFF')).token;
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
