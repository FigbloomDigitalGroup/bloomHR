// platform_handoff_routes.js: one-click sign-in from Figbloom Schools or Figbloom Fleet into HR ("handoff",
// ERP/SCHOOLS_HR_HANDOFF_CONTRACT.md section 2, ERP/FLEET_HR_CONTRACT.md section 2). The redeemed claims' source is
// the product the person came from (the platform's word: the product whose service client asked for the code); only
// the products HR maps people from (STAFF_SOURCES: schools, fleet) are accepted, and the person is looked up with that
// source (external_logins).
//
//   browser --GET /api/platform/handoff?code=...-->  HR redeems the code on the platform (POST /handoffs/redeem, the
//                                                     "hr" service client), then:
//     linked     (external_logins)  the person's HR login, if still an active member of that company: switched into it
//                                   and signed in with a one-time sign-in token (Supabase admin generateLink, magiclink,
//                                   for that user's own address), verified by the app's /handoff page, which then
//                                   opens return_to (a relative path of this site only) or the dashboard
//     no access                     "You don't have access to HR for this school": nobody is signed in
//     not linked                    never matched by email: a pending record (random id, only its hash kept, 10
//                                   minutes, used once, holding the redeemed claims, bound to this browser by an HttpOnly
//                                   cookie) and HR's normal sign-in, with "Sign in to HR once to connect your Figbloom
//                                   Schools account"
//   app --POST /api/platform/handoff/pending {pending}-->  (signed in) who would be connected, so the person confirms
//   app --POST /api/platform/handoff/link {pending}----->  (signed in, same browser) links them when they are an active
//                                                          member of that same company, uses the record up, switches
//                                                          them into the company and answers return_to
//   app --DELETE /api/platform/handoff/link {source}---->  (signed in) removes their own link (Settings)
//
// Every outcome is written to platform_handoff_log (and links to audit_log). The code, the pending id, the cookie and
// the sign-in token are never logged.
//
// Settings (server only, never VITE_):
//   PLATFORM_HANDOFF_ENABLED   "true" to accept handoffs; otherwise a friendly "not available" page (the code is not
//                              redeemed) and the link endpoints answer 503 (removing a link always works)
//   PLATFORM_CLIENT_ID / PLATFORM_CLIENT_SECRET, PLATFORM_API_URL, PLATFORM_TOKEN_URL   the "hr" service client
//   SITE_URL                   the HR website the browser is sent back to (else this same address)
//   CORS_ORIGIN                when the app calls the API from another address: the link endpoints send the cookie
//                              only to these origins
import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import { admin, authenticate, HttpError } from "./admin_routes.js";
import { PlatformError } from "./platform_client.js";
import { PRODUCT_NAMES, STAFF_SOURCES, hrClient } from "./platform_events_routes.js";

const TAG = "[platform/handoff]";
export const HANDOFF_COOKIE = "fb_hr_handoff";
export const PENDING_MINUTES = 10;
export const DEFAULT_LANDING = "/dashboard";
const REDEEM_TIMEOUT_MS = 8 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCE_RE = /^[a-z][a-z0-9_]{0,31}$/;
// the platform's code (32 bytes, base64url) and our own random values have the same shape
const TOKEN_RE = /^[A-Za-z0-9_-]{20,200}$/;
// pages a handoff must never land on: sign-in pages (a loop) and the API
const NOT_A_LANDING = /^\/(api|iclock|handoff|login|mfa|auth|join|offer|update-password|create-company)(\/|$)/i;

const on = (value) => /^(1|true|yes|on)$/i.test(String(value || "").trim());
export const handoffEnabled = () => on(process.env.PLATFORM_HANDOFF_ENABLED);

const sha256 = (value) => crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
const randomToken = () => crypto.randomBytes(32).toString("base64url");

/**
 * Where to go after signing in: return_to only when it is a path on this site ("/payroll?month=2026-11"), never
 * another address ("//evil.example", "https://...", "/\\evil"), a control character, the API or a sign-in page;
 * otherwise the dashboard.
 */
export function safeReturnTo(value, fallback = DEFAULT_LANDING) {
  if (typeof value !== "string") return fallback;
  const v = value.trim();
  if (!v || v.length > 512 || !v.startsWith("/") || v.startsWith("//") || v.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(v)) return fallback;
  let u;
  try {
    u = new URL(v, "https://hr.invalid");
  } catch {
    return fallback;
  }
  if (u.origin !== "https://hr.invalid" || NOT_A_LANDING.test(u.pathname)) return fallback;
  return `${u.pathname}${u.search}${u.hash}`;
}

/** The claims of a redeemed handoff, checked; null when anything is missing or malformed. */
export function readClaims(body) {
  const source = typeof body?.source === "string" ? body.source.trim() : "";
  const platformTenantId = typeof body?.platform_tenant_id === "string" ? body.platform_tenant_id.trim() : "";
  const tenantId = typeof body?.tenant_local_id === "string" ? body.tenant_local_id.trim() : "";
  const person = body?.person && typeof body.person === "object" ? body.person : null;
  const externalId = typeof person?.external_id === "string" ? person.external_id.trim() : "";
  if (!SOURCE_RE.test(source) || !STAFF_SOURCES.includes(source) || !UUID_RE.test(platformTenantId) || !UUID_RE.test(tenantId)) return null;
  if (!externalId || externalId.length > 200) return null;
  const text = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  return {
    source,
    platformTenantId,
    tenantId,
    externalId,
    // kept with a pending record to show who is being connected; never used to find anyone
    person: { name: text(person.name, 120), email: text(person.email, 254), role: text(person.role, 60) },
    returnTo: safeReturnTo(body?.return_to),
  };
}

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}

// ---- the database (service role), behind a small interface so the routes can be tested without one

const first = (data) => (Array.isArray(data) ? data[0] ?? null : data ?? null);

export function supabaseHandoffStore(db = admin) {
  const client = () => {
    if (!db) throw new Error("Admin API is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
    return db;
  };
  const rpc = async (fn, args) => {
    const { data, error } = await client().rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message || "failed"}`);
    return data;
  };
  return {
    begin: async ({ tenantId, platformTenantId, source, externalId, person, returnTo, tokenHash, browserHash }) =>
      first(
        await rpc("platform_handoff_begin", {
          p_tenant: tenantId, p_platform_tenant: platformTenantId, p_source: source, p_external_id: externalId,
          p_person: person, p_return_to: returnTo, p_token_hash: tokenHash, p_browser_hash: browserHash,
        })
      ),
    complete: async ({ tokenHash, browserHash, userId, confirm }) =>
      first(await rpc("platform_handoff_complete", { p_token_hash: tokenHash, p_browser_hash: browserHash, p_user: userId, p_confirm: confirm })),
    unlink: async ({ userId, tenantId, source }) =>
      Number(await rpc("platform_handoff_unlink", { p_user: userId, p_tenant: tenantId, p_source: source })) || 0,
    async log(entry) {
      const { error } = await client().from("platform_handoff_log").insert({
        outcome: entry.outcome,
        source: entry.source ?? null,
        platform_tenant_id: UUID_RE.test(String(entry.platformTenantId ?? "")) ? entry.platformTenantId : null,
        tenant_id: UUID_RE.test(String(entry.tenantId ?? "")) ? entry.tenantId : null,
        external_id: entry.externalId ? String(entry.externalId).slice(0, 200) : null,
        user_id: UUID_RE.test(String(entry.userId ?? "")) ? entry.userId : null,
        detail: entry.detail ? String(entry.detail).slice(0, 500) : null,
      });
      if (error) throw new Error(`platform_handoff_log: ${error.message}`);
    },
    /**
     * A one-time sign-in token for exactly this user (their own sign-in address), or { ok: false } when they can't
     * sign in (no such login, no address, blocked).
     */
    async signInToken(userId) {
      const { data: found, error } = await client().auth.admin.getUserById(userId);
      const user = found?.user;
      if (error || !user) return { ok: false, reason: "no_user" };
      if (user.banned_until && Date.parse(user.banned_until) > Date.now()) return { ok: false, reason: "blocked" };
      if (!user.email) return { ok: false, reason: "no_email" };
      const { data, error: linkError } = await client().auth.admin.generateLink({ type: "magiclink", email: user.email });
      const tokenHash = data?.properties?.hashed_token;
      if (linkError || typeof tokenHash !== "string" || !tokenHash) throw new Error(`generateLink: ${linkError?.message || "no token"}`);
      // the address belongs to that one login; make sure the token is for it
      if (data?.user?.id && data.user.id !== userId) throw new Error("generateLink: the token is for another login");
      return { ok: true, tokenHash };
    },
  };
}

/** The signed-in person (their session token), or an HttpError 401. */
async function supabaseUser(req) {
  if (!admin) throw new HttpError(500, "Admin API is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new HttpError(401, "Missing bearer token");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, "Invalid or expired session");
  return { id: data.user.id, email: data.user.email || "" };
}

/** The HR website the browser is sent back to: SITE_URL, else this same address (a relative redirect). */
function defaultSite() {
  return String(process.env.SITE_URL || process.env.PUBLIC_SITE_URL || "").trim().replace(/\/+$/, "");
}

/** The product's name, for the person ("Figbloom Schools", "Figbloom Fleet"); Schools when not known. */
export const productName = (source) => PRODUCT_NAMES[source] ?? PRODUCT_NAMES.schools;
const notLinkedAgain = (source) =>
  `This connection link has expired or was already used. Open HR & Payroll from ${productName(source)} again, in this browser.`;
const NOT_LINKED_AGAIN = notLinkedAgain("schools");

/** What the app is told for each outcome of finishing a pending handoff. */
function completeAnswer(r, user) {
  const company = r?.company_name || (r?.source === "fleet" ? "this company" : "this school");
  const product = productName(r?.source);
  switch (r?.outcome) {
    case "ready":
      return {
        status: 200,
        body: { outcome: "ready", source: r.source ?? null, person_name: r.person_name ?? null, company_name: r.company_name ?? null },
      };
    case "linked":
    case "already_linked":
      return { status: 200, body: { ok: true, outcome: r.outcome, company_name: r.company_name ?? null, return_to: safeReturnTo(r.return_to) } };
    case "wrong_company":
      return {
        status: 409,
        body: {
          error: {
            code: "wrong_company",
            message: `You're signed in as ${user.email || "someone"}, who isn't a member of ${company} in Figbloom HR, so nothing was connected. Sign in with the HR account you use for ${company}, or ask your HR administrator to invite you.`,
          },
          company_name: r.company_name ?? null,
        },
      };
    case "taken":
      return {
        status: 409,
        body: { error: { code: "taken", message: `Another HR login of ${company} is already connected to this ${product} account. Sign in with that login, or remove the connection there first (Appearance, Connected accounts).` } },
      };
    case "user_has_other":
      return {
        status: 409,
        body: { error: { code: "user_has_other", message: `Your HR login is already connected to another ${product} account in ${company}. Remove that connection first (Appearance, Connected accounts).` } },
      };
    case "used":
    case "expired":
    case "other_browser":
    case "invalid":
    default:
      return { status: 410, body: { error: { code: r?.outcome || "invalid", message: notLinkedAgain(r?.source) } } };
  }
}

/**
 * GET / (mounted at /api/platform/handoff) and the app's endpoints. store, platform, verifyUser, authenticateCaller
 * and site are for tests.
 */
export function createPlatformHandoffRouter({
  store = supabaseHandoffStore(),
  platform = hrClient,
  verifyUser = supabaseUser,
  authenticateCaller = authenticate,
  site = defaultSite,
  timeoutMs = REDEEM_TIMEOUT_MS,
} = {}) {
  const router = express.Router();

  // the app may call from another address (VITE_API_URL): the cookie goes only to the origins listed in CORS_ORIGIN
  const credentialed = cors((_req, cb) => {
    const origins = (process.env.CORS_ORIGIN || "").split(",").map((o) => o.trim()).filter(Boolean);
    cb(null, { origin: origins.length ? origins : false, credentials: true });
  });
  router.use(["/pending", "/link"], credentialed);
  router.use(express.json({ limit: "10kb" }));
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("Referrer-Policy", "no-referrer");
    next();
  });

  /** Records an outcome; a failure to record is reported, never shown to the person. */
  const audit = async (entry) => {
    console.log(TAG, entry.outcome, entry.source ?? "-", entry.tenantId ?? "-", entry.userId ?? "-", entry.detail ?? "");
    try {
      await store.log(entry);
    } catch (err) {
      console.error(TAG, "not logged:", err?.message || err);
    }
  };

  const page = (res, query) => res.redirect(302, `${site()}/handoff${query}`);
  // a status page for a person of another product than Schools says which (?from=fleet)
  const from = (claims) => (claims?.source && claims.source !== "schools" ? `&from=${claims.source}` : "");

  router.get("/", async (req, res) => {
    if (!handoffEnabled()) {
      await audit({ outcome: "off" });
      return page(res, "?status=off");
    }
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!TOKEN_RE.test(code)) {
      await audit({ outcome: "invalid", detail: "no code or a malformed one" });
      return page(res, "?status=invalid");
    }

    let claims = null;
    try {
      let redeemed;
      try {
        redeemed = await platform.call("POST", "/handoffs/redeem", { code }, timeoutMs);
      } catch (err) {
        if (err instanceof PlatformError && err.status >= 400 && err.status < 500 && err.status !== 429) {
          // unknown, used, expired or not ours: one answer for all (410 handoff_invalid)
          await audit({ outcome: "invalid", detail: `redeem ${err.status} ${err.code}` });
          return page(res, "?status=invalid");
        }
        await audit({ outcome: "error", detail: `redeem ${err?.status ?? ""} ${err?.code ?? err?.message ?? "failed"}`.trim() });
        return page(res, "?status=error");
      }

      claims = readClaims(redeemed);
      if (!claims) {
        await audit({ outcome: "invalid", detail: "the platform's answer is missing claims" });
        return page(res, "?status=invalid");
      }
      const base = { source: claims.source, platformTenantId: claims.platformTenantId, tenantId: claims.tenantId, externalId: claims.externalId };

      const pending = randomToken();
      const browser = randomToken();
      const r = await store.begin({
        tenantId: claims.tenantId,
        platformTenantId: claims.platformTenantId,
        source: claims.source,
        externalId: claims.externalId,
        person: claims.person,
        returnTo: claims.returnTo,
        tokenHash: sha256(pending),
        browserHash: sha256(browser),
      });

      if (r?.outcome === "unknown_company") {
        await audit({ ...base, tenantId: null, outcome: "unknown_company", detail: `tenant_local_id ${claims.tenantId}` });
        return page(res, `?status=not_set_up${from(claims)}`);
      }
      if (r?.outcome === "no_access") {
        await audit({ ...base, userId: r.user_id, outcome: "no_access" });
        return page(res, `?status=no_access${from(claims)}`);
      }
      if (r?.outcome === "linked") {
        const signIn = await store.signInToken(r.user_id);
        if (!signIn.ok) {
          await audit({ ...base, userId: r.user_id, outcome: "no_access", detail: signIn.reason });
          return page(res, `?status=no_access${from(claims)}`);
        }
        await audit({ ...base, userId: r.user_id, outcome: "signed_in" });
        const fragment = new URLSearchParams({ token_hash: signIn.tokenHash, next: claims.returnTo });
        // in the fragment: never sent to a server, never in a Referer
        return page(res, `#${fragment.toString()}`);
      }
      if (r?.outcome === "pending") {
        await audit({ ...base, outcome: "not_linked" });
        const secure = req.secure || req.get("x-forwarded-proto") === "https" || /^https:/i.test(site());
        res.cookie(HANDOFF_COOKIE, browser, {
          httpOnly: true,
          secure,
          sameSite: "lax",
          path: "/api/platform/handoff",
          maxAge: PENDING_MINUTES * 60 * 1000,
        });
        return page(res, `#${new URLSearchParams({ connect: pending }).toString()}`);
      }
      throw new Error(`platform_handoff_begin answered ${r?.outcome ?? "nothing"}`);
    } catch (err) {
      await audit({
        outcome: "error",
        source: claims?.source,
        platformTenantId: claims?.platformTenantId,
        tenantId: claims?.tenantId,
        externalId: claims?.externalId,
        detail: String(err?.message || err).slice(0, 300),
      });
      return page(res, "?status=error");
    }
  });

  const finish = (confirm) => async (req, res) => {
    if (!handoffEnabled()) return res.status(503).json({ error: { code: "handoff_off", message: "Signing in from other Figbloom products isn't available yet." } });
    let user;
    try {
      user = await verifyUser(req);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 401;
      return res.status(status).json({ error: { code: "not_signed_in", message: "Sign in first." } });
    }
    const pending = typeof req.body?.pending === "string" ? req.body.pending : "";
    if (!TOKEN_RE.test(pending)) return res.status(400).json({ error: { code: "invalid", message: NOT_LINKED_AGAIN } });
    const browser = readCookie(req, HANDOFF_COOKIE);

    try {
      const r = TOKEN_RE.test(browser)
        ? await store.complete({ tokenHash: sha256(pending), browserHash: sha256(browser), userId: user.id, confirm })
        : { outcome: "other_browser" };
      const answer = completeAnswer(r, user);
      if (confirm || r?.outcome !== "ready") {
        await audit({
          outcome: r?.outcome === "linked" || r?.outcome === "already_linked" ? r.outcome : `link_${r?.outcome || "invalid"}`.slice(0, 40),
          source: r?.source,
          tenantId: r?.tenant_id,
          externalId: r?.external_id,
          userId: user.id,
          detail: confirm ? null : "checked before linking",
        });
      }
      if (confirm && answer.status === 200) res.clearCookie(HANDOFF_COOKIE, { path: "/api/platform/handoff" });
      return res.status(answer.status).json(answer.body);
    } catch (err) {
      await audit({ outcome: "link_error", userId: user.id, detail: String(err?.message || err).slice(0, 300) });
      return res.status(500).json({ error: { code: "server_error", message: "Something went wrong. Try again." } });
    }
  };

  router.post("/pending", finish(false));
  router.post("/link", finish(true));

  // removing one's own link works even with the switch off
  router.delete("/link", async (req, res) => {
    let caller;
    try {
      caller = await authenticateCaller(req);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 401;
      return res.status(status).json({ error: { code: "not_signed_in", message: err?.message || "Sign in first." } });
    }
    const source = typeof req.body?.source === "string" ? req.body.source.trim() : "schools";
    if (!SOURCE_RE.test(source) || !STAFF_SOURCES.includes(source)) return res.status(400).json({ error: { code: "invalid_source", message: "Unknown product." } });
    try {
      const removed = await store.unlink({ userId: caller.id, tenantId: caller.tenantId, source });
      if (removed) await audit({ outcome: "unlinked", source, tenantId: caller.tenantId, userId: caller.id });
      return res.json({ ok: true, removed });
    } catch (err) {
      console.error(TAG, "unlink", err?.message || err);
      return res.status(500).json({ error: { code: "server_error", message: "The connection could not be removed. Try again." } });
    }
  });

  return router;
}
