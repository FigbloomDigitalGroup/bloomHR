// @vitest-environment node
//
// Work injury (WIBA) cases (20261022800000_work_injury_cases.sql): the new incident types, opening a case from an
// incident report, the country from the employee's branch, the step dates, the company's cover, files in the case's
// folder, who sees what (the Incidents module, own company only), and running the migration again.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000b0228';
const HR = '00000000-0000-0000-0000-00000000a281';
const STAFF = '00000000-0000-0000-0000-00000000a282';
const OTHER = '00000000-0000-0000-0000-00000000a283'; // HR at company B
const INCIDENT = '00000000-0000-0000-0000-00000000a2f1';
const MIGRATION = join(__dirname, '..', 'migrations', '20261022800000_work_injury_cases.sql');

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const as = (user: string, sql: string) => asUser(db, user, () => db.exec(sql));
const read = <T = Record<string, unknown>>(user: string, sql: string) => asUser(db, user, () => rows<T>(sql));

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'B Co', 'b-co-wiba');
    insert into auth.users (id, email) values ('${HR}', 'hr@a.co'), ('${STAFF}', 'staff@a.co'), ('${OTHER}', 'hr@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${STAFF}', 'staff@a.co', 'STAFF', '${A}'), ('${OTHER}', 'hr@b.co', 'HR', '${B}');
    delete from role_permissions where tenant_id = '${B}';
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['incident-reports'], '${A}'), ('STAFF', array['dashboard'], '${A}'), ('HR', array['incident-reports'], '${B}');
    insert into branches (tenant_id, name, country) values ('${A}', 'Dar es Salaam', 'Tanzania');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", onboarding_status, "Branch", tenant_id) values
      ('W1', 'Amina', 'Wanjiru', 'w1@a.co', 'approved', null, '${A}'),
      ('W2', 'Tatu', 'Mushi', 'w2@a.co', 'approved', 'Dar es Salaam', '${A}');
    insert into incident_reports (id, employee_number, incident_type, severity, title, description, is_anonymous, tenant_id)
      values ('${INCIDENT}', 'W1', 'workplace_injury', 'high', 'Fell from ladder', 'In the store', false, '${A}');
  `);
}, 120000);

describe('work injury cases', () => {
  it('incident reports take the new kinds', async () => {
    await db.exec(`insert into incident_reports (employee_number, incident_type, severity, title, description, is_anonymous, tenant_id)
      values ('W1', 'occupational_disease', 'medium', 'Cough', 'Dust', false, '${A}')`);
    await expect(db.exec(`insert into incident_reports (employee_number, incident_type, severity, title, description, is_anonymous, tenant_id)
      values ('W1', 'not_a_kind', 'medium', 'x', 'y', false, '${A}')`)).rejects.toThrow();
  });

  it('HR opens a case from an incident; name, country and currency are filled in', async () => {
    await as(HR, `insert into work_injury_cases (incident_report_id, employee_number, occurred_at, place)
      values ('${INCIDENT}', 'W1', '2026-10-20 10:00+03', '  Store  ')`);
    await as(HR, `insert into work_injury_cases (employee_number, occurred_at) values ('W2', '2026-10-21 08:00+03')`);
    const list = await read<{ employee_number: string; employee_name: string; country: string; currency: string; place: string; status: string; employer_notified_on: string; tenant_id: string }>(HR,
      `select employee_number, employee_name, country, currency, place, status, employer_notified_on::text, tenant_id from work_injury_cases order by employee_number`);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ employee_name: 'Amina Wanjiru', country: 'Kenya', currency: 'KES', place: 'Store', status: 'reported', employer_notified_on: '2026-10-20', tenant_id: A });
    expect(list[1]).toMatchObject({ employee_name: 'Tatu Mushi', country: 'Tanzania', currency: 'TZS' });
  });

  it('a step reached gets its date; bad values are refused', async () => {
    await as(HR, `update work_injury_cases set status = 'claim_lodged' where employee_number = 'W1'`);
    const [c] = await read<{ authority_notified_on: string | null; claim_lodged_on: string | null; assessed_on: string | null }>(HR,
      `select authority_notified_on, claim_lodged_on, assessed_on from work_injury_cases where employee_number = 'W1'`);
    expect(c.authority_notified_on).not.toBeNull();
    expect(c.claim_lodged_on).not.toBeNull();
    expect(c.assessed_on).toBeNull();
    await expect(as(HR, `update work_injury_cases set status = 'lost' where employee_number = 'W1'`)).rejects.toThrow();
    await expect(as(HR, `update work_injury_cases set incapacity_percent = 120 where employee_number = 'W1'`)).rejects.toThrow();
    await expect(as(HR, `insert into work_injury_cases (employee_number, occurred_at) values ('NOBODY', now())`)).rejects.toThrow(/Unknown employee/);
  });

  it('only the Incidents module, only in its own company', async () => {
    expect(await read(STAFF, `select id from work_injury_cases`)).toHaveLength(0);
    await expect(as(STAFF, `insert into work_injury_cases (employee_number, occurred_at) values ('W1', now())`)).rejects.toThrow();
    expect(await read(OTHER, `select id from work_injury_cases`)).toHaveLength(0);
    // B's HR cannot open a case for A's employee or incident
    await expect(as(OTHER, `insert into work_injury_cases (employee_number, occurred_at, incident_report_id) values ('W1', now(), '${INCIDENT}')`)).rejects.toThrow();
  });

  it('the cover, and files only in the case’s folder', async () => {
    await as(HR, `insert into company_wiba_cover (insurer_name, policy_number, cover_expiry) values (' Jubilee ', 'WIBA-1', '2027-01-31')`);
    expect(await read(HR, `select insurer_name from company_wiba_cover`)).toEqual([{ insurer_name: 'Jubilee' }]);
    expect(await read(STAFF, `select insurer_name from company_wiba_cover`)).toHaveLength(0);
    expect(await read(OTHER, `select insurer_name from company_wiba_cover`)).toHaveLength(0);

    const [{ id }] = await read<{ id: string }>(HR, `select id from work_injury_cases where employee_number = 'W1'`);
    await as(HR, `insert into work_injury_documents (case_id, file_path, file_name) values ('${id}', '${A}/${HR}/work-injuries/${id}/x.pdf', 'report.pdf')`);
    await expect(as(HR, `insert into work_injury_documents (case_id, file_path, file_name) values ('${id}', '${A}/${HR}/policies/x.pdf', 'x.pdf')`)).rejects.toThrow(/folder/);
    expect(await read(HR, `select file_name from work_injury_documents`)).toEqual([{ file_name: 'report.pdf' }]);
  });

  it('runs again safely', async () => {
    await db.exec(readFileSync(MIGRATION, 'utf8'));
    expect(await read(HR, `select id from work_injury_cases`)).toHaveLength(2);
  }, 60000);
});
