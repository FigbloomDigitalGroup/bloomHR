export interface BirthdayEmployee {
  'First Name'?: string | null;
  'Last Name'?: string | null;
  'Date of Birth'?: string | null;
}

export interface BirthdayPerson {
  name: string;
  /** The next time it falls, e.g. "Fri, Oct 9" (upcoming only). */
  date?: string;
}

const fullName = (e: BirthdayEmployee) => `${e['First Name'] ?? ''} ${e['Last Name'] ?? ''}`.trim();

/** Month and day of a stored date of birth, read from the text itself so the time zone cannot shift the day. */
function monthAndDay(value: string): { month: number; day: number } | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return { month: Number(iso[2]), day: Number(iso[3]) };
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : { month: parsed.getMonth() + 1, day: parsed.getDate() };
}

/**
 * Who has a birthday today, and who in the next `windowDays` days. A birthday just after New Year counts when
 * today is late December. People with no (or an unreadable) date of birth are skipped.
 */
export function findBirthdays(
  employees: BirthdayEmployee[],
  today: Date = new Date(),
  windowDays = 7
): { today: BirthdayPerson[]; upcoming: BirthdayPerson[] } {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + windowDays);

  const todays: BirthdayPerson[] = [];
  const soon: { person: BirthdayPerson; when: Date }[] = [];

  for (const employee of employees) {
    const dob = employee['Date of Birth'];
    const md = dob ? monthAndDay(dob) : null;
    const name = fullName(employee);
    if (!md || !name) continue;

    let when = new Date(start.getFullYear(), md.month - 1, md.day);
    if (when < start) when = new Date(start.getFullYear() + 1, md.month - 1, md.day);

    if (when.getTime() === start.getTime()) {
      todays.push({ name });
    } else if (when <= end) {
      soon.push({
        person: { name, date: when.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) },
        when,
      });
    }
  }

  soon.sort((a, b) => a.when.getTime() - b.when.getTime());
  return { today: todays, upcoming: soon.map((s) => s.person) };
}
