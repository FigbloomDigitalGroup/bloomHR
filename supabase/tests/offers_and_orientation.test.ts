// @vitest-environment node
//
// After hiring (20261016000000): offer letters with a public token link (only its holder sees that offer, answers it
// once, before it expires), adding the candidate as an employee, orientation checklists, required training and tests
// marked in the database. HR is ADMIN or the Employees or Recruitment module; each company sees only its own.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, bootDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const HR = '00000000-0000-0000-0000-00000000c311';
const REC = '00000000-0000-0000-0000-00000000c312';
const STAFF = '00000000-0000-0000-0000-00000000c313';
const PAY = '00000000-0000-0000-0000-00000000c314';
const ADMIN_B = '00000000-0000-0000-0000-00000000c315';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const as = <T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) => asUser(db, user, () => rows<T>(sql, params));
const anon = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => asAnon(db, () => rows<T>(sql, params));
const fails = async (p: Promise<unknown>) => {
  try {
    await p;
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};
const newOffer = async (user: string, fields: Record<string, unknown> = {}) => {
  const all = {
    candidate_first_name: 'Jane', candidate_last_name: 'Wanjiku', candidate_email: 'Jane@Gmail.com', job_title: 'Accountant',
    body: 'Dear {{candidate_name}}', ...fields,
  };
  const cols = Object.keys(all).join(', ');
  const vals = Object.keys(all).map((_, i) => `$${i + 1}`).join(', ');
  return (await as<{ id: string }>(user, `insert into job_offers (${cols}, start_date, expiry_date) values (${vals}, current_date + 30, current_date + 7) returning id`,
    Object.values(all)))[0].id;
};
const send = async (user: string, id: string) => (await as<{ t: string }>(user, `select send_offer($1) t`, [id]))[0].t;
const status = async (id: string) => (await rows<{ status: string }>(`select status from job_offers where id = $1`, [id]))[0].status;

beforeAll(async () => {
  db = await bootDb();
  await db.exec(`delete from public.role_permissions where tenant_id = '${A}'`);
  await db.exec(`insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co')`);
  for (const [id, email, role, tenant] of [
    [HR, 'hr@a.co', 'HR', A], [REC, 'rec@a.co', 'RECRUITER', A], [STAFF, 'staff@a.co', 'STAFF', A],
    [PAY, 'pay@a.co', 'FINANCE', A], [ADMIN_B, 'admin@b.co', 'ADMIN', B],
  ]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${tenant}');
    `);
  }
  await db.exec(`insert into role_permissions (role_name, permissions, tenant_id) values
    ('HR', array['employees'], '${A}'), ('RECRUITER', array['recruitment'], '${A}'), ('STAFF', array['dashboard'], '${A}'),
    ('FINANCE', array['payroll'], '${A}')`);
  await db.exec(`insert into employees ("Employee Number", "First Name", "Work Email", "Job Title", tenant_id)
    values ('STAFF-1', 'Sam', 'staff@a.co', 'Clerk', '${A}')`);
}, 120000);

describe('offer letter templates', () => {
  it('every company has one default template, with the placeholders', async () => {
    const t = await rows<{ tenant_id: string; body: string; is_default: boolean }>(`select tenant_id, body, is_default from offer_letter_templates order by tenant_id`);
    expect(t.map((r) => [r.tenant_id, r.is_default])).toEqual([[A, true], [B, true]]);
    expect(t[0].body).toMatch(/\{\{candidate_name\}\}[\s\S]*\{\{basic_salary\}\}[\s\S]*\{\{expiry_date\}\}/);
  });

  it('HR and Recruitment manage them; staff and payroll don’t see them', async () => {
    expect(await as(HR, `select 1 from offer_letter_templates`)).toHaveLength(1);
    await as(REC, `insert into offer_letter_templates (title, body) values ('Intern offer', 'Hi {{candidate_name}}')`);
    expect(await as(STAFF, `select 1 from offer_letter_templates`)).toHaveLength(0);
    expect(await as(PAY, `select 1 from offer_letter_templates`)).toHaveLength(0);
    expect(await fails(as(STAFF, `insert into offer_letter_templates (title, body) values ('x', 'y')`))).toMatch(/row-level security/);
  });
});

describe('offers', () => {
  it('a job group fills the pay from its current rate', async () => {
    const [g] = await as<{ id: string }>(HR, `insert into job_groups (code, name) values ('G4', 'Grade 4') returning id`);
    await as(HR, `insert into job_group_rates (job_group_id, effective_from, basic_salary, house_allowance, travel_allowance)
      values ($1, current_date - 1, 80000, 12000, 3000)`, [g.id]);
    const id = await newOffer(REC, { job_group_id: g.id, basic_salary: 1 });
    expect((await rows(`select basic_salary::float8 b, house_allowance::float8 h, travel_allowance::float8 t from job_offers where id = $1`, [id]))[0])
      .toEqual({ b: 80000, h: 12000, t: 3000 });
    const groups = await as<{ code: string; basic_salary: string }>(REC, `select code, basic_salary::text from offer_job_groups()`);
    expect(groups).toContainEqual({ code: 'G4', basic_salary: '80000.00' });
    expect(await fails(as(STAFF, `select * from offer_job_groups()`))).toMatch(/may not/);
  });

  it('starts as a draft; its status moves only through the functions', async () => {
    expect(await fails(newOffer(HR, { status: 'accepted' }))).toMatch(/starts as a draft/);
    const id = await newOffer(HR);
    expect(await fails(as(HR, `update job_offers set status = 'accepted' where id = $1`, [id]))).toMatch(/buttons/);
    await as(HR, `update job_offers set job_title = 'Senior Accountant' where id = $1`, [id]);
    await send(HR, id);
    expect(await fails(as(HR, `update job_offers set job_title = 'CEO' where id = $1`, [id]))).toMatch(/sent and can no longer be changed/);
    expect(await fails(as(HR, `delete from job_offers where id = $1`, [id]))).toMatch(/withdraw/);
  });

  it('can’t be sent without an email or with an expiry in the past', async () => {
    const id = await newOffer(HR, { candidate_email: null });
    expect(await fails(send(HR, id))).toMatch(/email/);
    const late = (await as<{ id: string }>(HR, `insert into job_offers (candidate_first_name, candidate_email, job_title, body, start_date, expiry_date)
      values ('Al', 'al@x.co', 'Clerk', 'b', current_date + 5, current_date - 1) returning id`))[0].id;
    expect(await fails(send(HR, late))).toMatch(/expiry/);
    expect(await fails(send(STAFF, late))).toMatch(/Only HR/);
  });

  it('only the token holder sees that offer, with the company’s branding, and nothing else', async () => {
    const id = await newOffer(HR, { candidate_first_name: 'Token', basic_salary: 50000 });
    const token = await send(HR, id);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    // only the hash is stored
    expect((await rows<{ token_hash: string }>(`select token_hash from job_offers where id = $1`, [id]))[0].token_hash).not.toBe(token);
    const [{ o }] = await anon<{ o: Record<string, any> }>(`select offer_by_token($1) o`, [token]);
    expect(o).toMatchObject({ candidate_first_name: 'Token', status: 'sent', basic_salary: 50000, company: { name: expect.any(String) } });
    expect(o).not.toHaveProperty('token_hash');
    expect(o).not.toHaveProperty('id');
    expect((await anon<{ o: unknown }>(`select offer_by_token($1) o`, ['0'.repeat(64)]))[0].o).toBeNull();
    expect((await anon<{ o: unknown }>(`select offer_by_token($1) o`, ['']))[0].o).toBeNull();
    // anon reads no table directly
    expect(await anon(`select 1 from job_offers`).catch(() => [])).toHaveLength(0);
    // the first view is noted
    expect((await rows(`select viewed_at is not null v from job_offers where id = $1`, [id]))[0]).toEqual({ v: true });
  });

  it('sending again replaces the link', async () => {
    const id = await newOffer(HR);
    const first = await send(HR, id);
    const second = await send(HR, id);
    expect((await anon<{ o: unknown }>(`select offer_by_token($1) o`, [first]))[0].o).toBeNull();
    expect((await anon<{ o: { status: string } }>(`select offer_by_token($1) o`, [second]))[0].o.status).toBe('sent');
  });

  it('is accepted or declined once, by the token holder', async () => {
    const id = await newOffer(HR);
    const token = await send(HR, id);
    expect(await anon(`select respond_to_offer($1, true) s`, [token])).toEqual([{ s: 'accepted' }]);
    expect(await fails(anon(`select respond_to_offer($1, false, 'changed my mind')`, [token]))).toMatch(/already accepted/);
    expect(await status(id)).toBe('accepted');

    const id2 = await newOffer(HR);
    const token2 = await send(HR, id2);
    expect(await fails(anon(`select respond_to_offer($1, true)`, ['f'.repeat(64)]))).toMatch(/not valid/);
    await anon(`select respond_to_offer($1, false, '  Took another job  ')`, [token2]);
    expect((await rows(`select status, decline_reason from job_offers where id = $1`, [id2]))[0])
      .toEqual({ status: 'declined', decline_reason: 'Took another job' });
    expect(await fails(anon(`select respond_to_offer($1, true)`, [token2]))).toMatch(/already declined/);
  });

  it('can’t be answered after it expires; the daily job marks it expired', async () => {
    const id = await newOffer(HR);
    const token = await send(HR, id);
    await db.exec(`set session_replication_role = replica; update job_offers set expiry_date = current_date - 1 where id = '${id}'; set session_replication_role = default`);
    expect((await anon<{ o: { status: string } }>(`select offer_by_token($1) o`, [token]))[0].o.status).toBe('expired');
    expect(await fails(anon(`select respond_to_offer($1, true)`, [token]))).toMatch(/expired on/);
    expect(await rows(`select expire_job_offers() n`)).toEqual([{ n: 1 }]);
    expect(await status(id)).toBe('expired');
    expect(await fails(as(HR, `select expire_job_offers()`))).toMatch(/permission denied/);
  });

  it('a withdrawn offer’s link stops working', async () => {
    const id = await newOffer(HR);
    const token = await send(HR, id);
    await as(HR, `select withdraw_offer($1)`, [id]);
    expect((await anon<{ o: unknown }>(`select offer_by_token($1) o`, [token]))[0].o).toBeNull();
    expect(await fails(anon(`select respond_to_offer($1, true)`, [token]))).toMatch(/not valid/);
    expect(await fails(as(HR, `select send_offer($1)`, [id]))).toMatch(/withdrawn/);
  });

  it('an accepted offer becomes an employee once, in draft onboarding, by people who manage employees', async () => {
    const [g] = await rows<{ id: string }>(`select id from job_groups where code = 'G4'`);
    const id = await newOffer(HR, { candidate_first_name: 'Neema', candidate_last_name: 'Otieno', candidate_email: 'neema@gmail.com', job_group_id: g.id });
    expect(await fails(as(HR, `select * from add_offer_employee($1)`, [id]))).toMatch(/Only an accepted offer/);
    await anon(`select respond_to_offer($1, true)`, [await send(HR, id)]);
    expect(await fails(as(REC, `select * from add_offer_employee($1)`, [id]))).toMatch(/manage employees/);
    const [added] = await as<{ employee_id: string; employee_number: string; work_email: string }>(HR,
      `select * from add_offer_employee($1, ' Neema@Company.co.ke ')`, [id]);
    expect(added.work_email).toBe('neema@company.co.ke');
    const [e] = await rows(`select "First Name" f, "Last Name" l, "Personal Email" p, "Job Title" j, onboarding_status s,
      "Basic Salary"::float8 b, "Job Group" g from employees where id = $1`, [added.employee_id]);
    expect(e).toEqual({ f: 'Neema', l: 'Otieno', p: 'neema@gmail.com', j: 'Accountant', s: 'draft', b: 80000, g: 'G4' });
    expect((await rows(`select employee_id from job_offers where id = $1`, [id]))[0]).toEqual({ employee_id: added.employee_id });
    expect(await fails(as(HR, `select * from add_offer_employee($1)`, [id]))).toMatch(/already been added/);
  });

  it('each company sees and acts on only its own offers', async () => {
    const id = await newOffer(HR);
    expect(await as(ADMIN_B, `select 1 from job_offers where id = $1`, [id])).toHaveLength(0);
    expect(await fails(as(ADMIN_B, `select send_offer($1)`, [id]))).toMatch(/not found/);
    expect(await fails(as(ADMIN_B, `select withdraw_offer($1)`, [id]))).toMatch(/not found/);
    const [gB] = await as<{ id: string }>(ADMIN_B, `insert into job_groups (code, name) values ('B1', 'B1') returning id`);
    expect(await fails(newOffer(HR, { job_group_id: gB.id }))).toMatch(/foreign key/);
    expect(await as(STAFF, `select 1 from job_offers`)).toHaveLength(0);
  });
});

describe('orientation checklists', () => {
  let general: string;
  let accountants: string;

  it('a new employee gets the template for their job title, else the default, with due dates from the start date', async () => {
    general = (await as<{ id: string }>(HR, `insert into orientation_templates (name, is_default) values ('General', true) returning id`))[0].id;
    accountants = (await as<{ id: string }>(REC, `insert into orientation_templates (name, job_title) values ('Finance team', ' accountant ') returning id`))[0].id;
    await as(HR, `insert into orientation_template_items (template_id, position, title, owner_role, due_offset_days) values
      ($1, 1, 'Laptop and email', 'hr', -1), ($1, 2, 'Read the handbook', 'employee', 3), ($2, 1, 'Meet the CFO', 'manager', 1)`, [general, accountants]);
    await as(HR, `insert into employees ("Employee Number", "First Name", "Work Email", "Job Title", "Start Date") values
      ('NEW-1', 'Nia', 'nia@a.co', 'Driver', '2030-01-10'), ('NEW-2', 'Ali', 'ali@a.co', 'Accountant', '2030-01-10')`);
    const items = await rows<{ n: string; title: string; due: string; owner_role: string }>(`select e."Employee Number" n, i.title, i.due_date::text due, i.owner_role
      from employee_orientation_items i join employees e on e.id = i.employee_id where e."Employee Number" like 'NEW-%' order by 1, i.position`);
    expect(items).toEqual([
      { n: 'NEW-1', title: 'Laptop and email', due: '2030-01-09', owner_role: 'hr' },
      { n: 'NEW-1', title: 'Read the handbook', due: '2030-01-13', owner_role: 'employee' },
      { n: 'NEW-2', title: 'Meet the CFO', due: '2030-01-11', owner_role: 'manager' },
    ]);
  });

  it('HR assigns another; items already done are kept', async () => {
    const [emp] = await rows<{ id: string }>(`select id from employees where "Employee Number" = 'NEW-2'`);
    const [item] = await rows<{ id: string }>(`select id from employee_orientation_items where employee_id = $1`, [emp.id]);
    await as(HR, `select set_orientation_item_done($1, true)`, [item.id]);
    expect(await as(HR, `select assign_orientation($1, $2) n`, [emp.id, general])).toEqual([{ n: 2 }]);
    expect((await rows(`select title from employee_orientation_items where employee_id = $1 order by title`, [emp.id])).map((r) => r.title))
      .toEqual(['Laptop and email', 'Meet the CFO', 'Read the handbook']);
    expect(await fails(as(STAFF, `select assign_orientation($1, $2)`, [emp.id, general]))).toMatch(/Only HR/);
  });

  it('the employee ticks only their own items marked for them, and sees only their own checklist', async () => {
    // the staff user is now NEW-1
    await db.exec(`update employees set "Work Email" = 'old-staff@a.co' where "Employee Number" = 'STAFF-1';
      update employees set "Work Email" = 'staff@a.co' where "Employee Number" = 'NEW-1'`);
    const mine = await as<{ id: string; owner_role: string }>(STAFF, `select id, owner_role from employee_orientation_items order by position`);
    expect(mine.map((r) => r.owner_role)).toEqual(['hr', 'employee']);
    await as(STAFF, `select set_orientation_item_done($1, true)`, [mine[1].id]);
    expect(await fails(as(STAFF, `select set_orientation_item_done($1, true)`, [mine[0].id]))).toMatch(/HR ticks/);
    const other = (await rows<{ id: string }>(`select i.id from employee_orientation_items i join employees e on e.id = i.employee_id
      where e."Employee Number" = 'NEW-2' limit 1`))[0].id;
    expect(await fails(as(STAFF, `select set_orientation_item_done($1, true)`, [other]))).toMatch(/HR ticks/);
    expect(await as(STAFF, `update employee_orientation_items set done_at = now() returning 1`)).toEqual([]);
    const after = await as<{ orientation: { done_at: string | null }[] }>(STAFF, `select after_hiring() ->'orientation' orientation`);
    expect(after[0].orientation.map((i) => i.done_at !== null)).toEqual([false, true]);
  });

  it('each company sees only its own templates and checklists', async () => {
    expect(await as(ADMIN_B, `select 1 from orientation_templates`)).toHaveLength(0);
    expect(await as(ADMIN_B, `select 1 from employee_orientation_items`)).toHaveLength(0);
    const [emp] = await rows<{ id: string }>(`select id from employees where "Employee Number" = 'NEW-1'`);
    expect(await fails(as(ADMIN_B, `select after_hiring($1)`, [emp.id]))).toMatch(/not found/);
  });
});

describe('required training', () => {
  it('lists the required items with due dates; done when training_progress says so', async () => {
    const [v] = await rows<{ id: string }>(`insert into training_videos (title, tenant_id) values ('Safety basics', '${A}') returning id`);
    const [d] = await rows<{ id: string }>(`insert into training_documents (title, tenant_id) values ('Finance manual', '${A}') returning id`);
    await as(HR, `insert into required_training (item_kind, item_id, due_days) values ('video', $1, 7)`, [v.id]);
    await as(HR, `insert into required_training (item_kind, item_id, job_title, due_days) values ('document', $1, 'Accountant', 14)`, [d.id]);
    const [vB] = await rows<{ id: string }>(`insert into training_videos (title, tenant_id) values ('B video', '${B}') returning id`);
    expect(await fails(as(HR, `insert into required_training (item_kind, item_id) values ('video', $1)`, [vB.id]))).toMatch(/not in your company/);

    const [emp] = await rows<{ id: string }>(`select id from employees where "Employee Number" = 'NEW-1'`);
    let [{ t }] = await as<{ t: { title: string; due_date: string; completed: boolean }[] }>(HR, `select after_hiring($1) -> 'training' t`, [emp.id]);
    expect(t).toEqual([expect.objectContaining({ title: 'Safety basics', due_date: '2030-01-17', completed: false })]);
    await db.exec(`insert into training_progress (document_id, employee_number, completed, completed_at, tenant_id)
      values ('${v.id}', 'NEW-1', true, now(), '${A}')`);
    [{ t }] = await as<{ t: { completed: boolean }[] }>(STAFF, `select after_hiring() -> 'training' t`);
    expect(t.map((x) => x.completed)).toEqual([true]);
    const [acc] = await rows<{ id: string }>(`select id from employees where "Employee Number" = 'NEW-2'`);
    [{ t }] = await as<{ t: { title: string }[] }>(HR, `select after_hiring($1) -> 'training' t`, [acc.id]);
    expect(t.map((x) => x.title).sort()).toEqual(['Finance manual', 'Safety basics']);
    expect(await fails(as(STAFF, `select after_hiring($1)`, [acc.id]))).toMatch(/Only HR/);
  });
});

describe('tests', () => {
  let quiz: string;

  it('a test set to be given to new employees is assigned when they are added', async () => {
    quiz = (await as<{ id: string }>(HR, `insert into quizzes (title, pass_mark, auto_assign, due_days) values ('Policies quiz', 60, true, 5) returning id`))[0].id;
    await as(HR, `insert into quiz_questions (quiz_id, position, question, options, correct_index) values
      ($1, 1, 'Working hours start at?', array['7am', '8am', '9am'], 1),
      ($1, 2, 'Report an incident to?', array['HR', 'Nobody'], 0),
      ($1, 3, 'Leave days a year?', array['10', '21', '30'], 1)`, [quiz]);
    expect(await fails(as(HR, `insert into quiz_questions (quiz_id, question, options, correct_index) values ($1, 'Bad', array['a', 'b'], 2)`, [quiz])))
      .toMatch(/check/);
    await as(HR, `insert into employees ("Employee Number", "First Name", "Work Email", "Job Title") values ('NEW-3', 'Tom', 'tom@a.co', 'Driver')`);
    expect(await rows(`select 1 from quiz_assignments a join employees e on e.id = a.employee_id where e."Employee Number" = 'NEW-3'`)).toHaveLength(1);
  });

  it('the employee sees the questions without the answers, and nobody else’s test', async () => {
    const [emp] = await rows<{ id: string }>(`select id from employees where "Employee Number" = 'NEW-1'`);
    const [{ a }] = await as<{ a: string }>(HR, `select assign_quiz($1, $2) a`, [quiz, emp.id]);
    const [{ q }] = await as<{ q: { questions: Record<string, unknown>[] } }>(STAFF, `select quiz_to_take($1) q`, [a]);
    expect(q.questions).toHaveLength(3);
    expect(JSON.stringify(q)).not.toMatch(/correct/);
    expect(await as(STAFF, `select * from quiz_questions`)).toHaveLength(0);
    const [other] = await rows<{ id: string }>(`select a.id from quiz_assignments a join employees e on e.id = a.employee_id where e."Employee Number" = 'NEW-3'`);
    expect(await fails(as(STAFF, `select quiz_to_take($1)`, [other.id]))).toMatch(/not found/);
    expect(await fails(as(STAFF, `select submit_quiz($1, array[1, 0, 1])`, [other.id]))).toMatch(/not found/);
  });

  it('is marked here: the score, pass or fail, once; HR can allow another attempt', async () => {
    const [a] = await as<{ id: string }>(STAFF, `select id from quiz_assignments`);
    expect(await fails(as(STAFF, `select submit_quiz($1, array[1])`, [a.id]))).toMatch(/every question/);
    const [{ r }] = await as<{ r: Record<string, unknown> }>(STAFF, `select submit_quiz($1, array[1, 1, 1]) r`, [a.id]);
    expect(r).toEqual({ score: 67, passed: true, correct: 2, total: 3, pass_mark: 60 });
    expect(await fails(as(STAFF, `select submit_quiz($1, array[1, 0, 1])`, [a.id]))).toMatch(/already taken/);
    expect(await as(STAFF, `update quiz_assignments set score = 100 returning 1`)).toEqual([]);
    const [res] = await as<{ score: number; passed: boolean; attempts: number }>(HR, `select score, passed, attempts from quiz_assignments where id = $1`, [a.id]);
    expect(res).toEqual({ score: 67, passed: true, attempts: 1 });

    await as(HR, `select reset_quiz_assignment($1)`, [a.id]);
    const [{ r: again }] = await as<{ r: Record<string, unknown> }>(STAFF, `select submit_quiz($1, array[0, 1, 0]) r`, [a.id]);
    expect(again).toMatchObject({ score: 0, passed: false });
    expect((await rows(`select attempts from quiz_assignments where id = $1`, [a.id]))[0]).toEqual({ attempts: 2 });
    expect(await fails(as(STAFF, `select reset_quiz_assignment($1)`, [a.id]))).toMatch(/Only HR/);
  });

  it('HR sees the results and progress; other companies don’t', async () => {
    const [emp] = await rows<{ id: string }>(`select id from employees where "Employee Number" = 'NEW-1'`);
    const [{ t }] = await as<{ t: { title: string; score: number; passed: boolean; question_count: number }[] }>(HR, `select after_hiring($1) -> 'tests' t`, [emp.id]);
    expect(t).toEqual([expect.objectContaining({ title: 'Policies quiz', score: 0, passed: false, question_count: 3 })]);
    const summary = await as<{ orientation_done: number; orientation_total: number; tests_total: number }>(REC,
      `select orientation_done, orientation_total, tests_total from after_hiring_summary() where employee_id = $1`, [emp.id]);
    expect(summary).toEqual([{ orientation_done: 1, orientation_total: 2, tests_total: 1 }]);
    expect(await as(ADMIN_B, `select 1 from quiz_assignments`)).toHaveLength(0);
    expect(await as(ADMIN_B, `select 1 from quizzes`)).toHaveLength(0);
    expect(await as(ADMIN_B, `select * from after_hiring_summary()`)).toHaveLength(0);
    expect(await fails(as(ADMIN_B, `select assign_quiz($1, $2)`, [quiz, emp.id]))).toMatch(/not found/);
    expect(await fails(as(STAFF, `select * from after_hiring_summary()`))).toMatch(/Only HR/);
  });

  it('removing an employee clears the link from their offer', async () => {
    const [o] = await rows<{ id: string; employee_id: string }>(`select id, employee_id from job_offers where employee_id is not null limit 1`);
    await db.exec(`delete from employees where id = '${o.employee_id}'`);
    expect((await rows(`select status, employee_id from job_offers where id = $1`, [o.id]))[0]).toEqual({ status: 'accepted', employee_id: null });
  });
});
