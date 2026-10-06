import { supabase } from './supabase';

// Client for the company functions in 20261006000000_company_memberships.sql and
// 20261006000100_company_signup_and_invites.sql. They run in the database with the person's own session.

export interface Company {
  tenant_id: string;
  name: string;
  slug: string;
  role: string;
  is_current: boolean;
}

export interface InvitePreview {
  company_name: string;
  email: string;
  role: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: string;
  status: 'pending' | 'accepted' | 'revoked';
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
}

export interface CreatedInvitation {
  invitation_id: string;
  token: string;
  expires_at: string;
}

export const INVITABLE_ROLES = ['STAFF', 'MANAGER', 'REGIONAL', 'OPERATIONS', 'CHECKER', 'HR', 'ADMIN'] as const;

/** Supabase errors are plain objects, not Error instances: turn them into a message a person can read. */
export function describeCompanyError(error: unknown): string {
  const message = typeof error === 'object' && error !== null && 'message' in error ? String((error as { message: unknown }).message) : '';
  if (/Not signed in/i.test(message)) return 'Please sign in first.';
  if (/not valid any more/i.test(message)) return 'This invitation link is no longer valid. Ask for a new one.';
  if (/different email/i.test(message)) return 'This invitation was sent to a different email address. Sign in with the address it was sent to.';
  if (/already in this company/i.test(message)) return 'That person is already in this company.';
  if (/only an administrator/i.test(message)) return message;
  if (/2 to 80/i.test(message)) return 'Company name must be 2 to 80 characters.';
  if (/already administer/i.test(message)) return message;
  if (/valid email/i.test(message)) return 'Enter a valid email address.';
  return message || 'Something went wrong. Please try again.';
}

async function call<T>(fn: string, args: Record<string, unknown> | undefined): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(describeCompanyError(error));
  return data as T;
}

/** The link someone opens to join a company. */
export const inviteLink = (token: string, origin: string = window.location.origin) => `${origin}/join?token=${encodeURIComponent(token)}`;

export const companyApi = {
  createCompany: (name: string) => call<string>('create_company', { p_name: name }),

  myCompanies: () => call<Company[]>('my_companies', undefined),

  switchCompany: async (tenantId: string): Promise<void> => {
    await call<null>('switch_company', { p_tenant_id: tenantId });
  },

  createInvitation: async (email: string, role: string): Promise<CreatedInvitation> => {
    const rows = await call<CreatedInvitation[]>('create_invitation', { p_email: email, p_role: role });
    const created = Array.isArray(rows) ? rows[0] : rows;
    if (!created?.token) throw new Error('Could not create the invitation. Please try again.');
    return created;
  },

  revokeInvitation: async (id: string): Promise<void> => {
    await call<null>('revoke_invitation', { p_id: id });
  },

  invitationPreview: async (token: string): Promise<InvitePreview | null> => {
    const rows = await call<InvitePreview[]>('invitation_preview', { p_token: token });
    return rows?.[0] ?? null;
  },

  acceptInvitation: (token: string) => call<string>('accept_invitation', { p_token: token }),

  listInvitations: async (): Promise<Invitation[]> => {
    const { data, error } = await supabase
      .from('invitations')
      .select('id, email, role, status, created_at, expires_at, accepted_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw new Error(describeCompanyError(error));
    return (data ?? []) as Invitation[];
  },
};
