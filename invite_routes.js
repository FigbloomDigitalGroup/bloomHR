// invite_routes.js: email an invitation to join a company.
//
// The browser creates the invitation (a database function checks who may invite whom) and gets the link token back.
// It then asks this route to email it. The server does not trust the browser for the content: it looks the
// invitation up by the token's hash, checks it belongs to the caller's company and is still open, and writes the
// email itself (company name, role and address come from the database). So this route cannot be used to send
// arbitrary mail; it can only deliver an invitation that really exists.
import express from "express";
import crypto from "node:crypto";
import dotenv from "dotenv";
import { Resend } from "resend";
import { authenticate, HttpError, admin } from "./admin_routes.js";

dotenv.config({ path: process.env.ENV_FILE || ".env" });

const router = express.Router();

// Same hash as the database: sha256 of the token's UTF-8 bytes, as hex (see hash_invite_token in the migration).
const hashToken = (token) => crypto.createHash("sha256").update(String(token ?? ""), "utf8").digest("hex");

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const roleLabel = (role) => String(role || "").charAt(0) + String(role || "").slice(1).toLowerCase();

// The address people are sent to. Configured, or Vercel's production address, or (last resort) the page that asked.
function siteUrl(req) {
  const configured = process.env.SITE_URL || process.env.PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  const origin = req.headers.origin;
  if (typeof origin === "string" && /^https?:\/\//.test(origin)) return origin.replace(/\/+$/, "");
  throw new HttpError(500, "The site address is not configured (SITE_URL)");
}

/** The subject, HTML and plain-text body of an invitation. Everything inserted is escaped. */
export function invitationEmail({ company, role, inviter, link, expires }) {
  const who = inviter ? `${inviter} has invited you` : "You have been invited";
  const expiry = expires ? new Date(expires).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "7 days from now";
  const subject = `You're invited to join ${company} on Figbloom HR`;
  const text = [
    `${who} to join ${company} on Figbloom HR as ${roleLabel(role)}.`,
    "",
    `Create your account here: ${link}`,
    "",
    `This link works once, only for this email address, and expires on ${expiry}.`,
    "If you were not expecting this, you can ignore this email.",
  ].join("\n");
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#16201a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
      <table role="presentation" width="520" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 16px;font-size:13px;font-weight:bold;color:#17402a;">Figbloom HR</p>
          <h1 style="margin:0 0 12px;font-size:20px;">Join ${escapeHtml(company)}</h1>
          <p style="margin:0 0 20px;font-size:14px;line-height:1.5;">${escapeHtml(who)} to join <strong>${escapeHtml(company)}</strong> on Figbloom HR as <strong>${escapeHtml(roleLabel(role))}</strong>.</p>
          <p style="margin:0 0 24px;"><a href="${escapeHtml(link)}" style="display:inline-block;background:#17402a;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;padding:12px 22px;border-radius:8px;">Accept the invitation</a></p>
          <p style="margin:0 0 8px;font-size:12px;color:#5f6b62;">Or paste this link into your browser:<br><span style="word-break:break-all;">${escapeHtml(link)}</span></p>
          <p style="margin:16px 0 0;font-size:12px;color:#5f6b62;">This link works once, only for this email address, and expires on ${escapeHtml(expiry)}. If you were not expecting this, you can ignore this email.</p>
        </td></tr>
      </table>
    </td></tr></table>
  </body>
</html>`;
  return { subject, html, text };
}

// POST /api/invites/send  { token }  -> emails the invitation that token belongs to (ADMIN, HR)
router.post("/send", async (req, res) => {
  try {
    if (!admin) throw new HttpError(500, "Admin API is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
    const caller = await authenticate(req);
    if (!["ADMIN", "HR"].includes(caller.role)) throw new HttpError(403, "Forbidden");

    const token = req.body?.token;
    if (typeof token !== "string" || token.length < 20 || token.length > 200) throw new HttpError(400, "A valid invitation token is required");

    const { data: invitation, error } = await admin
      .from("invitations")
      .select("id, email, role, status, expires_at")
      .eq("token_hash", hashToken(token))
      .eq("tenant_id", caller.tenantId)
      .maybeSingle();
    if (error) throw error;
    if (!invitation || invitation.status !== "pending" || new Date(invitation.expires_at) < new Date()) {
      throw new HttpError(404, "This invitation is not valid any more");
    }
    // the database already limits HR to inviting staff; keep that true here too
    if (caller.role !== "ADMIN" && invitation.role !== "STAFF") throw new HttpError(403, "Only an administrator can send this invitation");

    if (!process.env.RESEND_API_KEY) throw new HttpError(503, "Email is not set up yet (RESEND_API_KEY)");

    const { data: tenant, error: tenantError } = await admin.from("tenants").select("name").eq("id", caller.tenantId).maybeSingle();
    if (tenantError) throw tenantError;

    const link = `${siteUrl(req)}/join?token=${encodeURIComponent(token)}`;
    const message = invitationEmail({
      company: tenant?.name || "your company",
      role: invitation.role,
      inviter: caller.email,
      link,
      expires: invitation.expires_at,
    });

    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error: sendError } = await resend.emails.send({
      from: process.env.SMTP_FROM || "Figbloom HR <onboarding@resend.dev>",
      to: invitation.email,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    if (sendError) {
      console.error("[invites] Resend rejected the message:", sendError.name || "", sendError.message || "");
      throw new HttpError(502, "The email could not be sent. Copy the link and send it yourself.");
    }
    res.json({ ok: true, sentTo: invitation.email });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : err?.status && err.status < 500 ? err.status : 500;
    if (status >= 500) console.error("[invites]", err);
    res.status(status).json({ error: status >= 500 && !(err instanceof HttpError) ? "Could not send the invitation" : err.message });
  }
});

// POST /api/invites/accept  { token, password, fullName? }  (no login: the invitation link is the proof)
//
// For someone with no account yet. Only the person who received the email can have the token, so the invitation
// itself proves they own that address and no confirmation email is needed. The account is created already
// confirmed, in the inviting company, with the role chosen in the invitation. If the address already has an
// account (for example from another company), the answer is 409 / account_exists: they sign in and join instead.
router.post("/accept", async (req, res) => {
  let claimedId = null;
  let createdUserId = null;
  const undo = async () => {
    if (createdUserId) await admin.auth.admin.deleteUser(createdUserId).catch(() => {});
    if (claimedId) await admin.from("invitations").update({ status: "pending", accepted_at: null }).eq("id", claimedId);
  };
  try {
    if (!admin) throw new HttpError(500, "Admin API is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");

    const { token, password } = req.body || {};
    const fullName = typeof req.body?.fullName === "string" ? req.body.fullName.trim().slice(0, 100) : "";
    if (typeof token !== "string" || token.length < 20 || token.length > 200) throw new HttpError(400, "A valid invitation token is required");
    if (typeof password !== "string" || password.length < 8 || password.length > 72) throw new HttpError(400, "Password must be 8 to 72 characters");

    const { data: invitation, error } = await admin
      .from("invitations")
      .select("id, tenant_id, email, role, status, expires_at")
      .eq("token_hash", hashToken(token))
      .maybeSingle();
    if (error) throw error;
    if (!invitation || invitation.status !== "pending" || new Date(invitation.expires_at) < new Date()) {
      throw new HttpError(404, "This invitation is not valid any more");
    }

    // claim it first, so two requests with the same link cannot both create an account
    const { data: claimed, error: claimError } = await admin
      .from("invitations")
      .update({ status: "accepted", accepted_at: new Date().toISOString() })
      .eq("id", invitation.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) throw new HttpError(404, "This invitation is not valid any more");
    claimedId = invitation.id;

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: invitation.email,
      password,
      email_confirm: true,
      user_metadata: fullName ? { full_name: fullName } : {},
    });
    if (createError || !created?.user) {
      const exists = createError?.status === 422 || /already (been )?registered|already exists/i.test(createError?.message || "");
      if (exists) {
        await undo();
        claimedId = null;
        return res.status(409).json({ error: "You already have an account with this email. Sign in to join.", code: "account_exists" });
      }
      throw createError || new Error("Could not create the account");
    }
    createdUserId = created.user.id;

    const { error: memberError } = await admin
      .from("memberships")
      .insert({ user_id: createdUserId, tenant_id: invitation.tenant_id, role: invitation.role, account_status: "ACTIVE" });
    if (memberError) throw memberError;

    // best effort: keep the name on the profile too
    if (fullName) await admin.from("user_profiles").update({ full_name: fullName }).eq("user_id", createdUserId);
    await admin.from("invitations").update({ accepted_by: createdUserId }).eq("id", invitation.id);

    res.json({ ok: true, email: invitation.email });
  } catch (err) {
    await undo();
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error("[invites] accept failed:", err);
    res.status(status).json({ error: err instanceof HttpError ? err.message : "Could not create your account. Please try again." });
  }
});

export default router;
