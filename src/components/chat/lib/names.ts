/** The part of an email before the @, e.g. "mikekirutic" for mikekirutic@gmail.com. */
const emailName = (email?: string | null) => (email ? email.split('@')[0] : '');

/**
 * The name to show for a person in chat: their employee record, else the name they gave when they joined, else the
 * start of their email. Never the word "User": a company's first administrator often has no employee record yet.
 */
export function chatDisplayName(input: {
  firstName?: string | null;
  lastName?: string | null;
  metadata?: { full_name?: string | null; name?: string | null } | null;
  email?: string | null;
}): string {
  const fromEmployee = `${input.firstName ?? ''} ${input.lastName ?? ''}`.trim();
  return fromEmployee || input.metadata?.full_name?.trim() || input.metadata?.name?.trim() || emailName(input.email) || 'Someone';
}

/** Up to two capital letters from a display name ("Mike Kiruti" -> "MK", "mikekirutic" -> "M"). */
export function initialsOf(name: string): string {
  const words = name.trim().split(/[\s._-]+/).filter(Boolean);
  const letters = (words.length > 1 ? [words[0][0], words[words.length - 1][0]] : [words[0]?.[0]]).filter(Boolean).join('');
  return letters.toUpperCase() || 'U';
}

/** Chat ids for direct messages are "dm-<conversation id>": the real id is what is stored in the database. */
export const DM_PREFIX = 'dm-';
export const isDirectMessageId = (id: string): boolean => id.startsWith(DM_PREFIX);
export const realChannelId = (id: string): string => (isDirectMessageId(id) ? id.slice(DM_PREFIX.length) : id);
export const directMessageId = (conversationId: string): string => `${DM_PREFIX}${conversationId}`;
