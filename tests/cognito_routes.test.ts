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



// ---- Figbloom accounts from HR's forms: /sign-up (creating a company), /email-confirmed, /set-password
describe('sign-up, email-confirmed and set-password', () => {
  let srv: Server;
  let url = '';
  type Login = { id: string; email: string; confirmed: boolean; password?: string };
  let logins: Login[] = [];
  let links: Map<string, { sub: string; madeHere: boolean }>;
  let figbloom: Map<string, { sub: string; password: string | null; verified: boolean; madeHere: boolean }>;
  const mail: Row[] = [];
  let AccountError: typeof import('../figbloom_accounts.js').FigbloomAccountError;

  const db = {
    auth: {
      getUser: async (token: string) => {
        const l = logins.find((x) => `token-${x.id}` === token);
        return l
          ? { data: { user: { id: l.id, email: l.email, email_confirmed_at: l.confirmed ? '2026-11-17T10:00:00Z' : null, user_metadata: {} } }, error: null }
          : { data: { user: null }, error: { message: 'bad' } };
      },
      resend: async (a: Row) => {
        mail.push(a);
        return { error: null };
      },
      admin: {
        createUser: async (a: { email: string; password: string }) => {
          if (logins.some((l) => l.email === a.email)) return { data: { user: null }, error: { status: 422, message: 'already registered' } };
          const l = { id: `u${logins.length + 1}`, email: a.email, confirmed: false, password: a.password };
          logins.push(l);
          return { data: { user: { id: l.id } }, error: null };
        },
        deleteUser: async (id: string) => {
          logins = logins.filter((l) => l.id !== id);
          return { error: null };
        },
      },
    },
  };
  const accounts = {
    ensure: async ({ email, password }: { email: string; password?: string }) => {
      const f = figbloom.get(email);
      if (f) return { sub: f.sub, created: false };
      if (password !== undefined && !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(password)) {
        throw new AccountError(400, 'invalid_password', 'Your password must be at least 8 characters, with ...');
      }
      const sub = `sub-${figbloom.size + 1}`;
      figbloom.set(email, { sub, password: password ?? null, verified: false, madeHere: true });
      return { sub, created: true };
    },
    link: async (userId: string, sub: string, { madeHere }: { madeHere: boolean }) => {
      links.set(userId, { sub, madeHere });
      return 'linked';
    },
    identityOf: async (userId: string) => links.get(userId) ?? null,
    markEmailVerified: async (sub: string) => {
      for (const f of figbloom.values()) if (f.sub === sub) f.verified = true;
    },
    setInitialPassword: async (sub: string, password: string, { emailProven }: { emailProven: boolean }) => {
      const f = [...figbloom.values()].find((x) => x.sub === sub)!;
      if (f.password) throw new AccountError(409, 'use_figbloom_reset', 'You already have a Figbloom password.');
      f.password = password;
      if (emailProven) f.verified = true;
    },
    retirePassword: async (userId: string) => {
      const l = logins.find((x) => x.id === userId)!;
      l.password = 'retired';
    },
  };

  beforeAll(async () => {
    AccountError = (await import('../figbloom_accounts.js')).FigbloomAccountError;
    const app = express();
    app.use(
      '/api/auth/cognito',
      mod.createCognitoRouter({ store, cognitoClient: fakeCognito, env: { ...ENV, SITE_URL: 'https://hr-staging.figbloom.org' }, accounts: accounts as never, db: db as never }),
    );
    srv = createServer(app);
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/auth/cognito`;
  });
  afterAll(() => new Promise<void>((r) => srv.close(() => r())));
  beforeEach(() => {
    logins = [];
    links = new Map();
    figbloom = new Map();
    mail.length = 0;
  });

  const post = async (path: string, body: Row, token?: string) => {
    const res = await fetch(`${url}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Row };
  };

  it("sign-up: the password goes to a new Figbloom account, HR's login is linked, and Supabase emails the confirmation", async () => {
    const r = await post('/sign-up', { email: 'Owner@Farm.Example', password: 'Kenya-2024!' });
    expect(r).toEqual({ status: 201, body: { ok: true } });
    expect(figbloom.get('owner@farm.example')).toMatchObject({ password: 'Kenya-2024!', verified: false });
    expect(logins[0].password).not.toBe('Kenya-2024!');
    expect(links.get(logins[0].id)).toEqual({ sub: 'sub-1', madeHere: true });
    expect(mail).toEqual([{ type: 'signup', email: 'owner@farm.example', options: { emailRedirectTo: 'https://hr-staging.figbloom.org/create-company' } }]);
  });

  it('sign-up: an email with an HR login, or a Figbloom account, signs in first, and nothing is left behind', async () => {
    logins.push({ id: 'u0', email: 'old@farm.example', confirmed: true });
    expect((await post('/sign-up', { email: 'old@farm.example', password: 'Kenya-2024!' })).body.code).toBe('account_exists');
    expect(figbloom.size).toBe(0);
    figbloom.set('fleet@farm.example', { sub: 'sub-fleet', password: 'x', verified: true, madeHere: false });
    const r = await post('/sign-up', { email: 'fleet@farm.example', password: 'Kenya-2024!' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('figbloom_account_exists');
    expect(logins.map((l) => l.email)).toEqual(['old@farm.example']);
  });

  it("sign-up: a password Figbloom refuses is a 400 with the rule, and HR's login is removed again", async () => {
    const r = await post('/sign-up', { email: 'owner@farm.example', password: 'weakpassword' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('invalid_password');
    expect(logins).toEqual([]);
  });

  it("email-confirmed: once Supabase has confirmed the email, the Figbloom account's is verified too", async () => {
    await post('/sign-up', { email: 'owner@farm.example', password: 'Kenya-2024!' });
    const id = logins[0].id;
    expect((await post('/email-confirmed', {}, `token-${id}`)).body.code).toBe('not_confirmed');
    logins[0].confirmed = true;
    expect((await post('/email-confirmed', {}, `token-${id}`)).body).toEqual({ ok: true, changed: true });
    expect(figbloom.get('owner@farm.example')!.verified).toBe(true);
    expect((await post('/email-confirmed', {})).status).toBe(401);
  });

  it('set-password: the first password of an account HR made, with the email proven, once', async () => {
    logins.push({ id: 'u9', email: 'added@farm.example', confirmed: true });
    figbloom.set('added@farm.example', { sub: 'sub-9', password: null, verified: false, madeHere: true });
    links.set('u9', { sub: 'sub-9', madeHere: true });
    expect((await post('/set-password', { password: 'Kenya-2024!' }, 'token-u9')).body).toEqual({ ok: true });
    expect(figbloom.get('added@farm.example')).toMatchObject({ password: 'Kenya-2024!', verified: true });
    expect(logins[0].password).toBe('retired');
    const again = await post('/set-password', { password: 'Other-2024!' }, 'token-u9');
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('use_figbloom_reset');
  });

  it("set-password: someone not on Figbloom yet gets their account with it; a moved person (not HR's) changes it on Figbloom", async () => {
    logins.push({ id: 'u7', email: 'notyet@farm.example', confirmed: true }, { id: 'u8', email: 'moved@farm.example', confirmed: true });
    expect((await post('/set-password', { password: 'Kenya-2024!' }, 'token-u7')).body).toEqual({ ok: true });
    expect(links.get('u7')).toMatchObject({ madeHere: true });
    links.set('u8', { sub: 'sub-moved', madeHere: false });
    const r = await post('/set-password', { password: 'Kenya-2024!' }, 'token-u8');
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('use_figbloom_reset');
    expect((await post('/set-password', { password: 'Kenya-2024!' })).status).toBe(401);
  });
});
