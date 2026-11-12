// platform_fleet_routes.js: Figbloom Fleet's companies in the Figbloom console (ERP/FLEET_PLATFORM_CONTRACT.md 3).
//
//   console page --(Supabase session)--> /api/platform/fleet/companies --+--(shared secret)--> Fleet API /api/platform/companies
//                                                                        +--(client credentials)--> platform API /organizations
//
// A Fleet company is one platform organisation, registered by product "fleet" with its own ID (Company.id) as the local
// ID. The list is Fleet's summaries (name, owner, plan, counts, last ping) joined to the platform's status for each one.
// Approving, rejecting, suspending and reactivating are decided on the platform (POST /organizations/{id}/status), as
// for school groups; the platform tells Fleet through its decision webhook. Fleet decides nothing itself any more.
//
// The caller is checked as on every console route (authenticatePlatformAdmin(): a bearer token, then a row in
// platform_admins), then for their console role's permission (the same as school groups: approve_companies to approve
// and reject, suspend_companies to suspend and reactivate). Neither Fleet nor the platform checks roles: they trust
// this backend, so the check here is the only one.
//
// Settings: FLEET_PLATFORM_URL (Fleet's API address, e.g. https://fleet-api-staging.figbloom.org) and
// FLEET_PLATFORM_SECRET (the same value as Fleet's PLATFORM_CONSOLE_SECRET). Either unset: 503 fleet_not_connected,
// which the console shows as "not connected yet". The platform's settings are the console client's
// (platform_school_groups_routes.js); without them the companies still show, with no platform status and no decisions.
// The secret only ever goes into the x-platform-secret header: it is never logged nor sent back.
//
// Errors are { error: { code, message } }.
import express from "express";
import { PLATFORM_TIMEOUT_MS, PlatformError } from "./platform_client.js";
import { platformRoleAllows } from "./platform_routes.js";
import { ACTIONS, MAX_REASON, callPlatform, callerWith } from "./platform_school_groups_routes.js";

export { ACTIONS, MAX_REASON } from "./platform_school_groups_routes.js";
export const FLEET_TIMEOUT_MS = 8 * 1000;
export const MODULE = "fleet";
const PAGE = 200; // the platform's largest page
const MAX_PAGES = 10; // 2,000 companies: more than the console shows at once
const TAG = "[platform/fleet]";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_RE = /^[a-z][a-z0-9_]{0,63}$/;

/** Fleet's address and secret, or 503 fleet_not_connected. */
function fleetSettings() {
  const url = String(process.env.FLEET_PLATFORM_URL || "").trim().replace(/\/+$/, "");
  const secret = String(process.env.FLEET_PLATFORM_SECRET || "").trim();
  if (!url || !secret) throw new PlatformError(503, "fleet_not_connected", "Figbloom Fleet isn't connected to the console yet.");
  // the API's address, with or without its /api
  return { base: url.endsWith("/api") ? url : `${url}/api`, secret };
}

const fleetUnavailable = (message = "Figbloom Fleet didn't answer. Try again.") => new PlatformError(502, "fleet_unavailable", message);

/**
 * One GET to Fleet's console API (path under /api/platform). Resolves its JSON on 2xx. Its 4xx come back with the same
 * status, code and message, except 401/403: the shared secret was refused (a setting to fix here, not the caller's
 * session), so that is a 502. Anything else (unreachable, a timeout, 5xx, not JSON) is a 502 fleet_unavailable.
 */
export async function callFleet(path, timeoutMs = FLEET_TIMEOUT_MS) {
  const { base, secret } = fleetSettings();
  let response;
  let payload;
  try {
    response = await fetch(`${base}/platform${path}`, {
      method: "GET",
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
    console.error(TAG, "GET", path, timedOut ? "timed out" : `failed (${err?.name || "error"})`);
    throw fleetUnavailable(timedOut ? "Figbloom Fleet didn't answer in time. Try again." : undefined);
  }

  if (response.ok) {
    if (payload === null || typeof payload !== "object") {
      console.error(TAG, "GET", path, "answered", response.status, "without JSON");
      throw fleetUnavailable();
    }
    return payload;
  }
  if (response.status === 401 || response.status === 403) {
    console.error(TAG, "Fleet refused the shared secret (check FLEET_PLATFORM_SECRET)", response.status);
    throw fleetUnavailable("Figbloom Fleet refused the console's connection. Check its settings.");
  }
  if (response.status >= 400 && response.status < 500) {
    const e = payload?.error;
    const code = typeof e?.code === "string" && CODE_RE.test(e.code) ? e.code : "fleet_error";
    const raw = typeof e?.message === "string" ? e.message : typeof e === "string" ? e : typeof payload?.message === "string" ? payload.message : "";
    throw new PlatformError(response.status, code, raw.trim() ? raw.trim().slice(0, 500) : "Figbloom Fleet refused the request.");
  }
  console.error(TAG, "GET", path, "answered", response.status);
  throw fleetUnavailable();
}

const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const count = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** One of Fleet's company summaries, as the console shows it (nested or flat, snake_case or camelCase). */
export function toSummary(c) {
  const owner = c?.owner && typeof c.owner === "object" ? c.owner : {};
  const counts = c?.counts && typeof c.counts === "object" ? c.counts : {};
  const pick = (...keys) => {
    for (const [o, k] of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
    return null;
  };
  return {
    id: String(c?.id ?? ""),
    name: String(c?.name ?? ""),
    fleet_status: str(c?.status),
    plan: str(pick([c, "plan"], [c, "subscription_plan"], [c, "subscriptionPlan"])),
    created_at: str(pick([c, "created_at"], [c, "createdAt"], [c, "created"])),
    owner_name: str(pick([owner, "name"], [c, "owner_name"], [c, "ownerName"])),
    owner_email: str(pick([owner, "email"], [c, "owner_email"], [c, "ownerEmail"])),
    vehicles: count(pick([counts, "vehicles"], [c, "vehicles"])),
    drivers: count(pick([counts, "drivers"], [c, "drivers"])),
    admins: count(pick([counts, "admins"], [c, "admins"])),
    trips_last_30_days: count(pick([counts, "trips_last_30_days"], [counts, "tripsLast30Days"], [c, "trips_last_30_days"])),
    last_location_at: str(pick([c, "last_location_at"], [c, "lastLocationAt"], [c, "last_ping_at"], [c, "lastPingAt"])),
  };
}

/** Fleet's summaries: { companies, generated_at }. */
export async function fleetCompanies(timeoutMs) {
  const result = await callFleet("/companies", timeoutMs);
  const rows = Array.isArray(result) ? result : Array.isArray(result.companies) ? result.companies : null;
  if (!rows) {
    console.error(TAG, "GET /companies answered without a list of companies");
    throw fleetUnavailable("Figbloom Fleet sent something the console does not understand.");
  }
  return { companies: rows.map(toSummary).filter((c) => c.id), generated_at: str(result.generated_at) };
}

function toOrganization(o) {
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

/** Every Fleet organisation on the platform (all pages). */
export async function fleetOrganizations(timeoutMs) {
  const organizations = [];
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ module: MODULE, limit: String(PAGE), offset: String(page * PAGE) });
    const result = await callPlatform("GET", `/organizations?${params}`, null, timeoutMs);
    const rows = Array.isArray(result.organizations) ? result.organizations : [];
    organizations.push(...rows.map(toOrganization));
    if (rows.length < PAGE) break;
    if (page === MAX_PAGES - 1) truncated = true;
  }
  return { organizations, truncated };
}

const EMPTY_SUMMARY = {
  fleet_status: null, plan: null, owner_name: null, vehicles: null, drivers: null, admins: null, trips_last_30_days: null, last_location_at: null,
};

/**
 * Fleet's companies with the platform's decision for each (joined on the organisation's fleet local ID = Company.id).
 * A company the platform doesn't know yet (Fleet hasn't sent it) has no status; an organisation Fleet's list doesn't
 * have (in_fleet: false) still shows, so nothing waiting for approval is hidden.
 */
export function mergeCompanies(summaries, organizations) {
  const byLocal = new Map(organizations.filter((o) => o.local_organization_id).map((o) => [o.local_organization_id, o]));
  const seen = new Set();
  const companies = summaries.map((s) => {
    const o = byLocal.get(s.id) ?? null;
    if (o) seen.add(o.id);
    return {
      ...s,
      owner_email: s.owner_email ?? o?.owner_email ?? null,
      in_fleet: true,
      organization_id: o?.id ?? null,
      status: o?.status ?? null,
      status_reason: o?.status_reason ?? null,
    };
  });
  for (const o of organizations) {
    if (seen.has(o.id)) continue;
    companies.push({
      ...EMPTY_SUMMARY,
      id: o.local_organization_id ?? "",
      name: o.name,
      created_at: o.created_at,
      owner_email: o.owner_email,
      in_fleet: false,
      organization_id: o.id,
      status: o.status,
      status_reason: o.status_reason,
    });
  }
  return companies;
}

/** How many companies have each platform status (unregistered: not on the platform yet). */
export function countByStatus(companies) {
  const counts = { pending: 0, active: 0, suspended: 0, rejected: 0, unregistered: 0 };
  for (const c of companies) {
    const key = c.status ?? "unregistered";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function send(res, err) {
  if (err instanceof PlatformError) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  console.error(TAG, err?.message || err);
  return res.status(500).json({ error: { code: "server_error", message: "Something went wrong. Try again." } });
}

/** The routes, mounted at /api/platform/fleet. timeoutMs is for tests. */
export function createFleetRouter({ timeoutMs = FLEET_TIMEOUT_MS, platformTimeoutMs = PLATFORM_TIMEOUT_MS } = {}) {
  const router = express.Router();

  // GET /api/platform/fleet/companies -> { generated_at, companies, counts, truncated, platform }. Permission: view.
  // Fleet must answer; the platform may not (platform: { ok: false, code, message }): the companies then show without
  // their status, and nothing can be decided until it is back.
  router.get("/companies", async (req, res) => {
    try {
      await callerWith(req, "view", "Your console role can't see Fleet companies.");
      const [fleet, platform] = await Promise.all([
        fleetCompanies(timeoutMs),
        fleetOrganizations(platformTimeoutMs).then(
          (r) => ({ ok: true, ...r }),
          (err) => {
            if (!(err instanceof PlatformError)) throw err;
            return { ok: false, code: err.code, message: err.message, organizations: [], truncated: false };
          }
        ),
      ]);
      const companies = mergeCompanies(fleet.companies, platform.organizations);
      res.json({
        generated_at: fleet.generated_at,
        companies,
        counts: countByStatus(companies),
        truncated: platform.truncated,
        platform: platform.ok ? { ok: true } : { ok: false, code: platform.code, message: platform.message },
      });
    } catch (err) {
      send(res, err);
    }
  });

  // POST /api/platform/fleet/companies/:organizationId/status { action: approve | reject | suspend | reactivate, reason }
  //   -> { company: { organization_id, status, status_reason } }. :organizationId is the platform's ID for the company.
  // Approve and reject need approve_companies; suspend and reactivate need suspend_companies (reactivating a rejected
  // company, approve_companies). A reason (1-500 characters) is needed to reject or suspend. The platform records the
  // caller's email as who decided, then tells Fleet.
  router.post("/companies/:id/status", async (req, res) => {
    try {
      const action = req.body?.action;
      const rule = typeof action === "string" && Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : null;
      // who may do anything at all, before saying more about the request
      const caller = await callerWith(req, rule ? rule.permission : "view", "Your console role can't do that to Fleet companies.");
      if (!rule) throw new PlatformError(400, "invalid_action", "Choose an action: approve, reject, suspend or reactivate.");

      const id = String(req.params.id || "");
      if (!UUID_RE.test(id)) throw new PlatformError(400, "invalid_organization_id", "That is not a Fleet company's platform ID.");
      const rawReason = req.body?.reason;
      if (rawReason != null && typeof rawReason !== "string") throw new PlatformError(400, "invalid_reason", "The reason must be text.");
      const reason = (rawReason || "").trim();
      if (rule.reason && !reason) throw new PlatformError(400, "reason_required", `Give a reason to ${action} a company.`);
      if (reason.length > MAX_REASON) throw new PlatformError(400, "invalid_reason", `Keep the reason to ${MAX_REASON} characters.`);
      if (!caller.email) throw new PlatformError(400, "no_actor_email", "Your login has no email to record this under.");

      // the company's status now, so each action only does what its permission allows (reactivate never approves)
      const { organizations } = await fleetOrganizations(platformTimeoutMs);
      const org = organizations.find((o) => o.id === id);
      if (!org) throw new PlatformError(404, "organization_not_found", "No such Fleet company on the platform.");
      if (!rule.from.includes(org.status)) {
        throw new PlatformError(409, "invalid_transition", `A ${org.status} company can't be ${action === "reactivate" ? "reactivated" : `${action}d`}.`);
      }
      const needed = rule.fromPermission?.[org.status];
      if (needed && !platformRoleAllows(caller.role, needed)) {
        throw new PlatformError(403, "forbidden", "Only an owner or admin can reactivate a company that was not approved.");
      }

      const result = await callPlatform(
        "POST",
        `/organizations/${encodeURIComponent(id)}/status`,
        { status: rule.to, ...(reason ? { reason } : {}), actor_email: caller.email },
        platformTimeoutMs
      );
      const o = result.organization && typeof result.organization === "object" ? result.organization : {};
      res.json({
        company: {
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

export default createFleetRouter();
