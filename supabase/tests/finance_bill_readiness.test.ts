// @vitest-environment node
//
// Finance Bill readiness (FIG-813, migration 20261021800000_finance_bill_readiness.sql): the per diem share and
// Kenya's NSSF year 2 limits as dated rates, platform admins (only they add platform rates, through add_platform_rate:
// validated, refused when backdated into an approved month unless confirmed, audited), the rates each draft country
// was worked out with and the stale-draft check (approval refused until recalculated; approved countries untouched),
// company isolation, and running the migration again.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';
import { PLATFORM_RATE_ROWS } from '../../src/lib/payroll/platformRateRows';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000b0813';
const PAY = '00000000-0000-0000-0000-00000000f801'; // payroll at A
const STAFF = '00000000-0000-0000-0000-00000000f802';
const PLAT = '00000000-0000-0000-0000-00000000f803'; // a Figbloom platform admin (a plain staff member of A)
const PLAT2 = '00000000-0000-0000-0000-00000000f804';
const OTHER = '00000000-0000-0000-0000-00000000f805'; // payroll at B

const MIGRATION = join(__dirname, '..', 'migrations', '20261021800000_finance_bill_readiness.sql');

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const as = (user: string, sql: string) => asUser(db, user, () => db.exec(sql));
const read = <T = Record<string, unknown>>(user: string, sql: string) => asUser(db, user, () => rows<T>(sql));

const slip = (emp: string, period: string) =>
  `insert into salary_history (employee_id, employee_name, pay_period, gross_pay, net_pay, tenant_id) values ('${emp}', '${emp}', '${period}', 100000, 80000, '${A}')`;
const runOf = async (period: string) => (await rows<{ id: string }>(`select id from payroll_runs where tenant_id = '${A}' and pay_period = '${period}'`))[0].id;
const setKenya = async (period: string, status: string) =>
  as(PAY, `update payroll_run_countries set status = '${status}' where run_id = '${await runOf(period)}' and country = 'Kenya'`);
const kenyaOn = async (day: string) =>
  (await read<{ r: Record<string, unknown> }>(PAY, `select statutory_rates_on('${day}', 'Kenya') r`))[0].r;
/** What the payroll page does after saving a run: records the rates it worked each country out with (as JSON from the client). */
const recordRates = async (user: string, period: string, rates: Record<string, unknown>) =>
  read<{ done: string[] }>(user, `select record_payroll_rates('${await runOf(period)}', '${JSON.stringify({ Kenya: rates }).replace(/'/g, "''")}'::jsonb) done`);
const stale = async (user: string, period: string) =>
  (await read<{ c: string }>(user, `select payroll_stale_countries('${await runOf(period)}') c`)).map((r) => r.c);
const addRate = (user: string, args: string) => as(user, `select add_platform_rate(${args})`);

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'B Co', 'b-co-813');
    insert into auth.users (id, email) values ('${PAY}', 'pay@a.co'), ('${STAFF}', 'staff@a.co'), ('${PLAT}', 'ops@figbloom.org'),
      ('${PLAT2}', 'ops2@figbloom.org'), ('${OTHER}', 'pay@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${PAY}', 'pay@a.co', 'FINANCE', '${A}'), ('${STAFF}', 'staff@a.co', 'STAFF', '${A}'), ('${PLAT}', 'ops@figbloom.org', 'STAFF', '${A}'),
      ('${PLAT2}', 'ops2@figbloom.org', 'STAFF', '${A}'), ('${OTHER}', 'pay@b.co', 'FINANCE', '${B}');
    delete from role_permissions where tenant_id = '${B}';
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('FINANCE', array['work-records', 'payroll'], '${A}'), ('STAFF', array['dashboard'], '${A}'), ('FINANCE', array['work-records', 'payroll'], '${B}');
    insert into employees ("Employee Number", "First Name", "Work Email", worker_kind, onboarding_status, tenant_id) values
      ('K1', 'Kerubo', 'k1@a.co', 'employee', 'approved', '${A}');
  `);
}, 120000);

describe('the rates the migration adds', () => {
  it('are the rows the per-Finance-Act tests pin (src/lib/payroll/platformRateRows.ts)', async () => {
    const key = (r: { country: string; code: string; effective_from: string }) => `${r.country}|${r.code}|${r.effective_from}`;
    const db_ = await rows<{ country: string; code: string; value: string | null; bands: unknown; effective_from: string; effective_to: string | null }>(
      `select country, code, value::text, bands, effective_from::text, effective_to::text from statutory_rates where tenant_id is null`
    );
    const asData = (r: { country: string; code: string; value: string | number | null; bands: unknown; effective_from: string; effective_to: string | null }) => ({
      country: r.country, code: r.code, value: r.value === null ? null : Number(r.value), bands: r.bands, effective_from: r.effective_from, effective_to: r.effective_to,
    });
    expect(db_.map(asData).sort((a, b) => key(a).localeCompare(key(b)))).toEqual(
      PLATFORM_RATE_ROWS.map((r) => asData({ ...r })).sort((a, b) => key(a).localeCompare(key(b)))
    );
  });

  it('keeps the per diem at 33% of basic as a dated default a company can change', async () => {
    expect((await kenyaOn('2026-10-31')).per_diem_rate).toBe(0.33);
    expect((await kenyaOn('2001-01-31')).per_diem_rate).toBe(0.33);
    await as(PAY, `insert into statutory_rates (tenant_id, country, code, value, effective_from) values ('${A}', 'Kenya', 'per_diem_rate', 0, '2030-01-01')`);
    expect((await kenyaOn('2030-01-31')).per_diem_rate).toBe(0);
    expect((await read<{ r: Record<string, unknown> }>(OTHER, `select statutory_rates_on('2030-01-31', 'Kenya') r`))[0].r.per_diem_rate).toBe(0.33);
    await db.exec(`delete from statutory_rates where tenant_id = '${A}' and code = 'per_diem_rate'`);
  });

  it("gives Kenya's NSSF year 2 (Feb 2024 to Jan 2025) its earnings limits", async () => {
    const y2 = await kenyaOn('2024-06-30');
    expect([y2.nssf_lower_limit, y2.nssf_upper_limit]).toEqual([7000, 36000]);
    const y3 = await kenyaOn('2025-06-30');
    expect([y3.nssf_lower_limit, y3.nssf_upper_limit]).toEqual([8000, 72000]);
    expect((await kenyaOn('2024-01-31')).nssf_upper_limit).toBeUndefined();
  });
});

describe('platform admins', () => {
  it('starts with none, and nobody signed in makes themselves one', async () => {
    expect(await rows(`select * from platform_admins`)).toEqual([]);
    expect((await read<{ ok: boolean }>(PAY, `select is_platform_admin() ok`))[0].ok).toBe(false);
    await expect(as(PAY, `select grant_platform_admin('${PAY}')`)).rejects.toThrow(/Only a platform admin can add a platform admin/);
    await expect(as(PAY, `insert into platform_admins (user_id) values ('${PAY}')`)).rejects.toThrow(/permission denied/);
  });

  it('are added from the SQL editor or by the service role, then by each other', async () => {
    await db.exec(`select grant_platform_admin('${PLAT}', 'Figbloom payroll ops')`);
    expect((await read<{ ok: boolean }>(PLAT, `select is_platform_admin() ok`))[0].ok).toBe(true);
    await as(PLAT, `select grant_platform_admin('${PLAT2}')`);
    const list = await read<{ user_id: string; added_by: string | null }>(PLAT, `select user_id, added_by from platform_admins order by added_at, user_id`);
    expect(list).toEqual(expect.arrayContaining([{ user_id: PLAT, added_by: null }, { user_id: PLAT2, added_by: PLAT }]));
    // someone else sees no list
    expect(await read(PAY, `select * from platform_admins`)).toEqual([]);
    await as(PLAT, `select revoke_platform_admin('${PLAT2}')`);
    expect((await read<{ ok: boolean }>(PLAT2, `select is_platform_admin() ok`))[0].ok).toBe(false);
  });
});

describe('adding a platform rate', () => {
  it('only a platform admin can, never directly', async () => {
    await expect(addRate(PAY, `'Kenya', 'ahl_rate', 0.02, null, '2031-07-01', 'Finance Act 2031'`)).rejects.toThrow(/Only a platform admin/);
    await expect(as(PAY, `insert into statutory_rates (tenant_id, country, code, value, effective_from) values (null, 'Kenya', 'new_levy_rate', 0.02, '2031-07-01')`)).rejects.toThrow(
      /row-level security/
    );
    await expect(as(PLAT, `insert into statutory_rates (tenant_id, country, code, value, effective_from) values (null, 'Kenya', 'new_levy_rate', 0.02, '2031-07-01')`)).rejects.toThrow(
      /row-level security/
    );
  });

  it('starts a new version from its date; earlier months keep theirs; audited', async () => {
    await addRate(PLAT, `'kenya', 'ahl_rate', 0.02, null, '2031-07-01', 'Finance Act 2031 s.12'`);
    expect((await kenyaOn('2031-06-30')).ahl_rate).toBe(0.015);
    expect((await kenyaOn('2031-07-31')).ahl_rate).toBe(0.02);
    const versions = await rows<{ effective_from: string; effective_to: string | null; value: string }>(
      `select effective_from::text, effective_to::text, value::text from statutory_rates where tenant_id is null and code = 'ahl_rate' order by effective_from`
    );
    expect(versions).toEqual([
      { effective_from: '2024-03-19', effective_to: '2031-06-30', value: '0.015' },
      { effective_from: '2031-07-01', effective_to: null, value: '0.02' },
    ]);
    const audit = await read<{ action: string; performed_by: string }>(PLAT, `select action, performed_by from platform_rate_changes where code = 'ahl_rate' order by action`);
    expect(audit).toEqual([
      { action: 'INSERT', performed_by: PLAT },
      { action: 'UPDATE', performed_by: PLAT },
    ]);
    expect(await read(PAY, `select * from platform_rate_changes`)).toEqual([]);
  });

  it("leaves a company's own rate on top", async () => {
    await as(PAY, `insert into statutory_rates (tenant_id, country, code, value, effective_from) values ('${A}', 'Kenya', 'ahl_rate', 0.01, '2031-01-01')`);
    expect((await kenyaOn('2031-07-31')).ahl_rate).toBe(0.01);
    expect((await read<{ r: Record<string, unknown> }>(OTHER, `select statutory_rates_on('2031-07-31', 'Kenya') r`))[0].r.ahl_rate).toBe(0.02);
    await db.exec(`delete from statutory_rates where tenant_id = '${A}' and code = 'ahl_rate'`);
  });

  it('a version entered before a later one ends the day before it; one on the same day is corrected in place', async () => {
    await addRate(PLAT, `'Kenya', 'ahl_rate', 0.018, null, '2031-04-01', 'Correction notice'`);
    const versions = await rows<{ f: string; t: string | null }>(
      `select effective_from::text f, effective_to::text t from statutory_rates where tenant_id is null and code = 'ahl_rate' order by effective_from`
    );
    expect(versions).toEqual([
      { f: '2024-03-19', t: '2031-03-31' },
      { f: '2031-04-01', t: '2031-06-30' },
      { f: '2031-07-01', t: null },
    ]);
    await addRate(PLAT, `'Kenya', 'ahl_rate', 0.0175, null, '2031-04-01', 'Correction notice (fixed)'`);
    expect((await kenyaOn('2031-04-30')).ahl_rate).toBe(0.0175);
    expect((await rows<{ n: number }>(`select count(*)::int n from statutory_rates where tenant_id is null and code = 'ahl_rate'`))[0].n).toBe(3);
  });

  it('adds bands for a country, checked', async () => {
    const bands = `'[{"upto": 400000, "rate": 0}, {"upto": 500000, "rate": 0.2}, {"upto": null, "rate": 0.3}]'::jsonb`;
    await addRate(PLAT, `'Uganda', 'paye_bands', null, ${bands}, '2032-07-01', 'Income Tax (Amendment) Act 2032'`);
    const ug = await read<{ r: { paye_bands: { upto: number | null }[] } }>(PAY, `select statutory_rates_on('2032-07-31', 'Uganda') r`);
    expect(ug[0].r.paye_bands[0].upto).toBe(400000);
    const before = await read<{ r: { paye_bands: { upto: number | null }[] } }>(PAY, `select statutory_rates_on('2032-06-30', 'Uganda') r`);
    expect(before[0].r.paye_bands[0].upto).toBe(335000);
  });

  it('refuses rates out of range, bands that do not go up, and no source', async () => {
    await expect(addRate(PLAT, `'Kenya', 'shif_rate', 2.75, null, '2033-01-01', 'x'`)).rejects.toThrow(/between 0 and 1/);
    await expect(addRate(PLAT, `'Kenya', 'personal_relief', -1, null, '2033-01-01', 'x'`)).rejects.toThrow(/below 0/);
    await expect(addRate(PLAT, `'Kenya', 'shif_deductible', 2, null, '2033-01-01', 'x'`)).rejects.toThrow(/1 \(yes\) or 0 \(no\)/);
    await expect(
      addRate(PLAT, `'Kenya', 'paye_bands', null, '[{"upto": 30000, "rate": 0.1}, {"upto": 24000, "rate": 0.25}, {"upto": null, "rate": 0.3}]'::jsonb, '2033-01-01', 'x'`)
    ).rejects.toThrow(/above the one before/);
    await expect(addRate(PLAT, `'Kenya', 'paye_bands', null, '[{"upto": 24000, "rate": 0.1}, {"upto": 50000, "rate": 0.3}]'::jsonb, '2033-01-01', 'x'`)).rejects.toThrow(
      /leave its "up to" empty/
    );
    await expect(addRate(PLAT, `'Kenya', 'paye_bands', null, '[{"upto": null, "rate": 1.3}]'::jsonb, '2033-01-01', 'x'`)).rejects.toThrow(/between 0 and 1/);
    await expect(addRate(PLAT, `'Kenya', 'shif_rate', 0.03, null, '2033-01-01', ' '`)).rejects.toThrow(/where the rate comes from/);
    await expect(addRate(PLAT, `'Kenya', 'shif_rate', 0.03, '[]'::jsonb, '2033-01-01', 'x'`)).rejects.toThrow(/either a value or bands/);
    expect((await read<{ p: string[] }>(PAY, `select platform_rate_problems('nssf_rate', 0.06, null) p`))[0].p).toEqual([]);
  });

  it('asks for confirmation before reaching back into an approved month', async () => {
    await as(PAY, slip('K1', '2031-10'));
    await setKenya('2031-10', 'approved');
    expect((await read<{ m: string }>(PLAT, `select platform_latest_approved_month('Kenya') m`))[0].m).toBe('2031-10');
    await expect(read(PAY, `select platform_latest_approved_month('Kenya')`)).rejects.toThrow(/Only a platform admin/);
    await expect(addRate(PLAT, `'Kenya', 'nita_levy', 100, null, '2031-09-01', 'NITA notice'`)).rejects.toThrow(/2031-10 is already approved.*Confirm/);
    await addRate(PLAT, `'Kenya', 'nita_levy', 100, null, '2031-09-01', 'NITA notice', true`);
    expect((await kenyaOn('2031-09-30')).nita_levy).toBe(100);
    // after the approved month: no question
    await addRate(PLAT, `'Kenya', 'nita_levy', 150, null, '2031-11-01', 'NITA notice 2'`);
    // the approved month's payslip is as it was
    expect((await rows<{ n: string }>(`select net_pay::text n from salary_history where employee_id = 'K1' and pay_period = '2031-10'`))[0].n).toBe('80000');
  });
});

describe('a draft worked out before the rates changed', () => {
  it('is not stale while the rates it used are still the ones in force', async () => {
    await as(PAY, slip('K1', '2032-02'));
    const used = await kenyaOn('2032-02-29');
    expect((await recordRates(PAY, '2032-02', used))[0].done).toEqual(['Kenya']);
    expect(await stale(PAY, '2032-02')).toEqual([]);
  });

  it('is stale once a new rate starts on or before its month, and cannot be approved until recalculated', async () => {
    await addRate(PLAT, `'Kenya', 'shif_rate', 0.03, null, '2032-02-01', 'SHA notice'`);
    expect(await stale(PAY, '2032-02')).toEqual(['Kenya']);
    await expect(setKenya('2032-02', 'approved')).rejects.toThrow(/statutory rates for Kenya changed after payroll for 2032-02 was worked out. Recalculate, then approve/);
    // recalculated with the new rates
    await recordRates(PAY, '2032-02', await kenyaOn('2032-02-29'));
    expect(await stale(PAY, '2032-02')).toEqual([]);
    await setKenya('2032-02', 'approved');
  });

  it('a rate starting after the month leaves it alone', async () => {
    await as(PAY, slip('K1', '2032-03'));
    await recordRates(PAY, '2032-03', await kenyaOn('2032-03-31'));
    await addRate(PLAT, `'Kenya', 'personal_relief', 2600, null, '2032-04-01', 'Finance Act 2032'`);
    expect(await stale(PAY, '2032-03')).toEqual([]);
  });

  it("a company's own new rate makes it stale too", async () => {
    await as(PAY, `insert into statutory_rates (tenant_id, country, code, value, effective_from) values ('${A}', 'Kenya', 'per_diem_rate', 0.2, '2032-03-01')`);
    expect(await stale(PAY, '2032-03')).toEqual(['Kenya']);
  });

  it('an approved or paid month never changes and is never flagged', async () => {
    const before = await rows(`select * from salary_history where pay_period = '2032-02' order by id`);
    await addRate(PLAT, `'Kenya', 'shif_rate', 0.035, null, '2032-02-15', 'SHA notice 2', true`);
    expect(await stale(PAY, '2032-02')).toEqual([]);
    expect(await rows(`select * from salary_history where pay_period = '2032-02' order by id`)).toEqual(before);
    // reopened: it was worked out with older rates, so it must be recalculated before approving again
    await setKenya('2032-02', 'draft');
    expect(await stale(PAY, '2032-02')).toEqual(['Kenya']);
  });

  it('records rates only for draft countries, and only payroll does', async () => {
    await setKenya('2032-02', 'approved').catch(() => undefined);
    expect((await recordRates(PAY, '2031-10', await kenyaOn('2031-10-31')))[0].done).toEqual([]);
    await expect(recordRates(STAFF, '2032-03', {})).rejects.toThrow(/Only payroll/);
    await expect(as(PAY, `insert into payroll_run_rates (run_id, country, rates) values ('${await runOf('2032-03')}', 'Kenya', '{}')`)).rejects.toThrow(/permission denied/);
  });
});

describe('company isolation', () => {
  it("another company neither sees nor records this company's run rates", async () => {
    expect(await read(OTHER, `select * from payroll_run_rates`)).toEqual([]);
    expect(await stale(OTHER, '2032-03')).toEqual([]);
    await expect(recordRates(OTHER, '2032-03', {})).rejects.toThrow(/No such payroll run/);
    expect((await read<{ n: number }>(PAY, `select count(*)::int n from payroll_run_rates`))[0].n).toBeGreaterThan(0);
  });

  it('nobody signed in calls the internal helpers', async () => {
    await expect(read(PAY, `select statutory_rates_for('${B}', '2032-01-31', 'Kenya')`)).rejects.toThrow(/permission denied/);
    await expect(read(PAY, `select payroll_country_rates_stale('${await runOf('2032-03')}', 'Kenya')`)).rejects.toThrow(/permission denied/);
    await expect(read(PAY, `select can_manage_platform()`)).rejects.toThrow(/permission denied/);
  });
});

describe('running the migration again', () => {
  it('changes nothing', async () => {
    const q = {
      rates: `select tenant_id, country, code, value, bands, effective_from, effective_to from statutory_rates order by country, code, effective_from, tenant_id`,
      admins: `select user_id, note, added_by from platform_admins order by user_id`,
      runRates: `select run_id, country, rates, calculated_at from payroll_run_rates order by run_id, country`,
      audit: `select count(*)::int n from platform_rate_changes`,
    };
    const before = { rates: await rows(q.rates), admins: await rows(q.admins), runRates: await rows(q.runRates), audit: await rows(q.audit) };
    await db.exec(readFileSync(MIGRATION, 'utf8'));
    expect(await rows(q.rates)).toEqual(before.rates);
    expect(await rows(q.admins)).toEqual(before.admins);
    expect(await rows(q.runRates)).toEqual(before.runRates);
    expect(await rows(q.audit)).toEqual(before.audit);
  });
});
