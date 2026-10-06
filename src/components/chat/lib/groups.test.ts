import { describe, expect, it } from 'vitest';
import { buildGroups, notJoinedCount, resolveInvitees, type DirectoryPerson, type Member } from './groups';

const people: DirectoryPerson[] = [
  { 'Work Email': 'anna@acme.co', 'Job Level': 'Sales', 'Job Title': 'Rep', Town: 'Nairobi' },
  { 'Work Email': 'ben@acme.co', 'Job Level': 'sales ', 'Job Title': 'Manager', Town: 'Mombasa' },
  { 'Work Email': 'carl@acme.co', 'Job Level': 'Engineering', 'Job Title': 'Rep', Town: 'Nairobi' },
  { 'Work Email': 'dee@acme.co', 'Job Level': null, 'Job Title': '', Town: 'Nairobi' },
];
const members: Member[] = [
  { user_id: 'u-anna', email: 'Anna@Acme.co' },
  { user_id: 'u-carl', email: 'carl@acme.co' },
  { user_id: 'u-admin', email: 'admin@acme.co' }, // a login with no employee record
];

describe('buildGroups', () => {
  const groups = buildGroups(people, members);
  const find = (id: string) => groups.find((g) => g.id === id);

  it('groups by department, job title and town, ignoring blanks, case and stray spaces', () => {
    expect(find('Department|Sales')?.total).toBe(2);
    expect(find('Department|Engineering')?.total).toBe(1);
    expect(find('Job title|Rep')?.total).toBe(2);
    expect(find('Town|Nairobi')?.total).toBe(3);
    expect(groups.some((g) => g.value === '')).toBe(false);
  });

  it('lists only the people who have joined as invitable, matching email case-insensitively', () => {
    expect(find('Department|Sales')?.userIds).toEqual(['u-anna']);
    expect(find('Town|Nairobi')?.userIds.sort()).toEqual(['u-anna', 'u-carl']);
  });

  it('puts the larger groups first within a kind', () => {
    const towns = groups.filter((g) => g.kind === 'Town').map((g) => g.value);
    expect(towns).toEqual(['Nairobi', 'Mombasa']);
  });
});

describe('resolveInvitees', () => {
  const groups = buildGroups(people, members);

  it('combines groups and individuals without duplicates', () => {
    const ids = resolveInvitees(groups, ['Department|Sales', 'Town|Nairobi'], ['u-anna', 'u-admin']);
    expect(ids.sort()).toEqual(['u-admin', 'u-anna', 'u-carl']);
  });

  it('never includes the creator', () => {
    expect(resolveInvitees(groups, ['Town|Nairobi'], [], 'u-anna')).toEqual(['u-carl']);
  });

  it('is empty when nothing is chosen', () => {
    expect(resolveInvitees(groups, [], [])).toEqual([]);
  });
});

describe('notJoinedCount', () => {
  it('counts the people in the chosen groups who have no login yet', () => {
    const groups = buildGroups(people, members);
    expect(notJoinedCount(groups, ['Department|Sales'])).toBe(1); // ben
    expect(notJoinedCount(groups, [])).toBe(0);
  });
});
