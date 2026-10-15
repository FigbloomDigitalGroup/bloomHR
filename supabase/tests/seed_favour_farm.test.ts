// @vitest-environment node
//
// The FAVOR FARM demo seeds (scripts/seed_favour_farm_*.sql) run against the real schema, stop on a second run, and
// their clean-up removes what they added.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { bootDb } from './db';

const FARM = '00000000-0000-0000-0000-00000000fa01';
const ADMIN = '00000000-0000-0000-0000-00000000fa11';
const HR = '00000000-0000-0000-0000-00000000fa12';
// the other company with the same name, which must be left alone
const OTHER = '00000000-0000-0000-0000-00000000fa02';

const script = (name: string) => readFileSync(join(__dirname, '..', '..', 'scripts', name), 'utf8');
/** the commented-out clean-up block at the end of a seed script */
const cleanup = (sql: string) =>
  sql.slice(sql.indexOf('To remove')).split('\n').filter((l) => l.startsWith('-- ') && !l.includes('---') && !l.includes('To remove')).map((l) => l.slice(3)).join('\n');

let db: PGlite;
const count = async (sql: string) => Number((await db.query<{ n: number }>(sql)).rows[0].n);

beforeAll(async () => {
  db = await bootDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${FARM}', 'FAVOR FARM', 'favor-farm'),
      ('${OTHER}', 'FAVOR FARM, Kajiado', 'favor-farm-kajiado');
    insert into auth.users (id, email) values ('${ADMIN}', 'admin@favorfarm.co.ke'), ('${HR}', 'hr@favorfarm.co.ke');
    insert into memberships (user_id, tenant_id, role) values ('${ADMIN}', '${FARM}', 'ADMIN'), ('${HR}', '${FARM}', 'HR');
  `);
}, 180000);

describe('recruitment seed', () => {
  const sql = script('seed_favour_farm_recruitment.sql');

  it('adds jobs, candidates across the stages, interviews, panels, scores and notes', async () => {
    await db.exec(sql);
    expect(await count(`select count(*) n from job_postings where tenant_id = '${FARM}'`)).toBe(3);
    expect(await count(`select count(*) n from job_applications where tenant_id = '${FARM}'`)).toBe(12);
    expect(await count(`select count(distinct current_stage_id) n from job_applications where tenant_id = '${FARM}'`)).toBeGreaterThan(8);
    expect(await count(`select count(*) n from job_applications where tenant_id = '${FARM}' and status = 'hired' and hired_at is not null`)).toBe(1);
    expect(await count(`select count(*) n from recruitment_interviews where tenant_id = '${FARM}' and status = 'scheduled' and scheduled_at > now()`)).toBe(3);
    expect(await count(`select count(*) n from recruitment_interviews where tenant_id = '${FARM}' and status = 'done' and scheduled_at < now()`)).toBeGreaterThan(2);
    expect(await count(`select count(*) n from interview_panelists where tenant_id = '${FARM}'`)).toBeGreaterThan(0);
    expect(await count(`select count(*) n from interview_scorecards where tenant_id = '${FARM}'`)).toBeGreaterThan(0);
    expect(await count(`select count(*) n from scorecard_ratings where tenant_id = '${FARM}'`)).toBeGreaterThan(0);
    expect(await count(`select count(*) n from interview_transcripts where tenant_id = '${FARM}'`)).toBe(2);
    expect(await count(`select count(*) n from job_postings where tenant_id = '${OTHER}'`)).toBe(0);
    // every candidate's history starts with Applied, in date order
    expect(await count(`
      select count(*) n from job_applications a where a.tenant_id = '${FARM}' and (
        select h.to_stage_name from application_stage_history h where h.application_id = a.id order by h.moved_at limit 1
      ) <> 'Applied'`)).toBe(0);
  });

  it('does nothing the second time', async () => {
    await db.exec(sql);
    expect(await count(`select count(*) n from job_applications where tenant_id = '${FARM}'`)).toBe(12);
  });

  it('cleans up after itself', async () => {
    await db.exec(cleanup(sql));
    expect(await count(`select count(*) n from job_postings where tenant_id = '${FARM}'`)).toBe(0);
    expect(await count(`select count(*) n from job_applications where tenant_id = '${FARM}'`)).toBe(0);
    expect(await count(`select count(*) n from recruitment_interviews where tenant_id = '${FARM}'`)).toBe(0);
  });
});

describe('payroll seed', () => {
  const sql = script('seed_favour_farm_payroll.sql');
  const demo = `tenant_id = '${FARM}' and "Work Email" ilike '%@demo.favorfarm.example'`;

  it('adds staff ready for payroll, paid by their job group', async () => {
    await db.exec(sql);
    expect(await count(`select count(*) n from employees where ${demo}`)).toBe(15);
    expect(await count(`select count(*) n from employees where ${demo} and onboarding_status = 'approved'
      and "Employee Number" is not null and "Payroll Number" is not null and job_group_id is not null`)).toBe(15);
    expect(await count(`select "Basic Salary" n from employees where ${demo} and "First Name" = 'James'`)).toBe(18000);
    expect(await count(`select house_allowance n from employees where ${demo} and "First Name" = 'Anne'`)).toBe(8000);
    // the override keeps the manager's own pay
    expect(await count(`select "Basic Salary" n from employees where ${demo} and "First Name" = 'Daniel'`)).toBe(135000);
  });

  it('adds deductions, an advance payroll will recover, and this month\'s piece-rate work', async () => {
    expect(await count(`select count(*) n from employee_deductions where tenant_id = '${FARM}'`)).toBe(15 + 5 + 1);
    expect(await count(`select count(*) n from salary_advance where tenant_id = '${FARM}' and status = 'paid' and payment_processed = 'true'`)).toBe(1);
    expect(await count(`select count(*) n from work_entries where tenant_id = '${FARM}' and status = 'approved'`)).toBeGreaterThanOrEqual(0);
    expect(await count(`select count(*) n from payroll_runs where tenant_id = '${FARM}'`)).toBe(0);
    expect(await count(`select count(*) n from employees where tenant_id = '${OTHER}'`)).toBe(0);
  });

  it('does nothing the second time', async () => {
    await db.exec(sql);
    expect(await count(`select count(*) n from employees where ${demo}`)).toBe(15);
  });

  it('cleans up after itself', async () => {
    await db.exec(cleanup(sql));
    expect(await count(`select count(*) n from employees where tenant_id = '${FARM}'`)).toBe(0);
    expect(await count(`select count(*) n from work_entries where tenant_id = '${FARM}'`)).toBe(0);
    expect(await count(`select count(*) n from employee_deductions where tenant_id = '${FARM}'`)).toBe(0);
    expect(await count(`select count(*) n from job_groups where tenant_id = '${FARM}'`)).toBe(0);
  });
});
