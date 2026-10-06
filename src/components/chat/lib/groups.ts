// Grouping colleagues for channel invitations. A "group" is everyone who shares a value in an employee field the
// company already fills in: Department (stored in "Job Level"), Job Title, or Town. Nothing extra to maintain.

export interface DirectoryPerson {
  'Work Email'?: string | null;
  'First Name'?: string | null;
  'Last Name'?: string | null;
  'Job Level'?: string | null;
  'Job Title'?: string | null;
  Town?: string | null;
}

export interface Member {
  user_id: string;
  email: string;
}

export const GROUP_FIELDS = [
  { field: 'Job Level', label: 'Department' },
  { field: 'Job Title', label: 'Job title' },
  { field: 'Town', label: 'Town' },
] as const;

export interface PeopleGroup {
  id: string; // "Department|Sales"
  kind: string; // "Department"
  value: string; // "Sales"
  /** Logins of the people in the group, i.e. those who have joined. */
  userIds: string[];
  /** Everyone with the value, joined or not. */
  total: number;
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** Groups with at least one person, largest first within each kind. People who have not joined count in `total` only. */
export function buildGroups(people: DirectoryPerson[], members: Member[]): PeopleGroup[] {
  const byEmail = new Map(members.map((m) => [norm(m.email), m.user_id]));
  const groups: PeopleGroup[] = [];

  for (const { field, label } of GROUP_FIELDS) {
    const found = new Map<string, { value: string; emails: Set<string>; total: number }>();
    for (const person of people) {
      const value = (person[field] ?? '').toString().trim();
      if (!value) continue;
      const key = value.toLowerCase();
      const entry = found.get(key) ?? { value, emails: new Set<string>(), total: 0 };
      entry.total += 1;
      const email = norm(person['Work Email']);
      if (email && byEmail.has(email)) entry.emails.add(email);
      found.set(key, entry);
    }
    const kindGroups = [...found.values()]
      .map((g) => ({
        id: `${label}|${g.value}`,
        kind: label,
        value: g.value,
        userIds: [...g.emails].map((e) => byEmail.get(e)!),
        total: g.total,
      }))
      .sort((a, b) => b.total - a.total || a.value.localeCompare(b.value));
    groups.push(...kindGroups);
  }
  return groups;
}

/** Everyone to invite: the chosen groups and the chosen individuals, without duplicates and without the creator. */
export function resolveInvitees(groups: PeopleGroup[], selectedGroupIds: string[], selectedUserIds: string[], creatorId?: string): string[] {
  const ids = new Set<string>(selectedUserIds);
  const chosen = new Set(selectedGroupIds);
  for (const g of groups) if (chosen.has(g.id)) g.userIds.forEach((id) => ids.add(id));
  if (creatorId) ids.delete(creatorId);
  return [...ids];
}

/** How many people in the chosen groups have no login yet (so cannot be added until they join). */
export function notJoinedCount(groups: PeopleGroup[], selectedGroupIds: string[]): number {
  const chosen = new Set(selectedGroupIds);
  return groups.filter((g) => chosen.has(g.id)).reduce((n, g) => n + (g.total - g.userIds.length), 0);
}
