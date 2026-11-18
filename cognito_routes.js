// cognito_routes.js: "Sign in with Figbloom" (ERP/HR_COGNITO_CONTRACT.md section 2). bloomHR keeps its own Supabase
// logins and sessions; Cognito only proves who someone is.
//
//   app --POST /api/auth/cognito/exchange { pool, code, codeVerifier, redirectUri }-->
//     HR swaps the code (with its client secret) for the person's ID token at Cognito, checks it (RS256, issuer,
//     audience, token_use), finds the bloomHR login it belongs to (identity_sign_in(): by sub, or linked on the first
//     sign-in by a verified email), and answers a one-time sign-in token for that login (the handoff one: Supabase
//     admin generateLink, magiclink). The app turns it into the person's usual Supabase session (verifyOtp), so
//     auth.uid(), RLS and everything after sign-in (account status, the company's two-step code) are as today.
//   customers pool: the web app. staff pool: the console; only platform admins.
//
// On a login's first Figbloom sign-in its Supabase password is replaced with a random one, so the old password stops
// working: from then on only Cognito holds it.
//
// Settings (server only):
//   COGNITO_SIGN_IN           "on" to accept Figbloom sign-ins; otherwise 404 cognito_off
//   COGNITO_REGION
//   COGNITO_CUSTOMERS_POOL_ID, COGNITO_CUSTOMERS_DOMAIN, HR_SIGNIN_CLIENT_ID, HR_SIGNIN_CLIENT_SECRET
//   COGNITO_STAFF_POOL_ID, COGNITO_STAFF_DOMAIN, HR_CONSOLE_CLIENT_ID, HR_CONSOLE_CLIENT_SECRET
import express from "express";
import crypto from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { admin } from "./admin_routes.js";
import { supabaseHandoffStore } from "./platform_handoff_routes.js";

const TAG = "[cognito]";
export const POOLS = ["customers", "staff"];
const TIMEOUT_MS = 10_000;
const MAX = { code: 2048, codeVerifier: 128, redirectUri: 2048 };

export { cognitoSignInEnabled } from "./figbloom_accounts.js";
import { cognitoSignInEnabled, FigbloomAccountError, figbloomAccounts, randomPassword, sendAccountError, USE_FIGBLOOM_RESET } from "./figbloom_accounts.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The person behind a Supabase session token (Bearer), or null. No company needed: a new sign-up has none yet. */
async function sessionUser(db, req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !db) return null;
  const { data, error } = await db.auth.getUser(token);
  return error || !data?.user ? null : data.user;
}

const site = (env) => String(env.SITE_URL || env.PUBLIC_SITE_URL || "").trim().replace(/\/+$/, "");

export class CognitoError extends Error {
  constructor(message, status = 401, code = "sign_in_failed") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** The pool's settings, or null when any is missing. */
export function poolConfig(pool, env = process.env) {
  const names =
    pool === "staff"
      ? ["COGNITO_STAFF_POOL_ID", "COGNITO_STAFF_DOMAIN", "HR_CONSOLE_CLIENT_ID", "HR_CONSOLE_CLIENT_SECRET"]
      : ["COGNITO_CUSTOMERS_POOL_ID", "COGNITO_CUSTOMERS_DOMAIN", "HR_SIGNIN_CLIENT_ID", "HR_SIGNIN_CLIENT_SECRET"];
  const region = String(env.COGNITO_REGION || "").trim();
  const [poolId, domain, clientId, clientSecret] = names.map((n) => String(env[n] || "").trim());
  if (!region || !poolId || !domain || !clientId || !clientSecret) return null;
  return {
    pool,
    clientId,
    clientSecret,
    tokenUrl: `${domain.replace(/\/+$/, "")}/oauth2/token`,
    issuer: `https://cognito-idp.${region}.amazonaws.com/${poolId}`,
  };
}

/** The request body, checked: { pool, code, codeVerifier, redirectUri } or { error }. */
export function readExchange(body) {
  const pool = body?.pool;
  if (!POOLS.includes(pool)) return { error: "pool must be customers or staff" };
  const out = { pool };
  for (const key of ["code", "codeVerifier", "redirectUri"]) {
    const value = body?.[key];
    if (typeof value !== "string" || !value || value.length > MAX[key]) return { error: `${key} is required` };
    out[key] = value;
  }
  // PKCE: 43 to 128 characters of [A-Za-z0-9-._~] (RFC 7636)
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(out.codeVerifier)) return { error: "codeVerifier is not a PKCE verifier" };
  return out;
}

const jwks = new Map();
const keysFor = (issuer) => {
  if (!jwks.has(issuer)) jwks.set(issuer, createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)));
  return jwks.get(issuer);
};

/** Cognito, over HTTP. Tests swap it. */
export const cognito = {
  async signIn(config, { code, codeVerifier, redirectUri }) {
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
    let res;
    try {
      res = await fetch(config.tokenUrl, {
        method: "POST",
        headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", client_id: config.clientId, code, code_verifier: codeVerifier, redirect_uri: redirectUri }).toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "error",
      });
    } catch (err) {
      throw new CognitoError("Figbloom sign-in can't be reached right now. Please try again.", 503, "cognito_unreachable");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || typeof data.id_token !== "string") {
      // invalid_grant: an old, used or copied code
      if (data?.error === "invalid_grant") throw new CognitoError("This sign-in link has expired. Please sign in again.", 401, "sign_in_expired");
      console.error(TAG, `token endpoint answered ${res.status}${data?.error ? ` ${data.error}` : ""}`);
      throw new CognitoError("Figbloom sign-in failed. Please try again.", 502, "cognito_failed");
    }
    let payload;
    try {
      ({ payload } = await jwtVerify(data.id_token, keysFor(config.issuer), { issuer: config.issuer, audience: config.clientId, algorithms: ["RS256"] }));
    } catch (err) {
      // why, for the log only (never the token): a wrong issuer usually means COGNITO_*_POOL_ID or COGNITO_REGION is wrong
      console.error(TAG, `ID token refused: ${err?.code || err?.name || "error"}${err?.claim ? ` (${err.claim})` : ""}; expected issuer ${config.issuer}`);
      throw new CognitoError("Figbloom sign-in couldn't be verified. Please try again.", 401, "token_invalid");
    }
    if (payload.token_use !== "id" || typeof payload.sub !== "string") throw new CognitoError("Figbloom sign-in couldn't be verified.", 401, "token_invalid");
    const verified = payload.email_verified === true || payload.email_verified === "true";
    return { sub: payload.sub, email: typeof payload.email === "string" ? payload.email.toLowerCase() : "", emailVerified: verified };
  },
};

// ---- the database (service role), behind a small interface so the route can be tested without one

export function supabaseIdentityStore(db = admin) {
  const client = () => {
    if (!db) throw new Error("Admin API is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
    return db;
  };
  const handoff = supabaseHandoffStore(db);
  return {
    async signIn({ pool, sub, email, emailVerified }) {
      const { data, error } = await client().rpc("identity_sign_in", { p_pool: pool, p_sub: sub, p_email: email || null, p_email_verified: !!emailVerified });
      if (error) throw new Error(`identity_sign_in: ${error.message || "failed"}`);
      return Array.isArray(data) ? data[0] ?? null : data ?? null;
    },
    // the old Supabase password stops working: only Cognito holds it from now on
    async retirePassword(userId) {
      const { error } = await client().auth.admin.updateUserById(userId, { password: crypto.randomBytes(32).toString("base64url") });
      if (error) throw new Error(`updateUserById: ${error.message || "failed"}`);
    },
    signInToken: (userId) => handoff.signInToken(userId),
  };
}

const REFUSALS = {
  no_account: [403, "There is no bloomHR account for this email. Ask your company to invite you, or create a company."],
  email_in_use: [409, "This bloomHR account is already connected to another Figbloom account. Ask Figbloom support for help."],
  no_console_access: [403, "This Figbloom staff account has no console access."],
};

// Failed exchanges per address: a few people behind one office connection share it, so it counts failures only
const FAILURES = { windowMs: 15 * 60 * 1000, max: 30 };
function failureLimiter() {
  const seen = new Map();
  return {
    blocked(ip, now = Date.now()) {
      const e = seen.get(ip);
      if (!e || now - e.since > FAILURES.windowMs) return false;
      return e.count >= FAILURES.max;
    },
    failed(ip, now = Date.now()) {
      const e = seen.get(ip);
      if (!e || now - e.since > FAILURES.windowMs) seen.set(ip, { since: now, count: 1 });
      else e.count += 1;
      if (seen.size > 10_000) seen.clear();
    },
  };
}

/** POST /exchange (mounted at /api/auth/cognito). store, cognitoClient and env are for tests. */
export function createCognitoRouter({
  store = supabaseIdentityStore(),
  cognitoClient = cognito,
  env = process.env,
  accounts = figbloomAccounts,
  db = admin,
} = {}) {
  const router = express.Router();
  const limiter = failureLimiter();
  router.use(express.json({ limit: "10kb" }));
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  router.post("/exchange", async (req, res) => {
    const refuse = (status, code, message) => {
      if (status !== 503) limiter.failed(req.ip);
      return res.status(status).json({ error: { code, message } });
    };
    if (!cognitoSignInEnabled(env)) return res.status(404).json({ error: { code: "cognito_off", message: "Figbloom sign-in isn't switched on here." } });
    if (limiter.blocked(req.ip)) return res.status(429).json({ error: { code: "too_many", message: "Too many failed sign-ins from this network. Please try again in 15 minutes." } });

    const input = readExchange(req.body);
    if (input.error) return refuse(400, "bad_request", input.error);
    const config = poolConfig(input.pool, env);
    if (!config) {
      console.error(TAG, `the ${input.pool} pool's settings are incomplete`);
      return refuse(503, "cognito_not_configured", "Figbloom sign-in isn't set up here yet.");
    }

    try {
      const claims = await cognitoClient.signIn(config, input);
      const found = await store.signIn({ pool: input.pool, sub: claims.sub, email: claims.email, emailVerified: claims.emailVerified });
      if (found?.outcome !== "linked" || !found.user_id) {
        const [status, message] = REFUSALS[found?.outcome] ?? [403, "You can't sign in to bloomHR with this account."];
        console.log(TAG, input.pool, found?.outcome ?? "no answer");
        return refuse(status, found?.outcome ?? "refused", message);
      }
      if (found.newly_linked) {
        try {
          await store.retirePassword(found.user_id);
        } catch (err) {
          // never blocks the sign-in; the link is made, so the next first-time check won't run again: report it
          console.error(TAG, `could not retire the Supabase password of ${found.user_id}:`, err?.message || err);
        }
      }
      const token = await store.signInToken(found.user_id);
      if (!token?.ok) {
        console.log(TAG, input.pool, `login ${found.user_id} can't sign in: ${token?.reason}`);
        return refuse(403, "blocked", "This account can't sign in. Ask your HR administrator.");
      }
      console.log(TAG, input.pool, found.newly_linked ? "linked and signed in" : "signed in", found.user_id);
      return res.json({ tokenHash: token.tokenHash, firstSignIn: !!found.newly_linked });
    } catch (err) {
      if (err instanceof CognitoError) return refuse(err.status, err.code, err.message);
      console.error(TAG, "sign-in failed:", err?.message || err);
      return res.status(500).json({ error: { code: "error", message: "Sign-in failed. Please try again." } });
    }
  });

  const off = (res) => res.status(404).json({ error: { code: "cognito_off", message: "Figbloom sign-in isn't switched on here." } });

  // POST /sign-up { email, password }: creating a company with Figbloom sign-in. The password goes to the person's new
  // Figbloom account; HR makes their login (a random password nobody knows), links it, and Supabase emails the usual
  // confirmation link, which brings them back to /create-company, where the company is made (as today).
  router.post("/sign-up", async (req, res) => {
    if (!cognitoSignInEnabled(env)) return off(res);
    if (limiter.blocked(req.ip)) return res.status(429).json({ error: "Too many attempts from this network. Please try again in 15 minutes.", code: "too_many" });
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = req.body?.password;
    if (!EMAIL_RE.test(email) || email.length > 254) return res.status(400).json({ error: "Enter a valid email address.", code: "bad_request" });
    if (typeof password !== "string" || password.length > 256) return res.status(400).json({ error: "Choose a password.", code: "bad_request" });
    let userId = null;
    try {
      // HR's login first: an email that already has one signs in instead (its current password still works, through Figbloom)
      const { data, error } = await db.auth.admin.createUser({ email, password: randomPassword(), email_confirm: false });
      if (error || !data?.user) {
        const exists = error?.status === 422 || /already (been )?registered|already exists/i.test(error?.message || "");
        limiter.failed(req.ip);
        if (exists) return res.status(409).json({ error: "You already have a Figbloom HR account with this email. Sign in with Figbloom, then create your company.", code: "account_exists" });
        throw error || new Error("createUser failed");
      }
      userId = data.user.id;
      const account = await accounts.ensure({ email, password });
      if (!account.created) {
        await db.auth.admin.deleteUser(userId);
        userId = null;
        return res.status(409).json({ error: "You already have a Figbloom account with this email. Sign in with Figbloom, then create your company.", code: "figbloom_account_exists" });
      }
      const linked = await accounts.link(userId, account.sub, { madeHere: true });
      if (linked === "taken") throw new Error("the new Figbloom account is already linked to another login");
      const redirect = site(env);
      const { error: mailError } = await db.auth.resend({ type: "signup", email, ...(redirect ? { options: { emailRedirectTo: `${redirect}/create-company` } } : {}) });
      if (mailError) console.error(TAG, "sign-up confirmation not sent:", mailError.message);
      return res.status(201).json({ ok: true });
    } catch (err) {
      if (userId) await db.auth.admin.deleteUser(userId).catch(() => {});
      if (err instanceof FigbloomAccountError) return sendAccountError(res, err);
      console.error(TAG, "sign-up failed:", err?.message || err);
      return res.status(500).json({ error: "Could not create your account. Please try again.", code: "error" });
    }
  });

  // POST /email-confirmed (Bearer: the person's session after the confirmation link): their Figbloom account's email
  // becomes verified too, so Figbloom's "Forgot password" can reach them. Repeating it is harmless.
  router.post("/email-confirmed", async (req, res) => {
    if (!cognitoSignInEnabled(env)) return off(res);
    try {
      const user = await sessionUser(db, req);
      if (!user) return res.status(401).json({ error: "Sign in first.", code: "unauthorized" });
      if (!user.email_confirmed_at) return res.status(409).json({ error: "Your email isn't confirmed yet.", code: "not_confirmed" });
      const identity = await accounts.identityOf(user.id);
      if (!identity?.madeHere) return res.json({ ok: true, changed: false });
      await accounts.markEmailVerified(identity.sub);
      return res.json({ ok: true, changed: true });
    } catch (err) {
      if (err instanceof FigbloomAccountError) return sendAccountError(res, err);
      console.error(TAG, "email-confirmed failed:", err?.message || err);
      return res.status(500).json({ error: "Could not confirm your email. Please try again.", code: "error" });
    }
  });

  // POST /set-password { password } (Bearer: the session from a password email, /update-password): the Figbloom
  // password. An account HR made gets its first password; someone not on Figbloom yet gets their account with it; anyone
  // who already has a Figbloom password changes it on Figbloom's sign-in page (409 use_figbloom_reset).
  router.post("/set-password", async (req, res) => {
    if (!cognitoSignInEnabled(env)) return off(res);
    const password = req.body?.password;
    if (typeof password !== "string" || !password || password.length > 256) return res.status(400).json({ error: "Choose a password.", code: "bad_request" });
    try {
      const user = await sessionUser(db, req);
      if (!user?.email) return res.status(401).json({ error: "This link has expired. Ask for a new one.", code: "unauthorized" });
      const identity = await accounts.identityOf(user.id);
      if (identity && !identity.madeHere) throw USE_FIGBLOOM_RESET();
      if (identity) {
        // the link came to this inbox: the email is proven too
        await accounts.setInitialPassword(identity.sub, password, { emailProven: true });
      } else {
        const account = await accounts.ensure({ email: user.email, name: user.user_metadata?.full_name, password, emailProven: true });
        if (!account.created) throw USE_FIGBLOOM_RESET();
        const linked = await accounts.link(user.id, account.sub, { madeHere: true });
        if (linked === "taken") throw USE_FIGBLOOM_RESET();
      }
      await accounts.retirePassword(user.id).catch((err) => console.error(TAG, "could not retire the Supabase password:", err?.message || err));
      return res.json({ ok: true });
    } catch (err) {
      if (err instanceof FigbloomAccountError) return sendAccountError(res, err);
      console.error(TAG, "set-password failed:", err?.message || err);
      return res.status(500).json({ error: "Could not set your password. Please try again.", code: "error" });
    }
  });

  return router;
}
