import { apiRequest } from './adminApi';

// "Invite admin" for a customer's HR company (a school, Fleet company or Property workspace with HR & Payroll on),
// through bloomHR's backend (platform_hr_admin_routes.js, Owner/Admin): HR queues an ADMIN invitation to the address,
// as it did for the admins the customer gave when HR was switched on.

/** queued: HR emails the invitation within minutes; already_invited: one is waiting; already_member: they have a login. */
export type HrAdminInviteOutcome = 'queued' | 'already_invited' | 'already_member';

export interface HrAdminInvite {
  outcome: HrAdminInviteOutcome;
  email: string;
  company: { id: string; name: string | null } | null;
  /** already_member: their role in the HR company (ADMIN, HR, STAFF...) */
  member_role: string | null;
}

const OUTCOMES: HrAdminInviteOutcome[] = ['queued', 'already_invited', 'already_member'];

/** Invites someone as an administrator of the HR company of a platform tenant (its platform ID). */
export async function inviteHrAdmin(platformTenantId: string, email: string, name?: string): Promise<HrAdminInvite> {
  const result = await apiRequest<Partial<HrAdminInvite>>(
    'POST',
    `/platform/hr-admin/${encodeURIComponent(platformTenantId)}/invite`,
    { email, ...(name?.trim() ? { name: name.trim() } : {}) }
  );
  if (!result?.outcome || !OUTCOMES.includes(result.outcome)) throw new Error('The console could not tell whether the invitation was queued.');
  return {
    outcome: result.outcome,
    email: result.email ?? email.trim().toLowerCase(),
    company: result.company ?? null,
    member_role: result.member_role ?? null,
  };
}

/** What staff see after inviting. */
export function hrAdminInviteMessage(r: HrAdminInvite): string {
  if (r.outcome === 'queued') return `Invitation sent to ${r.email}. Figbloom HR emails it within a few minutes.`;
  if (r.outcome === 'already_invited') return `${r.email} is already invited. Nothing was sent again.`;
  return r.member_role === 'ADMIN'
    ? `${r.email} is already an admin of this HR company.`
    : `${r.email} already has a login in this HR company${r.member_role ? ` (${r.member_role.toLowerCase()})` : ''}. Change their role in Figbloom HR.`;
}
