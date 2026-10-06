import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { InvitePicker } from './InvitePicker';
import { buildGroups, type DirectoryPerson, type Member } from './lib/groups';

const people: DirectoryPerson[] = [
  { 'Work Email': 'anna@acme.co', 'First Name': 'Anna', 'Last Name': 'Wanjiru', 'Job Level': 'Sales' },
  { 'Work Email': 'ben@acme.co', 'First Name': 'Ben', 'Last Name': 'Otieno', 'Job Level': 'Sales' },
];
const members: Member[] = [
  { user_id: 'u-anna', email: 'anna@acme.co' },
  { user_id: 'u-admin', email: 'admin@acme.co' },
];

const setup = (extra = {}) => {
  const onGroupsChange = vi.fn();
  const onUsersChange = vi.fn();
  render(
    <InvitePicker
      groups={buildGroups(people, members)}
      members={members}
      people={people}
      selectedGroupIds={[]}
      selectedUserIds={[]}
      onGroupsChange={onGroupsChange}
      onUsersChange={onUsersChange}
      {...extra}
    />
  );
  return { onGroupsChange, onUsersChange };
};

afterEach(() => cleanup());

describe('InvitePicker', () => {
  it('offers groups with how many have joined, and colleagues by name (email when there is no employee record)', () => {
    setup();
    expect(screen.getByText('Sales')).toBeTruthy();
    expect(screen.getByText('1 of 2 joined')).toBeTruthy();
    expect(screen.getByText('Anna Wanjiru')).toBeTruthy();
    expect(screen.getByText('admin@acme.co')).toBeTruthy();
  });

  it('choosing a group or a person reports it', () => {
    const { onGroupsChange, onUsersChange } = setup();
    fireEvent.click(screen.getByRole('checkbox', { name: /Department: Sales/ }));
    expect(onGroupsChange).toHaveBeenCalledWith(['Department|Sales']);
    fireEvent.click(screen.getByRole('checkbox', { name: /Anna Wanjiru/ }));
    expect(onUsersChange).toHaveBeenCalledWith(['u-anna']);
  });

  it('search narrows the lists', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Search groups and people'), { target: { value: 'admin' } });
    expect(screen.queryByText('Anna Wanjiru')).toBeNull();
    expect(screen.getByText('admin@acme.co')).toBeTruthy();
    expect(screen.queryByText('Sales')).toBeNull();
  });

  it('says when chosen groups include people who have not joined', () => {
    setup({ notJoined: 1 });
    expect(screen.getByText(/1 person in these groups has not joined yet/)).toBeTruthy();
  });
});
