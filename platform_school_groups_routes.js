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
import { PLATFORM_TIMEOUT_MS, PlatformError, createPlatformClient } from "./platform_client.js";

export { PLATFORM_TIMEOUT_MS } from "./platform_client.js";
export const MAX_REASON = 500;
export const SCOPE = "platform/console";
const PAGE = 200; // the platform's largest page
const MAX_PAGES = 10; // 2,000 groups: more than the console shows at once

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What the console may do to a group, the platform status it becomes, from which statuses, and the permission it needs:
 * approving and rejecting are Owner/Admin (approve_companies); suspending and reactivating are Support too
 * (suspend_companies), except reactivating a rejected group, which overrides a rejection and so is Owner/Admin
 * (fromPermission). Checked against the group's current status here, so reactivate can't be used to approve.
 */
export const ACTIONS = {
  approve: { to: "active", from: ["pending"], permission: "approve_companies", reason: false },
  reject: { to: "rejected", from: ["pending"], permission: "approve_companies", reason: true },
  suspend: { to: "suspended", from: ["active"], permission: "suspend_companies", reason: true },
  reactivate: { to: "active", from: ["suspended", "rejected"], permission: "suspend_companies", reason: false, fromPermission: { rejected: "approve_companies" } },
};

const AUTH_CODES = { 401: "unauthorized", 403: "forbidden", 500: "server_error" };

/** Whether Figbloom Schools applies the platform's decisions yet (SCHOOL_GROUP_DECISIONS_LIVE). */
export const decisionsLive = () => /^(1|true|yes|on)$/i.test(String(process.env.SCHOOL_GROUP_DECISIONS_LIVE || "").trim());

// ---- the console's own client (client credentials, scope platform/console), shared with the Schools HR switch
export const consoleClient = createPlatformClient({
  clientIdEnv: "PLATFORM_CONSOLE_CLIENT_ID",
  clientSecretEnv: "PLATFORM_CONSOLE_CLIENT_SECRET",
  scope: SCOPE,
  tag: "[platform/school-groups]",
  who: "The console",
  notConnected: "The Figbloom platform isn't connected to the console yet.",
});

/** Forgets the token (tests; and after the platform refuses it). */
export const resetPlatformToken = () => consoleClient.resetToken();

/** One call to the platform API as the console (see platform_client.js for what comes back). */
export const callPlatform = (method, path, body, timeoutMs) => consoleClient.call(method, path, body, timeoutMs);

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
export async function listGroups(timeoutMs) {
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
export async function callerWith(req, permission, refusal) {
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

export function send(res, err) {
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
      // reactivating a rejected group overrides an Owner's or Admin's rejection: Owner/Admin only
      const needed = rule.fromPermission?.[group.status];
      if (needed && !platformRoleAllows(caller.role, needed)) {
        throw new PlatformError(403, "forbidden", "Only an owner or admin can reactivate a group that was not approved.");
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
