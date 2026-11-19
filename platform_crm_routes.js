// platform_crm_routes.js: Figbloom CRM's organisations in the Figbloom console (ERP/CRM_PLATFORM_CONTRACT.md 3).
//
//   console page --(Supabase session)--> /api/platform/crm/organizations --+--(shared secret)--> CRM /api/platform/organizations
//                                                                          +--(client credentials)--> platform API /organizations
//
// The same pattern as Figbloom Fleet's companies (platform_fleet_routes.js), with two differences: Figbloom staff create
// CRM organisations here (CRM's POST /api/platform/organizations, with the staff member's email for CRM's audit), and
// there is nothing to approve, so the console creates, lists, suspends and reactivates. One CRM Organization is one
// platform organisation, registered by product "crm" with its own ID as the local ID; CRM's summary carries the
// platform's ID for it (platformOrganizationId), null until CRM has registered it (within a minute of being created).
// Suspending and reactivating are decided on the platform (POST /organizations/{id}/status), as for Fleet; the platform
// tells CRM through its decision webhook.
//
// The caller is checked as on every console route (callerWith(): a bearer token, then a row in platform_admins), then
// for their console role's permission: any console role sees the list (view); creating, suspending and reactivating
// need approve_companies (Owner, Admin: Mike, 2026-11-19). Neither CRM nor the platform checks roles: they trust this
// backend, so the check here is the only one.
//
// Settings: CRM_PLATFORM_URL (CRM's address, e.g. https://crm.figbloom.org, with or without /api) and
// CRM_PLATFORM_SECRET (the same value as CRM's PLATFORM_CONSOLE_SECRET). Either unset: 503 crm_not_connected, which the
// console shows as "not connected yet". The platform's settings are the console client's
// (platform_school_groups_routes.js); without them the organisations still show, with CRM's own status and no actions.
// The secret only ever goes into the x-platform-secret header: it is never logged nor sent back.
//
// CRM sends counts only (members, invitations, leads, open deals, companies): no deal values and no customer data, and
// toSummary() keeps only the fields below, so nothing else CRM might add ever reaches the browser.
//
// Errors are { error: { code, message, field_errors? } }; field_errors ([{ path, message }], path one of name, slug,
// adminName, adminEmail) come from CRM's own validation of a new organisation, or from the checks here.
import express from "express";
import { PLATFORM_TIMEOUT_MS, PlatformError } from "./platform_client.js";
import { MAX_REASON, callPlatform, callerWith } from "./platform_school_groups_routes.js";

export { MAX_REASON } from "./platform_school_groups_routes.js";
export const CRM_TIMEOUT_MS = 8 * 1000;
// creating provisions the organisation and sends its admin's invitation: give it longer, and never retry it
export const CRM_CREATE_TIMEOUT_MS = 20 * 1000;
export const MODULE = "crm";
const PAGE = 200; // the platform's largest page
const MAX_PAGES = 10; // 2,000 organisations: more than the console shows at once
const TAG = "[platform/crm]";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CRM_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const CODE_RE = /^[a-z][a-z0-9_]{0,63}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_NAME = 200;
export const MAX_SLUG = 63;
export const MAX_EMAIL = 254;

/**
 * What the console may do to a CRM organisation: the platform status it becomes, from which, and the permission. Both
 * are approve_companies (the contract: the same staff as Fleet's approvals). A reason is needed to suspend.
 */
export const ACTIONS = {
  suspend: { to: "suspended", from: ["active"], permission: "approve_companies", reason: true },
  reactivate: { to: "active", from: ["suspended"], permission: "approve_companies", reason: false },
};

/** CRM's address and secret, or 503 crm_not_connected. */
function crmSettings() {
  const url = String(process.env.CRM_PLATFORM_URL || "").trim().replace(/\/+$/, "");
  const secret = String(process.env.CRM_PLATFORM_SECRET || "").trim();
  if (!url || !secret) throw new PlatformError(503, "crm_not_connected", "Figbloom CRM isn't connected to the console yet.");
  return { base: url.endsWith("/api") ? url : `${url}/api`, secret };
}

const crmUnavailable = (message = "Figbloom CRM didn't answer. Try again.") => new PlatformError(502, "crm_unavailable", message);

/** CRM's field errors ([{ path, message }]), kept to the form's fields. */
function fieldErrorsOf(payload) {
  const list = Array.isArray(payload?.fieldErrors) ? payload.fieldErrors : Array.isArray(payload?.error?.fieldErrors) ? payload.error.fieldErrors : [];
  return list
    .filter((f) => f && typeof f.path === "string" && typeof f.message === "string" && f.message.trim())
    .map((f) => ({ path: f.path, message: f.message.trim().slice(0, 300) }))
    .slice(0, 20);
}

/** A PlatformError that may carry field errors. */
function crmError(status, code, message, fieldErrors) {
  const err = new PlatformError(status, code, message);
  if (fieldErrors?.length) err.fieldErrors = fieldErrors;
  return err;
}

/**
 * One call to CRM's console API (path under /api/platform). Resolves its JSON on 2xx. Its 4xx come back with the same
 * status, CRM's code in lower case and its message (and field errors), except 401/403: the shared secret was refused (a
 * setting to fix here, not the caller's session), so that is a 502. Anything else (unreachable, a timeout, 5xx, not
 * JSON) is a 502 crm_unavailable.
 */
export async function callCrm(method, path, body, timeoutMs = CRM_TIMEOUT_MS) {
  const { base, secret } = crmSettings();
  let response;
  let payload;
  try {
    response = await fetch(`${base}/platform${path}`, {
      method,
      headers: {
        accept: "application/json",
        "x-platform-secret": secret,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
  } catch (err) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    // the route and the error's name only: never the request (its headers carry the secret)
    console.error(TAG, method, path, timedOut ? "timed out" : `failed (${err?.name || "error"})`);
    throw crmUnavailable(timedOut ? "Figbloom CRM didn't answer in time. Try again." : undefined);
  }

  if (response.ok) {
    if (payload === null || typeof payload !== "object") {
      console.error(TAG, method, path, "answered", response.status, "without JSON");
      throw crmUnavailable();
    }
    return payload;
  }
  if (response.status === 401 || response.status === 403) {
    console.error(TAG, "CRM refused the shared secret (check CRM_PLATFORM_SECRET)", response.status);
    throw crmUnavailable("Figbloom CRM refused the console's connection. Check its settings.");
  }
  if (response.status >= 400 && response.status < 500) {
    // CRM's envelope: { error: "<message>", code: "SLUG_TAKEN" | "VALIDATION_FAILED" | "NOT_FOUND", message, fieldErrors }; { error: { code, message } } too
    const e = payload?.error;
    const rawCode = typeof payload?.code === "string" ? payload.code : typeof e?.code === "string" ? e.code : "";
    const lower = rawCode.toLowerCase();
    const code = CODE_RE.test(lower) ? lower : "crm_error";
    const raw = typeof payload?.message === "string" ? payload.message : typeof e === "string" ? e : typeof e?.message === "string" ? e.message : "";
    throw crmError(response.status, code, raw.trim() ? raw.trim().slice(0, 500) : "Figbloom CRM refused the request.", fieldErrorsOf(payload));
  }
  console.error(TAG, method, path, "answered", response.status);
  throw crmUnavailable();
}

const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const count = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * One of CRM's organisation summaries, as the console shows it. Only these fields: whatever else CRM might send (it
 * sends no deal values or customer data) never reaches the browser.
 */
export function toSummary(c) {
  const admin = c?.admin && typeof c.admin === "object" ? c.admin : null;
  const counts = c?.counts && typeof c.counts === "object" ? c.counts : {};
  return {
    id: String(c?.id ?? ""),
    name: String(c?.name ?? ""),
    slug: str(c?.slug),
    crm_status: str(c?.status),
    created_at: str(c?.createdAt ?? c?.created_at),
    admin_name: str(admin?.name),
    admin_email: str(admin?.email),
    active_members: count(counts.activeMembers),
    pending_invitations: count(counts.pendingInvitations),
    leads: count(counts.leads),
    open_deals: count(counts.openDeals),
    companies: count(counts.companies),
    last_activity_at: str(c?.lastActivityAt ?? c?.last_activity_at),
    platform_organization_id: str(c?.platformOrganizationId ?? c?.platform_organization_id),
  };
}

const badAnswer = () => crmUnavailable("Figbloom CRM sent something the console does not understand.");

/** CRM's link switched off: its whole console API answers 404, which is "not connected" here, as a missing setting. */
const linkOff = (err) =>
  err instanceof PlatformError && err.status === 404
    ? new PlatformError(503, "crm_not_connected", "Figbloom CRM isn't connected to the console yet (its platform link is switched off).")
    : err;

/** CRM's summaries. */
export async function crmOrganizations(timeoutMs) {
  let result;
  try {
    result = await callCrm("GET", "/organizations", undefined, timeoutMs);
  } catch (err) {
    throw linkOff(err);
  }
  if (!Array.isArray(result.organizations)) {
    console.error(TAG, "GET /organizations answered without a list of organisations");
    throw badAnswer();
  }
  return result.organizations.map(toSummary).filter((c) => c.id);
}

/** One CRM summary (404 not_found when CRM doesn't know it). */
export async function crmOrganization(id, timeoutMs) {
  const result = await callCrm("GET", `/organizations/${encodeURIComponent(id)}`, undefined, timeoutMs);
  const s = result.organization && typeof result.organization === "object" ? toSummary(result.organization) : null;
  if (!s?.id) throw badAnswer();
  return s;
}

function toPlatformOrganization(o) {
  const link = Array.isArray(o?.links) ? o.links.find((l) => l?.module === MODULE) ?? null : null;
  return {
    id: String(o?.id ?? ""),
    name: String(o?.name ?? ""),
    status: String(o?.status ?? ""),
    status_reason: o?.status_reason ?? null,
    owner_email: o?.owner_email ?? null,
    created_at: o?.created_at ?? null,
    local_organization_id: link?.local_organization_id != null ? String(link.local_organization_id) : null,
  };
}

/** Every CRM organisation on the platform (all pages). */
export async function platformCrmOrganizations(timeoutMs) {
  const organizations = [];
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ module: MODULE, limit: String(PAGE), offset: String(page * PAGE) });
    const result = await callPlatform("GET", `/organizations?${params}`, null, timeoutMs);
    const rows = Array.isArray(result.organizations) ? result.organizations : [];
    organizations.push(...rows.map(toPlatformOrganization));
    if (rows.length < PAGE) break;
    if (page === MAX_PAGES - 1) truncated = true;
  }
  return { organizations, truncated };
}

/** The platform's organisations, or why they couldn't be read ({ ok: false, code, message }); other errors throw. */
async function platformOrNot(timeoutMs) {
  try {
    return { ok: true, ...(await platformCrmOrganizations(timeoutMs)) };
  } catch (err) {
    if (!(err instanceof PlatformError)) throw err;
    return { ok: false, code: err.code, message: err.message, organizations: [], truncated: false };
  }
}

const EMPTY_SUMMARY = {
  slug: null, crm_status: null, admin_name: null, admin_email: null, active_members: null, pending_invitations: null,
  leads: null, open_deals: null, companies: null, last_activity_at: null, platform_organization_id: null,
};

/** One summary with the platform's organisation for it (by the platform's ID CRM gave, else the crm local ID). */
function withPlatform(s, o) {
  return {
    ...s,
    in_crm: true,
    organization_id: o?.id ?? null,
    status: o?.status || null,
    status_reason: o?.status_reason ?? null,
  };
}

/**
 * CRM's organisations with the platform's status for each. One CRM hasn't registered yet has no platform status (the
 * console shows CRM's own); an organisation on the platform that CRM's list doesn't have (in_crm: false) still shows.
 */
export function mergeOrganizations(summaries, organizations) {
  const byId = new Map(organizations.map((o) => [o.id, o]));
  const byLocal = new Map(organizations.filter((o) => o.local_organization_id).map((o) => [o.local_organization_id, o]));
  const seen = new Set();
  const merged = summaries.map((s) => {
    const o = (s.platform_organization_id && byId.get(s.platform_organization_id)) || byLocal.get(s.id) || null;
    if (o) seen.add(o.id);
    return withPlatform(s, o);
  });
  for (const o of organizations) {
    if (seen.has(o.id)) continue;
    merged.push({
      ...EMPTY_SUMMARY,
      id: o.local_organization_id ?? "",
      name: o.name,
      created_at: o.created_at,
      in_crm: false,
      organization_id: o.id,
      status: o.status || null,
      status_reason: o.status_reason,
    });
  }
  return merged;
}

/** The status the console shows: the platform's decision, else CRM's own, else unregistered. */
export const shownStatus = (o) => o.status ?? o.crm_status ?? "unregistered";

/** How many organisations have each status. */
export function countByStatus(list) {
  const counts = { active: 0, suspended: 0, inactive: 0, unregistered: 0 };
  for (const o of list) {
    const key = shownStatus(o);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** The new organisation's fields, trimmed, or a 400 validation_failed with each field's problem. */
export function newOrganizationInput(body) {
  const errors = [];
  const text = (key, { required, max }) => {
    const v = body?.[key];
    if (v !== undefined && v !== null && typeof v !== "string") {
      errors.push({ path: key, message: "Must be text." });
      return null;
    }
    const t = (v ?? "").trim();
    if (!t) {
      if (required) errors.push({ path: key, message: "Required." });
      return null;
    }
    if (t.length > max) errors.push({ path: key, message: `Keep it to ${max} characters.` });
    return t;
  };
  const name = text("name", { required: true, max: MAX_NAME });
  const slug = text("slug", { required: false, max: MAX_SLUG });
  const adminName = text("adminName", { required: true, max: MAX_NAME });
  const adminEmail = text("adminEmail", { required: true, max: MAX_EMAIL });
  if (adminEmail && !errors.some((e) => e.path === "adminEmail") && !EMAIL_RE.test(adminEmail)) {
    errors.push({ path: "adminEmail", message: "Enter a valid email address." });
  }
  if (errors.length) throw crmError(400, "validation_failed", "Check the highlighted fields.", errors);
  return { name, ...(slug ? { slug } : {}), adminName, adminEmail: adminEmail.toLowerCase() };
}

function send(res, err) {
  if (err instanceof PlatformError) {
    const fieldErrors = Array.isArray(err.fieldErrors) ? err.fieldErrors : [];
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(fieldErrors.length ? { field_errors: fieldErrors } : {}) },
    });
  }
  console.error(TAG, err?.message || err);
  return res.status(500).json({ error: { code: "server_error", message: "Something went wrong. Try again." } });
}

const platformNote = (p) => (p.ok ? { ok: true } : { ok: false, code: p.code, message: p.message });

/** The routes, mounted at /api/platform/crm. The timeouts are for tests. */
export function createCrmRouter({
  timeoutMs = CRM_TIMEOUT_MS,
  createTimeoutMs = CRM_CREATE_TIMEOUT_MS,
  platformTimeoutMs = PLATFORM_TIMEOUT_MS,
} = {}) {
  const router = express.Router();

  // GET /api/platform/crm/organizations -> { organizations, counts, truncated, platform }. Permission: view.
  // CRM must answer; the platform may not (platform: { ok: false, code, message }): the organisations then show with
  // CRM's own status, and nothing can be suspended or reactivated until it is back.
  router.get("/organizations", async (req, res) => {
    try {
      await callerWith(req, "view", "Your console role can't see CRM organisations.");
      const [summaries, platform] = await Promise.all([crmOrganizations(timeoutMs), platformOrNot(platformTimeoutMs)]);
      const organizations = mergeOrganizations(summaries, platform.organizations);
      res.json({ organizations, counts: countByStatus(organizations), truncated: platform.truncated, platform: platformNote(platform) });
    } catch (err) {
      send(res, err);
    }
  });

  // GET /api/platform/crm/organizations/:id -> { organization, platform }. :id is CRM's own ID. Permission: view.
  router.get("/organizations/:id", async (req, res) => {
    try {
      await callerWith(req, "view", "Your console role can't see CRM organisations.");
      const id = String(req.params.id || "");
      if (!CRM_ID_RE.test(id)) throw new PlatformError(400, "invalid_organization_id", "That is not a CRM organisation's ID.");
      const [summary, platform] = await Promise.all([crmOrganization(id, timeoutMs), platformOrNot(platformTimeoutMs)]);
      const [organization] = mergeOrganizations([summary], platform.organizations.filter((o) => o.id === summary.platform_organization_id || o.local_organization_id === summary.id));
      res.json({ organization, platform: platformNote(platform) });
    } catch (err) {
      send(res, err);
    }
  });

  // POST /api/platform/crm/organizations { name, slug?, adminName, adminEmail } -> 201 { organization }.
  // Permission: approve_companies. CRM provisions it (its defaults, its first admin invited as Management) with the
  // caller's email as staffEmail for its audit, then registers it with the platform within a minute. 409 slug_taken
  // and 400 validation_failed (with field_errors) pass through from CRM.
  router.post("/organizations", async (req, res) => {
    try {
      const caller = await callerWith(req, "approve_companies", "Only an owner or admin can create a CRM organisation.");
      const input = newOrganizationInput(req.body);
      if (!caller.email) throw new PlatformError(400, "no_actor_email", "Your login has no email to record this under.");
      let result;
      try {
        result = await callCrm("POST", "/organizations", { ...input, staffEmail: caller.email }, createTimeoutMs);
      } catch (err) {
        throw linkOff(err);
      }
      const summary = result.organization && typeof result.organization === "object" ? toSummary(result.organization) : null;
      if (!summary?.id) {
        console.error(TAG, "POST /organizations answered without the organisation");
        throw badAnswer();
      }
      console.log(TAG, "organisation created", summary.id);
      res.status(201).json({ organization: withPlatform(summary, null) });
    } catch (err) {
      send(res, err);
    }
  });

  // POST /api/platform/crm/organizations/:organizationId/status { action: suspend | reactivate, reason }
  //   -> { organization: { organization_id, status, status_reason } }. :organizationId is the platform's ID for the
  // organisation (CRM's platformOrganizationId). Permission: approve_companies. A reason (1-500 characters) is needed
  // to suspend. The platform records the caller's email as who decided, then tells CRM.
  router.post("/organizations/:id/status", async (req, res) => {
    try {
      const action = req.body?.action;
      const rule = typeof action === "string" && Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : null;
      // who may do anything at all, before saying more about the request
      const caller = await callerWith(req, rule ? rule.permission : "approve_companies", "Only an owner or admin can suspend or reactivate a CRM organisation.");
      if (!rule) throw new PlatformError(400, "invalid_action", "Choose an action: suspend or reactivate.");

      const id = String(req.params.id || "");
      if (!UUID_RE.test(id)) throw new PlatformError(400, "invalid_organization_id", "That is not a CRM organisation's platform ID.");
      const rawReason = req.body?.reason;
      if (rawReason != null && typeof rawReason !== "string") throw new PlatformError(400, "invalid_reason", "The reason must be text.");
      const reason = (rawReason || "").trim();
      if (rule.reason && !reason) throw new PlatformError(400, "reason_required", `Give a reason to ${action} an organisation.`);
      if (reason.length > MAX_REASON) throw new PlatformError(400, "invalid_reason", `Keep the reason to ${MAX_REASON} characters.`);
      if (!caller.email) throw new PlatformError(400, "no_actor_email", "Your login has no email to record this under.");

      // the organisation's status now, and that it is a CRM one
      const { organizations } = await platformCrmOrganizations(platformTimeoutMs);
      const org = organizations.find((o) => o.id === id);
      if (!org) throw new PlatformError(404, "organization_not_found", "No such CRM organisation on the platform.");
      if (!rule.from.includes(org.status)) {
        throw new PlatformError(409, "invalid_transition", `${/^[aeiou]/i.test(org.status) ? "An" : "A"} ${org.status} organisation can't be ${action === "reactivate" ? "reactivated" : "suspended"}.`);
      }

      const result = await callPlatform(
        "POST",
        `/organizations/${encodeURIComponent(id)}/status`,
        { status: rule.to, ...(reason ? { reason } : {}), actor_email: caller.email },
        platformTimeoutMs
      );
      const o = result.organization && typeof result.organization === "object" ? result.organization : {};
      res.json({
        organization: {
          organization_id: id,
          status: typeof o.status === "string" ? o.status : rule.to,
          status_reason: o.status_reason ?? (reason || null),
        },
      });
    } catch (err) {
      send(res, err);
    }
  });

  return router;
}

export default createCrmRouter();
