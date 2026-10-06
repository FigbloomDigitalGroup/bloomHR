// @vitest-environment node
//
// Who may create channels (administrators, HR, managers) and the general channel every company keeps.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const ADMIN = '00000000-0000-0000-0000-00000000ee01';
const HR = '00000000-0000-0000-0000-00000000ee02';
const MANAGER = '00000000-0000-0000-0000-00000000ee03';
const STAFF = '00000000-0000-0000-0000-00000000ee04';
const CHECKER = '00000000-0000-0000-0000-00000000ee05';
const FOUNDER = '00000000-0000-0000-0000-00000000ee06';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const attempt = async (sql: string) => {
  try {
    await db.query(sql);
    return true;
  } catch {
    return false;
  }
};
const create = (as: string, name: string, extra = '') =>
  asUser(db, as, () => attempt(`insert into channels (name, type, is_private, created_by${extra ? ', ' + extra.split('=')[0] : ''}) values ('${name}', 'channel', false, '${as}'${extra ? ', ' + extra.split('=')[1] : ''})`));

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    delete from channels;
    insert into auth.users (id, email) values
      ('${ADMIN}', 'admin@a.co'), ('${HR}', 'hr@a.co'), ('${MANAGER}', 'mgr@a.co'), ('${STAFF}', 'staff@a.co'), ('${CHECKER}', 'chk@a.co'), ('${FOUNDER}', 'founder@new.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${ADMIN}', 'admin@a.co', 'ADMIN', '${A}'), ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${MANAGER}', 'mgr@a.co', 'MANAGER', '${A}'),
      ('${STAFF}', 'staff@a.co', 'STAFF', '${A}'), ('${CHECKER}', 'chk@a.co', 'CHECKER', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values ('STAFF', array['dashboard'], '${A}');
  `);
}, 120000);

describe('who may create a channel', () => {
  it('administrators, HR and managers may, and choose the name', async () => {
    expect(await create(ADMIN, 'engineering')).toBe(true);
    expect(await create(HR, 'people-ops')).toBe(true);
    expect(await create(MANAGER, 'sales')).toBe(true);
    const names = (await rows<{ name: string }>(`select name from channels order by name`)).map((r) => r.name);
    expect(names).toEqual(['engineering', 'people-ops', 'sales']);
  });

  it('staff and other roles may not', async () => {
    expect(await create(STAFF, 'staff-made')).toBe(false);
    expect(await create(CHECKER, 'checker-made')).toBe(false);
    expect((await rows(`select 1 from channels where name in ('staff-made', 'checker-made')`)).length).toBe(0);
  });

  it('nobody can create one in someone else’s name, or as the protected default', async () => {
    await asUser(db, MANAGER, async () => {
      expect(await attempt(`insert into channels (name, type, is_private, created_by) values ('forged', 'channel', false, '${ADMIN}')`)).toBe(false);
      expect(await attempt(`insert into channels (name, type, is_private, created_by, is_default) values ('sneaky-general', 'channel', false, '${MANAGER}', true)`)).toBe(false);
    });
  });

  it('a manager can still rename and delete their own channel, and an admin anyone’s', async () => {
    await asUser(db, MANAGER, async () => {
      expect((await rows(`update channels set name = 'sales-team' where name = 'sales' returning 1`)).length).toBe(1);
      expect((await rows(`update channels set name = 'hijack' where name = 'engineering' returning 1`)).length).toBe(0); // not theirs
    });
    await asUser(db, ADMIN, async () => {
      expect((await rows(`delete from channels where name = 'sales-team' returning 1`)).length).toBe(1);
    });
  });
});

describe('the general channel every company keeps', () => {
  let generalId: string;
  beforeAll(async () => {
    const company = await asUser(db, FOUNDER, async () => (await db.query<{ create_company: string }>(`select create_company('Newco Ltd')`)).rows[0].create_company);
    const [g] = await rows<{ id: string; is_default: boolean }>(`select id, is_default from channels where tenant_id = '${company}'`);
    generalId = g.id;
    expect(g.is_default).toBe(true);
  });

  it('is created for a new company and marked as the default', async () => {
    expect(generalId).toBeTruthy();
  });

  it('cannot be renamed or deleted by anyone, even the administrator who founded the company', async () => {
    await asUser(db, FOUNDER, async () => {
      expect((await rows(`update channels set name = 'renamed' where id = '${generalId}' returning 1`)).length).toBe(0);
      expect((await rows(`delete from channels where id = '${generalId}' returning 1`)).length).toBe(0);
      expect((await rows(`select name from channels where id = '${generalId}'`))[0]).toEqual({ name: 'general' });
    });
  });

  it('an existing company’s "general" channel is marked as the default too (the oldest one, only one)', async () => {
    await db.exec(`
      insert into channels (id, name, type, is_private, tenant_id, created_at) values
        ('00000000-0000-0000-0000-00000000f001', 'General', 'channel', false, '${A}', now() - interval '2 days'),
        ('00000000-0000-0000-0000-00000000f002', 'general', 'channel', false, '${A}', now() - interval '1 day');
      update channels set is_default = false where tenant_id = '${A}';
    `);
    // run the marking step of the migration again
    await db.exec(`
      update public.channels c set is_default = true
      where lower(c.name) = 'general' and c.type is distinct from 'dm'
        and c.id = (select c2.id from public.channels c2 where c2.tenant_id = c.tenant_id and lower(c2.name) = 'general' and c2.type is distinct from 'dm' order by c2.created_at nulls last, c2.id limit 1)
    `);
    const marked = await rows<{ id: string }>(`select id from channels where tenant_id = '${A}' and is_default`);
    expect(marked).toEqual([{ id: '00000000-0000-0000-0000-00000000f001' }]);
  });

  it('is visible to every member of the company', async () => {
    await asUser(db, STAFF, async () => {
      expect((await rows(`select 1 from channels where lower(name) = 'general'`)).length).toBeGreaterThan(0);
    });
  });
});
