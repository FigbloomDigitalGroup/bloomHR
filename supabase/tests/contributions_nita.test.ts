// @vitest-environment node
//
// Staff contributions and the NITA levy (FIG-898): an employee asks for a contribution from their pay (their own
// only), payroll approves (it becomes a voluntary deduction, or is added to the pension / PRMF / insurance / mortgage
// amount payroll reads) or declines it with a reason, either side can stop it, companies are kept apart; and the
// employer's NITA levy, a dated rate saved on each payslip (not for contractors; casuals have no payslips).
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const PAY = '00000000-0000-0000-0000-00000000c701';
const STAFF = '00000000-0000-0000-0000-00000000c702';
const STAFF2 = '00000000-0000-0000-0000-00000000c703';
const PAY_B = '00000000-0000-0000-0000-00000000c704';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const one = async <T = Record<string, unknown>>(sql: string) => (await rows<T>(sql))[0];
const run = async (sql: string) => {
  try {
    await db.query(sql);
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};
const as = (user: string, sql: string) => asUser(db, user, () => run(sql));
const read = <T = Record<string, unknown>>(user: string, sql: string) => asUser(db, user, () => rows<T>(sql));
const q = (s: string | null) => (s === null ? 'null' : `'${s.replace(/'/g, "''")}'`);

const addMonths = (period: string, n: number) => {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const NOW = new Date().toISOString().slice(0, 7);
const NEXT = addMonths(NOW, 1);

const request = (user: string, kind: string, amount: number, start: string, end: string | null = null, provider: string | null = null,
  reference: string | null = null, doc: string | null = null) =>
  asUser(db, user, async () => {
    try {
      const r = await one<{ id: string; status: string; employee_number: string }>(
        `select * from request_contribution(${q(kind)}, ${amount}, ${q(start)}, ${q(end)}, ${q(provider)}, ${q(reference)}, null, ${q(doc)})`);
      return r;
    } catch (e) {
      return (e as Error).message;
    }
  });
const contribution = (id: string) =>
  one<{ status: string; start_period: string; end_period: string | null; applied_amount: string; employee_deduction_id: string | null;
        decline_reason: string | null; stop_period: string | null }>(`select * from employee_contributions where id = '${id}'`);
const employee = (num: string) =>
  one<{ other_pension_contribution: string | null; insurance_premium: string | null; mortgage_interest: string | null;
        post_retirement_medical_fund: string | null; onboarding_status: string }>(
    `select other_pension_contribution, insurance_premium, mortgage_interest, post_retirement_medical_fund, onboarding_status
     from employees where "Employee Number" = '${num}'`);
const notes = (emp: string, type: string) =>
  rows<{ title: string; message: string }>(`select title, message from hr_notifications where employee_number = '${emp}'
    and notification_type = '${type}' order by created_at, id`);

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values ('${PAY}', 'pay@a.co'), ('${STAFF}', 'me@a.co'), ('${STAFF2}', 'you@a.co'), ('${PAY_B}', 'pay@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${PAY}', 'pay@a.co', 'FINANCE', '${A}'), ('${STAFF}', 'me@a.co', 'STAFF', '${A}'), ('${STAFF2}', 'you@a.co', 'STAFF', '${A}'),
      ('${PAY_B}', 'pay@b.co', 'FINANCE', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('FINANCE', array['payroll'], '${A}'), ('STAFF', array['dashboard'], '${A}'), ('FINANCE', array['payroll'], '${B}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Start Date", onboarding_status, tenant_id) values
      ('P1', 'Pat', 'Payroll', 'pay@a.co', '2020-01-01', 'approved', '${A}'),
      ('E1', 'Mia', 'Me', 'me@a.co', '2020-01-01', 'approved', '${A}'),
      ('E2', 'Yusuf', 'You', 'you@a.co', '2020-01-01', 'approved', '${A}'),
      ('X1', 'Xena', 'Other', 'x@b.co', '2020-01-01', 'approved', '${B}');
  `);
}, 120000);

describe('asking for a contribution', () => {
  it('an employee asks for their own; payroll is told', async () => {
    const r = await request(STAFF, 'sacco', 2000, NOW, null, 'Stima Sacco', 'M-123');
    expect(r).toMatchObject({ status: 'pending', employee_number: 'E1' });
    const told = await notes('E1', 'contribution_requested');
    expect(told).toHaveLength(1);
    expect(told[0].message).toContain('Mia Me asked for sacco (Stima Sacco) of KES 2,000.00 a month');
  });

  it('checks what is asked for', async () => {
    expect(await request(STAFF, 'sacco', 500, NOW)).toMatch(/already have a sacco request waiting/);
    expect(await request(STAFF, 'pension_avc', 0, NOW)).toMatch(/amount a month/);
    expect(await request(STAFF, 'pension_avc', 100, addMonths(NOW, -1))).toMatch(/month that has passed/);
    expect(await request(STAFF, 'pension_avc', 100, NEXT, NOW)).toMatch(/last month can't be before/);
    expect(await request(STAFF, 'other', 100, NOW)).toMatch(/who the contribution is paid to/);
    expect(await request(STAFF, 'bitcoin', 100, NOW)).toMatch(/what kind/);
    // a document must be in the employee's own folder
    expect(await request(STAFF, 'pension_avc', 100, NOW, null, null, null, `${A}/${STAFF2}/x.pdf`)).toMatch(/Upload the document again/);
    expect(await request(STAFF, 'pension_avc', 100, NOW, null, null, null, `${A}/${STAFF}/contribution_x.pdf`)).toMatchObject({ status: 'pending' });
  });

  it('only through the functions, and each employee sees only their own', async () => {
    expect(await as(STAFF, `insert into employee_contributions (employee_number, kind, amount, start_period) values ('E2', 'sacco', 1, '${NOW}')`))
      .toMatch(/permission denied/);
    expect(await as(STAFF, `update employee_contributions set amount = 1`)).toMatch(/permission denied/);
    expect((await read(STAFF2, `select * from employee_contributions_list()`))).toHaveLength(0);
    expect((await read(STAFF2, `select * from employee_contributions`))).toHaveLength(0);
    expect((await read(STAFF, `select * from employee_contributions_list()`))).toHaveLength(2);
    expect((await read<{ employee_name: string }>(PAY, `select * from employee_contributions_list()`))[0].employee_name).toBe('Mia Me');
  });
});

describe('payroll decides', () => {
  it('staff cannot approve, and payroll cannot decide their own', async () => {
    const r = (await one<{ id: string }>(`select id from employee_contributions where employee_number = 'E1' and kind = 'sacco'`)).id;
    expect(await as(STAFF, `select decide_contribution('${r}', true)`)).toMatch(/Only payroll/);
    expect(await as(STAFF2, `select decide_contribution('${r}', true)`)).toMatch(/Only payroll/);
    const own = await request(PAY, 'welfare', 300, NOW);
    expect(own).toMatchObject({ status: 'pending' });
    expect(await as(PAY, `select decide_contribution('${(own as { id: string }).id}', true)`)).toMatch(/Someone else in payroll/);
  });

  it('a SACCO becomes a voluntary deduction under the company\'s SACCO type; the employee is told', async () => {
    const r = (await one<{ id: string }>(`select id from employee_contributions where employee_number = 'E1' and kind = 'sacco'`)).id;
    expect(await as(PAY, `select decide_contribution('${r}', true)`)).toBe('');
    const c = await contribution(r);
    expect(c).toMatchObject({ status: 'active', start_period: NOW, applied_amount: '0.00' });
    expect(await one(`select t.name, d.amount, d.start_period, d.end_period, d.notes from employee_deductions d
      join deduction_types t on t.id = d.deduction_type_id where d.id = '${c.employee_deduction_id}'`))
      .toEqual({ name: 'SACCO', amount: '2000.00', start_period: NOW, end_period: null, notes: 'Asked for by the employee: Stima Sacco, ref M-123' });
    expect(await as(PAY, `select decide_contribution('${r}', true)`)).toMatch(/already been dealt with/);
    const told = await notes('E1', 'employment_update');
    expect(told.at(-1)).toMatchObject({ title: 'Contribution approved' });
    expect(told.at(-1)?.message).toContain('taken from your pay each month');
  });

  it('a pension AVC is added to the pension amount payroll deducts before tax, without sending the record back', async () => {
    const r = (await one<{ id: string }>(`select id from employee_contributions where employee_number = 'E1' and kind = 'pension_avc'`)).id;
    await db.exec(`update employees set other_pension_contribution = 1000 where "Employee Number" = 'E1'`);
    expect(await as(PAY, `select decide_contribution('${r}', true)`)).toBe('');
    expect(await contribution(r)).toMatchObject({ status: 'active', applied_amount: '100.00', employee_deduction_id: null });
    expect(await employee('E1')).toMatchObject({ other_pension_contribution: '1100.00', onboarding_status: 'approved' });
  });

  it('insurance premium and mortgage interest set the relief amounts; PRMF its fund', async () => {
    const ins = await request(STAFF2, 'insurance_premium', 4000, NOW, null, 'Jubilee', 'POL-9') as { id: string };
    const mort = await request(STAFF2, 'mortgage_interest', 25000, NOW, null, 'KCB') as { id: string };
    const prmf = await request(STAFF2, 'prmf', 1500, NOW) as { id: string };
    for (const id of [ins.id, mort.id, prmf.id]) expect(await as(PAY, `select decide_contribution('${id}', true)`)).toBe('');
    expect(await employee('E2')).toMatchObject({ insurance_premium: '4000.00', mortgage_interest: '25000.00', post_retirement_medical_fund: '1500.00' });
    expect((await notes('E2', 'employment_update')).find((n) => n.message.includes('Insurance premium'.toLowerCase()))?.message)
      .toContain('you keep paying Jubilee yourself');
  });

  it('one starting next month waits until this month\'s payroll is approved', async () => {
    const r = await request(STAFF2, 'pension_avc', 700, NEXT) as { id: string };
    expect(await as(PAY, `select decide_contribution('${r.id}', true)`)).toBe('');
    expect(await contribution(r.id)).toMatchObject({ status: 'active', start_period: NEXT, applied_amount: '0.00' });
    expect((await employee('E2')).other_pension_contribution).toBeNull();

    // this month's payroll: a payslip (with the NITA levy worked out) and approving the month
    await db.exec(`insert into salary_history (employee_id, employee_name, pay_period, basic_salary, gross_pay, net_pay, tenant_id)
                   values ('E2', 'Yusuf You', '${NOW}', 50000, 50000, 40000, '${A}')`);
    await db.exec(`update payroll_runs set status = 'approved' where tenant_id = '${A}' and pay_period = '${NOW}'`);
    expect(await contribution(r.id)).toMatchObject({ applied_amount: '700.00' });
    expect((await employee('E2')).other_pension_contribution).toBe('700.00');
    expect((await read<{ next_payroll_period: string }>(PAY, `select * from employee_contributions_list()`))[0].next_payroll_period).toBe(NEXT);
  });

  it('declining needs a reason, which the employee is told', async () => {
    const r = await request(STAFF2, 'welfare', 200, NEXT) as { id: string };
    expect(await as(PAY, `select decide_contribution('${r.id}', false, '  ')`)).toMatch(/reason for declining/);
    expect(await as(PAY, `select decide_contribution('${r.id}', false, 'Welfare is already taken from everyone')`)).toBe('');
    expect(await contribution(r.id)).toMatchObject({ status: 'declined', decline_reason: 'Welfare is already taken from everyone' });
    expect((await notes('E2', 'employment_update')).at(-1)).toEqual({
      title: 'Contribution declined',
      message: 'Your welfare request of KES 200.00 a month was declined. Reason: Welfare is already taken from everyone.',
    });
  });
});

describe('stopping', () => {
  it('the employee stops their SACCO from the next payroll month; payroll is told', async () => {
    const r = (await one<{ id: string }>(`select id, employee_deduction_id from employee_contributions where employee_number = 'E1' and kind = 'sacco'`)).id;
    const before = await contribution(r);
    expect(await as(STAFF2, `select stop_contribution('${r}')`)).toMatch(/Only the employee or payroll/);
    expect(await as(STAFF, `select stop_contribution('${r}')`)).toBe('');
    // this month is approved, so it was taken this month and stops next month
    expect(await contribution(r)).toMatchObject({ status: 'stopped', stop_period: NEXT, end_period: NOW });
    expect(await one(`select end_period from employee_deductions where id = '${before.employee_deduction_id}'`)).toEqual({ end_period: NOW });
    expect((await notes('E1', 'contribution_requested')).at(-1)?.title).toBe('Contribution stopped');
    expect(await as(STAFF, `select stop_contribution('${r}')`)).toMatch(/not running/);
  });

  it('payroll stops a pension AVC: the amount comes off again and the employee is told', async () => {
    const r = (await one<{ id: string }>(`select id from employee_contributions where employee_number = 'E1' and kind = 'pension_avc'`)).id;
    expect(await as(PAY, `select stop_contribution('${r}')`)).toBe('');
    expect(await contribution(r)).toMatchObject({ status: 'stopped', applied_amount: '0.00' });
    expect((await employee('E1')).other_pension_contribution).toBe('1000.00');
    expect((await notes('E1', 'employment_update')).at(-1)?.title).toBe('Contribution stopped');
  });

  it('a request still waiting is withdrawn by the employee (payroll declines instead)', async () => {
    const r = await request(STAFF, 'mortgage_interest', 9000, NEXT, null, 'HF') as { id: string };
    expect(await as(PAY, `select stop_contribution('${r.id}')`)).toMatch(/Decline the request instead/);
    expect(await as(STAFF, `select stop_contribution('${r.id}')`)).toBe('');
    expect((await contribution(r.id)).status).toBe('cancelled');
  });

  it('one that has not started when stopped never reaches payroll', async () => {
    const r = await request(STAFF, 'sacco', 800, addMonths(NOW, 3), null, 'Mwalimu') as { id: string };
    expect(await as(PAY, `select decide_contribution('${r.id}', true)`)).toBe('');
    const d = (await contribution(r.id)).employee_deduction_id;
    expect(await as(STAFF, `select stop_contribution('${r.id}')`)).toBe('');
    expect(await rows(`select 1 from employee_deductions where id = '${d}'`)).toHaveLength(0);
    expect(await contribution(r.id)).toMatchObject({ status: 'stopped', end_period: null });
  });
});

describe('companies are kept apart', () => {
  it('another company\'s payroll sees and decides nothing here', async () => {
    const r = await request(STAFF, 'insurance_premium', 1000, NEXT, null, 'Britam') as { id: string };
    expect(await read(PAY_B, `select * from employee_contributions_list()`)).toHaveLength(0);
    expect(await read(PAY_B, `select * from employee_contributions`)).toHaveLength(0);
    expect(await as(PAY_B, `select decide_contribution('${r.id}', true)`)).toMatch(/No such contribution request/);
    expect(await as(PAY_B, `select stop_contribution('${r.id}')`)).toMatch(/No such contribution/);
  });
});

describe('the HR alert', () => {
  it('is for payroll only', async () => {
    expect((await one<{ v: boolean }>(`select hr_only_notification('contribution_requested') v`)).v).toBe(true);
    expect((await one<{ v: string[] }>(`select hr_alert_modules('contribution_requested') v`)).v).toEqual(['payroll']);
    // every older type is still allowed
    expect((await one<{ v: boolean }>(`select hr_only_notification('leave_document_overdue') v`)).v).toBe(true);
    expect(await run(`insert into hr_notifications (tenant_id, employee_number, notification_type, title, message)
                      values ('${A}', 'E1', 'leave_document_overdue', 't', 'm')`)).toBe('');
  });
});

describe('NITA levy', () => {
  it('is a dated default rate of KES 50 with its source', async () => {
    expect(await one(`select value, effective_from::text, effective_to, source like '%Training Levy%' as sourced from statutory_rates
                      where tenant_id is null and code = 'nita_levy'`))
      .toEqual({ value: '50', effective_from: '2012-01-01', effective_to: null, sourced: true });
    expect((await read<{ r: Record<string, number> }>(STAFF, `select statutory_rates_on('${NOW}-01') r`))[0].r.nita_levy).toBe(50);
  });

  it('is saved on each payslip as an employer cost, not taken from pay; contractors pay none', async () => {
    expect(await one(`select nita_levy, total_deductions, net_pay from salary_history where employee_id = 'E2' and pay_period = '${NOW}'`))
      .toEqual({ nita_levy: '50.00', total_deductions: null, net_pay: '40000' });
    await db.exec(`
      insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Start Date", onboarding_status, worker_kind,
                             wht_category, tenant_id)
      values ('CT1', 'Carl', 'Contractor', 'ct@a.co', '2020-01-01', 'approved', 'contractor', 'professional', '${A}');
    `);
    const month = addMonths(NOW, 1);
    expect(await as(PAY, `insert into salary_history (employee_id, employee_name, pay_period, basic_salary, gross_pay, net_pay)
      values ('E1', 'Mia Me', '${month}', 1, 1, 1), ('CT1', 'Carl', '${month}', 1, 1, 1), ('E2', 'Yusuf You', '${month}', 1, 1, 1)`)).toBe('');
    expect(await rows(`select employee_id, nita_levy from salary_history where pay_period = '${month}' order by employee_id`))
      .toEqual([{ employee_id: 'CT1', nita_levy: '0.00' }, { employee_id: 'E1', nita_levy: '50.00' }, { employee_id: 'E2', nita_levy: '50.00' }]);
    // payroll's list: per employee, contractors left out
    expect(await read(PAY, `select employee_number, employee_name, levy from nita_levy_for('${month}')`))
      .toEqual([{ employee_number: 'E1', employee_name: 'Mia Me', levy: '50.00' }, { employee_number: 'E2', employee_name: 'Yusuf You', levy: '50.00' }]);
    expect(await as(STAFF, `select * from nita_levy_for('${month}')`)).toMatch(/Only payroll/);
  });

  it('casual workers have no payslip, so no levy', async () => {
    await db.exec(`insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Start Date", onboarding_status, worker_kind,
                     daily_rate, "Employee Type", tenant_id)
                   values ('CAS1', 'Cas', 'Ual', 'cas@a.co', '2020-01-01', 'approved', 'casual', 500, 'Casual', '${A}')`);
    expect(await as(PAY, `insert into salary_history (employee_id, employee_name, pay_period, basic_salary, gross_pay, net_pay)
      values ('CAS1', 'Cas', '${addMonths(NOW, 1)}', 1, 1, 1)`)).toMatch(/casual worker/);
  });

  it('a company rate from a date is used for payslips from then on; a recalculated draft follows it', async () => {
    const month = addMonths(NOW, 1);
    expect(await as(PAY, `insert into statutory_rates (tenant_id, code, value, effective_from, source)
      values ('${A}', 'nita_levy', 60, '${month}-01', 'Set by the company')`)).toBe('');
    // the month is still a draft: saving its payslips again picks the new rate up
    expect(await as(PAY, `update salary_history set gross_pay = 2 where pay_period = '${month}' and employee_id = 'E1'`)).toBe('');
    expect(await one(`select nita_levy from salary_history where pay_period = '${month}' and employee_id = 'E1'`)).toEqual({ nita_levy: '60.00' });
    // an approved month keeps what it had
    expect(await one(`select nita_levy from salary_history where pay_period = '${NOW}' and employee_id = 'E2'`)).toEqual({ nita_levy: '50.00' });
  });
});
