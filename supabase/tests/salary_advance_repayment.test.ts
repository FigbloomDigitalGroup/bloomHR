// @vitest-environment node
//
// 20261015600000: salary advances carry how many months they are repaid over (1 by default, as every advance before
// it) and who marked them paid; access is otherwise unchanged. Since 20261027700000 a new advance is repaid in full on
// the next payday, so it can't be spread (salary_advance_next_payday.test.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootDb, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const STAFF = '00000000-0000-0000-0000-00000000e001'; // E-ME
const PAYER = '00000000-0000-0000-0000-00000000e002'; // salaryadmin
const OTHER_ADMIN = '00000000-0000-0000-0000-00000000e003'; // ADMIN of company B

let db: PGlite;
const attempt = async (sql: string) => {
  try {
    await db.query(sql);
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }
};

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');
    insert into auth.users (id, email) values ('${STAFF}', 'me@a.co'), ('${PAYER}', 'payer@a.co'), ('${OTHER_ADMIN}', 'admin@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${STAFF}', 'me@a.co', 'STAFF', '${A}'), ('${PAYER}', 'payer@a.co', 'CHECKER', '${A}'), ('${OTHER_ADMIN}', 'admin@b.co', 'ADMIN', '${B}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('STAFF', array['dashboard'], '${A}'), ('CHECKER', array['salaryadmin'], '${A}');
    insert into employees ("Employee Number", "First Name", "Work Email", "Basic Salary", tenant_id) values ('E-ME', 'Me', 'me@a.co', 50000, '${A}');
  `);
}, 120000);

describe('salary advance repayment months', () => {
  it('existing advances are repaid in one month, as before', async () => {
    const seeded = await bootDb({
      file: '20261015600000_salary_advance_repayment.sql',
      seed: async (d) => {
        await d.exec(`insert into employees ("Employee Number", "First Name", tenant_id) values ('E-OLD', 'Old', '${A}');
          insert into salary_advance ("Employee Number", "Amount Requested", status, payment_processed, tenant_id)
          values ('E-OLD', 3000, 'paid', 'true', '${A}')`);
      },
    });
    const { rows } = await seeded.query<{ repayment_months: number; paid_by: string | null }>(
      `select repayment_months, paid_by from salary_advance where "Employee Number" = 'E-OLD'`,
    );
    expect(rows).toEqual([{ repayment_months: 1, paid_by: null }]);
  }, 120000);

  it('staff may ask for their own advance, repaid in one month', async () => {
    await asUser(db, STAFF, async () => {
      const r = await attempt(`insert into salary_advance ("Employee Number", "Amount Requested", status)
        values ('E-ME', 6000, 'Pending')`);
      expect(r).toEqual({ ok: true });
    });
    const { rows } = await db.query<{ repayment_months: number }>(`select repayment_months from salary_advance where "Employee Number" = 'E-ME'`);
    expect(rows).toEqual([{ repayment_months: 1 }]);
  });

  it('only between 1 and 12 months', async () => {
    for (const months of [0, 13, -1]) {
      const r = await attempt(`insert into salary_advance ("Employee Number", "Amount Requested", repayment_months, tenant_id)
        values ('E-ME', 100, ${months}, '${A}')`);
      expect(r.ok).toBe(false);
    }
  });

  it('staff still cannot ask for one already paid, nor for someone else', async () => {
    await asUser(db, STAFF, async () => {
      expect((await attempt(`insert into salary_advance ("Employee Number", "Amount Requested", status, payment_processed)
        values ('E-ME', 100, 'paid', 'true')`)).ok).toBe(false);
      expect((await attempt(`insert into salary_advance ("Employee Number", "Amount Requested", repayment_months)
        values ('E-SOMEONE', 100, 2)`)).ok).toBe(false);
    });
  });

  it('the salary advance screen marks it paid with who; another company cannot see or touch it', async () => {
    await asUser(db, PAYER, async () => {
      // approved through its approval chain first (20261025700000)
      await db.query(`select decide_approval(r.id, 'approved', null) from approval_requests r
        join salary_advance a on a.id = r.record_id where r.kind = 'salary_advance' and a."Employee Number" = 'E-ME'`);
      const { rows } = await db.query(`update salary_advance set status = 'paid', payment_processed = 'true', paid_by = '${PAYER}',
        paid_by_email = 'payer@a.co' where "Employee Number" = 'E-ME' returning id`);
      expect(rows).toHaveLength(1);
    });
    await asUser(db, OTHER_ADMIN, async () => {
      expect((await db.query(`select id from salary_advance where "Employee Number" = 'E-ME'`)).rows).toHaveLength(0);
      expect((await db.query(`update salary_advance set repayment_months = 1 where "Employee Number" = 'E-ME' returning id`)).rows).toHaveLength(0);
    });
    const { rows } = await db.query(`select status, payment_processed, paid_by_email, repayment_months from salary_advance where "Employee Number" = 'E-ME'`);
    expect(rows).toEqual([{ status: 'paid', payment_processed: 'true', paid_by_email: 'payer@a.co', repayment_months: 1 }]);
  });

  it('staff cannot change their own request (no update policy for them)', async () => {
    await asUser(db, STAFF, async () => {
      expect((await db.query(`update salary_advance set repayment_months = 12 where "Employee Number" = 'E-ME' returning id`)).rows).toHaveLength(0);
    });
  });
});
