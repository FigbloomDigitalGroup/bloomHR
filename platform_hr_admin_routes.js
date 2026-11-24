// platform_hr_admin_routes.js: "Invite admin" for a customer's HR company in the Figbloom console.
//
//   console page --(Supabase session)--> /api/platform/hr-admin/:platformTenantId/invite --> platform_invite_hr_admin()
//
// When HR & Payroll is on for a Schools school, a Fleet company or a Property workspace, Figbloom HR created the HR
// company and queued ADMIN invitations for the admins the customer gave (platform_enable_hr()). When that address is
// wrong or made up, Figbloom staff invite someone else here: the HR company is the one whose tenants.platform_tenant_id
// is the platform tenant, and the invitation is queued exactly as platform_enable_hr() queues them (via_platform, no
// sender), for HR's send-invites job to email. Recorded in that company's audit_log as console:<your email>.
//
// The caller is checked as on the other console routes (a platform admin, then their console role): approve_companies
// (Owner, Admin), the same as Enable. The SQL function checks the role again. 20 invitations an hour per staff member,
// as the console's staff invitations. Errors are { error: { code, message } }, as the other console routes.
import express from "express";
import { admin } from "./admin_routes.js";
import { createBudget } from "./authz.js";
import { PlatformError } from "./platform_client.js";
import { callerWith } from "./platform_school_groups_routes.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// addresses nobody reads: reserved and internal domains, and Figbloom's own made-up login addresses
const PLACEHOLDER_DOMAIN_RE = /@([a-z0-9-]+\.)*(figbloom\.internal|invalid|local|localhost|test|example|example\.(com|org|net))$/i;
const MAX_NAME = 200;
const HOUR = 60 * 60 * 1000;
const OUTCOMES = ["queued", "already_invited", "already_member", "no_company"];

/** The email to invite, lower case, or a PlatformError saying why not. */
export function inviteEmail(value) {
  if (value != null && typeof value !== "string") throw new PlatformError(400, "invalid_email", "Enter an email address.");
  const email = String(value ?? "").trim().toLowerCase();
  if (!email) throw new PlatformError(400, "invalid_email", "Enter an email address.");
  if (email.length > 254 || !EMAIL_RE.test(email) || /[\s,;<>()[\]"\\]/.test(email) || email.includes("..")) {
    throw new PlatformError(400, "invalid_email", "That is not a valid email address.");
  }
  if (PLACEHOLDER_DOMAIN_RE.test(email)) {
    throw new PlatformError(400, "invalid_email", "That address can't receive email. Enter the admin's real address.");
  }
  return email;
}

function send(res, err) {
  if (err instanceof PlatformError) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  console.error("[platform/hr-admin]", err?.message || err);
  return res.status(500).json({ error: { code: "server_error", message: "Something went wrong. Try again." } });
}

/** The routes, mounted at /api/platform/hr-admin. `budget` is for tests. */
export function createHrAdminRouter({ budget = createBudget({ default: { limit: 20, windowMs: HOUR } }) } = {}) {
  const router = express.Router();

  // POST /api/platform/hr-admin/:id/invite { email, name? } (the platform tenant's id)
  //   -> { outcome, email, company: { id, name } | null, member_role }
  // outcome: queued (the invitation is queued; HR emails it within minutes), already_invited (an invitation to that
  // address is waiting or still open: nothing sent), already_member (they already have a login in the company,
  // member_role says as what), no_company (HR has no company for this customer yet: 404). Permission:
  // approve_companies. 400 invalid_tenant_id / invalid_email / invalid_name / no_actor_email; 429 rate_limited.
  router.post("/:id/invite", async (req, res) => {
    try {
      const caller = await callerWith(req, "approve_companies", "Only an owner or admin can invite a customer's HR admin.");
      const id = String(req.params.id || "");
      if (!UUID_RE.test(id)) throw new PlatformError(400, "invalid_tenant_id", "That is not a customer's platform ID.");
      const email = inviteEmail(req.body?.email);
      const rawName = req.body?.name;
      if (rawName != null && typeof rawName !== "string") throw new PlatformError(400, "invalid_name", "The name must be text.");
      const name = (rawName || "").trim().replace(/\s+/g, " ");
      if (name.length > MAX_NAME) throw new PlatformError(400, "invalid_name", `Keep the name to ${MAX_NAME} characters.`);
      if (!caller.email) throw new PlatformError(400, "no_actor_email", "Your login has no email to record this under.");
      if (!admin) throw new PlatformError(503, "not_configured", "The console's database isn't set up on this server.");

      if (!budget(caller.id, "default", 1)) throw new PlatformError(429, "rate_limited", "Too many invitations. Try again in an hour.");

      const { data, error } = await admin.rpc("platform_invite_hr_admin", {
        p_platform_tenant: id, p_email: email, p_actor: caller.id, p_actor_email: caller.email, p_name: name || null,
      });
      if (error) {
        if (error.code === "42501") throw new PlatformError(403, "forbidden", "Only an owner or admin can invite a customer's HR admin.");
        if (error.code === "22023") throw new PlatformError(400, "invalid_email", error.message || "That is not a valid email address.");
        throw new Error(`platform_invite_hr_admin: ${error.message || "failed"}`);
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || !OUTCOMES.includes(row.outcome)) throw new Error("platform_invite_hr_admin: no answer");
      if (row.outcome === "no_company") {
        throw new PlatformError(404, "no_company", "Figbloom HR has no company for this customer yet. Switch HR & Payroll on first, or wait for it to finish.");
      }
      if (row.outcome === "queued") console.log("[platform/hr-admin] HR admin invitation queued for", id);
      res.json({
        outcome: row.outcome,
        email,
        company: row.tenant_id ? { id: row.tenant_id, name: row.tenant_name ?? null } : null,
        member_role: row.member_role ?? null,
      });
    } catch (err) {
      send(res, err);
    }
  });

  return router;
}

export default createHrAdminRouter();
