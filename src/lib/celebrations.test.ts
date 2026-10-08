import { describe, expect, it } from 'vitest';
import { nextAnniversary, toDay, upcomingBirthdays, upcomingEventsAndHolidays, whenLabel } from './celebrations';

const today = new Date(2026, 9, 8); // Thu 8 Oct 2026

describe('upcomingBirthdays', () => {
  it('lists birthdays from today on, soonest first, and leaves out ones already past this year', () => {
    const list = upcomingBirthdays(
      [
        { name: 'Brian Rotich', dateOfBirth: '1990-10-11' },
        { name: 'Amina Hassan', dateOfBirth: '1995-10-08' },
        { name: 'Past One', dateOfBirth: '1988-10-01' },
        { name: 'No Date', dateOfBirth: null },
      ],
      today,
      30
    );
    expect(list.map((b) => [b.title, b.daysAway])).toEqual([['Amina Hassan', 0], ['Brian Rotich', 3]]);
  });

  it('wraps round the new year', () => {
    const dec = new Date(2026, 11, 20);
    expect(upcomingBirthdays([{ name: 'Jan Baby', dateOfBirth: '2000-01-05' }], dec, 30)[0].daysAway).toBe(16);
  });

  it('keeps a 29 February birthday on the 28th in other years', () => {
    expect(nextAnniversary(1, 29, today)).toEqual(new Date(2027, 1, 28));
    expect(nextAnniversary(1, 29, new Date(2027, 5, 1))).toEqual(new Date(2028, 1, 29));
  });
});

describe('upcomingEventsAndHolidays', () => {
  it('mixes events and holidays, skips past ones, and repeats recurring holidays every year', () => {
    const list = upcomingEventsAndHolidays(
      [
        { title: 'Staff party', date: '2026-10-20', description: 'At the farm' },
        { title: 'Old event', date: '2026-09-01' },
      ],
      [
        { name: 'Mashujaa Day', date: '2020-10-20', recurring: true },
        { name: 'One-off', date: '2025-10-10', recurring: false },
      ],
      today,
      30
    );
    expect(list.map((i) => [i.kind, i.title, i.daysAway])).toEqual([
      ['holiday', 'Mashujaa Day', 12],
      ['event', 'Staff party', 12],
    ]);
  });
});

describe('dates', () => {
  it('reads YYYY-MM-DD as that calendar day', () => {
    expect(toDay('2026-10-08')).toEqual(new Date(2026, 9, 8));
    expect(toDay('nonsense')).toBeNull();
  });
  it('labels today and tomorrow', () => {
    expect(whenLabel({ kind: 'event', title: 'x', date: today, daysAway: 0 })).toBe('Today');
    expect(whenLabel({ kind: 'event', title: 'x', date: today, daysAway: 1 })).toBe('Tomorrow');
  });
});
