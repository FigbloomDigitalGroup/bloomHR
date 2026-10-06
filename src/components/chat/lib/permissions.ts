/** Administrators, HR and managers create channels (and so choose their names); everyone else uses what exists.
 *  The database enforces the same list (20261006000800_channel_creators.sql). */
export const CHANNEL_CREATOR_ROLES = ['ADMIN', 'HR', 'MANAGER'] as const;

export const canCreateChannels = (role: string | null | undefined): boolean =>
  CHANNEL_CREATOR_ROLES.includes(String(role ?? '').toUpperCase() as (typeof CHANNEL_CREATOR_ROLES)[number]);
