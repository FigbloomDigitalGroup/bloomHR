// @vitest-environment node
//
// The HELB onboarding document is the HELB clearance certificate (20261016650000).
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { bootLiveDb } from './db';

let db: PGlite;
beforeAll(async () => {
  db = await bootLiveDb();
}, 120000);

describe('HELB document label', () => {
  it('is "HELB clearance certificate"', async () => {
    const { rows } = await db.query<{ label: string }>(`select label from document_types where code = 'helb_certificate'`);
    expect(rows).toEqual([{ label: 'HELB clearance certificate' }]);
  });
});
