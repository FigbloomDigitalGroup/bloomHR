// @vitest-environment node
//
// Documents with leave (FIG-876): a leave type can need a document with the application (a doctor's report) or after
// it (a birth notification), checked here for an employee's own application, and added afterwards by them or HR.
// (The test database has no storage schema, so the bucket's policies are not exercised here.)
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const HR = '00000000-0000-0000-0000-00000000fe01';
const STAFF = '00000000-0000-0000-0000-00000000fe02';
const OTHER = '00000000-0000-0000-0000-00000000fe03';

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
const file = (user: string, tenant = A) => `${tenant}/${user}/abc123-report.pdf`;
const apply = (user: string, employee: string, type: string, start: string, end: string, doc: string | null = null) =>
  asUser(db, user, () => run(
    `insert into leave_application ("Employee Number", name, "Leave Type", "Start Date", "End Date", status, document_path, document_name)
     values ('${employee}', '${employee}', '${type}', '${start}', '${end}', 'pending', ${doc ? `'${doc}'` : 'null'}, ${doc ? `'report.pdf'` : 'null'})`));
const lastLeave = async (employee: string) =>
  (await rows<{ id: string; document_path: string | null; document_uploaded_at: string | null; followup_document_path: string | null }>(
    `select id, document_path, document_uploaded_at, followup_document_path from leave_application
     where "Employee Number" = '${employee}' order by time_added desc limit 1`))[0];
const setSick = (set: string) =>
  db.exec(`update leave_policies set ${set} where leave_type_id = (select id from leave_types where tenant_id = '${A}' and name = 'Sick Leave')`);

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values ('${HR}', 'hr@a.co'), ('${STAFF}', 'me@a.co'), ('${OTHER}', 'them@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${STAFF}', 'me@a.co', 'STAFF', '${A}'), ('${OTHER}', 'them@a.co', 'STAFF', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values ('HR', array['leaves', 'employees'], '${A}'), ('STAFF', array['dashboard'], '${A}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", tenant_id) values
      ('ME', 'Mia', 'Me', 'me@a.co', '${A}'), ('THEM', 'Theo', 'Them', 'them@a.co', '${A}'), ('E-HR', 'Hana', 'Hr', 'hr@a.co', '${A}');
    select seed_default_leave_types('${A}');
  `);
}, 120000);

describe('what each leave type asks for', () => {
  it('new companies: a medical report for sick leave, due date then birth notification for maternity, and so on', async () => {
    const p = await rows<{ name: string; document_name: string | null; document_when: string; followup_document_name: string | null; followup_within_days: number }>(
      `select t.name, p.document_name, p.document_when, p.followup_document_name, p.followup_within_days
       from current_leave_policies p join leave_types t on t.id = p.leave_type_id where t.tenant_id = '${A}'`);
    const by = Object.fromEntries(p.map((r) => [r.name, r]));
    expect(by['Sick Leave']).toMatchObject({ document_name: 'Report from a registered medical practitioner stating the rest period', document_when: 'with_application' });
    expect(by['Maternity Leave']).toMatchObject({ document_name: 'Medical report with the expected delivery date', followup_document_name: 'Birth notification', followup_within_days: 30 });
    expect(by['Paternity Leave'].document_name).toBe('Birth notification');
    expect(by['Adoption Leave'].document_name).toBe('Custody agreement from the adoption agency');
    expect(by['Annual Leave'].document_name).toBeNull();
  });

  it('staff can see which leave types need which documents', async () => {
    const r = (await asUser(db, STAFF, () => rows<{ r: { leave_type: string; name: string | null; followup_name: string | null }[] }>(`select leave_document_rules() r`)))[0].r;
    expect(r.map((x) => x.leave_type)).toEqual(['Adoption Leave', 'Maternity Leave', 'Paternity Leave', 'Sick Leave']);
    expect(r.find((x) => x.leave_type === 'Maternity Leave')).toMatchObject({ followup_name: 'Birth notification' });
  });

  it('the forms are told which document is needed', async () => {
    const c = (await asUser(db, STAFF, () =>
      rows<{ c: { document: { name: string; when: string } } }>(`select leave_request_check('ME', 'Sick Leave', '2030-03-04', '2030-03-05') c`)))[0].c;
    expect(c.document).toMatchObject({ name: 'Report from a registered medical practitioner stating the rest period', when: 'with_application' });
  });
});

describe('with the application', () => {
  it('an employee cannot apply for sick leave without the report', async () => {
    expect(await apply(STAFF, 'ME', 'Sick Leave', '2030-03-04', '2030-03-05'))
      .toMatch(/Sick Leave needs a document with the application: Report from a registered medical practitioner/);
  });

  it('with the report from their own folder, they can; it is kept with the date it came in', async () => {
    expect(await apply(STAFF, 'ME', 'Sick Leave', '2030-03-04', '2030-03-05', file(STAFF))).toBe('');
    const l = await lastLeave('ME');
    expect(l.document_path).toBe(file(STAFF));
    expect(l.document_uploaded_at).not.toBeNull();
  });

  it("a file from someone else's folder, or another company's, is refused", async () => {
    expect(await apply(STAFF, 'ME', 'Sick Leave', '2030-04-01', '2030-04-02', file(OTHER))).toMatch(/not uploaded here/);
    expect(await apply(STAFF, 'ME', 'Sick Leave', '2030-04-01', '2030-04-02', file(STAFF, B))).toMatch(/not uploaded here/);
  });

  it('HR entering sick leave for someone may add the report later', async () => {
    expect(await apply(HR, 'THEM', 'Sick Leave', '2030-03-11', '2030-03-11')).toBe('');
  });

  it('"only for leave longer than N days": a short absence needs none', async () => {
    await setSick('document_if_longer_than = 2');
    expect(await apply(STAFF, 'ME', 'Sick Leave', '2030-05-06', '2030-05-07')).toBe('');
    expect(await apply(STAFF, 'ME', 'Sick Leave', '2030-05-13', '2030-05-15')).toMatch(/needs a document/);
    await setSick('document_if_longer_than = 0');
  });

  it('a document due after the leave starts is not needed to apply', async () => {
    await setSick(`document_when = 'after', document_within_days = 7`);
    expect(await apply(STAFF, 'ME', 'Sick Leave', '2030-06-03', '2030-06-04')).toBe('');
    await setSick(`document_when = 'with_application', document_within_days = 0`);
  });
});

describe('adding a document afterwards', () => {
  it('the employee adds the follow-up document to their own leave; HR can too; a colleague cannot', async () => {
    const leave = await lastLeave('ME');
    expect(await asUser(db, STAFF, () => run(`select attach_leave_document('${leave.id}', 'followup', '${file(STAFF)}', 'birth.pdf')`))).toBe('');
    expect((await lastLeave('ME')).followup_document_path).toBe(file(STAFF));
    expect(await asUser(db, OTHER, () => run(`select attach_leave_document('${leave.id}', 'main', '${file(OTHER)}', 'x.pdf')`)))
      .toMatch(/Only the employee or HR/);
    expect(await asUser(db, HR, () => run(`select attach_leave_document('${leave.id}', 'main', '${file(HR)}', 'scan.pdf')`))).toBe('');
    expect((await lastLeave('ME')).document_path).toBe(file(HR));
  });

  it("refuses a file from another login's folder, or an unknown kind", async () => {
    const leave = await lastLeave('ME');
    expect(await asUser(db, STAFF, () => run(`select attach_leave_document('${leave.id}', 'main', '${file(OTHER)}', 'x.pdf')`))).toMatch(/not uploaded here/);
    expect(await asUser(db, STAFF, () => run(`select attach_leave_document('${leave.id}', 'other', '${file(STAFF)}', 'x.pdf')`))).toMatch(/Unknown document/);
  });
});
