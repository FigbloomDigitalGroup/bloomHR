// @vitest-environment node
//
// The payslip's details and design (FIG-814, migration 20261021600000_payslip_details.sql): the payslip-design module
// (seeded once to administrators and roles holding payroll), the company's payslip settings and per-branch contacts
// (everyone in the company reads them, only payslip-design changes them, each company only its own), the year to date
// (approved payslips only, the country's tax year, never mixing currencies; payroll sees everyone, staff only their
// own), the payslip's run, and running the migration again.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootDb } from './db';

const FILE = '20261021600000_payslip_details.sql';
const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000b0814';
const ADM = '00000000-0000-0000-0000-00000000f801';
const PAY = '00000000-0000-0000-0000-00000000f802'; // CHECKER: holds payroll
const STAFF = '00000000-0000-0000-0000-00000000f803'; // employee K1
const STAFF2 = '00000000-0000-0000-0000-00000000f804'; // employee K2
const DESIGNER = '00000000-0000-0000-0000-00000000f805'; // a Staff-based custom role holding only payslip-design
const OTHER = '00000000-0000-0000-0000-00000000f806'; // administrator at company B

let db: PGlite;
let oldCustom = ''; // a custom CHECKER role holding payroll, made before the migration
let oldCustomNoPay = ''; // a custom MANAGER role without payroll
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const as = (user: string, sql: string) => asUser(db, user, () => db.exec(sql));
const read = <T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) => asUser(db, user, () => rows<T>(sql, params));
const holders = async (tenant: string) =>
  (await rows<{ role_name: string }>(`select role_name from role_permissions where tenant_id = $1 and 'payslip-design' = any (permissions) order by 1`, [tenant])).map((r) => r.role_name);

const slip = (emp: string, period: string, gross: number, extra: Record<string, string> = {}) => {
  const cols: Record<string, string> = {
    employee_id: `'${emp}'`, employee_name: `'${emp}'`, pay_period: `'${period}'`, gross_pay: String(gross), net_pay: String(gross * 0.8),
    paye_tax: String(gross * 0.1), nssf_deduction: '100', taxable_pay: String(gross * 0.9), tenant_id: `'${A}'`, ...extra,
  };
  return `insert into salary_history (${Object.keys(cols).join(', ')}) values (${Object.values(cols).join(', ')})`;
};
const runOf = async (period: string) => (await rows<{ id: string }>(`select id from payroll_runs where tenant_id = '${A}' and pay_period = '${period}'`))[0].id;
const setCountry = async (period: string, country: string, status: string) =>
  as(PAY, `update payroll_run_countries set status = '${status}' where run_id = '${await runOf(period)}' and country = '${country}'`);

beforeAll(async () => {
  db = await bootDb({
    file: FILE,
    seed: async (d) => {
      // company B set up like the default company; custom roles in A that existed before the migration
      await d.exec(`
        insert into tenants (id, name, slug) values ('${B}', 'B Co', 'b-co-814');
        insert into role_permissions (tenant_id, role_name, permissions)
          select '${B}', role_name, permissions from role_permissions where tenant_id = '${A}' and role_name = any (system_role_names());
      `);
      oldCustom = (await d.query<{ role_key: string; id: string }>(
        `insert into company_roles (tenant_id, name, base_role, is_system, role_key) values ($1, 'Payroll clerk', 'CHECKER', false, 'CR_00000000000000000000000000000000') returning id, role_key`,
        [A])).rows[0].role_key;
      await d.query(`insert into role_permissions (tenant_id, role_name, permissions) values ($1, $2, array['payroll'])`, [A, oldCustom]);
      oldCustomNoPay = (await d.query<{ role_key: string }>(
        `insert into company_roles (tenant_id, name, base_role, is_system, role_key) values ($1, 'Team lead', 'MANAGER', false, 'CR_00000000000000000000000000000000') returning role_key`,
        [A])).rows[0].role_key;
      await d.query(`insert into role_permissions (tenant_id, role_name, permissions) values ($1, $2, array['leaves'])`, [A, oldCustomNoPay]);
    },
  });

  await db.exec(`
    insert into auth.users (id, email) values ('${ADM}', 'adm@a.co'), ('${PAY}', 'pay@a.co'), ('${STAFF}', 'k1@a.co'), ('${STAFF2}', 'k2@a.co'),
      ('${DESIGNER}', 'des@a.co'), ('${OTHER}', 'adm@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${ADM}', 'adm@a.co', 'ADMIN', '${A}'), ('${PAY}', 'pay@a.co', 'CHECKER', '${A}'), ('${STAFF}', 'k1@a.co', 'STAFF', '${A}'),
      ('${STAFF2}', 'k2@a.co', 'STAFF', '${A}'), ('${DESIGNER}', 'des@a.co', 'STAFF', '${A}'), ('${OTHER}', 'adm@b.co', 'ADMIN', '${B}');
    update memberships set account_status = 'ACTIVE';
    insert into branches (tenant_id, name, country) values ('${A}', 'Kampala', 'Uganda');
    insert into employees ("Employee Number", "First Name", "Work Email", worker_kind, onboarding_status, "Branch", tenant_id) values
      ('K1', 'Kerubo', 'k1@a.co', 'employee', 'approved', null, '${A}'),
      ('K2', 'Kamau', 'k2@a.co', 'employee', 'approved', null, '${A}'),
      ('U1', 'Usher', 'u1@a.co', 'employee', 'approved', 'Kampala', '${A}');
  `);
  // a Staff-based custom role holding only payslip-design
  const designer = (await rows<{ id: string; role_key: string }>(
    `insert into company_roles (tenant_id, name, base_role, is_system, role_key) values ($1, 'Payslip designer', 'STAFF', false, 'CR_00000000000000000000000000000000') returning id, role_key`,
    [A]))[0];
  await db.query(`insert into role_permissions (tenant_id, role_name, permissions) values ($1, $2, array['dashboard', 'payslip-design'])`, [A, designer.role_key]);
  await db.query(`update user_profiles set company_role_id = $1 where user_id = $2`, [designer.id, DESIGNER]);
  await db.query(`update memberships set company_role_id = $1 where user_id = $2`, [designer.id, DESIGNER]).catch(() => undefined);
}, 180000);

describe('the payslip-design module', () => {
  it('is in the catalogue', async () => {
    expect(await rows(`select module_id, module_name from permissions where module_id = 'payslip-design'`)).toEqual([
      { module_id: 'payslip-design', module_name: 'Payslip design' },
    ]);
  });

  it('was given once to administrators and every role holding payroll, system or custom', async () => {
    const a = await holders(A);
    expect(a).toContain('ADMIN');
    expect(a).toContain('CHECKER'); // holds payroll in the default roles
    expect(a).toContain(oldCustom);
    expect(a).not.toContain(oldCustomNoPay);
    expect(a).not.toContain('STAFF');
    expect(await holders(B)).toEqual(expect.arrayContaining(['ADMIN', 'CHECKER']));
  });

  it('a Staff-based role may hold it', async () => {
    expect((await read<{ v: boolean }>(DESIGNER, `select has_module('payslip-design') v`))[0].v).toBe(true);
    expect((await read<{ v: boolean }>(STAFF, `select has_module('payslip-design') v`))[0].v).toBe(false);
  });
});

describe('the payslip settings', () => {
  it('only payslip-design changes them; everyone in the company reads them', async () => {
    await expect(as(STAFF, `insert into payslip_settings (footer_text) values ('Hacked')`)).rejects.toThrow(/row-level security/);
    await as(DESIGNER, `insert into payslip_settings (footer_text, brand_color, phone, employer_tax_numbers, show_ytd) values (' Confidential ', '#17402A', '  ', '{"Uganda": "1000123456"}', false)`);
    const saved = await read(STAFF, `select footer_text, brand_color, phone, letterhead, employer_tax_numbers, show_ytd, show_employer_contributions, updated_by from payslip_settings`);
    expect(saved).toEqual([
      { footer_text: 'Confidential', brand_color: '#17402A', phone: null, letterhead: 'logo', employer_tax_numbers: { Uganda: '1000123456' }, show_ytd: false, show_employer_contributions: true, updated_by: DESIGNER },
    ]);
    await as(STAFF, `update payslip_settings set footer_text = 'x'`); // silently nothing
    expect((await read<{ footer_text: string }>(PAY, `select footer_text from payslip_settings`))[0].footer_text).toBe('Confidential');
    await as(PAY, `update payslip_settings set footer_text = 'Payroll queries: pay@a.co'`); // CHECKER got the module
    expect((await read<{ footer_text: string }>(STAFF, `select footer_text from payslip_settings`))[0].footer_text).toBe('Payroll queries: pay@a.co');
  });

  it('checks the colour, the letterhead and the link', async () => {
    await expect(as(ADM, `update payslip_settings set brand_color = 'green'`)).rejects.toThrow(/brand_color/);
    await expect(as(ADM, `update payslip_settings set letterhead = 'poster'`)).rejects.toThrow(/letterhead/);
    await expect(as(ADM, `update payslip_settings set letterhead_url = 'javascript:alert(1)'`)).rejects.toThrow(/letterhead_url/);
  });

  it('each company sees and changes only its own', async () => {
    expect(await read(OTHER, `select * from payslip_settings`)).toEqual([]);
    await as(OTHER, `insert into payslip_settings (footer_text) values ('B footer')`);
    expect((await read<{ footer_text: string }>(STAFF, `select footer_text from payslip_settings`)).map((r) => r.footer_text)).toEqual(['Payroll queries: pay@a.co']);
    await as(OTHER, `update payslip_settings set footer_text = 'B again'`);
    expect((await rows<{ footer_text: string }>(`select footer_text from payslip_settings where tenant_id = '${A}'`))[0].footer_text).toBe('Payroll queries: pay@a.co');
  });

  it('a branch overrides the address and contacts, for its own company only', async () => {
    const kampala = (await rows<{ id: string }>(`select id from branches where tenant_id = '${A}' and name = 'Kampala'`))[0].id;
    await expect(as(STAFF, `insert into payslip_branch_settings (branch_id, address) values ('${kampala}', 'x')`)).rejects.toThrow(/row-level security/);
    await as(DESIGNER, `insert into payslip_branch_settings (branch_id, address, phone) values ('${kampala}', 'Plot 1, Kampala Road', '+256 700 000000')`);
    expect(await read(STAFF2, `select address, phone, email from payslip_branch_settings`)).toEqual([{ address: 'Plot 1, Kampala Road', phone: '+256 700 000000', email: null }]);
    // company B can't attach an override to A's branch, nor see A's
    await expect(as(OTHER, `insert into payslip_branch_settings (branch_id, address) values ('${kampala}', 'x')`)).rejects.toThrow(/Unknown branch/);
    expect(await read(OTHER, `select * from payslip_branch_settings`)).toEqual([]);
  });
});

describe('the year to date', () => {
  beforeAll(async () => {
    // K1 in Kenya: Jan and Feb approved, Mar a draft, Apr (this month) a draft; last December approved (last tax year)
    for (const [p, g] of [['2029-12', 999], ['2030-01', 1000], ['2030-02', 2000], ['2030-03', 4000], ['2030-04', 8000]] as const) {
      await db.exec(slip('K1', p, g));
      await db.exec(slip('K2', p, g * 10));
    }
    for (const p of ['2029-12', '2030-01', '2030-02']) await setCountry(p, 'Kenya', 'approved');
    await setCountry('2030-02', 'Kenya', 'paid');
    // U1 in Uganda: June 2030 (last tax year), July and August 2030 approved
    for (const [p, g] of [['2030-06', 50000], ['2030-07', 100000], ['2030-08', 200000], ['2030-09', 400000]] as const) {
      await db.exec(slip('U1', p, g, { country: `'Uganda'`, currency: `'UGX'` }));
    }
    for (const p of ['2030-06', '2030-07', '2030-08']) await setCountry(p, 'Uganda', 'approved');
  });

  it('adds up only approved payslips, earlier in the tax year (Kenya: January to December)', async () => {
    const ytd = await read(PAY, `select * from payslip_ytd('K1', '2030-04')`);
    expect(ytd).toEqual([
      {
        currency: 'KES', months: 2, gross_pay: '3000', taxable_pay: '2700.00', taxable_months: 2, paye_tax: '300', nssf_deduction: '200', net_pay: '2400',
        country: 'Kenya', tax_year_start: '2030-01',
      },
    ]);
    // January: nothing before it in the year (December is last year's)
    expect(await read(PAY, `select * from payslip_ytd('K1', '2030-01')`)).toEqual([]);
  });

  it("Uganda's tax year starts in July", async () => {
    const ytd = await read<{ months: number; gross_pay: string; tax_year_start: string; country: string }>(PAY, `select months, gross_pay, tax_year_start, country from payslip_ytd('U1', '2030-09')`);
    expect(ytd).toEqual([{ months: 2, gross_pay: '300000', tax_year_start: '2030-07', country: 'Uganda' }]);
    const june = await read<{ months: number; tax_year_start: string }>(PAY, `select months, tax_year_start from payslip_ytd('U1', '2030-07')`);
    expect(june).toEqual([]); // June belongs to the year before
  });

  it('never mixes currencies', async () => {
    // (the payslip guards are bypassed: this is about the totals, not how a USD payslip is made)
    await db.exec(`set session_replication_role = replica;
      update salary_history set currency = 'USD', gross_pay = 10, fx_rate = 129, local_currency = 'KES', local_amounts = '{"gross_pay": 1290}' where employee_id = 'K2' and pay_period = '2030-01';
      set session_replication_role = origin;`);
    const ytd = await read<{ currency: string; months: number; gross_pay: string }>(PAY, `select currency, months, gross_pay from payslip_ytd('K2', '2030-04')`);
    expect(ytd).toEqual([{ currency: 'KES', months: 1, gross_pay: '20000' }, { currency: 'USD', months: 1, gross_pay: '10' }]);
  });

  it('staff see only their own; payroll sees everyone', async () => {
    expect((await read<{ months: number }>(STAFF, `select months from payslip_ytd('K1', '2030-04')`))[0].months).toBe(2);
    await expect(read(STAFF, `select * from payslip_ytd('K2', '2030-04')`)).rejects.toThrow(/only see your own/);
    await expect(read(DESIGNER, `select * from payslip_ytd('K1', '2030-04')`)).rejects.toThrow(/only see your own/);
    expect((await read<{ months: number }>(PAY, `select months from payslip_ytd('K2', '2030-04')`)).length).toBe(2);
    // another company sees nothing of A's
    expect(await read(OTHER, `select * from payslip_ytd('K1', '2030-04')`)).toEqual([]);
  });

  it("gives the payslip's run, its status and dates", async () => {
    const jan = await read<{ run_id: string; status: string; approved_at: string | null }>(STAFF, `select * from payslip_run_details('K1', '2030-01')`);
    expect(jan).toHaveLength(1);
    expect(jan[0].run_id).toBe(await runOf('2030-01'));
    expect(jan[0].status).toBe('approved');
    expect(jan[0].approved_at).not.toBeNull();
    // a draft month: payroll sees its run, staff don't
    expect(await read(STAFF, `select * from payslip_run_details('K1', '2030-04')`)).toEqual([]);
    expect((await read<{ status: string }>(PAY, `select status from payslip_run_details('K1', '2030-04')`))[0].status).toBe('draft');
    await expect(read(STAFF, `select * from payslip_run_details('K2', '2030-01')`)).rejects.toThrow(/only see your own/);
  });

  it('anonymous visitors cannot call them', async () => {
    const r = await rows<{ v: boolean }>(`select has_function_privilege('anon', 'public.payslip_ytd(text, text)', 'execute') v`);
    expect(r[0].v).toBe(false);
  });
});

describe('running the migration again', () => {
  it('changes nothing', async () => {
    const settings = await rows(`select * from payslip_settings order by tenant_id`);
    const branches = await rows(`select * from payslip_branch_settings order by id`);
    const perms = await rows(`select tenant_id, role_name, permissions from role_permissions order by tenant_id, role_name`);
    // a company that unticks the module keeps it unticked
    await db.exec(`update role_permissions set permissions = array_remove(permissions, 'payslip-design') where tenant_id = '${B}' and role_name = 'CHECKER'`);
    const after = await rows(`select tenant_id, role_name, permissions from role_permissions order by tenant_id, role_name`);
    await db.exec(readFileSync(join(__dirname, '..', 'migrations', FILE), 'utf8'));
    expect(await rows(`select * from payslip_settings order by tenant_id`)).toEqual(settings);
    expect(await rows(`select * from payslip_branch_settings order by id`)).toEqual(branches);
    expect(await rows(`select tenant_id, role_name, permissions from role_permissions order by tenant_id, role_name`)).toEqual(after);
    expect(perms.length).toBe(after.length);
  });
});
