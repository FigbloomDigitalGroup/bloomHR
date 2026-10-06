// @vitest-environment node
//
// Creating a company, inviting people and joining by link. Real migrations on a real Postgres (PGlite).
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, bootLiveDb } from './db';

const DEFAULT = '00000000-0000-0000-0000-000000000001';
const OWNER = '00000000-0000-0000-0000-00000000e001'; // admin of the default company
const HR = '00000000-0000-0000-0000-00000000e002'; // HR in the default company
const STAFF = '00000000-0000-0000-0000-00000000e003';
const FOUNDER = '00000000-0000-0000-0000-00000000e004'; // signs up and creates a company
const GUEST = '00000000-0000-0000-0000-00000000e005'; // invited with guest@gmail.com
const OTHER = '00000000-0000-0000-0000-00000000e006'; // a different person

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const profile = async (id: string) =>
  (await rows<{ tenant_id: string; role: string }>(`select tenant_id, role from user_profiles where user_id = '${id}'`))[0];

type Invite = { invitation_id: string; token: string; expires_at: string };
const invite = (as: string, email: string, role: string) =>
  asUser(db, as, async () => (await db.query<Invite>(`select * from create_invitation('${email}', '${role}')`)).rows[0]);

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email) values
      ('${OWNER}', 'owner@figbloom.org'), ('${HR}', 'hr@figbloom.org'), ('${STAFF}', 'staff@figbloom.org'),
      ('${FOUNDER}', 'founder@startup.co'), ('${GUEST}', 'Guest@Gmail.com'), ('${OTHER}', 'other@gmail.com');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${OWNER}', 'owner@figbloom.org', 'ADMIN', '${DEFAULT}'),
      ('${HR}', 'hr@figbloom.org', 'HR', '${DEFAULT}'),
      ('${STAFF}', 'staff@figbloom.org', 'STAFF', '${DEFAULT}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('STAFF', array['dashboard'], '${DEFAULT}'), ('HR', array['dashboard','employees'], '${DEFAULT}');
  `);
}, 120000);

describe('create_company', () => {
  let company: string;

  it('a brand-new person creates a company and becomes its administrator', async () => {
    company = await asUser(db, FOUNDER, async () => (await db.query<{ create_company: string }>(`select create_company('Startup Ltd')`)).rows[0].create_company);
    expect(await profile(FOUNDER)).toMatchObject({ tenant_id: company, role: 'ADMIN' });
    const [t] = await rows<{ name: string; slug: string; status: string }>(`select name, slug, status from tenants where id = '${company}'`);
    expect(t).toMatchObject({ name: 'Startup Ltd', slug: 'startup-ltd', status: 'active' });
    expect(await rows(`select role from memberships where user_id = '${FOUNDER}' and tenant_id = '${company}'`)).toEqual([{ role: 'ADMIN' }]);
  });

  it('starts the company with the default role permissions, and keeps its data apart from other companies', async () => {
    const perms = await rows<{ role_name: string }>(`select role_name from role_permissions where tenant_id = '${company}' order by 1`);
    expect(perms.map((p) => p.role_name)).toEqual(['HR', 'STAFF']);
    await asUser(db, FOUNDER, async () => {
      expect((await rows(`select 1 from role_permissions where tenant_id = '${DEFAULT}'`)).length).toBe(0);
      expect((await rows(`select 1 from tenants where id = '${DEFAULT}'`)).length).toBe(0);
    });
  });

  it('gives a second company with the same name its own address', async () => {
    const second = await asUser(db, OWNER, async () => (await db.query<{ create_company: string }>(`select create_company('Startup Ltd')`)).rows[0].create_company);
    const [t] = await rows<{ slug: string }>(`select slug from tenants where id = '${second}'`);
    expect(t.slug).toMatch(/^startup-ltd-[0-9a-f]{5}$/);
    // an existing member creating another company keeps their first, and works in the new one
    expect(await rows(`select 1 from memberships where user_id = '${OWNER}'`)).toHaveLength(2);
    expect(await profile(OWNER)).toMatchObject({ tenant_id: second, role: 'ADMIN' });
    await asUser(db, OWNER, async () => {
      await db.query(`select switch_company('${DEFAULT}')`);
    });
    expect(await profile(OWNER)).toMatchObject({ tenant_id: DEFAULT });
  });

  it('rejects empty names and signed-out callers', async () => {
    await asUser(db, OTHER, async () => {
      await expect(db.query(`select create_company('  ')`)).rejects.toThrow(/2 to 80/);
      await expect(db.query(`select create_company('x')`)).rejects.toThrow(/2 to 80/);
    });
    await expect(db.query(`select create_company('Anon Co')`)).rejects.toThrow(/Not signed in/);
    await asAnon(db, async () => {
      await expect(db.query(`select create_company('Anon Co')`)).rejects.toThrow(/permission denied/);
    });
  });

  it('clients cannot create or edit companies directly', async () => {
    await asUser(db, OTHER, async () => {
      await expect(db.query(`insert into tenants (name, slug) values ('Sneaky', 'sneaky')`)).rejects.toThrow(/permission denied/);
    });
  });
});

describe('invitations', () => {
  let guestInvite: Invite;

  it('an administrator invites an email address and gets a link token', async () => {
    guestInvite = await invite(OWNER, 'guest@gmail.com', 'HR');
    expect(guestInvite.token).toMatch(/^[0-9a-f]{64}$/);
    const days = (new Date(guestInvite.expires_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  it('stores only a hash of the token', async () => {
    const [r] = await rows<{ token_hash: string }>(`select token_hash from invitations where id = '${guestInvite.invitation_id}'`);
    expect(r.token_hash).not.toContain(guestInvite.token);
    expect(r.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('HR can invite staff only; staff cannot invite anyone', async () => {
    expect((await invite(HR, 'new.staff@gmail.com', 'STAFF')).token).toBeTruthy();
    await expect(invite(HR, 'sneaky@gmail.com', 'ADMIN')).rejects.toThrow(/only an administrator/i);
    await expect(invite(STAFF, 'x@gmail.com', 'STAFF')).rejects.toThrow(/only an administrator or HR/i);
  });

  it('validates the email and the role', async () => {
    await expect(invite(OWNER, 'not-an-email', 'STAFF')).rejects.toThrow(/valid email/);
    await expect(invite(OWNER, 'a@b.co', 'SUPERUSER')).rejects.toThrow(/Unknown role/);
  });

  it('refuses to invite someone who is already in the company', async () => {
    await expect(invite(OWNER, 'staff@figbloom.org', 'STAFF')).rejects.toThrow(/already in this company/);
  });

  it('a new invitation to the same address replaces the old link', async () => {
    const first = await invite(OWNER, 'twice@gmail.com', 'STAFF');
    const second = await invite(OWNER, 'twice@gmail.com', 'MANAGER');
    await asAnon(db, async () => {
      expect(await rows(`select * from invitation_preview('${first.token}')`)).toEqual([]);
      expect(await rows(`select role from invitation_preview('${second.token}')`)).toEqual([{ role: 'MANAGER' }]);
    });
  });

  it('only administrators and HR can list invitations, and only their own company’s', async () => {
    await asUser(db, OWNER, async () => {
      expect((await rows(`select 1 from invitations`)).length).toBeGreaterThan(0);
    });
    await asUser(db, STAFF, async () => {
      expect(await rows(`select 1 from invitations`)).toEqual([]);
    });
    await asUser(db, FOUNDER, async () => {
      expect(await rows(`select 1 from invitations`)).toEqual([]); // the founder's company has none
    });
  });

  it('clients cannot write invitations directly', async () => {
    await asUser(db, OWNER, async () => {
      expect(await rows(`update invitations set expires_at = now() + interval '1 year' returning 1`)).toEqual([]);
      expect(await rows(`delete from invitations returning 1`)).toEqual([]);
      await expect(
        db.query(`insert into invitations (email, role, token_hash) values ('x@y.co', 'ADMIN', 'abc')`)
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('an administrator can cancel an invitation, and the link stops working', async () => {
    const inv = await invite(OWNER, 'cancel@gmail.com', 'STAFF');
    await asUser(db, OWNER, async () => {
      await db.query(`select revoke_invitation('${inv.invitation_id}')`);
    });
    await asAnon(db, async () => {
      expect(await rows(`select * from invitation_preview('${inv.token}')`)).toEqual([]);
    });
  });
});

describe('joining by link', () => {
  it('the join page can show the company and role to someone who is not signed in, but only with the token', async () => {
    const inv = await invite(OWNER, 'preview@gmail.com', 'MANAGER');
    await asAnon(db, async () => {
      expect(await rows(`select company_name, email, role from invitation_preview('${inv.token}')`)).toEqual([
        { company_name: 'Figbloom HR', email: 'preview@gmail.com', role: 'MANAGER' },
      ]);
      expect(await rows(`select * from invitation_preview('${'0'.repeat(64)}')`)).toEqual([]);
    });
  });

  it('the invited person (matching email, any letter case) joins and lands in that company with that role', async () => {
    const inv = await invite(OWNER, 'guest@gmail.com', 'HR'); // GUEST signed up as Guest@Gmail.com
    const joined = await asUser(db, GUEST, async () => (await db.query<{ accept_invitation: string }>(`select accept_invitation('${inv.token}')`)).rows[0].accept_invitation);
    expect(joined).toBe(DEFAULT);
    expect(await profile(GUEST)).toMatchObject({ tenant_id: DEFAULT, role: 'HR' });
    expect(await rows(`select status from invitations where id = '${inv.invitation_id}'`)).toEqual([{ status: 'accepted' }]);
  });

  it('a link is single-use', async () => {
    const inv = await invite(OWNER, 'once@gmail.com', 'STAFF');
    await db.exec(`insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000e0a1', 'once@gmail.com')`);
    await asUser(db, '00000000-0000-0000-0000-00000000e0a1', async () => {
      await db.query(`select accept_invitation('${inv.token}')`);
      await expect(db.query(`select accept_invitation('${inv.token}')`)).rejects.toThrow(/not valid any more/);
    });
  });

  it('someone else cannot use a link meant for another email', async () => {
    const inv = await invite(OWNER, 'intended@gmail.com', 'ADMIN');
    await asUser(db, OTHER, async () => {
      await expect(db.query(`select accept_invitation('${inv.token}')`)).rejects.toThrow(/different email/);
    });
    expect(await rows(`select 1 from memberships where user_id = '${OTHER}'`)).toEqual([]);
    expect(await rows(`select status from invitations where id = '${inv.invitation_id}'`)).toEqual([{ status: 'pending' }]);
  });

  it('an expired link does not work', async () => {
    const inv = await invite(OWNER, 'late@gmail.com', 'STAFF');
    await db.exec(`update invitations set expires_at = now() - interval '1 minute' where id = '${inv.invitation_id}'`);
    await asAnon(db, async () => {
      expect(await rows(`select * from invitation_preview('${inv.token}')`)).toEqual([]);
    });
    await db.exec(`insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000e0a2', 'late@gmail.com')`);
    await asUser(db, '00000000-0000-0000-0000-00000000e0a2', async () => {
      await expect(db.query(`select accept_invitation('${inv.token}')`)).rejects.toThrow(/not valid any more/);
    });
  });

  it('someone who works for two companies joins the second and can choose between them', async () => {
    // the founder (admin of Startup Ltd) is invited to the default company with the same login
    const inv = await invite(OWNER, 'founder@startup.co', 'STAFF');
    await asUser(db, FOUNDER, async () => {
      await db.query(`select accept_invitation('${inv.token}')`);
    });
    await asUser(db, FOUNDER, async () => {
      const list = await rows<{ name: string; role: string; is_current: boolean }>(`select name, role, is_current from my_companies() order by name`);
      expect(list).toEqual([
        { name: 'Figbloom HR', role: 'STAFF', is_current: true },
        { name: 'Startup Ltd', role: 'ADMIN', is_current: false },
      ]);
    });
    // only one company is in view at a time
    await asUser(db, FOUNDER, async () => {
      expect((await rows(`select 1 from tenants`)).length).toBe(1);
    });
  });

  it('a signed-out caller cannot accept', async () => {
    await expect(db.query(`select accept_invitation('whatever')`)).rejects.toThrow(/Not signed in/);
    await asAnon(db, async () => {
      await expect(db.query(`select accept_invitation('whatever')`)).rejects.toThrow(/permission denied/);
    });
  });
});
