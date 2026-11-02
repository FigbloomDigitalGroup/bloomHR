// platform_routes.js: Figbloom's own API for the console (console.figbloom.org), for platform admins.
//
// A platform admin may belong to no company, so these routes do not use authenticate() from admin_routes.js (which
// needs one). They verify the bearer token the same way, then require the caller to be in public.platform_admins.
// The database checks again: grant_platform_admin_as() refuses anyone who is not a platform admin
// (migration 20261102100000_platform_staff.sql).
import express from "express";
import { Resend } from "resend";
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

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** The email telling someone who already has a login that they are now a platform admin. Everything inserted is escaped. */
export function platformAdminEmail({ inviter, origin, note }) {
  const by = inviter ? ` by ${inviter}` : "";
  const subject = "You are now a Figbloom platform admin";
  const text = [
    `You've been made a Figbloom platform admin${by}.`,
    ...(note ? ["", `Note: ${note}`] : []),
    "",
    `Sign in at ${origin} with your usual password.`,
    "",
    "If you were not expecting this, tell the person who added you.",
  ].join("\n");
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#16201a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
      <table role="presentation" width="520" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 16px;font-size:13px;font-weight:bold;color:#17402a;">Figbloom console</p>
          <h1 style="margin:0 0 12px;font-size:20px;">You are now a platform admin</h1>
          <p style="margin:0 0 16px;font-size:14px;line-height:1.5;">You've been made a Figbloom platform admin${escapeHtml(by)}.</p>
          ${note ? `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;"><strong>Note:</strong> ${escapeHtml(note)}</p>` : ""}
          <p style="margin:0 0 24px;"><a href="${escapeHtml(origin)}" style="display:inline-block;background:#17402a;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;padding:12px 22px;border-radius:8px;">Sign in to the console</a></p>
          <p style="margin:0;font-size:12px;color:#5f6b62;">Sign in at ${escapeHtml(origin)} with your usual password. If you were not expecting this, tell the person who added you.</p>
        </td></tr>
      </table>
    </td></tr></table>
  </body>
</html>`;
  return { subject, html, text };
}

/** Emails an existing login that they now have console access. Resolves { ok } or { ok: false, reason }; never throws. */
async function notifyNewAdmin({ to, inviter, origin, note }) {
  if (!process.env.RESEND_API_KEY) return { ok: false, reason: "Email is not set up (RESEND_API_KEY)" };
  try {
    const message = platformAdminEmail({ inviter, origin, note });
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: process.env.SMTP_FROM || "Figbloom HR <onboarding@resend.dev>",
      to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    if (error) {
      console.error("[platform] Resend rejected the notification:", error.name || "", error.message || "");
      return { ok: false, reason: "The email service refused the message" };
    }
    return { ok: true };
  } catch (err) {
    console.error("[platform] notification failed:", err?.message || err);
    return { ok: false, reason: "The email could not be sent" };
  }
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

// POST /api/platform/staff/invite  { email, note? }
//   -> { ok, email, userId, origin, result, invited, notified, alreadyAdmin, notifyError? }
// Makes the person with this email a platform admin. `result` says what happened:
//   invited        no login yet: Supabase Auth created one and emailed a link to set a password on the console
//   notified       they had a login: added, and emailed here that they now have console access
//   notify_failed  they had a login: added, but that email failed (notifyError says why); they can still sign in
//   already_admin  they already were one: only the note was updated, nothing sent
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

    const origin = consoleOrigin(req.headers.origin);
    let invited = false;
    let { data, error } = await grantAs(caller, email, note);
    if (error && noLogin(error)) {
      const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${origin}/update-password` });
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

    const alreadyAdmin = data?.added === false;
    let result = invited ? "invited" : alreadyAdmin ? "already_admin" : "notified";
    let notifyError;
    // Supabase sends an existing login nothing: tell them here. The grant stands whatever happens to this email.
    if (result === "notified") {
      const sent = await notifyNewAdmin({ to: email, inviter: caller.email, origin, note });
      if (!sent.ok) {
        result = "notify_failed";
        notifyError = sent.reason;
      }
    }

    res.json({
      ok: true,
      email,
      userId: data?.user_id ?? null,
      origin,
      result,
      invited,
      notified: result === "notified",
      alreadyAdmin,
      ...(notifyError ? { notifyError } : {}),
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500 && !(err instanceof HttpError)) console.error("[platform]", err);
    res.status(status).json({ error: err instanceof HttpError ? err.message : "Could not add the platform admin" });
  }
});

export default router;
