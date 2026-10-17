// @vitest-environment node
//
// KPI templates and job titles (20261019300000): each company's job titles are made from its employees' "Job Title"
// texts and kept in step with them; KPI templates for a department (and its sub-departments), job title, job group or
// everyone are applied when a review period opens and when someone joins or moves during an open period; the same KPI
// is given once, from the highest priority source; a manager's or HR's change to a template KPI sticks; only HR (and
// the Employees module, for job titles) manage them; companies never see each other's.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, bootDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const ADMIN = '00000000-0000-0000-0000-00000000d101';
const HR = '00000000-0000-0000-0000-00000000d102';
const BOSS = '00000000-0000-0000-0000-00000000d103';
const ME = '00000000-0000-0000-0000-00000000d104';
const CLERK = '00000000-0000-0000-0000-00000000d105';
const ADMIN_B = '00000000-0000-0000-0000-00000000d106';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const fails = async (p: Promise<unknown>) => {
  try {
    await p;
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};
const as = <T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) =>
  asUser(db, user, () => rows<T>(sql, params));
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await rows<T>(sql, params))[0];
const titleId = async (name: string, tenant = A) =>
  (await one<{ id: string }>(`select id from job_titles where tenant_id = $1 and lower(name) = lower($2)`, [tenant, name]))?.id;
const emp = (n: string) =>
  one<{ title: string | null; job_title_id: string | null }>(`select "Job Title" as title, job_title_id from employees where "Employee Number" = $1`, [n]);

interface Line {
  employee_number: string;
  kpi: string;
  weight: string;
  target: string | null;
  assigned_via: string;
  template: string | null;
  overridden: boolean;
  no_longer_matches: boolean;
}
const linesOf = (period: string, employee: string) =>
  rows<Line>(
    `select a.employee_number, k.name as kpi, a.weight, a.target, a.assigned_via, t.name as template, a.overridden, a.no_longer_matches
     from kpi_assignments a join kpis k on k.id = a.kpi_id left join kpi_templates t on t.id = a.template_id
     where a.period_id = $1 and a.employee_number = $2 order by k.name`,
    [period, employee]
  );

let salesDept: string;
let northDept: string;
let opsDept: string;
let jg1: string;
const kpi: Record<string, string> = {};
const tpl: Record<string, string> = {};
let q4: string;

beforeAll(async () => {
  // employees as they may be on a live database before the migration: messy spacing and casing, blanks and nulls
  db = await bootDb({
    file: '20261019300000_kpi_templates.sql',
    seed: async (d) => {
      await d.exec(`
        insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
        insert into employees ("Employee Number", "First Name", "Last Name", "Job Title", "Status", tenant_id) values
          ('S-1', 'One', 'A', '  sales rep', 'Active', '${A}'),
          ('S-2', 'Two', 'A', E'Sales \\t Rep', 'Active', '${A}'),
          ('S-3', 'Three', 'A', 'Sales Rep', 'Active', '${A}'),
          ('S-4', 'Four', 'A', 'SALES REP ', 'Active', '${A}'),
          ('S-5', 'Five', 'A', null, 'Active', '${A}'),
          ('S-6', 'Six', 'A', '   ', 'Active', '${A}'),
          ('S-7', 'Seven', 'A', 'Driver', 'Active', '${A}'),
          ('S-B', 'Bee', 'B', 'sales rep', 'Active', '${B}');
      `);
    },
  });
  await db.exec(`delete from role_permissions where tenant_id = '${A}'`);
  for (const [id, email, role, tenant] of [
    [ADMIN, 'admin@a.co', 'ADMIN', A], [HR, 'hr@a.co', 'HR', A], [BOSS, 'boss@a.co', 'MANAGER', A],
    [ME, 'me@a.co', 'STAFF', A], [CLERK, 'clerk@a.co', 'CLERK', A], [ADMIN_B, 'admin@b.co', 'ADMIN', B],
  ]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${tenant}');
    `);
  }
  await db.exec(`
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['employees'], '${A}'), ('MANAGER', array['performance'], '${A}'), ('STAFF', array['dashboard'], '${A}'),
      ('CLERK', array['employees'], '${A}');
  `);
  salesDept = (await one<{ id: string }>(`insert into departments (tenant_id, name) values ('${A}', 'Sales') returning id`)).id;
  northDept = (await one<{ id: string }>(`insert into departments (tenant_id, name, parent_id) values ('${A}', 'Sales North', $1) returning id`, [salesDept])).id;
  opsDept = (await one<{ id: string }>(`insert into departments (tenant_id, name) values ('${A}', 'Operations') returning id`)).id;
  jg1 = (await one<{ id: string }>(`insert into job_groups (tenant_id, code, name) values ('${A}', 'JG1', 'Group one') returning id`)).id;
}, 120000);

describe('job titles made from existing employees', () => {
  it('one title per distinct text in each company, ignoring case and spacing, spelt as most employees spell it', async () => {
    const a = await rows<{ name: string }>(`select name from job_titles where tenant_id = '${A}' order by name`);
    expect(a.map((r) => r.name)).toEqual(['Driver', 'Sales Rep']);
    const b = await rows<{ name: string }>(`select name from job_titles where tenant_id = '${B}'`);
    expect(b.map((r) => r.name)).toEqual(['sales rep']);
  });

  it('links each employee and tidies their text; blanks stay unlinked', async () => {
    const rep = await titleId('Sales Rep');
    for (const n of ['S-1', 'S-2', 'S-3', 'S-4']) expect(await emp(n)).toEqual({ title: 'Sales Rep', job_title_id: rep });
    expect((await emp('S-5')).job_title_id).toBeNull();
    expect((await emp('S-6')).job_title_id).toBeNull();
    expect((await emp('S-B')).job_title_id).toBe(await titleId('sales rep', B));
  });

  it('a second title with the same name (any case or spacing) is refused', async () => {
    expect(await fails(as(HR, `insert into job_titles (name) values ('  DRIVER ')`))).toMatch(/duplicate|unique/);
    await as(ADMIN_B, `insert into job_titles (name) values ('Driver')`);
  });
});

describe('the employee’s title and its text stay together', () => {
  it('choosing a title sets the text', async () => {
    await as(HR, `update employees set job_title_id = $1 where "Employee Number" = 'S-5'`, [await titleId('Driver')]);
    expect(await emp('S-5')).toEqual({ title: 'Driver', job_title_id: await titleId('Driver') });
  });

  it('typing an existing title links it; a new one is added to the list for HR', async () => {
    await as(HR, `update employees set "Job Title" = ' sales   REP' where "Employee Number" = 'S-5'`);
    expect(await emp('S-5')).toEqual({ title: 'Sales Rep', job_title_id: await titleId('Sales Rep') });
    await as(HR, `update employees set "Job Title" = 'Agronomist' where "Employee Number" = 'S-6'`);
    expect((await emp('S-6')).job_title_id).toBe(await titleId('Agronomist'));
    await as(HR, `update employees set "Job Title" = '' where "Employee Number" = 'S-6'`);
    expect((await emp('S-6')).job_title_id).toBeNull();
  });

  it('another company’s title is refused', async () => {
    expect(await fails(as(HR, `update employees set job_title_id = $1 where "Employee Number" = 'S-5'`, [await titleId('sales rep', B)])))
      .toMatch(/foreign key|this company/);
  });

  it('renaming a title renames its employees’ text', async () => {
    await as(HR, `update job_titles set name = '  Sales  Representative ' where id = $1`, [await titleId('Sales Rep')]);
    expect((await emp('S-1')).title).toBe('Sales Representative');
    expect((await emp('S-5')).title).toBe('Sales Representative');
  });

  it('merging a duplicate moves its employees and removes it', async () => {
    const dup = (await as<{ id: string }>(HR, `insert into job_titles (name) values ('Sales Rep.') returning id`))[0].id;
    await as(HR, `update employees set job_title_id = $1 where "Employee Number" = 'S-4'`, [dup]);
    const into = await titleId('Sales Representative');
    const [{ merge_job_titles: n }] = await as<{ merge_job_titles: number }>(HR, `select merge_job_titles($1, $2)`, [dup, into]);
    expect(n).toBe(1);
    expect(await emp('S-4')).toEqual({ title: 'Sales Representative', job_title_id: into });
    expect(await rows(`select 1 from job_titles where id = $1`, [dup])).toHaveLength(0);
    expect(await fails(as(ME, `select merge_job_titles($1, $1)`, [into]))).toMatch(/may not manage/);
  });

  it('HR, the Employees module and Performance managers change titles; staff and other companies do not', async () => {
    await as(CLERK, `insert into job_titles (name) values ('Clerk')`);
    expect(await fails(as(ME, `insert into job_titles (name) values ('Boss')`))).toMatch(/row-level security/);
    expect((await as(ME, `select name from job_titles`)).length).toBeGreaterThan(0); // everyone reads the list
    expect(await as(ME, `update job_titles set active = false returning 1`)).toHaveLength(0);
    const seen = await as<{ tenant_id: string }>(ADMIN_B, `select tenant_id from job_titles`);
    expect(seen.every((r) => r.tenant_id === B)).toBe(true);
    expect(await as(ADMIN_B, `update job_titles set name = 'x' where tenant_id = '${A}' returning 1`)).toHaveLength(0);
    expect(await fails(asAnon(db, () => rows(`select 1 from job_titles`)))).toMatch(/permission denied/);
    const overview = await as<{ name: string; employee_count: number }>(HR, `select name, employee_count from job_titles_overview()`);
    expect(overview.find((r) => r.name === 'Sales Representative')?.employee_count).toBe(5);
    expect(await fails(as(ME, `select * from job_titles_overview()`))).toMatch(/may not manage/);
  });
});

describe('KPI templates', () => {
  beforeAll(async () => {
    for (const name of ['Revenue', 'Calls', 'Attendance', 'Quality', 'Safety']) {
      kpi[name] = (await as<{ id: string }>(HR, `insert into kpis (name, default_target, default_weight) values ($1, 10, 0) returning id`, [name]))[0].id;
    }
    // the people: Mo in Sales North (under Sales), a sales representative in JG1; Dee a driver in Operations
    await db.exec(`
      insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Job Title", "Status", tenant_id) values
        ('A-BOSS', 'Bea', 'Boss', 'boss@a.co', 'Sales Manager', 'Active', '${A}'),
        ('A-ME', 'Mo', 'Me', 'me@a.co', 'Sales Representative', 'Active', '${A}'),
        ('A-DEE', 'Dee', 'Driver', 'dee@a.co', 'Driver', 'Active', '${A}'),
        ('A-OUT', 'Old', 'Leaver', 'out@a.co', 'Sales Representative', 'Terminated', '${A}');
    `);
    const boss = (await one<{ id: string }>(`select id from employees where "Employee Number" = 'A-BOSS'`)).id;
    await db.query(`update employees set department_id = $1, job_group_id = $2, reports_to_id = $3 where "Employee Number" = 'A-ME'`, [northDept, jg1, boss]);
    await db.query(`update employees set department_id = $1 where "Employee Number" = 'A-DEE'`, [opsDept]);
    // the earlier tests' employees are not part of this
    await db.exec(`update employees set "Status" = 'Inactive' where "Employee Number" like 'S-%'`);
  });

  const save = (user: string, id: string | null, name: string, appliesTo: string, target: string | null, active: boolean, items: [string, number, number?][]) =>
    as<{ save_kpi_template: string }>(user, `select save_kpi_template($1, $2, $3, $4, $5, $6::jsonb)`, [
      id, name, appliesTo, target, active,
      JSON.stringify(items.map(([k, weight, target]) => ({ kpi_id: kpi[k], weight, target: target ?? null }))),
    ]).then((r) => r[0].save_kpi_template);

  it('a template can only be active when its weights total 100', async () => {
    expect(await fails(save(HR, null, 'Everyone', 'everyone', null, true, [['Attendance', 90]]))).toMatch(/total 100% .*they total 90%/);
    tpl.all = await save(HR, null, 'Everyone', 'everyone', null, false, [['Attendance', 90]]);
    expect((await one<{ active: boolean }>(`select active from kpi_templates where id = $1`, [tpl.all])).active).toBe(false);
    expect(await fails(as(HR, `update kpi_templates set active = true where id = $1`, [tpl.all]))).toMatch(/total 100%/);
    await save(HR, tpl.all, 'Everyone', 'everyone', null, true, [['Attendance', 100]]);
    // an active template's items can't be changed so they no longer total 100
    expect(await fails(as(HR, `update kpi_template_items set weight = 50 where template_id = $1`, [tpl.all]))).toMatch(/total 100%/);
    expect(await fails(as(HR, `insert into kpi_templates (name, applies_to, active) values ('Empty', 'everyone', true)`))).toMatch(/Add KPIs/);
  });

  it('checks what it applies to', async () => {
    expect(await fails(save(HR, null, 'No target', 'department', null, false, []))).toMatch(/Choose who/);
    expect(await fails(save(HR, null, 'Bad', 'job_title', salesDept, false, []))).toMatch(/this company's job titles/);
    expect(await fails(as(HR, `insert into kpi_templates (name, applies_to) values ('Loose', 'department')`))).toMatch(/check/);
  });

  it('HR sets up templates for a department, a job title and a job group', async () => {
    tpl.dept = await save(HR, null, 'Sales team', 'department', salesDept, true, [['Revenue', 60, 500], ['Attendance', 40]]);
    tpl.title = await save(HR, null, 'Sales reps', 'job_title', await titleId('Sales Representative'), true, [['Revenue', 70, 900], ['Calls', 30]]);
    tpl.group = await save(HR, null, 'JG1', 'job_group', jg1, true, [['Calls', 50], ['Quality', 50]]);
    const t = await one<{ applies_to: string; department_id: string; job_title_id: string | null }>(`select applies_to, department_id, job_title_id from kpi_templates where id = $1`, [tpl.dept]);
    expect(t).toEqual({ applies_to: 'department', department_id: salesDept, job_title_id: null });
  });

  it('shows who each template matches, including sub-departments; leavers are left out', async () => {
    const m = await as<{ template_id: string; employee_number: string; depth: number }>(HR, `select * from kpi_template_members() order by employee_number`);
    const of = (t: string) => m.filter((r) => r.template_id === t).map((r) => r.employee_number);
    expect(of(tpl.dept)).toEqual(['A-ME']);
    expect(m.find((r) => r.template_id === tpl.dept)?.depth).toBe(1);
    expect(of(tpl.title)).toEqual(['A-ME']);
    expect(of(tpl.group)).toEqual(['A-ME']);
    expect(of(tpl.all)).toEqual(['A-BOSS', 'A-DEE', 'A-ME']);
    expect(await fails(as(ME, `select * from kpi_template_members()`))).toMatch(/Only HR/);
  });

  it('staff, line managers and the Employees module can’t change templates', async () => {
    for (const u of [ME, BOSS, CLERK]) {
      expect(await fails(save(u, null, 'Mine', 'everyone', null, false, []))).toMatch(/Only HR/);
      expect(await fails(as(u, `insert into kpi_templates (name, applies_to) values ('Mine', 'everyone')`))).toMatch(/row-level security/);
      expect(await as(u, `update kpi_template_items set target = 1 returning 1`)).toHaveLength(0);
    }
    expect((await as(ME, `select 1 from kpi_templates`)).length).toBe(4); // read for the "from template" labels
  });
});

describe('applying templates', () => {
  beforeAll(async () => {
    q4 = (await as<{ id: string }>(HR, `insert into kpi_periods (name, starts_on, ends_on) values ('Q4 2026', '2026-10-01', '2026-12-31') returning id`))[0].id;
    // set by hand before the period opens: kept
    await as(HR, `select assign_kpi($1, $2, 'person', 'A-ME', 5, 10)`, [q4, kpi.Attendance]);
  });

  it('nothing while the period is a draft', async () => {
    expect((await linesOf(q4, 'A-DEE')).length).toBe(0);
  });

  it('opening the period gives everyone their template KPIs: each KPI once, from the highest priority source', async () => {
    await as(HR, `update kpi_periods set status = 'open' where id = $1`, [q4]);
    const me = await linesOf(q4, 'A-ME');
    expect(me.map((l) => [l.kpi, Number(l.weight), l.assigned_via, l.template])).toEqual([
      ['Attendance', 10, 'person', null], // by hand beats every template
      ['Calls', 30, 'template', 'Sales reps'], // job title beats job group
      ['Quality', 50, 'template', 'JG1'],
      ['Revenue', 70, 'template', 'Sales reps'], // job title beats department
    ]);
    expect(Number(me.find((l) => l.kpi === 'Revenue')?.target)).toBe(900);
    const dee = await linesOf(q4, 'A-DEE');
    expect(dee.map((l) => [l.kpi, Number(l.weight), l.template, Number(l.target)])).toEqual([['Attendance', 100, 'Everyone', 10]]);
    expect(await linesOf(q4, 'A-OUT')).toHaveLength(0);
    const dupes = await rows(`select 1 from kpi_assignments where period_id = $1 group by employee_number, kpi_id having count(*) > 1`, [q4]);
    expect(dupes).toHaveLength(0);
  });

  it('a department template beats “everyone”, and the nearer department beats the one above it', async () => {
    const near = await save2(HR, null, 'North', 'department', northDept, [['Safety', 100]]);
    const far = await save2(HR, null, 'Sales safety', 'department', salesDept, [['Safety', 100]]);
    await as(HR, `select apply_kpi_templates($1)`, [q4]);
    const safety = (await linesOf(q4, 'A-ME')).find((l) => l.kpi === 'Safety');
    expect(safety?.template).toBe('North');
    await as(HR, `delete from kpi_templates where id in ($1, $2)`, [near, far]);
    await as(HR, `select apply_kpi_templates()`);
    expect((await linesOf(q4, 'A-ME')).find((l) => l.kpi === 'Safety')).toBeUndefined();
  });

  it('a new employee during an open period gets their template KPIs', async () => {
    await as(HR, `insert into employees ("Employee Number", "First Name", "Last Name", "Job Title", "Status", department_id) values ('A-NEW', 'Nia', 'New', 'Driver', 'Active', $1)`, [salesDept]);
    const lines = await linesOf(q4, 'A-NEW');
    expect(lines.map((l) => [l.kpi, Number(l.weight), l.template])).toEqual([
      ['Attendance', 40, 'Sales team'],
      ['Revenue', 60, 'Sales team'],
    ]);
  });

  it('a transfer: new template KPIs added; ones that no longer match removed, or kept and flagged when checked in on', async () => {
    const revenue = (await one<{ id: string }>(`select id from kpi_assignments where period_id = $1 and employee_number = 'A-NEW' and kpi_id = $2`, [q4, kpi.Revenue])).id;
    await as(HR, `insert into kpi_checkins (assignment_id, kind, value) values ($1, 'final', 400)`, [revenue]);
    await as(HR, `update employees set department_id = $1, job_group_id = $2 where "Employee Number" = 'A-NEW'`, [opsDept, jg1]);
    const lines = await linesOf(q4, 'A-NEW');
    expect(lines.map((l) => [l.kpi, Number(l.weight), l.template, l.no_longer_matches])).toEqual([
      ['Attendance', 100, 'Everyone', false], // now from "everyone"
      ['Calls', 50, 'JG1', false],
      ['Quality', 50, 'JG1', false],
      ['Revenue', 60, 'Sales team', true], // has a check-in: kept, flagged
    ]);
    // back to Sales: it matches again
    await as(HR, `update employees set department_id = $1 where "Employee Number" = 'A-NEW'`, [salesDept]);
    expect((await linesOf(q4, 'A-NEW')).find((l) => l.kpi === 'Revenue')?.no_longer_matches).toBe(false);
    // leaving the group: its KPIs had no check-ins, so they go
    await as(HR, `update employees set job_group_id = null where "Employee Number" = 'A-NEW'`);
    expect((await linesOf(q4, 'A-NEW')).map((l) => l.kpi)).toEqual(['Attendance', 'Revenue']);
  });

  it('a change of job title (typed) is a transfer too', async () => {
    await as(HR, `update employees set "Job Title" = 'sales representative' where "Employee Number" = 'A-DEE'`);
    expect((await linesOf(q4, 'A-DEE')).map((l) => [l.kpi, l.template])).toEqual([
      ['Attendance', 'Everyone'],
      ['Calls', 'Sales reps'],
      ['Revenue', 'Sales reps'],
    ]);
  });

  it('a manager’s or HR’s change to a template KPI sticks and is marked overridden', async () => {
    const q = (await one<{ id: string }>(`select id from kpi_assignments where period_id = $1 and employee_number = 'A-ME' and kpi_id = $2`, [q4, kpi.Quality])).id;
    await as(BOSS, `update kpi_assignments set weight = 40, target = 3 where id = $1`, [q]);
    // the template changes and is applied again: the adjusted one keeps its values
    await save2(HR, tpl.group, 'JG1', 'job_group', jg1, [['Calls', 40], ['Quality', 60]]);
    await as(HR, `select apply_kpi_templates()`);
    const line = (await linesOf(q4, 'A-ME')).find((l) => l.kpi === 'Quality')!;
    expect([Number(line.weight), Number(line.target), line.overridden, line.template]).toEqual([40, 3, true, 'JG1']);
    // staff can't change it, nor mark anything as from a template
    expect(await as(ME, `update kpi_assignments set weight = 100 where id = $1 returning 1`, [q])).toHaveLength(0);
    await as(HR, `update kpi_assignments set overridden = false, template_id = null where id = $1`, [q]);
    expect((await one<{ overridden: boolean; template_id: string }>(`select overridden, template_id from kpi_assignments where id = $1`, [q])))
      .toEqual({ overridden: true, template_id: tpl.group });
    const other = (await as<{ id: string }>(HR, `insert into kpis (name) values ('Hand made') returning id`))[0].id;
    await as(HR, `insert into kpi_assignments (period_id, kpi_id, employee_number, assigned_via, template_id, weight) values ($1, $2, 'A-DEE', 'template', $3, 0)`, [q4, other, tpl.all]);
    expect(await one(`select assigned_via, template_id from kpi_assignments where kpi_id = $1`, [other])).toEqual({ assigned_via: 'person', template_id: null });
  });

  it('assigning a template KPI by hand makes it a manual one, which templates leave alone', async () => {
    await as(HR, `select assign_kpi($1, $2, 'person', 'A-DEE', 7, 25)`, [q4, kpi.Calls]);
    await as(HR, `select apply_kpi_templates()`);
    const calls = (await linesOf(q4, 'A-DEE')).find((l) => l.kpi === 'Calls')!;
    expect([calls.assigned_via, calls.template, Number(calls.weight)]).toEqual(['person', null, 25]);
  });

  it('a well-formed single template gives weights totalling 100', async () => {
    await as(HR, `insert into employees ("Employee Number", "First Name", "Last Name", "Status") values ('A-PLAIN', 'Pat', 'Plain', 'Active')`);
    const [{ total }] = await rows<{ total: string }>(`select sum(weight) total from kpi_assignments where period_id = $1 and employee_number = 'A-PLAIN'`, [q4]);
    expect(Number(total)).toBe(100);
  });

  it('only HR applies templates, and only in an open period', async () => {
    expect(await fails(as(ME, `select apply_kpi_templates()`))).toMatch(/Only HR/);
    expect(await fails(as(BOSS, `select apply_kpi_templates()`))).toMatch(/Only HR/);
    const draft = (await as<{ id: string }>(HR, `insert into kpi_periods (name, starts_on, ends_on) values ('Q1 2027', '2027-01-01', '2027-03-31') returning id`))[0].id;
    expect(await fails(as(HR, `select apply_kpi_templates($1)`, [draft]))).toMatch(/Open the review period/);
    // nobody calls the inner workings directly
    expect(await fails(as(HR, `select kpi_apply_templates_now($1)`, [q4]))).toMatch(/permission denied/);
  });

  it('companies never see or use each other’s templates', async () => {
    for (const t of ['kpi_templates', 'kpi_template_items']) {
      expect(await as(ADMIN_B, `select 1 from ${t}`)).toHaveLength(0);
      expect(await as(ADMIN_B, `delete from ${t} returning 1`)).toHaveLength(0);
      expect(await fails(asAnon(db, () => rows(`select 1 from ${t}`)))).toMatch(/permission denied/);
    }
    expect(await fails(as(ADMIN_B, `select save_kpi_template(null, 'Theirs', 'everyone', null, false, $1::jsonb)`, [JSON.stringify([{ kpi_id: kpi.Revenue, weight: 100 }])])))
      .toMatch(/Unknown KPI/);
    expect(await fails(as(ADMIN_B, `select save_kpi_template(null, 'Theirs', 'department', $1, false, '[]'::jsonb)`, [salesDept]))).toMatch(/this company's/);
    // B's periods open without touching A's people
    await as(ADMIN_B, `insert into kpi_periods (name, starts_on, ends_on, status) values ('B Q4', '2026-10-01', '2026-12-31', 'open')`);
    expect(Number((await one<{ n: string }>(`select count(*) n from kpi_assignments where tenant_id = '${B}'`)).n)).toBe(0);
  });
});

describe('telling employees about their KPIs (20261019400000)', () => {
  interface Note { tenant_id: string; employee_number: string; title: string; message: string }
  let mark = 0;
  const since = async () => {
    const got = await rows<Note & { id: number }>(
      `select id, tenant_id, employee_number, title, message from hr_notifications where notification_type = 'employment_update' and id > $1 order by id`, [mark]);
    mark = Math.max(mark, ...got.map((n) => Number(n.id)));
    return got;
  };
  const reset = async () => {
    mark = Number((await one<{ m: number | null }>(`select max(id) m from hr_notifications`)).m ?? 0);
  };

  beforeAll(async () => {
    // HR has an employee record too, in Sales
    await db.query(`insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Status", tenant_id, department_id)
      values ('A-HR', 'Hana', 'HR', 'hr@a.co', 'Active', '${A}', $1)`, [salesDept]);
  });

  it('a new hire gets one notification for all their new KPIs, not one per KPI', async () => {
    await reset();
    await as(HR, `insert into employees ("Employee Number", "First Name", "Last Name", "Job Title", "Status", department_id, job_group_id)
      values ('A-HIRE', 'Hal', 'Hire', 'Sales Representative', 'Active', $1, $2)`, [salesDept, jg1]);
    const n = (await linesOf(q4, 'A-HIRE')).length;
    expect(n).toBeGreaterThan(1);
    const notes = (await since()).filter((x) => x.employee_number === 'A-HIRE');
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe('New KPIs');
    expect(notes[0].message).toBe(`You have ${n} new KPIs for the Q4 2026 review. See them under My KPIs.`);
  });

  it('a KPI assigned by hand to a group: one each, and never to the person who assigned it', async () => {
    await reset();
    const extra = (await as<{ id: string }>(HR, `insert into kpis (name) values ('Team spirit') returning id`))[0].id;
    await as(HR, `select assign_kpi($1, $2, 'department', $3, 1, 0)`, [q4, extra, salesDept]);
    const notes = await since();
    const who = notes.map((x) => x.employee_number).sort();
    expect(who).toContain('A-HIRE');
    expect(who).not.toContain('A-HR'); // HR assigned it, to their own department too
    expect(new Set(who).size).toBe(who.length);
    expect(notes.find((x) => x.employee_number === 'A-HIRE')?.message).toMatch(/^You have 1 new KPI for/);
  });

  it('a manager changing a target or weight tells the employee once; re-applying templates says nothing', async () => {
    await reset();
    await as(BOSS, `update kpi_assignments set weight = weight + 0, target = 77 where period_id = $1 and employee_number = 'A-ME' and kpi_id in ($2, $3)`,
      [q4, kpi.Revenue, kpi.Calls]);
    const notes = await since();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ employee_number: 'A-ME', title: 'KPI targets changed' });
    expect(notes[0].message).toMatch(/your KPIs Calls, Revenue for the Q4 2026 review changed/);
    await as(HR, `select apply_kpi_templates()`);
    expect(await since()).toHaveLength(0);
    // a self-assessment is not a change of target
    const id = (await one<{ id: string }>(`select id from kpi_assignments where period_id = $1 and employee_number = 'A-ME' and kpi_id = $2`, [q4, kpi.Revenue])).id;
    await as(ME, `insert into kpi_checkins (assignment_id, kind, value) values ($1, 'self', 5)`, [id]);
    expect(await since()).toHaveLength(0);
  });

  it('template KPIs taken off after a move: one notification naming them', async () => {
    await reset();
    await as(HR, `update employees set job_group_id = null where "Employee Number" = 'A-HIRE'`);
    const notes = await since();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ employee_number: 'A-HIRE', title: 'KPIs removed' });
    expect(notes[0].message).toMatch(/^The KPI Quality was taken off your Q4 2026 review/);
    // removing one by hand is not announced
    await as(HR, `delete from kpi_assignments where period_id = $1 and employee_number = 'A-HIRE' and kpi_id = $2`, [q4, kpi.Revenue]);
    expect(await since()).toHaveLength(0);
  });

  it('nothing while a period is a draft; one notification per person when it opens', async () => {
    await reset();
    const p2 = (await as<{ id: string }>(HR, `insert into kpi_periods (name, starts_on, ends_on) values ('Q2 2027', '2027-04-01', '2027-06-30') returning id`))[0].id;
    await as(HR, `select assign_kpi($1, $2, 'person', 'A-DEE', 1, 0)`, [p2, kpi.Safety]);
    expect(await since()).toHaveLength(0);
    await as(HR, `update kpi_periods set status = 'open' where id = $1`, [p2]);
    const notes = await since();
    const dee = notes.filter((x) => x.employee_number === 'A-DEE');
    expect(dee).toHaveLength(1);
    const n = (await linesOf(p2, 'A-DEE')).length;
    expect(dee[0]).toMatchObject({ title: 'Your KPIs for Q2 2027' });
    expect(dee[0].message).toMatch(new RegExp(`You have ${n} KPIs to work towards`));
    expect(notes.some((x) => x.title === 'New KPIs')).toBe(false);
    expect(notes.some((x) => x.employee_number === 'A-HR')).toBe(false); // HR opened it
    expect(new Set(notes.map((x) => x.employee_number)).size).toBe(notes.length);
    await as(HR, `update kpi_periods set status = 'closed' where id = $1`, [p2]);
  });

  it('each company’s employees only hear about their own KPIs', async () => {
    await db.exec(`insert into employees ("Employee Number", "First Name", "Last Name", "Status", tenant_id) values ('B-2', 'Bo', 'Two', 'Active', '${B}')`);
    await reset();
    const k = (await as<{ id: string }>(ADMIN_B, `insert into kpis (name) values ('B metric') returning id`))[0].id;
    await as(ADMIN_B, `select save_kpi_template(null, 'All of B', 'everyone', null, true, $1::jsonb)`, [JSON.stringify([{ kpi_id: k, weight: 100 }])]);
    await as(ADMIN_B, `insert into kpi_periods (name, starts_on, ends_on, status) values ('B Q2', '2027-04-01', '2027-06-30', 'open')`);
    const notes = await since();
    expect(notes.map((x) => [x.tenant_id, x.employee_number])).toEqual([[B, 'B-2']]);
    expect(await as(ADMIN_B, `select employee_number from hr_notifications where tenant_id = '${A}'`)).toHaveLength(0);
  });

  it('running the migration again does not double the notifications', async () => {
    await db.exec(readFileSync(join(__dirname, '..', 'migrations', '20261019400000_kpi_notifications.sql'), 'utf8'));
    await db.exec('reset search_path');
    await reset();
    await as(HR, `select assign_kpi($1, $2, 'person', 'A-DEE', 1, 0)`, [q4, kpi.Safety]);
    expect((await since()).map((x) => x.employee_number)).toEqual(['A-DEE']);
  });
});

describe('running the migration again', () => {
  it('a template removed while its period is closed just leaves its KPIs without a template', async () => {
    const t = await save2(HR, null, 'Short lived', 'everyone', null, [['Safety', 100]]);
    await as(HR, `select apply_kpi_templates()`);
    await as(HR, `update kpi_periods set status = 'closed' where id = $1`, [q4]);
    await as(HR, `delete from kpi_templates where id = $1`, [t]);
    const [r] = await rows<{ template_id: string | null }>(`select template_id from kpi_assignments where period_id = $1 and kpi_id = $2 and employee_number = 'A-DEE'`, [q4, kpi.Safety]);
    expect(r.template_id).toBeNull();
  });

  it('changes nothing', async () => {
    const before = await rows(`select tenant_id, name from job_titles order by 1, 2`);
    const assignments = await rows(`select id, weight, template_id from kpi_assignments order by id`);
    await db.exec(readFileSync(join(__dirname, '..', 'migrations', '20261019300000_kpi_templates.sql'), 'utf8'));
    await db.exec('reset search_path');
    expect(await rows(`select tenant_id, name from job_titles order by 1, 2`)).toEqual(before);
    expect(await rows(`select id, weight, template_id from kpi_assignments order by id`)).toEqual(assignments);
  });
});

function save2(user: string, id: string | null, name: string, appliesTo: string, target: string | null, items: [string, number][]) {
  return as<{ save_kpi_template: string }>(user, `select save_kpi_template($1, $2, $3, $4, true, $5::jsonb)`, [
    id, name, appliesTo, target, JSON.stringify(items.map(([k, weight]) => ({ kpi_id: kpi[k], weight }))),
  ]).then((r) => r[0].save_kpi_template);
}
