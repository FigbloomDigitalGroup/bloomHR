// @vitest-environment node
//
// Public holidays by country (FIG-884): Kenya's worked out for any year (Easter moves; a holiday on a Sunday gives the
// Monday too), added for every company and for new companies, and by HR for another year; leave counting skips them.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const NEW = '00000000-0000-0000-0000-0000000000c7';
const HR = '00000000-0000-0000-0000-00000000f401';
const STAFF = '00000000-0000-0000-0000-00000000f402';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const run = async (sql: string) => {
  try {
    await db.query(sql);
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};
const list = async (country: string, year: number) =>
  (await rows<{ name: string; holiday: string }>(`select name, holiday::text from public_holidays_for('${country}', ${year}) order by holiday, name`));

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${HR}', 'hr@a.co'), ('${STAFF}', 'me@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${STAFF}', 'me@a.co', 'STAFF', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values ('HR', array['leaves'], '${A}'), ('STAFF', array['dashboard'], '${A}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", tenant_id) values ('ME', 'Mia', 'Me', 'me@a.co', '${A}');
  `);
}, 120000);

describe("Kenya's public holidays", () => {
  it('works out Easter for any year', async () => {
    const easter = async (y: number) => (await rows<{ d: string }>(`select easter_sunday(${y})::text d`))[0].d;
    expect(await easter(2024)).toBe('2024-03-31');
    expect(await easter(2025)).toBe('2025-04-20');
    expect(await easter(2026)).toBe('2026-04-05');
    expect(await easter(2027)).toBe('2027-03-28');
    expect(await easter(2030)).toBe('2030-04-21');
  });

  it('lists the year, Good Friday and Easter Monday with it', async () => {
    const y2026 = await list('Kenya', 2026);
    expect(y2026.map((h) => h.name)).toEqual([
      "New Year's Day", 'Good Friday', 'Easter Monday', 'Labour Day', 'Madaraka Day', 'Mazingira Day', 'Mashujaa Day',
      'Jamhuri Day', 'Christmas Day', 'Boxing Day',
    ]);
    expect(y2026.find((h) => h.name === 'Good Friday')?.holiday).toBe('2026-04-03');
    expect(y2026.find((h) => h.name === 'Easter Monday')?.holiday).toBe('2026-04-06');
  });

  it('a holiday on a Sunday gives the Monday too (and Boxing Day on a Sunday the Monday after)', async () => {
    const y2027 = await list('Kenya', 2027);
    expect(y2027.filter((h) => h.name.endsWith('(observed)'))).toEqual([
      { name: 'Mazingira Day (observed)', holiday: '2027-10-11' },
      { name: 'Jamhuri Day (observed)', holiday: '2027-12-13' },
      { name: 'Boxing Day (observed)', holiday: '2027-12-27' },
    ]);
  });

  it('countries without a list yet (Tanzania and Uganda have theirs since FIG-905): none', async () => {
    expect(await list('Rwanda', 2026)).toEqual([]);
  });
});

describe("each company's list", () => {
  it('every company has this year and next; a new company gets them when it is created', async () => {
    const y = new Date().getFullYear();
    const count = async (tenant: string, year: number) =>
      Number((await rows<{ n: string }>(`select count(*) n from holidays where tenant_id = '${tenant}' and source = 'auto' and extract(year from date) = ${year}`))[0].n);
    expect(await count(A, y)).toBeGreaterThanOrEqual(10);
    expect(await count(A, y + 1)).toBeGreaterThanOrEqual(10);
    await db.exec(`insert into tenants (id, name, slug) values ('${NEW}', 'New Co', 'new-co')`);
    expect(await count(NEW, y)).toBeGreaterThanOrEqual(10);
  });

  it('HR adds another year; again adds nothing; a day already on the list is left alone; staff cannot', async () => {
    await db.exec(`insert into holidays (tenant_id, name, date, recurring) values ('${A}', 'Our own New Year', '2030-01-01', false)`);
    const added = (await asUser(db, HR, () => rows<{ n: number }>(`select add_public_holidays(2030) n`)))[0].n;
    expect(added).toBe(10); // the 10, plus Mashujaa Day (observed) on Mon 21 Oct, less New Year's Day
    expect((await asUser(db, HR, () => rows<{ n: number }>(`select add_public_holidays(2030) n`)))[0].n).toBe(0);
    expect((await rows<{ name: string }>(`select name from holidays where tenant_id = '${A}' and date = '2030-01-01'`)).map((r) => r.name)).toEqual(['Our own New Year']);
    expect(await asUser(db, STAFF, () => run(`select add_public_holidays(2031)`))).toMatch(/Only people who run leave/);
  });

  it('leave counting skips Good Friday and Easter Monday', async () => {
    // Mon 15 to Mon 22 April 2030: 6 working days, less Good Friday (19th) and Easter Monday (22nd)
    expect(Number((await rows<{ n: string }>(`select leave_days_for('${A}', 'ME', '2030-04-15', '2030-04-22', false) n`))[0].n)).toBe(4);
  });

  it('the Holidays tab is told the country and whether its holidays are known', async () => {
    const c = (await asUser(db, HR, () => rows<{ c: { country: string; supported: boolean } }>(`select public_holidays_country() c`)))[0].c;
    expect(c).toEqual({ country: 'Kenya', supported: true, countries: [{ country: 'Kenya', supported: true }] });
  });
});
