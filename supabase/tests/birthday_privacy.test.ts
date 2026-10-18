// @vitest-environment node
//
// Birthdays without the year, migration 20261020700000: colleagues read each other's birthday (day and month) from
// employee_directory, never the year they were born; HR still reads the full date of birth from employees.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const STAFF = '00000000-0000-0000-0000-00000000bd01'; // E-ME
const HR = '00000000-0000-0000-0000-00000000bd02';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const migration = (file: string) => readFileSync(join(__dirname, '..', 'migrations', file), 'utf8');

type Dir = { n: string; dob: string | null; birthday: string | null };
const directory = () =>
  asUser(db, STAFF, () => rows<Dir>(`select "Employee Number" n, "Date of Birth" dob, birthday from employee_directory order by 1`));
const columns = async () =>
  (await rows<{ column_name: string; data_type: string }>(
    `select column_name, data_type from information_schema.columns
     where table_schema = 'public' and table_name = 'employee_directory' order by ordinal_position`
  )).map((c) => `${c.column_name}:${c.data_type}`);

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${STAFF}', 'me@a.co'), ('${HR}', 'hr@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${STAFF}', 'me@a.co', 'STAFF', '${A}'), ('${HR}', 'hr@a.co', 'HR', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('STAFF', array['dashboard'], '${A}'), ('HR', array['employees'], '${A}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Date of Birth", tenant_id) values
      ('E-1', 'Me',    'Staff', 'me@a.co',    '1990-11-20', '${A}'),
      ('E-2', 'Leap',  'Day',   'leap@a.co',  '1992-02-29', '${A}'),
      ('E-3', 'Slash', 'Date',  'slash@a.co', '05/03/1985', '${A}'),
      ('E-4', 'No',    'Date',  'none@a.co',  null,         '${A}'),
      ('E-5', 'Bad',   'Date',  'bad@a.co',   'sometime',   '${A}');
  `);
}, 120000);

const EXPECTED: Dir[] = [
  { n: 'E-1', dob: null, birthday: '11-20' },
  { n: 'E-2', dob: null, birthday: '02-29' },
  { n: 'E-3', dob: null, birthday: '03-05' },
  { n: 'E-4', dob: null, birthday: null },
  { n: 'E-5', dob: null, birthday: null },
];

describe('employee_directory', () => {
  it('gives a staff member every birthday as MM-DD, and never the year', async () => {
    expect(await directory()).toEqual(EXPECTED);
  });

  it('keeps every column in place ("Date of Birth" still text), with birthday added last', async () => {
    const cols = await columns();
    expect(cols).toContain('Date of Birth:text');
    expect(cols[cols.length - 1]).toBe('birthday:text');
    expect(cols.indexOf('Date of Birth:text')).toBe(cols.indexOf('Start Date:text') - 1);
  });
});

describe('employees', () => {
  it('HR still reads the full date of birth', async () => {
    const r = await asUser(db, HR, () =>
      rows<{ n: string; dob: string | null }>(`select "Employee Number" n, "Date of Birth" dob from employees order by 1`));
    expect(r.slice(0, 3)).toEqual([
      { n: 'E-1', dob: '1990-11-20' },
      { n: 'E-2', dob: '1992-02-29' },
      { n: 'E-3', dob: '05/03/1985' },
    ]);
  });

  it('a staff member still cannot read a colleague’s full date of birth from employees', async () => {
    const r = await asUser(db, STAFF, () => rows<{ n: string }>(`select "Employee Number" n from employees where "Date of Birth" is not null`));
    expect(r.map((x) => x.n)).toEqual(['E-1']); // only their own row
  });
});

describe('running the migrations again', () => {
  it('this one is safe and changes nothing', async () => {
    const before = await columns();
    await db.exec(migration('20261020700000_birthday_privacy.sql'));
    await db.exec('reset search_path');
    expect(await columns()).toEqual(before);
    expect(await directory()).toEqual(EXPECTED);
  });

  it('the KPI templates migration, which also defined the view, neither fails nor brings the year back', async () => {
    const before = await columns();
    await db.exec(migration('20261019300000_kpi_templates.sql'));
    await db.exec('reset search_path');
    expect(await columns()).toEqual(before);
    expect(await directory()).toEqual(EXPECTED);
  });
});
