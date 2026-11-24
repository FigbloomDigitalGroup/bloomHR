// platform_property_routes.js: Figbloom Property's workspaces in the Figbloom console (ERP/PROPERTY_PLATFORM_CONTRACT.md 3).
//
//   console page --(Supabase session)--> /api/platform/property/workspaces --+--(shared secret)--> Property /api/platform/workspaces/
//                                                                           +--(client credentials)--> platform API /organizations
//
// The same pattern as Figbloom CRM's organisations (platform_crm_routes.js), without creating: Property's customers sign
// themselves up and there is nothing to approve, so the console lists, suspends and reactivates. One Property Workspace
// is one platform organisation (and one tenant under it), registered by product "property" with the workspace's UUID as
// the local ID; Property's summary carries the platform's IDs for it (platform.organizationId), null until Property has
// registered it (within a minute of it being created). Suspending and reactivating are decided on the platform (POST
// /organizations/{id}/status), as for Fleet and CRM; the platform tells Property through its decision webhook, and
// Property switches the workspace's is_active.
//
// A workspace's owner can also deactivate it themselves in Property: its summary then says active: false while the
// platform still says active. The console shows that as "deactivated" (by its owner), not as suspended.
//
// The caller is checked as on every console route (callerWith(): a bearer token, then a row in platform_admins), then
// for their console role's permission: any console role sees the list (view); suspending and reactivating need
// suspend_companies (Owner, Admin, Support), as for Fleet (ERP/PROPERTY_PLATFORM_CONTRACT.md 3). Neither Property nor
// the platform checks roles: they trust this backend, so the check here is the only one.
//
// Settings: PROPERTY_PLATFORM_URL (Property's API address, e.g. https://property-api.figbloom.org, with or without /api)
// and PROPERTY_PLATFORM_SECRET (the same value as Property's PLATFORM_CONSOLE_SECRET). Either unset, or Property
// answering 503 not_configured (its own secret unset): 503 property_not_connected, which the console shows as "not
// connected yet". The platform's settings are the console client's (platform_school_groups_routes.js); without them the
// workspaces still show, with Property's own status and no actions. The secret only ever goes into the
// x-platform-secret header: it is never logged nor sent back.
//
// Property is Django: its paths end in a slash (/api/platform/workspaces/ and /api/platform/workspaces/<id>/). It sends
// counts only (properties, units, occupied units, team members, tenants): no tenant names, contacts, leases or payments,
// and toSummary() keeps only the fields below, so nothing else Property might add ever reaches the browser.
//
// HR & Payroll per workspace (ERP/PROPERTY_HR_CONTRACT.md section 2, as on Fleet's page: platform_fleet_routes.js):
// each workspace's platform tenant (Property's platform.tenantId, else the organisation's tenant linked with the
// workspace's ID) carries its HR state, off / enabling / on (hrState()); unknown ones are asked about one by one
// (GET /tenants/{id}, up to MAX_HR_LOOKUPS). POST /hr/:tenantId/enable (approve_companies: HR is a paid add-on, switched
// on by Figbloom staff once the customer has bought it) switches the hr module on for that tenant on the platform, with
// the workspace's creator from Property's summary as the admin to invite (role property_owner, so HR knows it is a
// Property workspace); Figbloom HR then creates the company, invites the creator and links it back. The creator is
// HR's admin only, never an employee: Property sends no staff events for them.
//
// Errors are { error: { code, message } }.
import express from "express";
import { PLATFORM_TIMEOUT_MS, PlatformError } from "./platform_client.js";
import { MAX_REASON, callPlatform, callerWith } from "./platform_school_groups_routes.js";
import { hrState, tenantParts } from "./platform_school_hr_routes.js";
import { realEmail } from "./platform_events_routes.js";

export { MAX_REASON } from "./platform_school_groups_routes.js";
export const PROPERTY_TIMEOUT_MS = 8 * 1000;
export const MODULE = "property";
const PAGE = 200; // the platform's largest page
const MAX_PAGES = 10; // 2,000 workspaces: more than the console shows at once
const TAG = "[platform/property]";
const MAX_HR_LOOKUPS = 100;
const HR_LOOKUP_CONCURRENCY = 6;
// the admin role HR is told about: property_* says the customer is a Property workspace
// (platform_events_routes.js enabledSource())
export const PROPERTY_OWNER_ROLE = "property_owner";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_RE = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * What the console may do to a Property workspace: the platform status it becomes, from which, and the permission. Both
 * are suspend_companies, as for Fleet (the contract). A reason is needed to suspend.
 */
export const ACTIONS = {
  suspend: { to: "suspended", from: ["active"], permission: "suspend_companies", reason: true },
  reactivate: { to: "active", from: ["suspended"], permission: "suspend_companies", reason: false },
};

const notConnected = (message = "Figbloom Property isn't connected to the console yet.") =>
  new PlatformError(503, "property_not_connected", message);

/** Property's address and secret, or 503 property_not_connected. */
function propertySettings() {
  const url = String(process.env.PROPERTY_PLATFORM_URL || "").trim().replace(/\/+$/, "");
  const secret = String(process.env.PROPERTY_PLATFORM_SECRET || "").trim();
  if (!url || !secret) throw notConnected();
  return { base: url.endsWith("/api") ? url : `${url}/api`, secret };
}

const propertyUnavailable = (message = "Figbloom Property didn't answer. Try again.") => new PlatformError(502, "property_unavailable", message);

/**
 * One call to Property's console API (path under /api/platform, with Django's trailing slash). Resolves its JSON on 2xx.
 * Its 4xx come back with the same status, its code and message, except 401/403: the shared secret was refused (a
 * setting to fix here, not the caller's session), so that is a 502. A 503 not_configured (Property's own secret unset)
 * is 503 property_not_connected. Anything else (unreachable, a timeout, 5xx, not JSON) is a 502 property_unavailable.
 */
export async function callProperty(method, path, timeoutMs = PROPERTY_TIMEOUT_MS) {
  const { base, secret } = propertySettings();
  let response;
  let payload;
  try {
    response = await fetch(`${base}/platform${path}`, {
      method,
      headers: { accept: "application/json", "x-platform-secret": secret },
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
    throw propertyUnavailable(timedOut ? "Figbloom Property didn't answer in time. Try again." : undefined);
  }

  if (response.ok) {
    if (payload === null || typeof payload !== "object") {
      console.error(TAG, method, path, "answered", response.status, "without JSON");
      throw propertyUnavailable();
    }
    return payload;
  }
  const e = payload?.error;
  const rawCode = typeof e?.code === "string" ? e.code : typeof payload?.code === "string" ? payload.code : "";
  if (response.status === 401 || response.status === 403) {
    console.error(TAG, "Property refused the shared secret (check PROPERTY_PLATFORM_SECRET)", response.status);
    throw propertyUnavailable("Figbloom Property refused the console's connection. Check its settings.");
  }
  if (response.status === 503 && rawCode.toLowerCase() === "not_configured") {
    console.error(TAG, "Property's console API is not configured (its PLATFORM_CONSOLE_SECRET is unset)");
    throw notConnected("Figbloom Property isn't connected to the console yet (its side isn't configured).");
  }
  if (response.status >= 400 && response.status < 500) {
    const lower = rawCode.toLowerCase();
    const code = CODE_RE.test(lower) ? lower : "property_error";
    const raw = typeof e?.message === "string" ? e.message : typeof e === "string" ? e : typeof payload?.message === "string" ? payload.message : "";
    throw new PlatformError(response.status, code, raw.trim() ? raw.trim().slice(0, 500) : "Figbloom Property refused the request.");
  }
  console.error(TAG, method, path, "answered", response.status);
  throw propertyUnavailable();
}

const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const count = (v) => (v === null || v === undefined || v === "" || typeof v === "boolean" || !Number.isFinite(Number(v)) ? null : Number(v));
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
/** A date-time string (ISO), else null: what an older Property without it sends, or anything unreadable. */
const when = (v) => {
  const s = str(v);
  return s && !Number.isNaN(Date.parse(s)) ? s : null;
};

/**
 * One of Property's workspace summaries, as the console shows it. Only these fields: whatever else Property might send
 * (it sends no tenant names, contacts, leases or payments) never reaches the browser.
 */
export function toSummary(w) {
  const creator = obj(w?.creator);
  const plan = obj(w?.plan);
  const counts = obj(w?.counts);
  const platform = obj(w?.platform);
  return {
    id: String(w?.id ?? ""),
    name: String(w?.name ?? ""),
    slug: str(w?.slug),
    property_active: typeof w?.active === "boolean" ? w.active : null,
    created_at: str(w?.createdAt),
    creator_name: str(creator.name),
    creator_email: str(creator.email),
    plan_name: str(plan.name),
    plan_status: str(plan.status),
    trial_ends_at: str(plan.trialEndsAt),
    properties: count(counts.properties),
    units: count(counts.units),
    occupied_units: count(counts.occupiedUnits),
    team_members: count(counts.teamMembers),
    tenants: count(counts.tenants),
    platform_organization_id: str(platform.organizationId),
    platform_tenant_id: str(platform.tenantId),
    registered_at: str(platform.registeredAt),
    // when a customer admin asked for Figbloom HR in Property ("Request Figbloom HR"); null when not asked, or Property
    // too old to send it
    hr_requested_at: when(w?.hr_requested_at ?? w?.hrRequestedAt),
  };
}

const badAnswer = () => propertyUnavailable("Figbloom Property sent something the console does not understand.");

/** Its console API not there at all (404 on the list): "not connected" here, as a missing setting. */
const linkOff = (err) =>
  err instanceof PlatformError && err.status === 404
    ? notConnected("Figbloom Property isn't connected to the console yet (its console API isn't there).")
    : err;

/** Property's summaries. */
export async function propertyWorkspaces(timeoutMs) {
  let result;
  try {
    result = await callProperty("GET", "/workspaces/", timeoutMs);
  } catch (err) {
    throw linkOff(err);
  }
  if (!Array.isArray(result.workspaces)) {
    console.error(TAG, "GET /workspaces/ answered without a list of workspaces");
    throw badAnswer();
  }
  return result.workspaces.map(toSummary).filter((w) => w.id);
}

/** One Property summary (404 not_found when Property doesn't know it). */
export async function propertyWorkspace(id, timeoutMs) {
  const result = await callProperty("GET", `/workspaces/${encodeURIComponent(id)}/`, timeoutMs);
  const s = result.workspace && typeof result.workspace === "object" ? toSummary(result.workspace) : null;
  if (!s?.id) throw badAnswer();
  return s;
}

/** The organisation's platform tenant for the workspace: the one Property linked with the workspace's ID, else the only one. */
function propertyTenant(o, localId) {
  const tenants = Array.isArray(o?.tenants) ? o.tenants.filter((t) => t && typeof t === "object" && typeof t.id === "string") : [];
  const linked = tenants.find((t) => Array.isArray(t.links) && t.links.some((l) => l?.module === MODULE && localId != null && String(l.local_tenant_id) === localId));
  return linked ?? (tenants.length === 1 ? tenants[0] : null);
}

function toPlatformOrganization(o) {
  const link = Array.isArray(o?.links) ? o.links.find((l) => l?.module === MODULE) ?? null : null;
  const localId = link?.local_organization_id != null ? String(link.local_organization_id) : null;
  const tenant = propertyTenant(o, localId);
  const links = Array.isArray(tenant?.links) ? tenant.links.filter((l) => l && typeof l === "object") : [];
  const modules = Array.isArray(tenant?.modules) ? tenant.modules.filter((m) => m && typeof m === "object") : undefined;
  return {
    id: String(o?.id ?? ""),
    name: String(o?.name ?? ""),
    status: String(o?.status ?? ""),
    status_reason: o?.status_reason ?? null,
    created_at: o?.created_at ?? null,
    local_organization_id: localId,
    platform_tenant_id: tenant ? tenant.id : null,
    hr: tenant ? hrState(modules, links) : null,
  };
}

/** Every Property organisation on the platform (all pages). */
export async function platformPropertyOrganizations(timeoutMs) {
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
    return { ok: true, ...(await platformPropertyOrganizations(timeoutMs)) };
  } catch (err) {
    if (!(err instanceof PlatformError)) throw err;
    return { ok: false, code: err.code, message: err.message, organizations: [], truncated: false };
  }
}

const EMPTY_SUMMARY = {
  slug: null, property_active: null, creator_name: null, creator_email: null, plan_name: null, plan_status: null,
  trial_ends_at: null, properties: null, units: null, occupied_units: null, team_members: null, tenants: null,
  platform_organization_id: null, platform_tenant_id: null, registered_at: null, hr_requested_at: null,
};

/**
 * The workspace's HR state: the platform organisation's tenant's when it is the same tenant, else unknown (asked about
 * by fillHrStates()) when the workspace has a platform tenant, else null (no platform account yet).
 */
function hrOf(tenantId, o) {
  if (!tenantId) return null;
  if (o?.hr && o.platform_tenant_id === tenantId) return o.hr;
  return { state: "unknown", module_status: null, hr_tenant_id: null };
}

function withPlatform(s, o) {
  // the tenant to switch HR on for: Property's word for it, else the platform's
  const tenantId = s.platform_tenant_id ?? o?.platform_tenant_id ?? null;
  return {
    ...s,
    platform_tenant_id: tenantId,
    in_property: true,
    organization_id: o?.id ?? null,
    status: o?.status || null,
    status_reason: o?.status_reason ?? null,
    hr: o ? hrOf(tenantId, o) : null,
  };
}

/**
 * Property's workspaces with the platform's status for each (by the platform's ID Property gave, else the property
 * local ID). One Property hasn't registered yet has no platform status (the console shows Property's own); an
 * organisation on the platform that Property's list doesn't have (in_property: false) still shows.
 */
export function mergeWorkspaces(summaries, organizations) {
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
      platform_tenant_id: o.platform_tenant_id ?? null,
      in_property: false,
      organization_id: o.id,
      status: o.status || null,
      status_reason: o.status_reason,
      hr: o.hr ?? null,
    });
  }
  return merged;
}

/**
 * The status the console shows: the platform's decision (an active one its owner switched off in Property is
 * "deactivated"), else Property's own (active, or inactive), else unregistered.
 */
export function shownStatus(w) {
  if (w.status) return w.status === "active" && w.property_active === false ? "deactivated" : w.status;
  if (w.property_active === true) return "active";
  if (w.property_active === false) return "inactive";
  return "unregistered";
}

/** How many workspaces have each status. */
export function countByStatus(list) {
  const counts = { active: 0, suspended: 0, deactivated: 0, inactive: 0, unregistered: 0 };
  for (const w of list) {
    const key = shownStatus(w);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** One platform tenant's HR state (GET /tenants/{id}). */
export async function tenantHr(id, timeoutMs) {
  const parts = tenantParts(await callPlatform("GET", `/tenants/${encodeURIComponent(id)}`, null, timeoutMs));
  return { parts, hr: hrState(parts.modules, parts.links) };
}

/** Asks the platform about the workspaces whose HR state the list didn't carry, a few at a time (in place). */
export async function fillHrStates(workspaces, timeoutMs) {
  const ask = workspaces.filter((w) => w.platform_tenant_id && w.hr?.state === "unknown").slice(0, MAX_HR_LOOKUPS);
  for (let i = 0; i < ask.length; i += HR_LOOKUP_CONCURRENCY) {
    await Promise.all(ask.slice(i, i + HR_LOOKUP_CONCURRENCY).map(async (w) => {
      try {
        w.hr = (await tenantHr(w.platform_tenant_id, timeoutMs)).hr;
      } catch (err) {
        // that workspace stays unknown; the rest still show
        if (!(err instanceof PlatformError)) throw err;
      }
    }));
  }
}

/**
 * The workspace's creator for HR to invite, from Property's summary: [{ email, name, role: property_owner }] when the
 * creator has a real address, else nobody (HR's admins can then be invited from HR). Never throws.
 */
export async function propertyAdmins(workspaceId, timeoutMs) {
  if (!workspaceId || !UUID_RE.test(workspaceId)) return [];
  try {
    const w = await propertyWorkspace(workspaceId, timeoutMs);
    const email = realEmail(w.creator_email);
    return email ? [{ email, name: (w.creator_name ?? email).slice(0, 200), role: PROPERTY_OWNER_ROLE }] : [];
  } catch (err) {
    console.warn(TAG, "the workspace's creator couldn't be read from Property:", err?.code || err?.message || err);
    return [];
  }
}

function send(res, err) {
  if (err instanceof PlatformError) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  console.error(TAG, err?.message || err);
  return res.status(500).json({ error: { code: "server_error", message: "Something went wrong. Try again." } });
}

const platformNote = (p) => (p.ok ? { ok: true } : { ok: false, code: p.code, message: p.message });

/** The routes, mounted at /api/platform/property. The timeouts are for tests. */
export function createPropertyRouter({ timeoutMs = PROPERTY_TIMEOUT_MS, platformTimeoutMs = PLATFORM_TIMEOUT_MS } = {}) {
  const router = express.Router();

  // GET /api/platform/property/workspaces -> { workspaces, counts, truncated, platform }. Permission: view.
  // Property must answer; the platform may not (platform: { ok: false, code, message }): the workspaces then show with
  // Property's own status, and nothing can be suspended or reactivated until it is back.
  router.get("/workspaces", async (req, res) => {
    try {
      await callerWith(req, "view", "Your console role can't see Property workspaces.");
      const [summaries, platform] = await Promise.all([propertyWorkspaces(timeoutMs), platformOrNot(platformTimeoutMs)]);
      const workspaces = mergeWorkspaces(summaries, platform.organizations);
      if (platform.ok) await fillHrStates(workspaces, platformTimeoutMs);
      res.json({ workspaces, counts: countByStatus(workspaces), truncated: platform.truncated, platform: platformNote(platform) });
    } catch (err) {
      send(res, err);
    }
  });

  // GET /api/platform/property/workspaces/:id -> { workspace, platform }. :id is the workspace's own UUID. Permission: view.
  router.get("/workspaces/:id", async (req, res) => {
    try {
      await callerWith(req, "view", "Your console role can't see Property workspaces.");
      const id = String(req.params.id || "");
      if (!UUID_RE.test(id)) throw new PlatformError(400, "invalid_workspace_id", "That is not a Property workspace's ID.");
      let summary;
      let platform;
      try {
        [summary, platform] = await Promise.all([propertyWorkspace(id, timeoutMs), platformOrNot(platformTimeoutMs)]);
      } catch (err) {
        if (err instanceof PlatformError && err.status === 404) throw new PlatformError(404, "not_found", "Figbloom Property has no such workspace.");
        throw err;
      }
      const [workspace] = mergeWorkspaces(
        [summary],
        platform.organizations.filter((o) => o.id === summary.platform_organization_id || o.local_organization_id === summary.id)
      );
      if (platform.ok) await fillHrStates([workspace], platformTimeoutMs);
      res.json({ workspace, platform: platformNote(platform) });
    } catch (err) {
      send(res, err);
    }
  });

  // POST /api/platform/property/workspaces/:organizationId/status { action: suspend | reactivate, reason }
  //   -> { workspace: { organization_id, status, status_reason } }. :organizationId is the platform's ID for the
  // workspace (Property's platform.organizationId). Permission: suspend_companies. A reason (1-500 characters) is needed
  // to suspend. The platform records the caller's email as who decided, then tells Property.
  router.post("/workspaces/:id/status", async (req, res) => {
    try {
      const action = req.body?.action;
      const rule = typeof action === "string" && Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : null;
      // who may do anything at all, before saying more about the request
      const caller = await callerWith(req, rule ? rule.permission : "view", "Your console role can't do that to Property workspaces.");
      if (!rule) throw new PlatformError(400, "invalid_action", "Choose an action: suspend or reactivate.");

      const id = String(req.params.id || "");
      if (!UUID_RE.test(id)) throw new PlatformError(400, "invalid_organization_id", "That is not a Property workspace's platform ID.");
      const rawReason = req.body?.reason;
      if (rawReason != null && typeof rawReason !== "string") throw new PlatformError(400, "invalid_reason", "The reason must be text.");
      const reason = (rawReason || "").trim();
      if (rule.reason && !reason) throw new PlatformError(400, "reason_required", `Give a reason to ${action} a workspace.`);
      if (reason.length > MAX_REASON) throw new PlatformError(400, "invalid_reason", `Keep the reason to ${MAX_REASON} characters.`);
      if (!caller.email) throw new PlatformError(400, "no_actor_email", "Your login has no email to record this under.");

      // the organisation's status now, and that it is a Property one
      const { organizations } = await platformPropertyOrganizations(platformTimeoutMs);
      const org = organizations.find((o) => o.id === id);
      if (!org) throw new PlatformError(404, "organization_not_found", "No such Property workspace on the platform.");
      if (!rule.from.includes(org.status)) {
        throw new PlatformError(409, "invalid_transition", `${/^[aeiou]/i.test(org.status) ? "An" : "A"} ${org.status} workspace can't be ${action === "reactivate" ? "reactivated" : "suspended"}.`);
      }

      const result = await callPlatform(
        "POST",
        `/organizations/${encodeURIComponent(id)}/status`,
        { status: rule.to, ...(reason ? { reason } : {}), actor_email: caller.email },
        platformTimeoutMs
      );
      const o = result.organization && typeof result.organization === "object" ? result.organization : {};
      res.json({
        workspace: {
          organization_id: id,
          status: typeof o.status === "string" ? o.status : rule.to,
          status_reason: o.status_reason ?? (reason || null),
        },
      });
    } catch (err) {
      send(res, err);
    }
  });

  // POST /api/platform/property/hr/:tenantId/enable -> { workspace: { platform_tenant_id, hr } }. Permission:
  // approve_companies (Owner, Admin): HR is a paid add-on. :tenantId is the platform's tenant for the workspace
  // (Property's platform.tenantId). Switches the hr module on for it on the platform (recorded as console:<your email>),
  // with the workspace's creator from Property (propertyAdmins()); HR then creates and links the company and invites
  // them. Already on: nothing is changed.
  router.post("/hr/:id/enable", async (req, res) => {
    try {
      const caller = await callerWith(req, "approve_companies", "Only an owner or admin can switch HR & Payroll on for a workspace.");
      const id = String(req.params.id || "");
      if (!UUID_RE.test(id)) throw new PlatformError(400, "invalid_tenant_id", "That is not a Property workspace's platform ID.");
      if (!caller.email) throw new PlatformError(400, "no_actor_email", "Your login has no email to record this under.");

      const before = await tenantHr(id, platformTimeoutMs);
      const propertyLink = before.parts.links.find((l) => l.module === MODULE && l.local_tenant_id);
      if (!propertyLink) throw new PlatformError(404, "not_a_property_workspace", "That platform account isn't a Figbloom Property workspace.");
      if (before.hr.state === "on") return res.json({ workspace: { platform_tenant_id: id, hr: before.hr } });

      // HR invites whoever is listed here (passed on in platform.module.enabled)
      const admins = await propertyAdmins(String(propertyLink.local_tenant_id), timeoutMs);
      await callPlatform("PUT", `/tenants/${encodeURIComponent(id)}/modules/hr`, { status: "active", admins, actor_email: caller.email }, platformTimeoutMs);
      let hr;
      try {
        hr = (await tenantHr(id, platformTimeoutMs)).hr;
      } catch {
        hr = { state: "enabling", module_status: "active", hr_tenant_id: null };
      }
      // switched on; HR links its company shortly
      if (hr.state === "off" || hr.state === "unknown") hr = { ...hr, state: "enabling" };
      console.log(TAG, "HR switched on for", id);
      res.json({ workspace: { platform_tenant_id: id, hr } });
    } catch (err) {
      send(res, err);
    }
  });

  return router;
}

export default createPropertyRouter();
