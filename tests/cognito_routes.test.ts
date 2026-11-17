// @vitest-environment node
//
// "Sign in with Figbloom" (cognito_routes.js, ERP/HR_COGNITO_CONTRACT.md section 2): the switch, the request checks,
// each answer of identity_sign_in() (its SQL runs on a real schema in supabase/tests/identity_links.test.ts), retiring
// the old password on a first sign-in, and the one-time sign-in token. Cognito's own token checks (signature, issuer,
// audience, token_use) run for real against a local stand-in that signs RS256 tokens.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';

const AMINA = '00000000-0000-0000-0000-00000000e001';
const VERIFIER = 'v'.repeat(43);
const REDIRECT = 'https://hr-staging.figbloom.org/auth/callback';

let mod: typeof import('../cognito_routes.js');
let server: Server;
let base = '';

type Row = Record<string, unknown>;
const calls: Row[] = [];
let answer: Row | null = null;
let tokenOk = true;
let retireFails = false;
const store = {
  signIn: async (a: Row) => {
    calls.push({ call: 'signIn', ...a });
    return answer;
  },
  retirePassword: async (userId: string) => {
    calls.push({ call: 'retirePassword', userId });
    if (retireFails) throw new Error('down');
  },
  signInToken: async (userId: string) => {
    calls.push({ call: 'signInToken', userId });
    return tokenOk ? { ok: true, tokenHash: `hash-for-${userId}` } : { ok: false, reason: 'blocked' };
  },
};
let claims: Row = { sub: 'sub-amina', email: 'amina@acme.example', emailVerified: true };
const fakeCognito = { signIn: async () => claims };

const ENV = {
  COGNITO_SIGN_IN: 'on',
  COGNITO_REGION: 'eu-west-1',
  COGNITO_CUSTOMERS_POOL_ID: 'eu-west-1_Cust',
  COGNITO_CUSTOMERS_DOMAIN: 'https://figbloom-test.auth.eu-west-1.amazoncognito.com',
  HR_SIGNIN_CLIENT_ID: 'hr-signin',
  HR_SIGNIN_CLIENT_SECRET: 'secret',
  COGNITO_STAFF_POOL_ID: 'eu-west-1_Staff',
  COGNITO_STAFF_DOMAIN: 'https://figbloom-staff-test.auth.eu-west-1.amazoncognito.com',
  HR_CONSOLE_CLIENT_ID: 'hr-console',
  HR_CONSOLE_CLIENT_SECRET: 'secret',
};
const env: Record<string, string> = { ...ENV };

beforeAll(async () => {
  mod = await import('../cognito_routes.js');
  const app = express();
  app.use('/api/auth/cognito', mod.createCognitoRouter({ store, cognitoClient: fakeCognito, env }));
  server = createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  calls.length = 0;
  answer = { outcome: 'linked', user_id: AMINA, newly_linked: false };
  tokenOk = true;
  retireFails = false;
  claims = { sub: 'sub-amina', email: 'amina@acme.example', emailVerified: true };
  Object.assign(env, ENV);
});

const exchange = async (body: Row) => {
  const res = await fetch(`${base}/api/auth/cognito/exchange`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Row, cache: res.headers.get('cache-control') };
};
const good = (pool = 'customers') => ({ pool, code: 'the-code', codeVerifier: VERIFIER, redirectUri: REDIRECT });

describe('POST /api/auth/cognito/exchange', () => {
  it('signs a linked person in with a one-time token, and never caches the answer', async () => {
    const r = await exchange(good());
    expect(r).toEqual({ status: 200, body: { tokenHash: `hash-for-${AMINA}`, firstSignIn: false }, cache: 'no-store' });
    expect(calls).toEqual([
      { call: 'signIn', pool: 'customers', sub: 'sub-amina', email: 'amina@acme.example', emailVerified: true },
      { call: 'signInToken', userId: AMINA },
    ]);
  });

  it("retires the old Supabase password on a login's first Figbloom sign-in, and still signs in if that fails", async () => {
    answer = { outcome: 'linked', user_id: AMINA, newly_linked: true };
    expect((await exchange(good())).body).toEqual({ tokenHash: `hash-for-${AMINA}`, firstSignIn: true });
    expect(calls.map((c) => c.call)).toEqual(['signIn', 'retirePassword', 'signInToken']);
    retireFails = true;
    expect((await exchange(good())).status).toBe(200);
  });

  it('answers each refusal plainly, without a token', async () => {
    for (const [outcome, status] of [['no_account', 403], ['email_in_use', 409], ['no_console_access', 403]] as const) {
      answer = { outcome, user_id: null, newly_linked: false };
      const r = await exchange(good());
      expect(r.status).toBe(status);
      expect((r.body.error as Row).code).toBe(outcome);
      expect(r.body.tokenHash).toBeUndefined();
    }
    expect(calls.some((c) => c.call === 'signInToken')).toBe(false);
  });

  it('refuses a login that may not sign in (banned)', async () => {
    tokenOk = false;
    const r = await exchange(good());
    expect(r.status).toBe(403);
    expect((r.body.error as Row).code).toBe('blocked');
  });

  it('is switched off unless COGNITO_SIGN_IN is on, and needs the pool settings', async () => {
    env.COGNITO_SIGN_IN = 'off';
    expect((await exchange(good())).status).toBe(404);
    env.COGNITO_SIGN_IN = 'on';
    delete env.HR_CONSOLE_CLIENT_SECRET;
    expect((await exchange(good('staff'))).status).toBe(503);
  });

  it('checks the request: the pool, the code and a real PKCE verifier', async () => {
    expect((await exchange({ ...good(), pool: 'admins' })).status).toBe(400);
    expect((await exchange({ ...good(), code: '' })).status).toBe(400);
    expect((await exchange({ ...good(), codeVerifier: 'short' })).status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe("cognito.signIn: Cognito's token endpoint and the ID token's checks", () => {
  let idp: Server;
  let issuer = '';
  let privateKey: CryptoKey;
  let otherKey: CryptoKey;
  let idToken = '';
  let tokenRequest: { auth?: string; form?: URLSearchParams } = {};
  let tokenAnswer: { status: number; body: Row } | null = null;

  beforeAll(async () => {
    // the pool's key (published) and someone else's
    const pool = await generateKeyPair('RS256', { extractable: true });
    privateKey = pool.privateKey;
    otherKey = (await generateKeyPair('RS256')).privateKey;
    const jwk = { ...(await exportJWK(pool.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    idp = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (req.url?.endsWith('/.well-known/jwks.json')) return res.end(JSON.stringify({ keys: [jwk] }));
        if (req.url === '/oauth2/token') {
          tokenRequest = { auth: req.headers.authorization, form: new URLSearchParams(raw) };
          const a = tokenAnswer ?? { status: 200, body: { id_token: idToken, access_token: 'a' } };
          res.statusCode = a.status;
          return res.end(JSON.stringify(a.body));
        }
        res.statusCode = 404;
        res.end('{}');
      });
    });
    await new Promise<void>((r) => idp.listen(0, '127.0.0.1', r));
    issuer = `http://127.0.0.1:${(idp.address() as AddressInfo).port}/pool`;
  });
  afterAll(() => new Promise<void>((r) => idp.close(() => r())));

  const sign = (payload: Row, key: CryptoKey = privateKey, kid = 'k1') =>
    new SignJWT(payload).setProtectedHeader({ alg: 'RS256', kid }).setIssuer(issuer).setAudience('hr-signin').setIssuedAt().setExpirationTime('1h').sign(key);
  const config = () => ({ pool: 'customers', clientId: 'hr-signin', clientSecret: 's3cret', tokenUrl: `${issuer.replace('/pool', '')}/oauth2/token`, issuer });
  const input = { code: 'the-code', codeVerifier: VERIFIER, redirectUri: REDIRECT };

  beforeEach(() => {
    tokenAnswer = null;
  });

  it('swaps the code with the client secret and PKCE, and returns the checked claims', async () => {
    idToken = await sign({ sub: 'sub-amina', email: 'Amina@Acme.Example', email_verified: true, token_use: 'id' });
    expect(await mod.cognito.signIn(config(), input)).toEqual({ sub: 'sub-amina', email: 'amina@acme.example', emailVerified: true });
    expect(tokenRequest.auth).toBe(`Basic ${Buffer.from('hr-signin:s3cret').toString('base64')}`);
    expect(Object.fromEntries(tokenRequest.form!)).toMatchObject({ grant_type: 'authorization_code', code: 'the-code', code_verifier: VERIFIER, redirect_uri: REDIRECT });
  });

  it('refuses a token signed with another key, for another app, or that is not an ID token', async () => {
    idToken = await sign({ sub: 's', token_use: 'id' }, otherKey);
    await expect(mod.cognito.signIn(config(), input)).rejects.toMatchObject({ code: 'token_invalid' });
    idToken = await new SignJWT({ sub: 's', token_use: 'id' }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(issuer).setAudience('fleet-web').setExpirationTime('1h').sign(privateKey);
    await expect(mod.cognito.signIn(config(), input)).rejects.toMatchObject({ code: 'token_invalid' });
    idToken = await sign({ sub: 's', token_use: 'access' });
    await expect(mod.cognito.signIn(config(), input)).rejects.toMatchObject({ code: 'token_invalid' });
  });

  it('says an old or used code has expired', async () => {
    tokenAnswer = { status: 400, body: { error: 'invalid_grant' } };
    await expect(mod.cognito.signIn(config(), input)).rejects.toMatchObject({ code: 'sign_in_expired', status: 401 });
  });

  it('reads an unverified email as unverified', async () => {
    idToken = await sign({ sub: 'sub-x', email: 'x@acme.example', email_verified: false, token_use: 'id' });
    expect((await mod.cognito.signIn(config(), input)).emailVerified).toBe(false);
  });
});


