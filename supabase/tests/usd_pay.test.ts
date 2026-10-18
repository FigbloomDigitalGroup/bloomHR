// @vitest-environment node
//
// Paying a country in USD at the rate the company enters each month (FIG-906, migration 20261021500000_usd_pay.sql):
// the pay currency per country (local by default, or USD), the payslip currency guard (USD only when chosen, at the
// month's rate, with its local figures, never with piece rate work; one currency per country per month), the rate
// required before a USD country is approved and locked once it is, the NITA levy kept in KES, company isolation, and
// running the migration again.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000b0906';
const PAY = '00000000-0000-0000-0000-00000000e601';
const STAFF = '00000000-0000-0000-0000-00000000e602';
const OTHER = '00000000-0000-0000-0000-00000000e603'; // payroll at company B

const MIGRATION = join(__dirname, '..', 'migrations', '20261021500000_usd_pay.sql');
const M1 = '2030-03';
const M2 = '2030-04';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const as = (user: string, sql: string) => asUser(db, user, () => db.exec(sql));
const read = <T = Record<string, unknown>>(user: string, sql: string) => asUser(db, user, () => rows<T>(sql));

/** A Kenya USD payslip: $2,000 gross at 1 USD = 129 KES, with its KES figures. */
const LOCAL = JSON.stringify({ gross_pay: 258000, taxable_pay: 240555, paye_tax: 64549.85, nssf_deduction: 6480, nhif_deduction: 7095, housing_levy: 3870 });
const usdSlip = (emp: string, period: string, extra: Record<string, string> = {}) => {
  const cols: Record<string, string> = {
    employee_id: `'${emp}'`, employee_name: `'${emp}'`, pay_period: `'${period}'`, gross_pay: '2000', net_pay: '1374.41',
    total_deductions: '625.59', paye_tax: '500.39', currency: `'USD'`, local_amounts: `'${LOCAL}'`, tenant_id: `'${A}'`, ...extra,
  };
  return `insert into salary_history (${Object.keys(cols).join(', ')}) values (${Object.values(cols).join(', ')})`;
};
/** A payslip in local currency (the currency left to the database, unless given). */
const kesSlip = (emp: string, period: string, currency?: string) =>
  `insert into salary_history (employee_id, employee_name, pay_period, gross_pay, net_pay, tenant_id${currency ? ', currency' : ''})
   values ('${emp}', '${emp}', '${period}', 100000, 80000, '${A}'${currency ? `, '${currency}'` : ''})`;
const runOf = async (period: string) => (await rows<{ id: string }>(`select id from payroll_runs where tenant_id = '${A}' and pay_period = '${period}'`))[0].id;
const setKenya = async (period: string, status: string) =>
  as(PAY, `update payroll_run_countries set status = '${status}' where run_id = '${await runOf(period)}' and country = 'Kenya'`);

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'B Co', 'b-co-906');
    insert into auth.users (id, email) values ('${PAY}', 'pay@a.co'), ('${STAFF}', 'staff@a.co'), ('${OTHER}', 'pay@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${PAY}', 'pay@a.co', 'FINANCE', '${A}'), ('${STAFF}', 'staff@a.co', 'STAFF', '${A}'), ('${OTHER}', 'pay@b.co', 'FINANCE', '${B}');
    delete from role_permissions where tenant_id = '${B}';
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('FINANCE', array['work-records', 'payroll'], '${A}'), ('STAFF', array['dashboard'], '${A}'), ('FINANCE', array['work-records', 'payroll'], '${B}');
    insert into branches (tenant_id, name, country) values ('${A}', 'Dar es Salaam', 'Tanzania');
    insert into employees ("Employee Number", "First Name", "Work Email", worker_kind, onboarding_status, "Branch", tenant_id) values
      ('K1', 'Kerubo', 'k1@a.co', 'employee', 'approved', null, '${A}'),
      ('K2', 'Kamau', 'k2@a.co', 'employee', 'approved', null, '${A}'),
      ('T1', 'Tatu', 't1@a.co', 'employee', 'approved', 'Dar es Salaam', '${A}');
  `);
}, 120000);

describe('the pay currency per country', () => {
  it("is the country's own until the company chooses USD", async () => {
    const before = await rows<{ ke: string; tz: string; emp: string }>(
      `select country_pay_currency('${A}', 'Kenya') ke, country_pay_currency('${A}', 'Tanzania') tz, employee_pay_currency('${A}', 'K1') emp`
    );
    expect(before[0]).toEqual({ ke: 'KES', tz: 'TZS', emp: 'KES' });
    await as(PAY, `insert into company_pay_currencies (country, currency) values ('kenya ', 'usd')`);
    const saved = await rows<{ country: string; currency: string; updated_by: string }>(`select country, currency, updated_by from company_pay_currencies where tenant_id = '${A}'`);
    expect(saved).toEqual([{ country: 'Kenya', currency: 'USD', updated_by: PAY }]);
    const after = await rows<{ ke: string; tz: string; emp: string; t1: string }>(
      `select country_pay_currency('${A}', 'Kenya') ke, country_pay_currency('${A}', 'Tanzania') tz, employee_pay_currency('${A}', 'K1') emp, employee_pay_currency('${A}', 'T1') t1`
    );
    expect(after[0]).toEqual({ ke: 'USD', tz: 'TZS', emp: 'USD', t1: 'TZS' });
  });

  it('is the local currency or USD, nothing else, one per country', async () => {
    await expect(as(PAY, `insert into company_pay_currencies (country, currency) values ('Tanzania', 'EUR')`)).rejects.toThrow(/Tanzania can be paid in TZS or USD, not EUR/);
    await expect(as(PAY, `insert into company_pay_currencies (country, currency) values ('Tanzania', 'KES')`)).rejects.toThrow(/TZS or USD/);
    await expect(as(PAY, `insert into company_pay_currencies (country, currency) values ('Kenya', 'KES')`)).rejects.toThrow(/duplicate|unique/);
  });

  it('everyone in the company can see it; only payroll changes it', async () => {
    expect(await read(STAFF, `select country, currency from company_pay_currencies`)).toEqual([{ country: 'Kenya', currency: 'USD' }]);
    await expect(as(STAFF, `insert into company_pay_currencies (country, currency) values ('Tanzania', 'USD')`)).rejects.toThrow(/row-level security/);
    await as(STAFF, `update company_pay_currencies set currency = 'KES'`);
    expect((await rows<{ currency: string }>(`select currency from company_pay_currencies where tenant_id = '${A}'`))[0].currency).toBe('USD');
  });
});

describe('the month’s USD rate', () => {
  it('is entered for a country paid in USD only, by payroll, and recorded with who entered it', async () => {
    await expect(as(PAY, `insert into payroll_fx_rates (pay_period, country, rate) values ('${M1}', 'Tanzania', 2600)`)).rejects.toThrow(
      /Tanzania is paid in TZS, not USD/
    );
    await expect(as(STAFF, `insert into payroll_fx_rates (pay_period, country, rate) values ('${M1}', 'Kenya', 129)`)).rejects.toThrow(/row-level security/);
    await expect(as(PAY, `insert into payroll_fx_rates (pay_period, country, rate) values ('${M1}', 'Kenya', 0)`)).rejects.toThrow(/check/);
    await as(PAY, `insert into payroll_fx_rates (pay_period, country, rate) values ('${M1}', 'kenya', 129)`);
    const r = await rows<{ country: string; currency: string; local_currency: string; rate: string; entered_by: string }>(
      `select country, currency, local_currency, rate, entered_by from payroll_fx_rates where tenant_id = '${A}'`
    );
    expect(r).toEqual([{ country: 'Kenya', currency: 'USD', local_currency: 'KES', rate: '129.0000', entered_by: PAY }]);
    expect(await read(STAFF, `select * from payroll_fx_rates`)).toEqual([]);
    // audited
    expect((await rows<{ n: number }>(`select count(*)::int n from audit_log where table_name = 'payroll_fx_rates'`))[0].n).toBeGreaterThan(0);
  });
});

describe('the payslip currency guard', () => {
  it('takes a USD payslip at the month’s rate, with its KES figures, and keeps the NITA levy in KES', async () => {
    await as(PAY, usdSlip('K1', M1));
    const s = await rows<{ currency: string; fx_rate: string; local_currency: string; nita_levy: string; nita_kes: string }>(
      `select currency, fx_rate, local_currency, nita_levy, (local_amounts ->> 'nita_levy')::numeric nita_kes from salary_history where employee_id = 'K1' and pay_period = '${M1}'`
    );
    expect(s[0]).toEqual({ currency: 'USD', fx_rate: '129.0000', local_currency: 'KES', nita_levy: '0.39', nita_kes: '50' });
    expect((await rows<{ currency: string }>(`select currency from payroll_run_countries where run_id = '${await runOf(M1)}'`))[0].currency).toBe('USD');
    // the NITA return reads KES
    expect(await read(PAY, `select employee_number, levy from nita_levy_for('${M1}')`)).toEqual([{ employee_number: 'K1', levy: '50' }]);
  });

  it('refuses USD when the country is not paid in USD, without the month’s rate, at another rate, or without local figures', async () => {
    await expect(as(PAY, usdSlip('T1', M1))).rejects.toThrow(/Tanzania is paid in TZS, so its payslips can't be in USD/);
    await expect(as(PAY, usdSlip('K2', '2030-09'))).rejects.toThrow(/Enter the USD rate for Kenya in 2030-09/);
    await expect(as(PAY, usdSlip('K2', M1, { fx_rate: '130' }))).rejects.toThrow(/worked out at 1 USD = 130.* KES, but the rate for Kenya in 2030-03 is 129/);
    await expect(as(PAY, usdSlip('K2', M1, { local_amounts: 'null' }))).rejects.toThrow(/needs its KES statutory figures/);
    await expect(as(PAY, usdSlip('K2', M1, { local_currency: `'TZS'` }))).rejects.toThrow(/keep their statutory figures in KES, not TZS/);
  });

  it('never puts piece rate work or arrears on a USD payslip', async () => {
    await expect(as(PAY, usdSlip('K2', M1, { work_pay: '100' }))).rejects.toThrow(/Piece rate work, contract jobs and arrears are paid in KES/);
    await expect(as(PAY, usdSlip('K2', M1, { arrears_brought_forward: '5' }))).rejects.toThrow(/can't go on a USD payslip/);
  });

  it('one currency per country per month: no KES payslip next to USD ones while Kenya is paid in USD', async () => {
    await expect(as(PAY, kesSlip('K2', M1, 'KES'))).rejects.toThrow(/Kenya payslips for 2030-03 are in USD; this one is in KES/);
    // a local payslip carries no rate or local figures
    await as(PAY, kesSlip('T1', M1));
    expect((await rows(`select currency, fx_rate, local_currency, local_amounts from salary_history where employee_id = 'T1' and pay_period = '${M1}'`))[0]).toEqual({
      currency: 'TZS', fx_rate: null, local_currency: null, local_amounts: null,
    });
  });
});

describe('approving a USD country', () => {
  it('needs this month’s rate', async () => {
    await as(PAY, `insert into payroll_fx_rates (pay_period, country, rate) values ('${M2}', 'Kenya', 129)`);
    await as(PAY, usdSlip('K1', M2));
    await as(PAY, `delete from payroll_fx_rates where pay_period = '${M2}'`);
    await expect(setKenya(M2, 'approved')).rejects.toThrow(/Enter this month's USD rate for Kenya before approving 2030-04/);
  });

  it('needs every payslip worked out at that rate', async () => {
    await as(PAY, `insert into payroll_fx_rates (pay_period, country, rate) values ('${M2}', 'Kenya', 130)`);
    await expect(setKenya(M2, 'approved')).rejects.toThrow(/USD rate for Kenya in 2030-04 is now 130.*recalculate/);
    // recalculated at 130
    await as(PAY, `update salary_history set fx_rate = 130, net_pay = 1380 where employee_id = 'K1' and pay_period = '${M2}'`);
    await setKenya(M2, 'approved');
    expect((await rows<{ status: string }>(`select status from payroll_run_countries where run_id = '${await runOf(M2)}' and country = 'Kenya'`))[0].status).toBe('approved');
  });

  it('locks the rate once approved, and frees it when reopened', async () => {
    await expect(as(PAY, `update payroll_fx_rates set rate = 131 where pay_period = '${M2}'`)).rejects.toThrow(/USD rate for Kenya in 2030-04 is locked: Kenya is approved/);
    await expect(as(PAY, `delete from payroll_fx_rates where pay_period = '${M2}'`)).rejects.toThrow(/is locked/);
    await setKenya(M2, 'draft');
    await as(PAY, `update payroll_fx_rates set rate = 131 where pay_period = '${M2}'`);
    expect((await rows<{ rate: string }>(`select rate from payroll_fx_rates where tenant_id = '${A}' and pay_period = '${M2}'`))[0].rate).toBe('131.0000');
  });

  it('needs its payslips in the currency it is paid in now', async () => {
    // Kenya switched back to KES: the draft's USD payslips must be recalculated in KES first
    await as(PAY, `update company_pay_currencies set currency = 'KES' where country = 'Kenya'`);
    await expect(setKenya(M2, 'approved')).rejects.toThrow(/Kenya is paid in KES, but its payslips for 2030-04 are in USD/);
    // recalculating in KES replaces the USD payslips (the new choice may replace the old currency's)
    await as(PAY, `${kesSlip('K2', M2)}; delete from salary_history where employee_id = 'K1' and pay_period = '${M2}'`);
    await setKenya(M2, 'approved');
    await as(PAY, `update company_pay_currencies set currency = 'USD' where country = 'Kenya'`);
  });
});

describe('company isolation', () => {
  it("another company sees none of this company's choices or rates, and has its own", async () => {
    expect(await read(OTHER, `select * from company_pay_currencies`)).toEqual([]);
    expect(await read(OTHER, `select * from payroll_fx_rates`)).toEqual([]);
    await as(OTHER, `insert into company_pay_currencies (country, currency) values ('Uganda', 'USD')`);
    expect((await rows<{ tenant_id: string }>(`select tenant_id from company_pay_currencies where country = 'Uganda'`))[0].tenant_id).toBe(B);
    expect((await rows<{ a: string; b: string }>(`select country_pay_currency('${A}', 'Uganda') a, country_pay_currency('${B}', 'Uganda') b`))[0]).toEqual({ a: 'UGX', b: 'USD' });
    await expect(as(OTHER, `insert into payroll_fx_rates (tenant_id, pay_period, country, rate) values ('${A}', '${M1}', 'Kenya', 1)`)).rejects.toThrow(/row-level security/);
    await as(OTHER, `update payroll_fx_rates set rate = 1`);
    expect((await rows<{ rate: string }>(`select rate from payroll_fx_rates where tenant_id = '${A}' and pay_period = '${M1}'`))[0].rate).toBe('129.0000');
  });

  it("nobody outside the database calls the pay currency helpers", async () => {
    await expect(read(PAY, `select country_pay_currency('${B}', 'Uganda')`)).rejects.toThrow(/permission denied/);
  });
});

describe('running the migration again', () => {
  it('changes nothing', async () => {
    const before = await rows(`select tenant_id, country, currency from company_pay_currencies order by tenant_id, country`);
    const rates = await rows(`select tenant_id, pay_period, country, rate, entered_by from payroll_fx_rates order by pay_period`);
    const slips = await rows(`select id, currency, fx_rate, local_currency, local_amounts, nita_levy from salary_history order by id`);
    await db.exec(readFileSync(MIGRATION, 'utf8'));
    expect(await rows(`select tenant_id, country, currency from company_pay_currencies order by tenant_id, country`)).toEqual(before);
    expect(await rows(`select tenant_id, pay_period, country, rate, entered_by from payroll_fx_rates order by pay_period`)).toEqual(rates);
    expect(await rows(`select id, currency, fx_rate, local_currency, local_amounts, nita_levy from salary_history order by id`)).toEqual(slips);
  });
});
