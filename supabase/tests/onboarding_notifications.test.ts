// @vitest-environment node
//
// Onboarding notifications (20261013600000): the employee hears, in the staff portal's bell, when HR reviews their
// documents or onboarding, removes their photo or asks for a document; never about what they did themselves.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const U = {
  STAFF: '00000000-0000-0000-0000-00000000e101', // E-ME
  HR: '00000000-0000-0000-0000-00000000e103',
};

let db: PGlite;
let me = '';
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const mine = () => asUser(db, U.STAFF, () => rows<{ notification_type: string; title: string; message: string }>(
  `select notification_type, title, message from hr_notifications order by id desc`));
const latest = async () => (await mine())[0];
// signed in as someone without going through row-level security: for the steps the app does with a definer function
const signedInAs = async (user: string, sql: string) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${user}', false)`);
  try {
    await db.exec(sql);
  } finally {
    await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
  }
};

beforeAll(async () => {
  db = await bootLiveDb();
  for (const [id, email, role] of [[U.STAFF, 'me@a.co', 'STAFF'], [U.HR, 'hr@a.co', 'HR']]) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${A}');
    `);
  }
  await db.exec(`
    insert into role_permissions (role_name, permissions, tenant_id) values ('STAFF', array['dashboard'], '${A}'), ('HR', array['employees'], '${A}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", tenant_id) values ('E-ME', 'Amina', 'Wanjiru', 'me@a.co', '${A}');
  `);
  me = (await rows<{ id: string }>(`select id from employees where "Employee Number" = 'E-ME'`))[0].id;
}, 120000);

describe('onboarding notifications', () => {
  it('a document HR does not accept, with the reason; and one HR accepts', async () => {
    await asUser(db, U.STAFF, () => db.query(
      `insert into employee_documents (employee_id, code, file_path, file_name) values ('${me}', 'cv', '${A}/${U.STAFF}/onboarding/cv.pdf', 'cv.pdf')`));
    expect(await mine()).toEqual([]); // uploading is the employee's own doing
    const doc = (await rows<{ id: string }>(`select id from employee_documents where employee_id = '${me}'`))[0].id;

    await asUser(db, U.HR, () => db.query(`select review_employee_document('${doc}', 'reject', 'The scan is blurred')`));
    expect(await latest()).toEqual({
      notification_type: 'document_rejected',
      title: 'Document not accepted',
      message: 'HR did not accept your Updated CV (cv.pdf). Reason: The scan is blurred. Please upload it again.',
    });

    // back to waiting, as if uploaded again
    await db.exec(`select set_config('app.document_review', 'on', false); update employee_documents set status = 'pending' where id = '${doc}'; select set_config('app.document_review', '', false)`);
    await asUser(db, U.HR, () => db.query(`select review_employee_document('${doc}', 'accept')`));
    expect((await latest()).notification_type).toBe('document_accepted');
    expect((await latest()).message).toMatch(/^HR accepted your Updated CV \(cv\.pdf\)\.$/);
  });

  it('onboarding approved or sent back, with HR’s comment', async () => {
    await signedInAs(U.HR, `insert into employee_onboarding_reviews (tenant_id, employee_id, action, comment) values ('${A}', '${me}', 'changes_requested', 'Add your KRA PIN')`);
    expect(await latest()).toMatchObject({ notification_type: 'onboarding_changes_requested', message: expect.stringContaining('Comment: Add your KRA PIN') });
    await signedInAs(U.HR, `insert into employee_onboarding_reviews (tenant_id, employee_id, action) values ('${A}', '${me}', 'approved')`);
    expect(await latest()).toMatchObject({ notification_type: 'onboarding_approved', message: 'HR approved your onboarding details.' });
  });

  it('not for what the employee does themselves', async () => {
    const before = (await mine()).length;
    await signedInAs(U.STAFF, `insert into employee_onboarding_reviews (tenant_id, employee_id, action) values ('${A}', '${me}', 'submitted')`);
    await signedInAs(U.STAFF, `insert into employee_onboarding_reviews (tenant_id, employee_id, action) values ('${A}', '${me}', 'changes_requested')`);
    expect((await mine()).length).toBe(before);
  });

  it('the photo removed by HR', async () => {
    await asUser(db, U.STAFF, () => db.query(`update employees set "Profile Image" = 'photos/me.jpg' where id = '${me}'`));
    await asUser(db, U.HR, () => db.query(`update employees set "Profile Image" = null where id = '${me}'`));
    expect(await latest()).toMatchObject({ notification_type: 'photo_removed', title: 'Photo removed' });
  });

  it('a document HR asks for', async () => {
    await asUser(db, U.HR, () => db.query(`insert into employee_document_requirements (employee_id, code) values ('${me}', 'driving_licence')`));
    expect(await latest()).toMatchObject({ notification_type: 'document_requested', message: expect.stringMatching(/^HR asked you for your .+\. Upload it in Onboarding\.$/) });
  });

  it('only the employee sees their notifications', async () => {
    const hrSees = await asUser(db, U.HR, () => rows(`select 1 from hr_notifications where employee_number = 'E-ME'`));
    expect(hrSees.length).toBeGreaterThan(0); // HR with the employees module sees them, as with leave
    expect(await asUser(db, U.STAFF, () => rows(`select 1 from hr_notifications where employee_number <> 'E-ME'`))).toEqual([]);
  });
});
