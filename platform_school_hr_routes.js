// platform_school_hr_routes.js: "HR & Payroll" per school in the Figbloom console (ERP/SCHOOLS_HR_PHASE1_CONTRACT.md).
//
//   console page --(Supabase session)--> /api/platform/school-hr --(console client)--> platform API /tenants/{id}
//
// Switching HR on records tenant_modules(school, hr) on the platform, which tells Figbloom HR (platform.module.enabled);
// HR creates the school's company, invites its admins and links it back (tenant_module_links(school, hr)). So a school
// is, for HR:
//   off        no hr module on the platform (or not active)
//   enabling   the module is on, HR hasn't linked its company yet
//   on         HR's company is linked
//   unknown    the console couldn't ask the platform about this school this time
//
// The caller is checked as on the other console routes (a platform admin, then their console role): view to see,
// approve_companies (Owner, Admin) to switch HR on. The platform trusts this backend's own client and records
// console:<actor_email>, so the role check here is the only one. Same settings as the school groups page.
import express from "express";
import { PlatformError } from "./platform_client.js";
import { PLATFORM_TIMEOUT_MS, callPlatform, callerWith, send } from "./platform_school_groups_routes.js";
import { callSchools } from "./platform_schools_routes.js";
import { realEmail } from "./platform_events_routes.js";

const PAGE = 200;
const MAX_PAGES = 10;
const MAX_LOOKUPS = 100; // schools whose module isn't in the list are asked about one by one, up to this many
const LOOKUP_CONCURRENCY = 6;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ON_STATUSES = ["active", "trial"];

const asList = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : undefined);

/** A school's HR state from its platform modules (undefined when not known) and links. */
export function hrState(modules, links) {
  const link = (links ?? []).find((l) => l.module === "hr" && l.local_tenant_id);
  const mod = modules?.find((m) => m.module === "hr");
  const module_status = typeof mod?.status === "string" ? mod.status : null;
  if (link) return { state: "on", module_status, hr_tenant_id: String(link.local_tenant_id) };
  if (mod && ON_STATUSES.includes(module_status)) return { state: "enabling", module_status, hr_tenant_id: null };
  if (modules === undefined) return { state: "unknown", module_status: null, hr_tenant_id: null };
  return { state: "off", module_status, hr_tenant_id: null };
}

/** The modules and links in the platform's GET /tenants/{id} answer (the account, at the top or under "tenant"). */
export function tenantParts(result) {
  const t = result?.tenant && typeof result.tenant === "object" ? result.tenant : result ?? {};
  return {
    name: typeof t.name === "string" ? t.name : typeof t.legal_name === "string" ? t.legal_name : null,
    modules: asList(result?.modules) ?? asList(t.modules) ?? [],
    links: asList(result?.links) ?? asList(t.links) ?? [],
  };
}

const schoolsLink = (links) => (links ?? []).find((l) => l.module === "schools") ?? null;

/** One school as the console shows it. */
function toEntry(id, name, links, modules) {
  const s = schoolsLink(links);
  return {
    platform_tenant_id: id,
    name: name ?? "",
    schools_tenant_id: s?.local_tenant_id ?? null,
    schools_slug: s?.local_slug ?? null,
    hr: hrState(modules, links),
  };
}

async function oneSchool(id, timeoutMs) {
  const parts = tenantParts(await callPlatform("GET", `/tenants/${encodeURIComponent(id)}`, null, timeoutMs));
  return toEntry(id, parts.name, parts.links, parts.modules);
}

/** Runs fn over items, a few at a time. */
async function inBatches(items, size, fn) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

/** Every Schools school on the platform with its HR state. */
async function listSchoolHr(timeoutMs) {
  const entries = [];
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ module: "schools", limit: String(PAGE), offset: String(page * PAGE) });
    const result = await callPlatform("GET", `/organizations?${params}`, null, timeoutMs);
    const rows = Array.isArray(result.organizations) ? result.organizations : [];
    for (const o of rows) {
      for (const t of asList(o?.tenants) ?? []) {
        if (typeof t.id !== "string" || !t.id) continue;
        entries.push(toEntry(t.id, t.name, asList(t.links) ?? [], asList(t.modules)));
      }
    }
    if (rows.length < PAGE) break;
    if (page === MAX_PAGES - 1) truncated = true;
  }
  // the list carries links, not modules: ask about the schools not linked yet (on or off), a few at a time
  const ask = entries.filter((e) => e.hr.state === "unknown").slice(0, MAX_LOOKUPS);
  await inBatches(ask, LOOKUP_CONCURRENCY, async (e) => {
    try {
      const parts = tenantParts(await callPlatform("GET", `/tenants/${encodeURIComponent(e.platform_tenant_id)}`, null, timeoutMs));
      e.hr = hrState(parts.modules, parts.links);
    } catch (err) {
      // that school stays unknown; the rest still show
      if (!(err instanceof PlatformError)) throw err;
    }
  });
  return { schools: entries, truncated };
}

const MAX_ADMINS = 20; // as the platform accepts

/**
 * The school's admins for HR to invite, from Figbloom Schools' own list (the console's platform-schools proxy). That
 * list gives one contact per school, admin_email ("the first school admin's email"), with no name: it is sent with the
 * role school_admin when it is a real address (not a login address Schools made up). Schools not connected, or the
 * school not in its list: nobody (HR's admins can then be invited from HR). Never throws.
 */
export async function schoolAdmins(schoolsTenantId, timeoutMs) {
  if (!schoolsTenantId) return [];
  try {
    const list = await callSchools({ action: "list" }, timeoutMs);
    const school = (Array.isArray(list?.schools) ? list.schools : []).find((s) => s?.id === schoolsTenantId);
    const emails = [school?.admin_email].map(realEmail).filter(Boolean);
    return [...new Set(emails)].slice(0, MAX_ADMINS).map((email) => ({ email, name: null, role: "school_admin" }));
  } catch (err) {
    console.warn("[platform/school-hr] the school's admins couldn't be read from Schools:", err?.code || err?.message || err);
    return [];
  }
}

const platformTenant = (req) => {
  const id = String(req.params.id || "");
  if (!UUID_RE.test(id)) throw new PlatformError(400, "invalid_tenant_id", "That is not a school's platform ID.");
  return id;
};

/** The routes, mounted at /api/platform/school-hr. timeoutMs is for tests. */
export function createSchoolHrRouter({ timeoutMs = PLATFORM_TIMEOUT_MS } = {}) {
  const router = express.Router();

  // GET /api/platform/school-hr -> { schools: [{ platform_tenant_id, name, schools_tenant_id, schools_slug,
  //   hr: { state, module_status, hr_tenant_id } }], truncated }. Permission: view.
  router.get("/", async (req, res) => {
    try {
      await callerWith(req, "view", "Your console role can't see schools.");
      res.json(await listSchoolHr(timeoutMs));
    } catch (err) {
      send(res, err);
    }
  });

  // GET /api/platform/school-hr/:id -> { school } (the platform's tenant id). Permission: view.
  router.get("/:id", async (req, res) => {
    try {
      await callerWith(req, "view", "Your console role can't see schools.");
      res.json({ school: await oneSchool(platformTenant(req), timeoutMs) });
    } catch (err) {
      send(res, err);
    }
  });

  // POST /api/platform/school-hr/:id/enable -> { school }. Permission: approve_companies (Owner, Admin). Switches the
  // hr module on for the school on the platform (recorded as console:<your email>), with the school's admins from
  // Figbloom Schools (schoolAdmins()); HR then creates and links the school's company and invites them. Already on:
  // nothing is changed.
  router.post("/:id/enable", async (req, res) => {
    try {
      const caller = await callerWith(req, "approve_companies", "Only an owner or admin can switch HR & Payroll on for a school.");
      const id = platformTenant(req);
      if (!caller.email) throw new PlatformError(400, "no_actor_email", "Your login has no email to record this under.");

      const before = await oneSchool(id, timeoutMs);
      if (before.hr.state === "on") return res.json({ school: before });

      // HR invites whoever is listed here (passed on in platform.module.enabled)
      const admins = await schoolAdmins(before.schools_tenant_id, timeoutMs);
      await callPlatform("PUT", `/tenants/${encodeURIComponent(id)}/modules/hr`, { status: "active", admins, actor_email: caller.email }, timeoutMs);
      let school;
      try {
        school = await oneSchool(id, timeoutMs);
      } catch {
        // switched on; HR links its company shortly
        school = { ...before, hr: { state: "enabling", module_status: "active", hr_tenant_id: null } };
      }
      if (school.hr.state === "off" || school.hr.state === "unknown") school.hr = { ...school.hr, state: "enabling" };
      console.log("[platform/school-hr] HR switched on for", id);
      res.json({ school });
    } catch (err) {
      send(res, err);
    }
  });

  return router;
}

export default createSchoolHrRouter();
