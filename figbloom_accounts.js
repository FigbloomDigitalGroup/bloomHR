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
