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

export const cognitoSignInEnabled = (env = process.env) => String(env.COGNITO_SIGN_IN || "").trim() === "on";

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
    } catch {
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
export function createCognitoRouter({ store = supabaseIdentityStore(), cognitoClient = cognito, env = process.env } = {}) {
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

  return router;
}
