// admin_routes.js - user administration that needs the Supabase service-role key.
// The key lives only here (server side); the browser calls these endpoints with its
// own session token and the caller's role is verified before anything runs.
import express from "express";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: process.env.ENV_FILE || ".env" });

const router = express.Router();

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin =
  supabaseUrl && serviceKey
    ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;

const ROLES = ["ADMIN", "HR", "CHECKER", "MANAGER", "REGIONAL", "OPERATIONS", "STAFF"];
const STATUSES = ["ACTIVE", "SUSPENDED", "DEACTIVATED"];
const LOCATION_ROLES = ["REGIONAL", "MANAGER", "OPERATIONS", "STAFF"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 6;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Supabase Auth ban durations for each account status.
const banDuration = (status) => (status === "ACTIVE" ? "none" : status === "SUSPENDED" ? "876000h" : "permanent");

// Verifies the bearer token and loads the caller's role from user_profiles.
// user_metadata is user-editable, so it is never trusted for authorization.
async function authenticate(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new HttpError(401, "Missing bearer token");

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, "Invalid or expired session");

  const { data: profile, error: profileError } = await admin
    .from("user_profiles")
    .select("role, account_status")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (profileError) throw new HttpError(500, "Could not verify caller role");
  if (!profile || (profile.account_status && profile.account_status !== "ACTIVE")) {
    throw new HttpError(403, "Forbidden");
  }
  return { id: data.user.id, role: profile.role };
}

// Wraps a handler with auth, a role allow-list and uniform error handling.
const guard = (allowedRoles, handler) => async (req, res) => {
  try {
    if (!admin) throw new HttpError(500, "Admin API is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
    const caller = await authenticate(req);
    if (!allowedRoles.includes(caller.role)) throw new HttpError(403, "Forbidden");
    await handler(req, res, caller);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : err.status && err.status < 500 ? err.status : 500;
    if (status >= 500) console.error("[admin]", err);
    res.status(status).json({ error: err.message || "Request failed" });
  }
};

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

async function listAllAuthUsers() {
  const users = [];
  const perPage = 1000;
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < perPage) break;
  }
  return users;
}

const toUserView = (user, profile) => ({
  id: user.id,
  email: user.email,
  role: profile?.role || user.user_metadata?.role || "STAFF",
  account_status:
    profile?.account_status ||
    user.user_metadata?.account_status ||
    (!user.banned_until && user.email_confirmed_at ? "ACTIVE" : "DEACTIVATED"),
  last_sign_in_at: user.last_sign_in_at,
  created_at: user.created_at,
  location: user.user_metadata?.location || null,
  branch: user.user_metadata?.branch || null,
  user_metadata: user.user_metadata,
});

// Keeps user_profiles (the trusted role source) in step with the auth user.
async function syncProfile(userId, email, role, accountStatus) {
  const { error } = await admin
    .from("user_profiles")
    .upsert({ user_id: userId, email, role, account_status: accountStatus }, { onConflict: "user_id" });
  if (error) throw error;
}

// HR may only manage STAFF accounts (the staff sign-up approval flow); ADMIN may manage any.
function assertCanManageRole(caller, role) {
  if (caller.role !== "ADMIN" && role !== "STAFF") throw new HttpError(403, "Only an ADMIN can manage non-STAFF accounts");
}

function validateFields({ email, role, account_status, password }, { requireAll }) {
  if (email !== undefined && !EMAIL_RE.test(email)) throw new HttpError(400, "A valid email is required");
  if (role !== undefined && !ROLES.includes(role)) throw new HttpError(400, `role must be one of ${ROLES.join(", ")}`);
  if (account_status !== undefined && !STATUSES.includes(account_status)) {
    throw new HttpError(400, `account_status must be one of ${STATUSES.join(", ")}`);
  }
  if (password !== undefined && String(password).length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (requireAll && (!email || !password || !role)) throw new HttpError(400, "email, password and role are required");
}

// GET /api/admin/users - every auth user with role/status (ADMIN)
router.get(
  "/users",
  guard(["ADMIN"], async (_req, res) => {
    const [users, profiles] = await Promise.all([
      listAllAuthUsers(),
      admin.from("user_profiles").select("user_id, role, account_status"),
    ]);
    if (profiles.error) throw profiles.error;
    const byId = new Map(profiles.data.map((p) => [p.user_id, p]));
    res.json({ users: users.map((u) => toUserView(u, byId.get(u.id))) });
  })
);

// GET /api/admin/auth-users - slim id/email/metadata list for sign-up matching (ADMIN, HR)
router.get(
  "/auth-users",
  guard(["ADMIN", "HR"], async (_req, res) => {
    const users = await listAllAuthUsers();
    res.json({ users: users.map((u) => ({ id: u.id, email: u.email, user_metadata: u.user_metadata })) });
  })
);

// POST /api/admin/users - create a login (ADMIN any role, HR STAFF only)
router.post(
  "/users",
  guard(["ADMIN", "HR"], async (req, res, caller) => {
    const { password, role, account_status = "ACTIVE", location, branch } = req.body || {};
    const email = normalizeEmail(req.body?.email);
    validateFields({ email, role, account_status, password }, { requireAll: true });
    assertCanManageRole(caller, role);

    const user_metadata = {
      role,
      account_status,
      ...(LOCATION_ROLES.includes(role) && location ? { location } : {}),
      ...(branch ? { branch } : {}),
    };
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata,
      ...(account_status !== "ACTIVE" ? { ban_duration: banDuration(account_status) } : {}),
    });
    if (error) {
      const exists = error.status === 422 || /already (been )?registered/i.test(error.message);
      throw new HttpError(exists ? 409 : 400, error.message);
    }
    try {
      await syncProfile(data.user.id, email, role, account_status);
    } catch (profileErr) {
      // Don't leave a login that can never pass the role check.
      await admin.auth.admin.deleteUser(data.user.id);
      throw profileErr;
    }
    res.status(201).json({ user: toUserView(data.user, { role, account_status }) });
  })
);

// PATCH /api/admin/users/:id - change email/role/status/location/branch/password (ADMIN, HR for STAFF)
router.patch(
  "/users/:id",
  guard(["ADMIN", "HR"], async (req, res, caller) => {
    const { id } = req.params;
    const { password, role, account_status, location, branch } = req.body || {};
    const email = req.body?.email === undefined ? undefined : normalizeEmail(req.body.email);
    validateFields({ email, role, account_status, password }, { requireAll: false });

    const { data: existing, error: getError } = await admin.auth.admin.getUserById(id);
    if (getError || !existing?.user) throw new HttpError(404, "User not found");
    const current = existing.user;

    const { data: currentProfile } = await admin.from("user_profiles").select("role, account_status").eq("user_id", id).maybeSingle();
    const currentRole = currentProfile?.role || current.user_metadata?.role || "STAFF";
    assertCanManageRole(caller, currentRole);
    const nextRole = role ?? currentRole;
    assertCanManageRole(caller, nextRole);

    if (id === caller.id && ((role && role !== currentRole) || (account_status && account_status !== "ACTIVE"))) {
      throw new HttpError(400, "You cannot change your own role or deactivate your own account");
    }

    const nextStatus = account_status ?? currentProfile?.account_status ?? current.user_metadata?.account_status ?? "ACTIVE";
    const user_metadata = {
      ...current.user_metadata,
      role: nextRole,
      account_status: nextStatus,
      updated_at: new Date().toISOString(),
    };
    if (role !== undefined || location !== undefined) {
      if (LOCATION_ROLES.includes(nextRole)) {
        if (location !== undefined) user_metadata.location = location || null;
      } else {
        user_metadata.location = null;
      }
    }
    if (branch !== undefined) user_metadata.branch = branch || null;

    const update = { user_metadata };
    if (email !== undefined) update.email = email;
    if (password !== undefined) update.password = password;
    if (account_status !== undefined) update.ban_duration = banDuration(account_status);

    const { data, error } = await admin.auth.admin.updateUserById(id, update);
    if (error) throw new HttpError(error.status === 422 ? 409 : 400, error.message);
    await syncProfile(id, data.user.email, nextRole, nextStatus);
    res.json({ user: toUserView(data.user, { role: nextRole, account_status: nextStatus }) });
  })
);

// DELETE /api/admin/users/:id (ADMIN)
router.delete(
  "/users/:id",
  guard(["ADMIN"], async (req, res, caller) => {
    if (req.params.id === caller.id) throw new HttpError(400, "You cannot delete your own account");
    const { error } = await admin.auth.admin.deleteUser(req.params.id);
    if (error) throw new HttpError(error.status === 404 ? 404 : 400, error.message);
    await admin.from("user_profiles").delete().eq("user_id", req.params.id);
    res.json({ ok: true });
  })
);

// POST /api/admin/users/:id/reset-email - send the user a password reset email (ADMIN)
router.post(
  "/users/:id/reset-email",
  guard(["ADMIN"], async (req, res) => {
    const { data, error } = await admin.auth.admin.getUserById(req.params.id);
    if (error || !data?.user?.email) throw new HttpError(404, "User not found");
    const redirectTo = typeof req.body?.redirectTo === "string" ? req.body.redirectTo : undefined;
    const { error: resetError } = await admin.auth.resetPasswordForEmail(data.user.email, redirectTo ? { redirectTo } : undefined);
    if (resetError) throw new HttpError(400, resetError.message);
    res.json({ ok: true });
  })
);

export default router;
