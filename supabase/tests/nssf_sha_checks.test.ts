// @vitest-environment node
//
// 20261021300000: NSSF and SHA number checks accept real numbers (e.g. 206593059X) and only catch typos.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { bootDb } from './db';

const MIGRATION = readFileSync(join(__dirname, '..', 'migrations', '20261021300000_nssf_sha_checks.sql'), 'utf8');

describe('NSSF and SHA number checks', () => {
  let db: PGlite;
  const ok = async (fn: string, v: string | null) =>
    (await db.query<{ ok: boolean }>(`select public.${fn}($1) as ok`, [v])).rows[0].ok;

  beforeAll(async () => {
    db = await bootDb();
  }, 120_000);

  it('accepts real Kenyan NSSF numbers, with or without a check letter or separators', async () => {
    for (const v of ['206593059X', '206593059x', '2012345678', '2012-345 678', '2012/345.678', 'NS12345', '12345']) {
      expect(await ok('nssf_number_ok', v), v).toBe(true);
    }
  });

  it('still catches NSSF typos', async () => {
    for (const v of ['123', '1234567890123456', 'ABCDEF', '12#45', '']) {
      expect(await ok('nssf_number_ok', v), v).toBe(false);
    }
  });

  it('accepts real SHA numbers and catches typos', async () => {
    for (const v of ['CR1234567890123-1', 'cr 1234567', 'CR-123-4', 'CR/1234/567']) {
      expect(await ok('sha_number_ok', v), v).toBe(true);
    }
    for (const v of ['CR#1', 'ABCD', '12']) {
      expect(await ok('sha_number_ok', v), v).toBe(false);
    }
  });

  it('a Kenyan employee with 206593059X saves', async () => {
    const { rows } = await db.query<{ ok: boolean }>(`select public.social_security_number_ok('Kenya', '206593059X') as ok`);
    expect(rows[0].ok).toBe(true);
  });

  it('Tanzania and Uganda keep their own check', async () => {
    const { rows } = await db.query<{ tz: boolean; ug: boolean }>(
      `select public.social_security_number_ok('Tanzania', '12345') as tz, public.social_security_number_ok('Uganda', 'AB12345') as ug`
    );
    expect(rows[0]).toEqual({ tz: false, ug: true });
  });

  it('can run again', async () => {
    await db.exec(MIGRATION);
    expect(await ok('nssf_number_ok', '206593059X')).toBe(true);
  });
});
