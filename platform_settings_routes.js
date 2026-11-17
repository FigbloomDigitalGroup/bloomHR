// platform_settings_routes.js: the Figbloom platform's auto-approve switch, per product, in the Figbloom console
// (figbloomHR-platform README: GET /settings, PUT /settings/auto-approve).
//
//   console page --(Supabase session)--> /api/platform/settings/auto-approve --(client credentials)--> platform API /settings
//
// The platform has one platform-wide switch (the default) and one per product, which overrides it for the organisations
// that product registers (a new Fleet company, a new school group, ...): on, it starts active; off, it waits for
// approval here. A product with no switch of its own follows the platform-wide one. Staff can still suspend from the
// product's page either way.
//
// The caller is checked as on every console route (authenticatePlatformAdmin()), then for their console role: anyone
// with view sees the switches; changing one needs approve_companies (Owner/Admin), as HR's own auto-approve switch does.
// THE PLATFORM DOES NOT CHECK ROLES: it trusts this backend (the console client, scope platform/console) and records
// console:<actor_email> as who changed it, with the reason, in its audit log.
//
// Settings: the console client's (platform_school_groups_routes.js). Errors are { error: { code, message } }.
import express from "express";
import { PLATFORM_TIMEOUT_MS, PlatformError } from "./platform_client.js";
import { platformRoleAllows } from "./platform_routes.js";
import { MAX_REASON, callPlatform, callerWith, send } from "./platform_school_groups_routes.js";

/** The products the console shows a switch for, in its order, with their names in the console. */
export const AUTO_APPROVE_PRODUCTS = [
  { module: "hr", label: "Figbloom HR" },
  { module: "schools", label: "Figbloom Schools" },
  { module: "fleet", label: "Figbloom Fleet" },
];
const KNOWN = new Set(AUTO_APPROVE_PRODUCTS.map((p) => p.module));

const switchOf = (v) => (typeof v === "boolean" ? v : null);

/** The platform's GET /settings as the console shows it: { default, products: [{ module, label, own, effective, inherited }] }. */
export function toAutoApprove(settings) {
  const global = settings?.auto_approve === true;
  const rows = Array.isArray(settings?.products) ? settings.products : [];
  return {
    default: global,
    products: AUTO_APPROVE_PRODUCTS.map(({ module, label }) => {
      const row = rows.find((r) => r?.module === module);
      const own = switchOf(row?.auto_approve);
      return { module, label, own, effective: own ?? global, inherited: own === null };
    }),
  };
}

/** The routes, mounted at /api/platform/settings. timeoutMs is for tests. */
export function createSettingsRouter({ timeoutMs = PLATFORM_TIMEOUT_MS } = {}) {
  const router = express.Router();

  // GET /api/platform/settings/auto-approve -> { default, products: [{ module, label, own, effective, inherited }], can_change }
  // Permission: view.
  router.get("/auto-approve", async (req, res) => {
    try {
      const caller = await callerWith(req, "view", "Your console role can't see the platform's settings.");
      const settings = await callPlatform("GET", "/settings", null, timeoutMs);
      res.json({ ...toAutoApprove(settings), can_change: platformRoleAllows(caller.role, "approve_companies") });
    } catch (err) {
      send(res, err);
    }
  });

  // PUT /api/platform/settings/auto-approve/:module { enabled: true | false | null, reason? }
  //   -> the same as the GET (without can_change). null: the product follows the platform-wide switch again.
  // Permission: approve_companies (Owner/Admin). The platform records the caller's email and the reason.
  router.put("/auto-approve/:module", async (req, res) => {
    try {
      const caller = await callerWith(req, "approve_companies", "Only an owner or admin can change how new companies are approved.");
      const module = String(req.params.module || "");
      if (!KNOWN.has(module)) throw new PlatformError(400, "unknown_product", "Choose Figbloom HR, Figbloom Schools or Figbloom Fleet.");
      const enabled = req.body?.enabled;
      if (enabled !== true && enabled !== false && enabled !== null) {
        throw new PlatformError(400, "invalid_enabled", "Send enabled: true, false, or null to follow the platform default.");
      }
      const rawReason = req.body?.reason;
      if (rawReason != null && typeof rawReason !== "string") throw new PlatformError(400, "invalid_reason", "The reason must be text.");
      const reason = (rawReason || "").trim();
      if (reason.length > MAX_REASON) throw new PlatformError(400, "invalid_reason", `Keep the reason to ${MAX_REASON} characters.`);
      if (!caller.email) throw new PlatformError(400, "no_actor_email", "Your login has no email to record this under.");

      await callPlatform(
        "PUT",
        "/settings/auto-approve",
        { module, enabled, ...(reason ? { reason } : {}), actor_email: caller.email },
        timeoutMs
      );
      const settings = await callPlatform("GET", "/settings", null, timeoutMs);
      res.json(toAutoApprove(settings));
    } catch (err) {
      send(res, err);
    }
  });

  return router;
}

export default createSettingsRouter();
