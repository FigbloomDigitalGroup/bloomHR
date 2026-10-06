import { useMemo, useState } from 'react';
import type { DirectoryPerson, Member, PeopleGroup } from './lib/groups';

interface InvitePickerProps {
  groups: PeopleGroup[];
  members: Member[];
  people: DirectoryPerson[];
  selectedGroupIds: string[];
  selectedUserIds: string[];
  onGroupsChange: (ids: string[]) => void;
  onUsersChange: (ids: string[]) => void;
  /** People in the chosen groups who have not joined yet, so cannot be added. */
  notJoined?: number;
  disabled?: boolean;
}

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

/** Choose whole groups (a department, a job title, a town) and/or individual colleagues to add to a new channel. */
export function InvitePicker({ groups, members, people, selectedGroupIds, selectedUserIds, onGroupsChange, onUsersChange, notJoined = 0, disabled }: InvitePickerProps) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const nameByEmail = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of people) {
      const email = (p['Work Email'] ?? '').trim().toLowerCase();
      const name = `${p['First Name'] ?? ''} ${p['Last Name'] ?? ''}`.trim();
      if (email && name) map.set(email, name);
    }
    return map;
  }, [people]);

  const people_ = useMemo(
    () =>
      members
        .map((m) => ({ id: m.user_id, email: m.email, name: nameByEmail.get((m.email || '').toLowerCase()) || m.email }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [members, nameByEmail]
  );

  const shownGroups = groups.filter((g) => !q || `${g.kind} ${g.value}`.toLowerCase().includes(q));
  const shownPeople = people_.filter((p) => !q || `${p.name} ${p.email}`.toLowerCase().includes(q));

  return (
    <div className="space-y-2" role="group" aria-label="Add people">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search groups and people"
        aria-label="Search groups and people"
        className="w-full rounded-md border px-3 py-2 text-sm"
        disabled={disabled}
      />

      <div className="max-h-52 overflow-y-auto rounded-md border p-2 text-sm">
        {shownGroups.length > 0 && (
          <fieldset className="mb-2">
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Groups</legend>
            {shownGroups.map((g) => (
              <label key={g.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-secondary">
                <input type="checkbox" checked={selectedGroupIds.includes(g.id)} onChange={() => onGroupsChange(toggle(selectedGroupIds, g.id))} disabled={disabled} />
                <span className="flex-1">
                  <span className="text-muted-foreground">{g.kind}: </span>
                  {g.value}
                </span>
                <span className="text-xs text-muted-foreground">
                  {g.userIds.length} of {g.total} joined
                </span>
              </label>
            ))}
          </fieldset>
        )}

        <fieldset>
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">People</legend>
          {shownPeople.length === 0 && <p className="px-1 py-1 text-xs text-muted-foreground">{q ? 'No one matches.' : 'No colleagues have joined yet.'}</p>}
          {shownPeople.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-secondary">
              <input type="checkbox" checked={selectedUserIds.includes(p.id)} onChange={() => onUsersChange(toggle(selectedUserIds, p.id))} disabled={disabled} />
              <span className="flex-1">{p.name}</span>
              {p.name !== p.email && <span className="truncate text-xs text-muted-foreground">{p.email}</span>}
            </label>
          ))}
        </fieldset>
      </div>

      {notJoined > 0 && (
        <p className="text-xs text-muted-foreground">
          {notJoined === 1 ? '1 person in these groups has' : `${notJoined} people in these groups have`} not joined yet, so cannot be added until they sign up.
        </p>
      )}
    </div>
  );
}
