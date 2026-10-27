// @vitest-environment node
//
// Framing the photo on a staff ID card (20261027600000): the card holder moves and zooms the photo on their own card,
// the 'staff-id-cards' module on anyone's; the card returns the framing until the employee's photo changes.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asUser, bootLiveDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const HR = '00000000-0000-0000-0000-00000000f101';
const S1 = '00000000-0000-0000-0000-00000000f102';
const S2 = '00000000-0000-0000-0000-00000000f103';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const as = <T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) => asUser(db, user, () => rows<T>(sql, params));
const fails = (user: string, sql: string, params: unknown[] = []) => as(user, sql, params).then(
  () => { throw new Error(`expected to fail: ${sql}`); },
  (e) => (e as Error).message,
);
const idOf = async (number: string) => (await rows<{ id: string }>(`select id from employees where "Employee Number" = $1`, [number]))[0].id;
type Framing = { photo_x: string; photo_y: string; photo_zoom: string };
const framing = async (user: string) =>
  (await as<Framing>(user, `select photo_x, photo_y, photo_zoom from my_staff_id_card()`))[0];
const asNumbers = (f: Framing) => ({ x: Number(f.photo_x), y: Number(f.photo_y), zoom: Number(f.photo_zoom) });

beforeAll(async () => {
  db = await bootLiveDb();
  await db.exec(`
    insert into auth.users (id, email) values ('${HR}', 'hr@a.co'), ('${S1}', 's1@a.co'), ('${S2}', 's2@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values
      ('${HR}', 'hr@a.co', 'HR', '${A}'), ('${S1}', 's1@a.co', 'STAFF', '${A}'), ('${S2}', 's2@a.co', 'STAFF', '${A}');
    insert into role_permissions (role_name, permissions, tenant_id) values
      ('HR', array['employees', 'staff-id-cards'], '${A}'), ('STAFF', array['dashboard'], '${A}');
    insert into employees ("Employee Number", "First Name", "Last Name", "Work Email", "Profile Image", "Status", tenant_id) values
      ('H1', 'Hana', 'Hr', 'hr@a.co', null, 'Active', '${A}'),
      ('E1', 'Esther', 'One', 's1@a.co', 'https://cdn/e1.png', 'Active', '${A}'),
      ('E2', 'Eric', 'Two', 's2@a.co', 'https://cdn/e2.png', 'Active', '${A}');
  `);
}, 120000);

describe('framing the photo', () => {
  it('a card starts centred', async () => {
    expect(asNumbers(await framing(S1))).toEqual({ x: 0.5, y: 0.5, zoom: 1 });
  });

  it('the card holder frames their own, brought into range, and the card keeps it', async () => {
    const e1 = await idOf('E1');
    await as(S1, `select set_staff_id_card_photo_framing($1, 0.3, 1.7, 9)`, [e1]);
    expect(asNumbers(await framing(S1))).toEqual({ x: 0.3, y: 1, zoom: 4 });
    // HR printing it sees the same
    const [card] = await as<Framing>(HR, `select photo_x, photo_y, photo_zoom from staff_id_cards(array[$1::uuid])`, [e1]);
    expect(asNumbers(card)).toEqual({ x: 0.3, y: 1, zoom: 4 });
  });

  it('not someone else’s, unless they have Staff ID cards', async () => {
    const e2 = await idOf('E2');
    await as(S2, `select * from my_staff_id_card()`); // E2's card exists
    expect(await fails(S1, `select set_staff_id_card_photo_framing($1, 0.1, 0.1, 2)`, [e2])).toMatch(/only frame the photo on your own card/);
    await as(HR, `select set_staff_id_card_photo_framing($1, 0.6, 0.4, 1.5)`, [e2]);
    expect(asNumbers(await framing(S2))).toEqual({ x: 0.6, y: 0.4, zoom: 1.5 });
  });

  it('a new photo shows centred, and an employee with no photo has nothing to frame', async () => {
    await rows(`update employees set "Profile Image" = 'https://cdn/e2-new.png' where "Employee Number" = 'E2'`);
    expect(asNumbers(await framing(S2))).toEqual({ x: 0.5, y: 0.5, zoom: 1 });

    const h1 = await idOf('H1');
    await as(HR, `select * from my_staff_id_card()`);
    expect(await fails(HR, `select set_staff_id_card_photo_framing($1, 0.5, 0.5, 1)`, [h1])).toMatch(/no photo to frame/);
  });

  it('the table is still not written directly', async () => {
    const e1 = await idOf('E1');
    expect(await fails(S1, `update staff_id_cards set photo_zoom = 2 where employee_id = $1`, [e1])).toMatch(/permission denied/);
  });
});
