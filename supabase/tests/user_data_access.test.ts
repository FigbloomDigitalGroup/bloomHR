// @vitest-environment node
//
// FIG-657 tier 4: chat, notifications, tasks, logs, MFA, sign-up requests and profiles. Runs on the real
// (ziradev) schema snapshot.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const B = '00000000-0000-0000-0000-0000000000b2';
const U = {
  STAFF: '00000000-0000-0000-0000-00000000a001', // E-ME, job title Clerk
  COLLEAGUE: '00000000-0000-0000-0000-00000000a002', // E-THEM, job title Manager
  HR: '00000000-0000-0000-0000-00000000a003',
  ADMIN: '00000000-0000-0000-0000-00000000a004',
  OTHER_ADMIN: '00000000-0000-0000-0000-00000000b0b0',
};
const CH = {
  general: '00000000-0000-0000-0000-0000000010a1', // public
  clerks: '00000000-0000-0000-0000-0000000010a2', // private, job title Clerk
  managers: '00000000-0000-0000-0000-0000000010a3', // private, job title Manager
  secret: '00000000-0000-0000-0000-0000000010a4', // private, created by the colleague
  other: '00000000-0000-0000-0000-0000000010b1', // company B, public
};
const ROLE_MODULES: Record<string, string[]> = {
  STAFF: ['dashboard', 'task-manager', 'teams'],
  COLLEAGUE: ['dashboard', 'task-manager', 'teams'],
  HR: ['employees', 'reports', 'hr-lifecycle'],
  ADMIN: [],
};

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;
const count = async (sql: string) => (await db.query(sql)).rows.length;
const attempt = async (sql: string) => {
  await db.exec('begin');
  try {
    await db.query(sql);
    return true;
  } catch {
    return false;
  } finally {
    await db.exec('rollback');
  }
};

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`insert into tenants (id, name, slug) values ('${B}', 'Other Co', 'other-co');`);
  const people: [string, string, string][] = [
    [U.STAFF, 'me@a.co', 'STAFF'], [U.COLLEAGUE, 'them@a.co', 'COLLEAGUE'], [U.HR, 'hr@a.co', 'HR'], [U.ADMIN, 'admin@a.co', 'ADMIN'],
  ];
  for (const [id, email, role] of people) {
    await db.exec(`
      insert into auth.users (id, email) values ('${id}', '${email}');
      insert into user_profiles (user_id, email, role, tenant_id) values ('${id}', '${email}', '${role}', '${A}');
    `);
  }
  for (const [role, mods] of Object.entries(ROLE_MODULES)) {
    await db.exec(`insert into role_permissions (role_name, permissions, tenant_id) values ('${role}', array[${mods.map((m) => `'${m}'`).join(',')}]::text[], '${A}')`);
  }
  await db.exec(`
    insert into auth.users (id, email) values ('${U.OTHER_ADMIN}', 'admin@b.co');
    insert into user_profiles (user_id, email, role, tenant_id) values ('${U.OTHER_ADMIN}', 'admin@b.co', 'ADMIN', '${B}');
    insert into employees ("Employee Number", "First Name", "Work Email", "Job Title", tenant_id) values
      ('E-ME', 'Me', 'me@a.co', 'Clerk', '${A}'), ('E-THEM', 'Them', 'them@a.co', 'Manager', '${A}');

    -- these tests define their own channels: clear the default 'general' every company gets (see 20261006000600)
    delete from channels;

    insert into channels (id, name, is_private, job_title, created_by, tenant_id) values
      ('${CH.general}', 'General', false, null, '${U.ADMIN}', '${A}'),
      ('${CH.clerks}',  'Clerks',  true, 'Clerk', '${U.ADMIN}', '${A}'),
      ('${CH.managers}', 'Managers', true, 'Manager', '${U.ADMIN}', '${A}'),
      ('${CH.secret}',  'Secret',  true, null, '${U.COLLEAGUE}', '${A}'),
      ('${CH.other}',   'Other co', false, null, '${U.OTHER_ADMIN}', '${B}');
    insert into messages (channel_id, author_id, content, tenant_id)
      select id, '${U.ADMIN}', 'hello ' || name, tenant_id from channels;
  `);
}, 120000);

describe('chat', () => {
  it('an employee sees public channels and channels for their job title, nothing else', async () => {
    await asUser(db, U.STAFF, async () => {
      const r = await rows<{ name: string }>(`select name from channels order by name`);
      expect(r.map((x) => x.name)).toEqual(['Clerks', 'General']);
    });
    await asUser(db, U.COLLEAGUE, async () => {
      expect((await rows<{ name: string }>(`select name from channels order by name`)).map((x) => x.name)).toEqual(['General', 'Managers', 'Secret']);
    });
  });
  it('an ADMIN sees every channel of the company, never another company’s', async () => {
    await asUser(db, U.ADMIN, async () => expect(await count(`select 1 from channels`)).toBe(4));
    await asUser(db, U.OTHER_ADMIN, async () => expect(await count(`select 1 from channels`)).toBe(1));
  });
  it('messages follow channel visibility', async () => {
    await asUser(db, U.STAFF, async () => {
      expect((await rows<{ content: string }>(`select content from messages order by content`)).map((x) => x.content)).toEqual(['hello Clerks', 'hello General']);
    });
  });
  it('an employee posts as themselves in channels they can see, nowhere else', async () => {
    await asUser(db, U.STAFF, async () => {
      expect(await attempt(`insert into messages (channel_id, author_id, content) values ('${CH.general}', '${U.STAFF}', 'hi')`)).toBe(true);
      expect(await attempt(`insert into messages (channel_id, author_id, content) values ('${CH.clerks}', '${U.STAFF}', 'hi')`)).toBe(true);
      expect(await attempt(`insert into messages (channel_id, author_id, content) values ('${CH.managers}', '${U.STAFF}', 'sneaky')`)).toBe(false);
      expect(await attempt(`insert into messages (channel_id, author_id, content) values ('${CH.general}', '${U.COLLEAGUE}', 'as someone else')`)).toBe(false);
      expect(await attempt(`insert into messages (channel_id, author_id, content) values ('${CH.other}', '${U.STAFF}', 'other company')`)).toBe(false);
    });
  });
  it('an employee edits and deletes only their own messages; an ADMIN moderates', async () => {
    await db.exec(`insert into messages (id, channel_id, author_id, content, tenant_id) values ('00000000-0000-0000-0000-0000000020a1', '${CH.general}', '${U.STAFF}', 'mine', '${A}')`);
    await asUser(db, U.STAFF, async () => {
      expect(await count(`update messages set content = 'edited' where content = 'hello General' returning 1`)).toBe(0);
      expect(await count(`delete from messages where content = 'hello General' returning 1`)).toBe(0);
      expect(await count(`update messages set content = 'edited' where id = '00000000-0000-0000-0000-0000000020a1' returning 1`)).toBe(1);
    });
    await asUser(db, U.ADMIN, async () => {
      await db.exec('begin');
      try {
        expect(await count(`delete from messages where id = '00000000-0000-0000-0000-0000000020a1' returning 1`)).toBe(1);
      } finally {
        await db.exec('rollback');
      }
    });
  });
  it('an employee creates channels as themselves only, and manages only their own', async () => {
    await asUser(db, U.STAFF, async () => {
      expect(await attempt(`insert into channels (name, created_by) values ('Mine', '${U.STAFF}')`)).toBe(true);
      expect(await attempt(`insert into channels (name, created_by) values ('Forged', '${U.ADMIN}')`)).toBe(false);
      expect(await count(`update channels set name = 'hacked' where id = '${CH.general}' returning 1`)).toBe(0);
      expect(await count(`delete from channels where id = '${CH.general}' returning 1`)).toBe(0);
    });
  });
  it('reactions: only on messages you can see, only as yourself', async () => {
    const [{ id: visible }] = await rows<{ id: string }>(`select id from messages where content = 'hello General'`);
    const [{ id: hidden }] = await rows<{ id: string }>(`select id from messages where content = 'hello Managers'`);
    await asUser(db, U.STAFF, async () => {
      expect(await attempt(`insert into message_reactions (message_id, user_id, emoji) values ('${visible}', '${U.STAFF}', '👍')`)).toBe(true);
      expect(await attempt(`insert into message_reactions (message_id, user_id, emoji) values ('${hidden}', '${U.STAFF}', '👍')`)).toBe(false);
      expect(await attempt(`insert into message_reactions (message_id, user_id, emoji) values ('${visible}', '${U.COLLEAGUE}', '👍')`)).toBe(false);
    });
  });
  it('read markers and memberships are your own', async () => {
    await db.exec(`
      insert into user_channel_states (user_id, channel_id, tenant_id) values ('${U.STAFF}', '${CH.general}', '${A}'), ('${U.COLLEAGUE}', '${CH.general}', '${A}');
      insert into channel_members (channel_id, user_id, tenant_id) values ('${CH.general}', '${U.STAFF}', '${A}'), ('${CH.general}', '${U.COLLEAGUE}', '${A}');
    `);
    await asUser(db, U.STAFF, async () => {
      expect(await count(`select 1 from user_channel_states`)).toBe(1);
      expect(await count(`select 1 from channel_members`)).toBe(1);
      expect(await attempt(`insert into user_channel_states (user_id, channel_id) values ('${U.COLLEAGUE}', '${CH.clerks}')`)).toBe(false);
      expect(await attempt(`insert into user_channel_states (user_id, channel_id) values ('${U.STAFF}', '${CH.clerks}')`)).toBe(true);
    });
  });
});

describe('notifications', () => {
  beforeAll(async () => {
    await db.exec(`
      insert into notifications (employee_number, title, tenant_id) values
        ('E-ME', 'for me', '${A}'), ('E-THEM', 'for them', '${A}');
    `);
  });
  it('an employee reads and updates only their own; HR (employees module) sees all', async () => {
    await asUser(db, U.STAFF, async () => {
      expect(await count(`select 1 from notifications`)).toBe(1);
      expect(await count(`update notifications set is_read = true where employee_number = 'E-ME' returning 1`)).toBe(1);
      expect(await count(`update notifications set is_read = true where employee_number = 'E-THEM' returning 1`)).toBe(0);
      expect(await count(`delete from notifications where employee_number = 'E-THEM' returning 1`)).toBe(0);
    });
    await asUser(db, U.HR, async () => expect(await count(`select 1 from notifications`)).toBe(2));
  });
  it('anyone signed in can notify someone (e.g. staff alerting HR), in their own company only', async () => {
    await asUser(db, U.STAFF, async () => {
      expect(await attempt(`insert into notifications (employee_number, title) values ('E-THEM', 'hi')`)).toBe(true);
      expect(await attempt(`insert into notifications (employee_number, title, tenant_id) values ('E-THEM', 'hi', '${B}')`)).toBe(false);
    });
  });
});

describe('tasks', () => {
  beforeAll(async () => {
    await db.exec(`
      insert into todos (title, user_id, is_private, tenant_id) values
        ('team task',        '${U.COLLEAGUE}', false, '${A}'),
        ('their private',    '${U.COLLEAGUE}', true,  '${A}'),
        ('my private',       '${U.STAFF}',     true,  '${A}');
      insert into todos (title, user_id, assigned_to, is_private, tenant_id) values
        ('private for me',   '${U.COLLEAGUE}', '${U.STAFF}', true, '${A}');
    `);
  });
  it('public tasks are visible to the company; private ones only to creator and assignee', async () => {
    await asUser(db, U.STAFF, async () => {
      expect((await rows<{ title: string }>(`select title from todos order by title`)).map((x) => x.title)).toEqual(['my private', 'private for me', 'team task']);
    });
  });
  it('you create tasks as yourself; creator and assignee update; only the creator deletes', async () => {
    await asUser(db, U.STAFF, async () => {
      expect(await attempt(`insert into todos (title, user_id) values ('x', '${U.STAFF}')`)).toBe(true);
      expect(await attempt(`insert into todos (title, user_id) values ('x', '${U.COLLEAGUE}')`)).toBe(false);
      expect(await count(`update todos set progress = '50' where title = 'private for me' returning 1`)).toBe(1); // assignee
      expect(await count(`update todos set progress = '50' where title = 'team task' returning 1`)).toBe(0); // someone else's
      expect(await count(`delete from todos where title = 'private for me' returning 1`)).toBe(0); // assignee is not the creator
    });
  });
});

describe('logs, sign-up requests and meetings follow the modules', () => {
  const TABLES: Record<string, { modules: string[]; insert: string }> = {
    email_logs: { modules: ['employees', 'adminconfirm', 'email-portal', 'settings'], insert: 'default values' },
    sms_logs: { modules: ['sms', 'salaryadmin', 'employees', 'hr-lifecycle'], insert: 'default values' },
    staff_signup_requests: { modules: ['adminconfirm', 'employees'], insert: 'default values' },
    meeting_transcripts: { modules: ['teams'], insert: `default values` },
  };
  beforeAll(async () => {
    for (const t of Object.keys(TABLES)) {
      await db.exec(`insert into ${t} (tenant_id) values ('${A}')`);
      await db.exec(`insert into ${t} (tenant_id) values ('${B}')`);
    }
  });
  for (const [table, cfg] of Object.entries(TABLES)) {
    for (const role of ['STAFF', 'HR', 'ADMIN'] as const) {
      const allowed = role === 'ADMIN' || cfg.modules.some((m) => ROLE_MODULES[role].includes(m));
      it(`${table}: ${role} ${allowed ? 'can' : 'cannot'} use it`, async () => {
        await asUser(db, U[role], async () => {
          expect(await count(`select 1 from ${table}`)).toBe(allowed ? 1 : 0);
          expect(await attempt(`insert into ${table} ${cfg.insert}`)).toBe(allowed);
        });
      });
    }
  }
});

describe('MFA tables (stop-gap)', () => {
  beforeAll(async () => {
    await db.exec(`
      insert into mfa_numbers (email, phone_number, tenant_id) values ('me@a.co', '0711', '${A}'), ('them@a.co', '0722', '${A}');
      insert into mfa_codes (email, code, phone_number, expires_at, tenant_id) values
        ('me@a.co', '111111', '0711', now() + interval '5 minutes', '${A}'),
        ('them@a.co', '222222', '0722', now() + interval '5 minutes', '${A}');
    `);
  });
  it('an employee sees only their own phone number and codes', async () => {
    await asUser(db, U.STAFF, async () => {
      expect((await rows<{ phone_number: string }>(`select phone_number from mfa_numbers`)).map((x) => x.phone_number)).toEqual(['0711']);
      expect((await rows<{ code: string }>(`select code from mfa_codes`)).map((x) => x.code)).toEqual(['111111']);
      expect(await count(`update mfa_codes set used = true where email = 'them@a.co' returning 1`)).toBe(0);
      expect(await attempt(`insert into mfa_codes (email, code, phone_number, expires_at) values ('them@a.co', '1', '0722', now())`)).toBe(false);
      expect(await attempt(`insert into mfa_numbers (email, phone_number) values ('me@a.co', '0799')`)).toBe(false); // changing the MFA phone needs the settings module
    });
  });
  it('the settings module can manage phone numbers', async () => {
    await asUser(db, U.ADMIN, async () => {
      expect(await count(`select 1 from mfa_numbers`)).toBe(2);
    });
  });
});

describe('profiles', () => {
  beforeAll(async () => {
    await db.exec(`
      insert into profiles (id, email, role, tenant_id) values ('${U.STAFF}', 'me@a.co', 'staff', '${A}'), ('${U.COLLEAGUE}', 'them@a.co', 'staff', '${A}');
    `);
  });
  it('you see and change only your own profile; employees/settings modules can read all', async () => {
    await asUser(db, U.STAFF, async () => {
      expect(await count(`select 1 from profiles`)).toBe(1);
      expect(await count(`update profiles set full_name = 'Me' where id = '${U.STAFF}' returning 1`)).toBe(1);
      expect(await count(`update profiles set full_name = 'Hacked' where id = '${U.COLLEAGUE}' returning 1`)).toBe(0);
    });
    await asUser(db, U.HR, async () => expect(await count(`select 1 from profiles`)).toBe(2));
  });
});
