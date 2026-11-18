// figbloom_accounts.js: people's Figbloom accounts, made through the platform (ERP/HR_COGNITO_CONTRACT.md section 2).
// With Figbloom sign-in on (COGNITO_SIGN_IN), Cognito holds people's passwords: HR's forms still ask for one (creating
// a company, accepting an invitation) and pass it here once; HR never keeps it. Its own Supabase logins get a random
// password nobody knows, and are linked to the Figbloom account (identity_links) the moment HR makes it.
//
// The platform's routes (the "hr" service client, platform_events_routes.js hrClient):
//   POST /users { email, name, password?, email_proven? }       -> { user_sub, created }
//   POST /users/{sub}/initial-password { password, email_proven } (accounts HR made, with no password yet)
//   POST /users/{sub}/email-verified                              (accounts HR made)
import crypto from "node:crypto";
import { admin } from "./admin_routes.js";
import { PlatformError } from "./platform_client.js";
import { hrClient } from "./platform_events_routes.js";

const TAG = "[figbloom accounts]";

/** Figbloom sign-in is on (COGNITO_SIGN_IN=on): people's passwords belong to their Figbloom accounts. */
export const cognitoSignInEnabled = (env = process.env) => String(env.COGNITO_SIGN_IN || "").trim() === "on";

// What a person reads when a password doesn't meet the Figbloom rule (the customers pool's policy)
export const FIGBLOOM_PASSWORD_RULE = "at least 8 characters, with an upper-case letter, a lower-case letter, a digit and a symbol";

/** A refusal to show the person: status, code and message are what HR answers with. */
export class FigbloomAccountError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const USE_FIGBLOOM_RESET = () =>
  new FigbloomAccountError(409, "use_figbloom_reset", 'You already have a Figbloom password. To change it, use "Forgot password" on the Figbloom sign-in page.');

const unavailable = () =>
  new FigbloomAccountError(503, "accounts_unavailable", "Figbloom accounts can't be created right now. Please try again in a few minutes.");

function translate(err) {
  if (err instanceof FigbloomAccountError) return err;
  if (err instanceof PlatformError) {
    if (err.code === "invalid_password") return new FigbloomAccountError(400, "invalid_password", `Your password must be ${FIGBLOOM_PASSWORD_RULE}.`);
    if (err.code === "password_already_set") return USE_FIGBLOOM_RESET();
    console.error(TAG, `the platform refused (${err.status} ${err.code}): ${err.message}`);
    return unavailable();
  }
  console.error(TAG, err?.message || err);
  return unavailable();
}

const randomPassword = () => crypto.randomBytes(32).toString("base64url");

/** The platform and the database, behind one object so routes and tests can swap them. */
export const figbloomAccounts = {
  platform: () => hrClient,
  db: () => admin,

  /** The Figbloom account for this email: { sub, created }. created: false = it already existed (unchanged). */
  async ensure({ email, name, password, emailProven = false }) {
    try {
      const body = { email, name: String(name || email.split("@")[0]).slice(0, 200), email_proven: !!emailProven, ...(password === undefined ? {} : { password }) };
      const r = await this.platform().call("POST", "/users", body);
      if (typeof r?.user_sub !== "string") throw new Error("the platform answered no user_sub");
      return { sub: r.user_sub, created: !!r.created };
    } catch (err) {
      throw translate(err);
    }
  },

  /** The first password of an account HR made without one; emailProven: it came through a link sent to that inbox. */
  async setInitialPassword(sub, password, { emailProven = false } = {}) {
    try {
      await this.platform().call("POST", `/users/${encodeURIComponent(sub)}/initial-password`, { password, email_proven: !!emailProven });
    } catch (err) {
      throw translate(err);
    }
  },

  async markEmailVerified(sub) {
    try {
      await this.platform().call("POST", `/users/${encodeURIComponent(sub)}/email-verified`, {});
    } catch (err) {
      throw translate(err);
    }
  },

  /** Links a login HR just made to its Figbloom account: 'linked' | 'already' | 'taken'. */
  async link(userId, sub, { madeHere }) {
    const { data, error } = await this.db().rpc("identity_link", { p_user: userId, p_pool: "customers", p_sub: sub, p_made_here: !!madeHere });
    if (error) throw new Error(`identity_link: ${error.message || "failed"}`);
    return data;
  },

  /** The login's Figbloom account: { sub, madeHere } or null. */
  async identityOf(userId) {
    const { data, error } = await this.db().rpc("identity_of", { p_user: userId, p_pool: "customers" });
    if (error) throw new Error(`identity_of: ${error.message || "failed"}`);
    const row = Array.isArray(data) ? data[0] : data;
    return row?.sub ? { sub: row.sub, madeHere: !!row.made_here } : null;
  },

  /** The login's own Supabase password stops working: only Cognito holds the password. */
  async retirePassword(userId) {
    const { error } = await this.db().auth.admin.updateUserById(userId, { password: randomPassword() });
    if (error) throw new Error(`updateUserById: ${error.message || "failed"}`);
  },
};

export { randomPassword };

/** Express: answers a FigbloomAccountError as { error, code }, the shape HR's API uses. */
export function sendAccountError(res, err) {
  return res.status(err.status).json({ error: err.message, code: err.code });
}

// ---- "Set your password" for a person an admin added (admin_routes.js POST /users)

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** The subject, HTML and plain text of "Set your password". Everything inserted is escaped. */
export function setPasswordEmail({ company, link }) {
  const where = company ? `${company} has added you to Figbloom HR` : "You have been added to Figbloom HR";
  const subject = company ? `Set your password for ${company} on Figbloom HR` : "Set your password for Figbloom HR";
  const text = [
    `${where}.`,
    "",
    `Choose your password here: ${link}`,
    "",
    "Then sign in with Figbloom, with this email address and that password: one account for every Figbloom product.",
    "The link works once. If it has expired, open it anyway and ask for a new one.",
  ].join("\n");
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#16201a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
      <table role="presentation" width="520" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:32px;">
        <tr><td>
          <p style="margin:0 0 16px;font-size:13px;font-weight:bold;color:#17402a;">Figbloom HR</p>
          <h1 style="margin:0 0 12px;font-size:20px;">Set your password</h1>
          <p style="margin:0 0 20px;font-size:14px;line-height:1.5;">${escapeHtml(where)}. Choose your password, then sign in with Figbloom: one account for every Figbloom product.</p>
          <p style="margin:0 0 24px;"><a href="${escapeHtml(link)}" style="display:inline-block;background:#17402a;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;padding:12px 22px;border-radius:8px;">Set your password</a></p>
          <p style="margin:0 0 8px;font-size:12px;color:#5f6b62;">Or paste this link into your browser:<br><span style="word-break:break-all;">${escapeHtml(link)}</span></p>
          <p style="margin:16px 0 0;font-size:12px;color:#5f6b62;">The link works once. If it has expired, open it anyway and ask for a new one. If you were not expecting this, you can ignore this email.</p>
        </td></tr>
      </table>
    </td></tr></table>
  </body>
</html>`;
  return { subject, html, text };
}

/**
 * Emails "Set your password": a one-time recovery link (Supabase generateLink, nothing sent by Supabase) to
 * /update-password, whose page sets the Figbloom password, sent with Resend like invitations. Without Resend, Supabase's
 * own recovery email instead (its wording is "Reset your password"). Never throws: the person was added either way.
 */
export async function sendSetPasswordEmail({ db = admin, email, company, site, send }) {
  const redirectTo = site ? `${site}/update-password` : undefined;
  try {
    if (send) {
      const { data, error } = await db.auth.admin.generateLink({ type: "recovery", email, ...(redirectTo ? { options: { redirectTo } } : {}) });
      const link = data?.properties?.action_link;
      if (error || typeof link !== "string") throw new Error(`generateLink: ${error?.message || "no link"}`);
      await send({ to: email, ...setPasswordEmail({ company, link }) });
      return "sent";
    }
    const { error } = await db.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
    if (error) throw new Error(error.message);
    return "sent_by_supabase";
  } catch (err) {
    console.error(TAG, "set-password email not sent:", err?.message || err);
    return "not_sent";
  }
}
