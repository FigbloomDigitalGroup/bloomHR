import { describe, expect, it } from 'vitest';
import { findBirthdays } from './birthdays';

const emp = (first: string, last: string, dob: string | null) => ({ 'First Name': first, 'Last Name': last, 'Date of Birth': dob });
const on = (y: number, m: number, d: number) => new Date(y, m - 1, d, 10, 30);

describe('findBirthdays', () => {
  it('finds today and the next seven days, whatever year they were born', () => {
    const r = findBirthdays(
      [emp('Amina', 'Otieno', '1990-10-06'), emp('Brian', 'Kamau', '1985-10-09'), emp('Cate', 'Wanjiru', '2000-10-13'), emp('Dan', 'Mwangi', '1992-10-14')],
      on(2026, 10, 6)
    );
    expect(r.today).toEqual([{ name: 'Amina Otieno' }]);
    expect(r.upcoming.map((p) => p.name)).toEqual(['Brian Kamau', 'Cate Wanjiru']); // Dan is 8 days away
    expect(r.upcoming[0].date).toBe('Fri, Oct 9');
  });

  it('is empty for a new company with no employees, or none with dates of birth', () => {
    expect(findBirthdays([], on(2026, 10, 6))).toEqual({ today: [], upcoming: [] });
    expect(findBirthdays([emp('A', 'B', null), emp('C', 'D', 'not a date')], on(2026, 10, 6))).toEqual({ today: [], upcoming: [] });
  });

  it('sorts upcoming birthdays by date, soonest first', () => {
    const r = findBirthdays([emp('Late', 'One', '1990-10-12'), emp('Early', 'One', '1990-10-07')], on(2026, 10, 6));
    expect(r.upcoming.map((p) => p.name)).toEqual(['Early One', 'Late One']);
  });

  it('counts a birthday just after New Year when today is late December', () => {
    const r = findBirthdays([emp('New', 'Year', '1995-01-02')], on(2026, 12, 28));
    expect(r.upcoming.map((p) => p.name)).toEqual(['New Year']);
  });

  it('does not show a birthday that has already passed this year', () => {
    expect(findBirthdays([emp('Past', 'One', '1990-10-05')], on(2026, 10, 6))).toEqual({ today: [], upcoming: [] });
  });

  it('reads the day from the stored text, so the time zone cannot move it', () => {
    const r = findBirthdays([emp('Edge', 'Case', '1990-10-06')], on(2026, 10, 6));
    expect(r.today.map((p) => p.name)).toEqual(['Edge Case']);
  });

  it('skips people with no name', () => {
    expect(findBirthdays([emp('', '', '1990-10-06')], on(2026, 10, 6)).today).toEqual([]);
  });
});
