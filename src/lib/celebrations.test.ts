import { describe, expect, it } from 'vitest';
import { birthdayMonthDay, nextAnniversary, toDay, upcomingBirthdays, upcomingEventsAndHolidays, whenLabel } from './celebrations';

const today = new Date(2026, 9, 8); // Thu 8 Oct 2026

describe('upcomingBirthdays', () => {
  it('lists birthdays from today on, soonest first, and leaves out ones already past this year', () => {
    const list = upcomingBirthdays(
      [
        { name: 'Brian Rotich', birthday: '10-11' },
        { name: 'Amina Hassan', birthday: '10-08' },
        { name: 'Past One', birthday: '10-01' },
        { name: 'No Date', birthday: null },
      ],
      today,
      30
    );
    expect(list.map((b) => [b.title, b.daysAway])).toEqual([['Amina Hassan', 0], ['Brian Rotich', 3]]);
  });

  it('wraps round the new year', () => {
    const dec = new Date(2026, 11, 20);
    expect(upcomingBirthdays([{ name: 'Jan Baby', birthday: '01-05' }], dec, 30)[0].daysAway).toBe(16);
  });

  it('keeps a 29 February birthday on the 28th in other years', () => {
    expect(nextAnniversary(1, 29, today)).toEqual(new Date(2027, 1, 28));
    expect(nextAnniversary(1, 29, new Date(2027, 5, 1))).toEqual(new Date(2028, 1, 29));
    const [leapling] = upcomingBirthdays([{ name: 'Leap Day', birthday: '02-29' }], new Date(2027, 1, 20), 30);
    expect([leapling.date, leapling.daysAway]).toEqual([new Date(2027, 1, 28), 8]);
  });

  it('still reads a full date of birth', () => {
    expect(upcomingBirthdays([{ name: 'Old Format', birthday: '1990-10-11' }], today, 30)[0].daysAway).toBe(3);
  });
});

describe('birthdayMonthDay', () => {
  it("reads 'MM-DD' (no year) and full dates, and rejects nonsense", () => {
    expect(birthdayMonthDay('11-20')).toEqual({ month: 10, day: 20 });
    expect(birthdayMonthDay('02-29')).toEqual({ month: 1, day: 29 });
    expect(birthdayMonthDay('1990-11-20')).toEqual({ month: 10, day: 20 });
    expect(birthdayMonthDay('13-01')).toBeNull();
    expect(birthdayMonthDay('00-10')).toBeNull();
    expect(birthdayMonthDay('')).toBeNull();
    expect(birthdayMonthDay(null)).toBeNull();
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
