// @vitest-environment node
//
// Kenyan banks and branches with their clearing codes (20261013200000), and codes filled in for existing employees.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asAnon, asUser, bootDb } from './db';

const A = '00000000-0000-0000-0000-000000000001';
const STAFF = '00000000-0000-0000-0000-00000000b801';

let db: PGlite;
const rows = async <T = Record<string, unknown>>(sql: string) => (await db.query<T>(sql)).rows;

beforeAll(async () => {
  db = await bootDb({
    file: '20261013200000_bank_branch_codes.sql',
    // records from before the list, with bank names as people typed them
    seed: (d) => d.exec(`
      insert into employees ("Employee Number", "First Name", "Bank", "Bank Branch", bank_code, branch_code, tenant_id) values
        ('E1', 'One', 'Equity Bank', 'Garden City', null, null, '${A}'),
        ('E2', 'Two', 'KCB', 'Kayole Branch', null, null, '${A}'),
        ('E3', 'Three', 'Barclays', 'Nowhere Street', null, null, '${A}'),
        ('E4', 'Four', 'Stima Sacco', 'Town', null, null, '${A}'),
        ('E5', 'Five', 'Equity', 'Garden City', '01', '999', '${A}');
    `),
  });
  await db.exec(`
    insert into auth.users (id, email) values ('${STAFF}', 's@a.co');
    insert into user_profiles (user_id, email, role, tenant_id) values ('${STAFF}', 's@a.co', 'STAFF', '${A}');
  `);
}, 120000);

const codes = async (n: string) => (await rows<{ b: string | null; br: string | null }>(`select bank_code b, branch_code br from employees where "Employee Number" = '${n}'`))[0];

describe('the list', () => {
  it('has every bank on KBA’s list with its 2-digit code, closed ones marked', async () => {
    expect((await rows<{ n: number }>(`select count(*)::int n from banks`))[0].n).toBe(50);
    expect(await rows(`select code, name, open from banks where code in ('01', '11', '30', '68') order by code`)).toEqual([
      { code: '01', name: 'Kenya Commercial Bank Limited', open: true },
      { code: '11', name: 'Co-operative Bank of Kenya Limited', open: true },
      { code: '30', name: 'Chase Bank Limited', open: false },
      { code: '68', name: 'Equity Bank Limited', open: true },
    ]);
  });

  it('has their branches with 3-digit codes', async () => {
    expect((await rows<{ n: number }>(`select count(*)::int n from bank_branches`))[0].n).toBe(1982);
    expect(await rows(`select name from bank_branches where bank_code = '68' and branch_code = '175'`)).toEqual([{ name: 'Garden City' }]);
    expect(await rows(`select name from bank_branches where bank_code = '07' and branch_code = '033'`)).toEqual([{ name: 'River Road' }]);
  });

  it('everyone signed in reads it; nobody changes it; anonymous visitors don’t see it', async () => {
    await asUser(db, STAFF, async () => {
      expect((await rows(`select 1 from bank_branches where bank_code = '68'`)).length).toBeGreaterThan(100);
      expect(await rows(`update banks set name = 'x' returning 1`)).toEqual([]);
      await expect(db.query(`insert into banks (code, name) values ('99', 'Mine')`)).rejects.toThrow(/row-level security/);
    });
    await asAnon(db, async () => {
      await expect(db.query(`select 1 from banks`)).rejects.toThrow(/permission denied/);
    });
  });
});

describe('existing employees', () => {
  it('get the bank code from a bank name that clearly names one, and the branch code where the branch matches', async () => {
    expect(await codes('E1')).toEqual({ b: '68', br: '175' });
    expect(await codes('E2')).toEqual({ b: '01', br: '324' }); // "Kayole Branch" matches Kayole
    expect(await codes('E3')).toEqual({ b: '03', br: null }); // Barclays is now Absa; the branch is not on the list
  });

  it('are left alone when the bank is not on the list or codes were already filled in', async () => {
    expect(await codes('E4')).toEqual({ b: null, br: null });
    expect(await codes('E5')).toEqual({ b: '01', br: '999' });
  });
});
