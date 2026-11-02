// platform_routes.js: Figbloom's own API for the console (console.figbloom.org), for platform admins.
//
// A platform admin may belong to no company, so these routes do not use authenticate() from admin_routes.js (which
// needs one). They verify the bearer token the same way, then require the caller to be in public.platform_admins.
// The database checks again: grant_platform_admin_as() refuses anyone who is not a platform admin
// (migration 20261102100000_platform_staff.sql).
import express from "express";
import { HttpError, admin } from "./admin_routes.js";
import { createBudget } from "./authz.js";

const router = express.Router();

// The console's addresses: the same list as CONSOLE_HOSTNAMES in src/lib/console.ts (tests/platform_routes.test.ts
// checks they match). An invitation link only ever points at one of these.
export const CONSOLE_HOSTNAMES = ["console.figbloom.org", "console-staging.figbloom.org"];
export const DEFAULT_CONSOLE_ORIGIN = "https://console.figbloom.org";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NOTE = 500;
const HOUR = 60 * 60 * 1000;

// 20 invitations an hour per admin. In this server's memory: take_rate_limit() counts per company, and a platform
// admin may have none.
const inviteBudget = createBudget({ default: { limit: 20, windowMs: HOUR } });

/** The console origin an invitation link goes back to: the request's, if it is one of the console's, else production. */
export function consoleOrigin(origin) {
  if (typeof origin !== "string" || !origin) return DEFAULT_CONSOLE_ORIGIN;
  try {
    const url = new URL(origin);
    if (url.protocol === "https:" && !url.port && CONSOLE_HOSTNAMES.includes(url.hostname.toLowerCase())) {
      return `https://${url.hostname.toLowerCase()}`;
    }
  } catch {
    // not a URL: the default
  }
  return DEFAULT_CONSOLE_ORIGIN;
}

/** The signed-in platform admin calling, or an HttpError. No company needed. */
async function authenticatePlatformAdmin(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new HttpError(401, "Missing bearer token");

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, "Invalid or expired session");

  const { data: row, error: adminError } = await admin
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (adminError) throw new HttpError(500, "Could not verify the caller");
  if (!row) throw new HttpError(403, "Only a Figbloom platform admin can do this");
  return { id: data.user.id, email: data.user.email };
}

const noLogin = (error) => error?.code === "P0002" || /No login with this email/i.test(error?.message || "");
const alreadyRegistered = (error) =>
  error?.status === 422 || error?.code === "email_exists" || /already (been )?registered|already exists/i.test(error?.message || "");

// grant_platform_admin_as(): adds the login with this email as a platform admin, logged as the caller
async function grantAs(caller, email, note) {
  const { data, error } = await admin.rpc("grant_platform_admin_as", { p_by: caller.id, p_email: email, p_note: note });
  return { data, error };
}

// POST /api/platform/staff/invite  { email, note? }  -> { ok, email, userId, invited, alreadyAdmin }
// Makes the person with this email a platform admin. Without a login yet, Supabase Auth creates one and emails them a
// link to set a password on the console (invited: true). With one, they are just added (invited: false).
router.post("/staff/invite", async (req, res) => {
  try {
    if (!admin) throw new HttpError(500, "Admin API is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
    const caller = await authenticatePlatformAdmin(req);

    const email = String(req.body?.email ?? "").trim().toLowerCase();
    if (!email || email.length > 254 || !EMAIL_RE.test(email)) throw new HttpError(400, "Enter a valid email address");
    const rawNote = req.body?.note;
    if (rawNote != null && typeof rawNote !== "string") throw new HttpError(400, "The note must be text");
    const note = (rawNote || "").trim().slice(0, MAX_NOTE) || null;

    if (!inviteBudget(caller.id, "default", 1)) throw new HttpError(429, "Too many invitations. Try again in an hour.");

    let invited = false;
    let { data, error } = await grantAs(caller, email, note);
    if (error && noLogin(error)) {
      const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${consoleOrigin(req.headers.origin)}/update-password`,
      });
      // someone created the login in the meantime: just add them
      if (inviteError && !alreadyRegistered(inviteError)) {
        console.error("[platform] invite failed:", inviteError.status || "", inviteError.message || "");
        throw new HttpError(502, "The invitation could not be sent. Try again.");
      }
      invited = !inviteError;
      ({ data, error } = await grantAs(caller, email, note));
    }
    if (error) {
      if (error.code === "42501") throw new HttpError(403, "Only a Figbloom platform admin can do this");
      throw error;
    }

    res.json({ ok: true, email, userId: data?.user_id ?? null, invited, alreadyAdmin: data?.added === false });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500 && !(err instanceof HttpError)) console.error("[platform]", err);
    res.status(status).json({ error: err instanceof HttpError ? err.message : "Could not add the platform admin" });
  }
});

export default router;
