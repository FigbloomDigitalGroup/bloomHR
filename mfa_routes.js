// mfa_routes.js - two-step sign-in codes, made and checked on the server (FIG-834, FIG-658).
//
// The browser used to make the code, store it and check it itself, so it could read or skip it. Now:
//   * the server makes a random 6-digit code, keeps only a keyed hash of it (10 minutes, 5 tries, used once) and sends
//     it to the caller's own login email or, where the company chose SMS, their registered MFA number;
//   * the code is tied to this sign-in: the user and the session id in their (verified) login token. Nobody can check
//     a code sent to someone else, and a code from another sign-in does not count;
//   * a right code is recorded in mfa_sessions by the database (mfa_check_code, server only). mfa_required() and
//     mfa_satisfied() read that record, so the browser cannot mark itself verified.
//
// Email goes through Resend. On Resend's basic tier every code counts toward the account's daily sending limit, so
// sends are rate limited per user (and a page reload reuses the code already sent rather than sending another).
//
//   POST /api/mfa/send    { resend?: boolean }  -> { sent, method, destination, expiresAt, resendIn }
//   POST /api/mfa/verify  { code }              -> { verified: true } | 400/410/429 { error, reason, attemptsLeft? }
import express from "express";
import crypto from "node:crypto";
import dotenv from "dotenv";
import { Resend } from "resend";
import { authenticate, HttpError, admin } from "./admin_routes.js";
import { createSharedBudget } from "./authz.js";
import { formatPhone, sendServerSms } from "./sms_routes.js";

dotenv.config({ path: process.env.ENV_FILE || ".env" });

const router = express.Router();

const CODE_TTL_SECONDS = 10 * 60;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 30;
const PASS_HOURS = 12; // a passed sign-in is trusted this long, then asks again
const MINUTE = 60 * 1000;

// Budgets shared by every server instance (take_rate_limit): one send per 30 seconds, 5 sends per 15 minutes, and 20
// checks per 15 minutes (each code allows 5 tries; this also limits trying across fresh codes).
const cooldown = createSharedBudget("mfa-send-cooldown", { default: { limit: 1, windowMs: RESEND_COOLDOWN_SECONDS * 1000 } });
const sendBudget = createSharedBudget("mfa-send", { default: { limit: 5, windowMs: 15 * MINUTE } });
const verifyBudget = createSharedBudget("mfa-verify", { default: { limit: 20, windowMs: 15 * MINUTE } });

const PRIVILEGED = ["ADMIN", "HR", "CHECKER"];
/** Does the company's setting ask this role for a code? (the same rule as two_step_applies() in the database) */
export const twoStepApplies = (mode, role) => mode === "everyone" || (mode === "privileged" && PRIVILEGED.includes(role));

/**
 * The session id in a login token. Read only after authenticate() has had the token verified by Supabase Auth, so
 * its contents can be trusted; '' when there is none.
 */
export function sessionIdOf(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] || "", "base64url").toString("utf8"));
    return typeof payload?.session_id === "string" && payload.session_id.length <= 100 ? payload.session_id : "";
  } catch {
    return "";
  }
}

// The hash kept in mfa_codes: keyed with a server secret and bound to the user and sign-in, so the stored value is of
// no use to anyone who reads the table, and cannot match for anyone else.
const codeSecret = () => process.env.MFA_CODE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
export const hashCode = (userId, sessionId, code) =>
  crypto.createHmac("sha256", codeSecret()).update(`${userId}:${sessionId}:${code}`, "utf8").digest("hex");

/** j***@company.com, or +254 *** *** 678: enough to recognise, not enough to learn the address. */
export function maskDestination(method, to) {
  if (method === "sms") {
    const digits = String(to || "").replace(/\D/g, "");
    return digits.length >= 6 ? `+${digits.slice(0, 3)} *** *** ${digits.slice(-3)}` : "your phone";
  }
  const [local, domain] = String(to || "").split("@");
  if (!local || !domain) return "your email";
  return `${local[0]}***@${domain}`;
}

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** The subject, HTML and plain-text body of a sign-in code email. Everything inserted is escaped. */
export function codeEmail({ code, company, minutes = CODE_TTL_SECONDS / 60 }) {
  const subject = `${code} is your Figbloom HR sign-in code`;
  const where = company ? ` to ${company}` : "";
  const text = [
    `Your code to finish signing in${where} on Figbloom HR is: ${code}`,
    "",
    `It works once and expires in ${minutes} minutes.`,
    "If you did not just sign in, someone may know your password: change it now and tell your administrator.",
  ].join("\n");
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#16201a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
      <table role="presentation" width="520" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 16px;font-size:13px;font-weight:bold;color:#17402a;">Figbloom HR</p>
          <h1 style="margin:0 0 12px;font-size:20px;">Your sign-in code</h1>
          <p style="margin:0 0 20px;font-size:14px;line-height:1.5;">Enter this code to finish signing in${escapeHtml(where)}:</p>
          <p style="margin:0 0 24px;font-size:32px;font-weight:bold;letter-spacing:8px;font-family:'Courier New',monospace;color:#17402a;">${escapeHtml(code)}</p>
          <p style="margin:0 0 8px;font-size:12px;color:#5f6b62;">It works once and expires in ${escapeHtml(minutes)} minutes.</p>
          <p style="margin:16px 0 0;font-size:12px;color:#5f6b62;">If you did not just sign in, someone may know your password: change it now and tell your administrator.</p>
        </td></tr>
      </table>
    </td></tr></table>
  </body>
</html>`;
  return { subject, html, text };
}

const handler = (fn) => async (req, res) => {
  try {
    if (!admin) throw new HttpError(500, "Sign-in codes are not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
    const caller = await authenticate(req);
    const sessionId = sessionIdOf(req);
    if (!sessionId) throw new HttpError(401, "Sign in again to get a code");
    await fn(req, res, caller, sessionId);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : err?.status && err.status < 500 ? err.status : 500;
    if (status >= 500) console.error("[mfa]", err);
    res.status(status).json({
      error: status >= 500 && !(err instanceof HttpError) ? "Request failed" : err.message || "Request failed",
      ...(err?.extra || {}),
    });
  }
};

const fail = (status, message, extra) => Object.assign(new HttpError(status, message), { extra });

// The company's setting for the caller, or a 409 when it does not ask them for a code.
async function policyFor(caller) {
  const { data, error } = await admin.rpc("two_step_policy", { p_tenant: caller.tenantId });
  if (error) throw new HttpError(500, "Could not read the two-step sign-in setting");
  const row = (Array.isArray(data) ? data[0] : data) || {};
  if (twoStepApplies(row.mode, caller.role)) return { method: row.method === "sms" ? "sms" : "email" };
  // not asked of their role: did they turn it on for themselves? (20261018500000, FIG-891)
  const { data: own, error: ownError } = await admin.rpc("personal_two_step", { p_tenant: caller.tenantId, p_user: caller.id });
  if (ownError) throw new HttpError(500, "Could not read the two-step sign-in setting");
  const mine = (Array.isArray(own) ? own[0] : own) || {};
  if (!mine.enabled) throw fail(409, "Two-step sign-in is not on for your account", { reason: "not_required" });
  return { method: mine.method === "sms" ? "sms" : "email" };
}

router.post(
  "/send",
  handler(async (req, res, caller, sessionId) => {
    const policy = await policyFor(caller);

    // a reload of the page reuses the code already on its way rather than sending (and paying for) another
    if (req.body?.resend !== true) {
      const { data: active, error } = await admin
        .from("mfa_codes")
        .select("method, sent_to, expires_at, created_at, attempts")
        .eq("user_id", caller.id)
        .eq("session_id", sessionId)
        .eq("used", false)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new HttpError(500, "Could not read your sign-in code");
      if (active && active.attempts < MAX_ATTEMPTS) {
        const age = (Date.now() - new Date(active.created_at).getTime()) / 1000;
        return res.json({
          sent: false,
          method: active.method,
          destination: maskDestination(active.method, active.sent_to),
          expiresAt: active.expires_at,
          resendIn: Math.max(0, Math.ceil(RESEND_COOLDOWN_SECONDS - age)),
        });
      }
    }

    if (!(await cooldown(caller, "default", 1))) {
      throw fail(429, `Wait ${RESEND_COOLDOWN_SECONDS} seconds before asking for another code.`, { reason: "cooldown", retryAfter: RESEND_COOLDOWN_SECONDS });
    }
    if (!(await sendBudget(caller, "default", 1))) {
      throw fail(429, "Too many codes asked for. Wait 15 minutes and try again.", { reason: "rate_limited", retryAfter: 15 * 60 });
    }

    // SMS goes only to the number registered for this login; without one, the code goes to the login email instead
    let method = policy.method;
    let to = caller.email;
    if (method === "sms") {
      const { data, error } = await admin
        .from("mfa_numbers")
        .select("phone_number")
        .eq("email", caller.email)
        .eq("tenant_id", caller.tenantId)
        .maybeSingle();
      if (error) throw new HttpError(500, "Could not read your MFA number");
      const phone = formatPhone(data?.phone_number);
      if (phone) to = phone;
      else method = "email";
    }
    if (method === "email" && !to) throw new HttpError(400, "Your account has no email address to send a code to");
    if (method === "email" && !process.env.RESEND_API_KEY) throw new HttpError(503, "Email is not set up yet (RESEND_API_KEY)");

    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    const { data: expiresAt, error: issueError } = await admin.rpc("mfa_issue_code", {
      p_tenant: caller.tenantId,
      p_user: caller.id,
      p_session: sessionId,
      p_email: caller.email,
      p_method: method,
      p_sent_to: to,
      p_code_hash: hashCode(caller.id, sessionId, code),
      p_ttl_seconds: CODE_TTL_SECONDS,
    });
    if (issueError) throw new HttpError(500, "Could not create a sign-in code");

    if (method === "sms") {
      const sms = await sendServerSms(to, `Your Figbloom HR sign-in code is ${code}. It expires in ${CODE_TTL_SECONDS / 60} minutes.`);
      if (!sms.success) {
        console.error("[mfa] SMS not sent:", sms.error);
        throw new HttpError(502, "The code could not be sent by SMS. Try again.");
      }
    } else {
      const { data: tenant } = await admin.from("tenants").select("name").eq("id", caller.tenantId).maybeSingle();
      const message = codeEmail({ code, company: tenant?.name || "" });
      // counts toward Resend's daily limit (basic tier): see the note at the top
      const resend = new Resend(process.env.RESEND_API_KEY);
      const { error: sendError } = await resend.emails.send({
        from: process.env.SMTP_FROM || "Figbloom HR <onboarding@resend.dev>",
        to: caller.email,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
      if (sendError) {
        console.error("[mfa] Resend rejected the message:", sendError.name || "", sendError.message || "");
        throw new HttpError(502, "The code could not be emailed. Try again.");
      }
    }

    res.json({ sent: true, method, destination: maskDestination(method, to), expiresAt, resendIn: RESEND_COOLDOWN_SECONDS });
  })
);

router.post(
  "/verify",
  handler(async (req, res, caller, sessionId) => {
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    if (!/^\d{6}$/.test(code)) throw fail(400, "Enter the 6-digit code", { reason: "invalid" });

    if (!(await verifyBudget(caller, "default", 1))) {
      throw fail(429, "Too many tries. Wait 15 minutes and try again.", { reason: "rate_limited", retryAfter: 15 * 60 });
    }

    const { data, error } = await admin.rpc("mfa_check_code", {
      p_user: caller.id,
      p_session: sessionId,
      p_code_hash: hashCode(caller.id, sessionId, code),
      p_max_attempts: MAX_ATTEMPTS,
      p_pass_hours: PASS_HOURS,
    });
    if (error) throw new HttpError(500, "Could not check the code");
    const { outcome, attempts_left: attemptsLeft } = (Array.isArray(data) ? data[0] : data) || {};

    if (outcome === "ok") return res.json({ verified: true });
    if (outcome === "wrong") {
      throw fail(400, `That code is not right. ${attemptsLeft} ${attemptsLeft === 1 ? "try" : "tries"} left.`, { reason: "wrong", attemptsLeft });
    }
    if (outcome === "expired") throw fail(410, "This code has expired. Send a new one.", { reason: "expired" });
    if (outcome === "too_many") throw fail(429, "Too many wrong tries. Send a new code.", { reason: "too_many" });
    throw fail(400, "There is no code to check. Send a new one.", { reason: "none" });
  })
);

export default router;
