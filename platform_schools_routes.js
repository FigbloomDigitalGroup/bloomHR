// platform_schools_routes.js: Figbloom Schools in the Figbloom console (ERP/SCHOOLS_CONSOLE_CONTRACT.md, level 1).
//
//   console page --(Supabase session)--> /api/platform/schools --(shared secret)--> Schools' edge function platform-schools
//
// The caller is checked as on every console route (authenticatePlatformAdmin() in platform_routes.js: a bearer token,
// then a row in platform_admins; no company needed), then for their console role's permission. Schools' own database
// never sees the caller: it trusts the shared secret, so the permission check here is the only one.
//
// Settings: SCHOOLS_PLATFORM_URL (Schools' Supabase URL) and SCHOOLS_PLATFORM_SECRET (the same value as Schools'
// PLATFORM_CONSOLE_SECRET). Either unset: 503 schools_not_connected, which the console shows as "not connected yet".
// The secret only ever goes into the x-platform-secret header: it is never logged nor sent back.
//
// Errors are { error: { code, message } }, as Schools' own.
import express from "express";
import { HttpError } from "./admin_routes.js";
import { authenticatePlatformAdmin, platformRoleAllows } from "./platform_routes.js";

export const SCHOOLS_TIMEOUT_MS = 8 * 1000; // 8 seconds, as the contract says
export const SCHOOL_STATUSES = ["suspended", "active"];
export const MAX_REASON = 500;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_RE = /^[a-z][a-z0-9_]{0,63}$/;

class SchoolsError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const AUTH_CODES = { 401: "unauthorized", 403: "forbidden", 500: "server_error" };

/** Schools' address and secret, or 503 schools_not_connected. */
function schoolsSettings() {
  const url = String(process.env.SCHOOLS_PLATFORM_URL || "").trim().replace(/\/+$/, "");
  const secret = String(process.env.SCHOOLS_PLATFORM_SECRET || "").trim();
  if (!url || !secret) throw new SchoolsError(503, "schools_not_connected", "Figbloom Schools isn't connected yet.");
  return { url, secret };
}

const unavailable = (message = "Figbloom Schools didn't answer. Try again.") => new SchoolsError(502, "schools_unavailable", message);

/**
 * One call to Schools' platform-schools function. Resolves its JSON on 2xx. Its 4xx answers come back as a
 * SchoolsError with the same status, code and message, except 401: that means the shared secret was refused (a
 * setting to fix here, not the caller's session), so it is a 502. Anything else (unreachable, a timeout, 5xx, not
 * JSON) is a 502 schools_unavailable.
 */
async function callSchools(body, timeoutMs) {
  const { url, secret } = schoolsSettings();
  let response;
  let payload;
  try {
    response = await fetch(`${url}/functions/v1/platform-schools`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-platform-secret": secret },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    payload = await response.json().catch((err) => {
      if (err?.name === "TimeoutError" || err?.name === "AbortError") throw err;
      return null;
    });
  } catch (err) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    // the error's name only: never the request (its headers carry the secret)
    console.error("[platform/schools]", body.action, timedOut ? "timed out" : `failed (${err?.name || "error"})`);
    throw unavailable(timedOut ? "Figbloom Schools didn't answer in time. Try again." : undefined);
  }

  if (response.ok) {
    if (payload === null || typeof payload !== "object") {
      console.error("[platform/schools]", body.action, "answered", response.status, "without JSON");
      throw unavailable();
    }
    return payload;
  }
  if (response.status === 401) {
    console.error("[platform/schools]", body.action, "refused the shared secret (check SCHOOLS_PLATFORM_SECRET)");
    throw new SchoolsError(502, "schools_unavailable", "Figbloom Schools refused the console's connection. Check its settings.");
  }
  if (response.status >= 400 && response.status < 500) {
    const e = payload?.error;
    const code = typeof e?.code === "string" && CODE_RE.test(e.code) ? e.code : "schools_error";
    const message = typeof e?.message === "string" && e.message.trim() ? e.message.trim().slice(0, 500) : "Figbloom Schools refused the request.";
    throw new SchoolsError(response.status, code, message);
  }
  console.error("[platform/schools]", body.action, "answered", response.status);
  throw unavailable();
}

/** The signed-in platform admin, if their role allows `permission`; else a SchoolsError. */
async function callerWith(req, permission, refusal) {
  let caller;
  try {
    caller = await authenticatePlatformAdmin(req);
  } catch (err) {
    if (err instanceof HttpError) throw new SchoolsError(err.status, AUTH_CODES[err.status] || "error", err.message);
    throw err;
  }
  if (!platformRoleAllows(caller.role, permission)) throw new SchoolsError(403, "forbidden", refusal);
  return caller;
}

function send(res, err) {
  if (err instanceof SchoolsError) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  console.error("[platform/schools]", err?.message || err);
  return res.status(500).json({ error: { code: "server_error", message: "Something went wrong. Try again." } });
}

/** The routes, mounted at /api/platform/schools. timeoutMs is for tests; the console uses SCHOOLS_TIMEOUT_MS. */
export function createSchoolsRouter({ timeoutMs = SCHOOLS_TIMEOUT_MS } = {}) {
  const router = express.Router();

  // GET /api/platform/schools -> Schools' list: { generated_at, schools: [...] }. Permission: view.
  router.get("/", async (req, res) => {
    try {
      await callerWith(req, "view", "Your console role can't see schools.");
      res.json(await callSchools({ action: "list" }, timeoutMs));
    } catch (err) {
      send(res, err);
    }
  });

  // POST /api/platform/schools/:id/status { status: 'suspended' | 'active', reason } -> { school }.
  // Permission: suspend_companies. A reason (1-500 characters) is needed to suspend; Schools records the caller's
  // email in its own audit log.
  router.post("/:id/status", async (req, res) => {
    try {
      const caller = await callerWith(req, "suspend_companies", "Your console role can't suspend or reactivate schools.");

      const id = String(req.params.id || "");
      if (!UUID_RE.test(id)) throw new SchoolsError(400, "invalid_school_id", "That is not a school's ID.");
      const status = req.body?.status;
      if (typeof status !== "string" || !SCHOOL_STATUSES.includes(status)) {
        throw new SchoolsError(400, "invalid_status", "Choose a status: suspended or active.");
      }
      const rawReason = req.body?.reason;
      if (rawReason != null && typeof rawReason !== "string") throw new SchoolsError(400, "invalid_reason", "The reason must be text.");
      const reason = (rawReason || "").trim();
      if (status === "suspended" && !reason) throw new SchoolsError(400, "reason_required", "Give a reason to suspend a school.");
      if (reason.length > MAX_REASON) throw new SchoolsError(400, "invalid_reason", `Keep the reason to ${MAX_REASON} characters.`);
      if (!caller.email) throw new SchoolsError(400, "no_actor_email", "Your login has no email to record this under.");

      const result = await callSchools(
        { action: "set_status", school_id: id, status, ...(reason ? { reason } : {}), actor_email: caller.email },
        timeoutMs
      );
      res.json(result);
    } catch (err) {
      send(res, err);
    }
  });

  return router;
}

export default createSchoolsRouter();
