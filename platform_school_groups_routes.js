// platform_school_groups_routes.js: Figbloom Schools' school groups (organisations) in the Figbloom console, decided on
// the Figbloom platform (ERP/CORE_PLATFORM_DESIGN.md 5.8; figbloomHR-platform README "Organisations and product
// registration (5.8)").
//
//   console page --(Supabase session)--> /api/platform/school-groups --(client credentials)--> platform API /organizations
//
// The caller is checked as on every console route (authenticatePlatformAdmin(): a bearer token, then a row in
// platform_admins; no company needed), then for their console role's permission. THE PLATFORM DOES NOT CHECK ROLES: it
// trusts this backend (its own Cognito client, scope platform/console) and records console:<actor_email> as who decided,
// so the role check here is the only one.
//
// Settings: PLATFORM_API_URL, PLATFORM_TOKEN_URL (the customers pool's Cognito /oauth2/token), PLATFORM_CONSOLE_CLIENT_ID
// and PLATFORM_CONSOLE_CLIENT_SECRET (the console-service-<env> client). Any missing: 503 platform_not_connected.
// SCHOOL_GROUP_DECISIONS_LIVE ("true" once Schools applies the platform's decisions): the GET says it, and the page shows
// a banner while it is off. The client secret and the access token are never logged nor sent back.
//
// Errors are { error: { code, message } }, as the platform's own (its 4xx pass through).
import express from "express";
import { HttpError } from "./admin_routes.js";
import { authenticatePlatformAdmin, platformRoleAllows } from "./platform_routes.js";

export const PLATFORM_TIMEOUT_MS = 8 * 1000;
export const MAX_REASON = 500;
export const SCOPE = "platform/console";
const PAGE = 200; // the platform's largest page
const MAX_PAGES = 10; // 2,000 groups: more than the console shows at once
const TOKEN_MARGIN_MS = 60 * 1000; // a token is renewed a minute before it expires

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_RE = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * What the console may do to a group, the platform status it becomes, from which statuses, and the permission it needs:
 * approving and rejecting are Owner/Admin (approve_companies); suspending and reactivating are Support too
 * (suspend_companies). Checked against the group's current status here, so reactivate can't be used to approve.
 */
export const ACTIONS = {
  approve: { to: "active", from: ["pending"], permission: "approve_companies", reason: false },
  reject: { to: "rejected", from: ["pending"], permission: "approve_companies", reason: true },
  suspend: { to: "suspended", from: ["active"], permission: "suspend_companies", reason: true },
  reactivate: { to: "active", from: ["suspended", "rejected"], permission: "suspend_companies", reason: false },
};

class PlatformError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const AUTH_CODES = { 401: "unauthorized", 403: "forbidden", 500: "server_error" };
const unavailable = (message = "The Figbloom platform didn't answer. Try again.") => new PlatformError(502, "platform_unavailable", message);

/** The platform's settings, or 503 platform_not_connected. */
function platformSettings() {
  const read = (name) => String(process.env[name] || "").trim();
  const apiUrl = read("PLATFORM_API_URL").replace(/\/+$/, "");
  const tokenUrl = read("PLATFORM_TOKEN_URL");
  const clientId = read("PLATFORM_CONSOLE_CLIENT_ID");
  const clientSecret = read("PLATFORM_CONSOLE_CLIENT_SECRET");
  if (!apiUrl || !tokenUrl || !clientId || !clientSecret) {
    throw new PlatformError(503, "platform_not_connected", "The Figbloom platform isn't connected to the console yet.");
  }
  return { apiUrl, tokenUrl, clientId, clientSecret };
}

/** Whether Figbloom Schools applies the platform's decisions yet (SCHOOL_GROUP_DECISIONS_LIVE). */
export const decisionsLive = () => /^(1|true|yes|on)$/i.test(String(process.env.SCHOOL_GROUP_DECISIONS_LIVE || "").trim());

// ---- the console's access token (client credentials), kept until shortly before it expires

let cached = null; // { key, token, expiresAt }
let pending = null; // { key, promise }: one token request at a time

/** Forgets the token (tests; and after the platform refuses it). */
export function resetPlatformToken() {
  cached = null;
  pending = null;
}

async function requestToken(s, timeoutMs) {
  let response;
  let payload;
  try {
    response = await fetch(s.tokenUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from(`${s.clientId}:${s.clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: SCOPE }).toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    payload = await response.json().catch(() => null);
  } catch (err) {
    console.error("[platform/school-groups] token request", err?.name === "TimeoutError" ? "timed out" : `failed (${err?.name || "error"})`);
    throw unavailable("The console couldn't sign in to the Figbloom platform. Try again.");
  }
  if (!response.ok || typeof payload?.access_token !== "string" || !payload.access_token) {
    // the status only: the answer may echo the client
    console.error("[platform/school-groups] token request refused", response.status);
    throw unavailable("The console couldn't sign in to the Figbloom platform. Check its settings.");
  }
  const seconds = Number(payload.expires_in) > 0 ? Number(payload.expires_in) : 3600;
  return { token: payload.access_token, expiresAt: Date.now() + seconds * 1000 };
}

async function platformToken(s, timeoutMs) {
  const key = `${s.tokenUrl}|${s.clientId}`;
  if (cached && cached.key === key && Date.now() < cached.expiresAt - TOKEN_MARGIN_MS) return cached.token;
  if (!pending || pending.key !== key) {
    const promise = requestToken(s, timeoutMs).then(
      (t) => {
        cached = { key, ...t };
        if (pending?.promise === promise) pending = null;
        return t.token;
      },
      (err) => {
        if (pending?.promise === promise) pending = null;
        throw err;
      }
    );
    pending = { key, promise };
  }
  return pending.promise;
}

/**
 * One call to the platform API. Resolves its JSON on 2xx. Its 4xx come back as a PlatformError with the same status,
 * code and message, except 401/403: those mean the console's own credential was refused (a setting to fix here, not the
 * caller's session), so after one retry with a new token they are a 502. Anything else (unreachable, a timeout, 5xx,
 * not JSON) is a 502 platform_unavailable.
 */
async function callPlatform(method, path, body, timeoutMs, retried = false) {
  const s = platformSettings();
  const token = await platformToken(s, timeoutMs);
  let response;
  let payload;
  try {
    response = await fetch(`${s.apiUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    payload = await response.json().catch((err) => {
      if (err?.name === "TimeoutError" || err?.name === "AbortError") throw err;
      return null;
    });
  } catch (err) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    // the method and route only: never the request (its headers carry the token)
    console.error("[platform/school-groups]", method, path.split("?")[0], timedOut ? "timed out" : `failed (${err?.name || "error"})`);
    throw unavailable(timedOut ? "The Figbloom platform didn't answer in time. Try again." : undefined);
  }

  if (response.ok) {
    if (payload === null || typeof payload !== "object") throw unavailable();
    return payload;
  }
  if (response.status === 401 || response.status === 403) {
    resetPlatformToken();
    if (!retried) return callPlatform(method, path, body, timeoutMs, true);
    console.error("[platform/school-groups] the platform refused the console's credential", response.status);
    throw unavailable("The Figbloom platform refused the console's connection. Check its settings.");
  }
  if (response.status >= 400 && response.status < 500) {
    const e = payload?.error;
    const code = typeof e?.code === "string" && CODE_RE.test(e.code) ? e.code : "platform_error";
    const message = typeof e?.message === "string" && e.message.trim() ? e.message.trim().slice(0, 500) : "The Figbloom platform refused the request.";
    throw new PlatformError(response.status, code, message);
  }
  console.error("[platform/school-groups]", method, path.split("?")[0], "answered", response.status);
  throw unavailable();
}

/** A school (platform customer account) as the console shows it: Schools' own ID and address for it. */
function toSchool(t) {
  const link = Array.isArray(t?.links) ? t.links.find((l) => l?.module === "schools") ?? null : null;
  return {
    id: String(t?.id ?? ""),
    name: String(t?.name ?? ""),
    status: typeof t?.status === "string" ? t.status : null,
    local_tenant_id: link?.local_tenant_id ?? t?.local_tenant_id ?? null,
    local_slug: link?.local_slug ?? t?.local_slug ?? t?.slug ?? null,
  };
}

function toGroup(o) {
  const link = Array.isArray(o?.links) ? o.links.find((l) => l?.module === "schools") ?? null : null;
  const schools = Array.isArray(o?.tenants) ? o.tenants.map(toSchool) : [];
  return {
    id: String(o?.id ?? ""),
    name: String(o?.name ?? ""),
    status: String(o?.status ?? ""),
    status_reason: o?.status_reason ?? null,
    owner_email: o?.owner_email ?? null,
    created_at: o?.created_at ?? null,
    local_organization_id: link?.local_organization_id ?? null,
    tenant_count: Number.isFinite(Number(o?.tenant_count)) ? Number(o.tenant_count) : schools.length,
    schools,
  };
}

/** Every Schools organisation on the platform (all pages), with the counts by status. */
async function listGroups(timeoutMs) {
  const groups = [];
  let counts = {};
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ module: "schools", limit: String(PAGE), offset: String(page * PAGE) });
    const result = await callPlatform("GET", `/organizations?${params}`, null, timeoutMs);
    const rows = Array.isArray(result.organizations) ? result.organizations : [];
    if (page === 0 && result.counts && typeof result.counts === "object") counts = result.counts;
    groups.push(...rows.map(toGroup));
    if (rows.length < PAGE) break;
    if (page === MAX_PAGES - 1) truncated = true;
  }
  return { groups, counts, truncated };
}

/** The signed-in platform admin, if their role allows `permission`; else a PlatformError. */
async function callerWith(req, permission, refusal) {
  let caller;
  try {
    caller = await authenticatePlatformAdmin(req);
  } catch (err) {
    if (err instanceof HttpError) throw new PlatformError(err.status, AUTH_CODES[err.status] || "error", err.message);
    throw err;
  }
  if (!platformRoleAllows(caller.role, permission)) throw new PlatformError(403, "forbidden", refusal);
  return caller;
}

function send(res, err) {
  if (err instanceof PlatformError) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  console.error("[platform/school-groups]", err?.message || err);
  return res.status(500).json({ error: { code: "server_error", message: "Something went wrong. Try again." } });
}

/** The routes, mounted at /api/platform/school-groups. timeoutMs is for tests. */
export function createSchoolGroupsRouter({ timeoutMs = PLATFORM_TIMEOUT_MS } = {}) {
  const router = express.Router();

  // GET /api/platform/school-groups -> { groups, counts, truncated, decisions_live }. Permission: view.
  router.get("/", async (req, res) => {
    try {
      await callerWith(req, "view", "Your console role can't see school groups.");
      const { groups, counts, truncated } = await listGroups(timeoutMs);
      res.json({ groups, counts, truncated, decisions_live: decisionsLive() });
    } catch (err) {
      send(res, err);
    }
  });

  // POST /api/platform/school-groups/:id/status { action: approve | reject | suspend | reactivate, reason }
  //   -> { group, decisions_live }. Approve and reject need approve_companies; suspend and reactivate need
  // suspend_companies. A reason (1-500 characters) is needed to reject or suspend. The platform records the caller's
  // email as who decided.
  router.post("/:id/status", async (req, res) => {
    try {
      const action = req.body?.action;
      const rule = typeof action === "string" && Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : null;
      // who may do anything at all, before saying more about the request
      const caller = await callerWith(req, rule ? rule.permission : "view", "Your console role can't do that to school groups.");
      if (!rule) throw new PlatformError(400, "invalid_action", "Choose an action: approve, reject, suspend or reactivate.");

      const id = String(req.params.id || "");
      if (!UUID_RE.test(id)) throw new PlatformError(400, "invalid_group_id", "That is not a school group's ID.");
      const rawReason = req.body?.reason;
      if (rawReason != null && typeof rawReason !== "string") throw new PlatformError(400, "invalid_reason", "The reason must be text.");
      const reason = (rawReason || "").trim();
      if (rule.reason && !reason) throw new PlatformError(400, "reason_required", `Give a reason to ${action} a school group.`);
      if (reason.length > MAX_REASON) throw new PlatformError(400, "invalid_reason", `Keep the reason to ${MAX_REASON} characters.`);
      if (!caller.email) throw new PlatformError(400, "no_actor_email", "Your login has no email to record this under.");

      // the group's status now, so each action only does what its permission allows (reactivate never approves)
      const { groups } = await listGroups(timeoutMs);
      const group = groups.find((g) => g.id === id);
      if (!group) throw new PlatformError(404, "organization_not_found", "No such school group.");
      if (!rule.from.includes(group.status)) {
        throw new PlatformError(409, "invalid_transition", `A ${group.status} school group can't be ${action === "reactivate" ? "reactivated" : `${action}d`}.`);
      }

      const result = await callPlatform(
        "POST",
        `/organizations/${encodeURIComponent(id)}/status`,
        { status: rule.to, ...(reason ? { reason } : {}), actor_email: caller.email },
        timeoutMs
      );
      // the group as it is now: the platform's answer for the status, the list for its schools
      const o = result.organization && typeof result.organization === "object" ? result.organization : {};
      res.json({
        group: { ...group, status: typeof o.status === "string" ? o.status : rule.to, status_reason: o.status_reason ?? (reason || null) },
        decisions_live: decisionsLive(),
      });
    } catch (err) {
      send(res, err);
    }
  });

  return router;
}

export default createSchoolGroupsRouter();
