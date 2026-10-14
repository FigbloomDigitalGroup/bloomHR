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

// Roles are each company's own (FIG-827): a role is a key of the company's role_permissions, checked against the
// database when it is given (assertCanManageRole). These fixed roles are the ones that never had a location.
const ROLE_KEY_RE = /^[A-Z][A-Z0-9_]{1,39}$/;
const STATUSES = ["ACTIVE", "SUSPENDED", "DEACTIVATED"];
const NO_LOCATION_ROLES = ["ADMIN", "HR", "CHECKER"];
const usesLocation = (role) => !NO_LOCATION_ROLES.includes(role);
// The module that lets someone other than ADMIN invite people and manage logins (of roles with less access).
const INVITE_MODULE = "invite-people";
const ADMIN_ONLY = Symbol("ADMIN only");
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

// Verifies the bearer token and loads the caller's role and tenant from user_profiles.
// user_metadata is user-editable, so it is never trusted for authorization. Every query below
// runs with the service-role key (no RLS), so tenant isolation is enforced here, in code: each
// handler is scoped to caller.tenantId (docs/MULTI_TENANCY_RFC.md, section 4).
async function authenticate(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new HttpError(401, "Missing bearer token");

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, "Invalid or expired session");

  const { data: profile, error: profileError } = await admin
    .from("user_profiles")
    .select("role, account_status, tenant_id")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (profileError) throw new HttpError(500, "Could not verify caller role");
  if (!profile || !profile.tenant_id || (profile.account_status && profile.account_status !== "ACTIVE")) {
    throw new HttpError(403, "Forbidden");
  }
  return { id: data.user.id, email: data.user.email, role: profile.role, tenantId: profile.tenant_id };
}

// Does the caller's role in their company include the module? ADMIN always does (the same rule as has_module()).
async function callerHasModule(caller, module) {
  if (caller.role === "ADMIN") return true;
  const { data, error } = await admin
    .from("role_permissions")
    .select("permissions")
    .eq("tenant_id", caller.tenantId)
    .eq("role_name", caller.role)
    .maybeSingle();
  if (error) throw new HttpError(500, "Could not verify permissions");
  return Array.isArray(data?.permissions) && data.permissions.includes(module);
}

// Wraps a handler with auth, an access check (ADMIN_ONLY, or a module the caller's role must have) and uniform
// error handling.
const guard = (access, handler) => async (req, res) => {
  try {
    if (!admin) throw new HttpError(500, "Admin API is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
    const caller = await authenticate(req);
    const allowed = access === ADMIN_ONLY ? caller.role === "ADMIN" : await callerHasModule(caller, access);
    if (!allowed) throw new HttpError(403, "Forbidden");
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

// Records the person's role and status in ONE company. memberships is the source of truth (a login can belong to
// several companies); a database trigger mirrors it into user_profiles, the row the access rules read, when this
// is the company the person is currently working in (or their first). Never writes another company's membership.
async function syncProfile(userId, role, accountStatus, tenantId) {
  const { error } = await admin
    .from("memberships")
    .upsert({ user_id: userId, tenant_id: tenantId, role, account_status: accountStatus }, { onConflict: "user_id,tenant_id" });
  if (error) throw error;
}

// True when the person is an active member of some company other than `tenantId`: suspending them in one
// company must not ban the login they still use for another.
async function hasOtherActiveMembership(userId, tenantId) {
  const { data, error } = await admin
    .from("memberships")
    .select("tenant_id")
    .eq("user_id", userId)
    .eq("account_status", "ACTIVE");
  if (error) throw error;
  return data.some((m) => m.tenant_id !== tenantId);
}

// True when the login also belongs to a company other than `tenantId` (any status). Its email and password belong
// to the whole login, so one company's admin must not change them.
async function belongsToOtherCompany(userId, tenantId) {
  const { data, error } = await admin.from("memberships").select("tenant_id").eq("user_id", userId);
  if (error) throw error;
  return data.some((m) => m.tenant_id !== tenantId);
}

// The target of a by-id operation must belong to the caller's tenant. A user in another tenant
// is reported as "not found" so the endpoint does not reveal that they exist.
async function loadTenantProfile(userId, caller) {
  const { data, error } = await admin
    .from("memberships")
    .select("role, account_status, tenant_id")
    .eq("user_id", userId)
    .eq("tenant_id", caller.tenantId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "User not found");
  return data;
}

// Ids of every login in the caller's tenant, with their profile.
async function tenantProfiles(caller) {
  const { data, error } = await admin
    .from("memberships")
    .select("user_id, role, account_status")
    .eq("tenant_id", caller.tenantId);
  if (error) throw error;
  return new Map(data.map((p) => [p.user_id, p]));
}

// ADMIN may manage accounts of any role; someone with invite-people only those of a role with less access than
// their own (HR: STAFF, as before). The database decides (can_assign_role(), 20261015300000), the same rule the
// invitations follow; it also refuses a role the company does not have.
async function assertCanManageRole(caller, role) {
  const { data, error } = await admin.rpc("can_assign_role", { p_user: caller.id, p_tenant: caller.tenantId, p_role: role });
  if (error) throw new HttpError(500, "Could not verify the role");
  if (data !== true) {
    throw new HttpError(403, caller.role === "ADMIN" ? "This company has no such role" : "You can only manage accounts of roles with less access than your own");
  }
}

function validateFields({ email, role, account_status, password }, { requireAll }) {
  if (email !== undefined && !EMAIL_RE.test(email)) throw new HttpError(400, "A valid email is required");
  if (role !== undefined && !(typeof role === "string" && ROLE_KEY_RE.test(role))) throw new HttpError(400, "role must be a role key of this company");
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
  guard(ADMIN_ONLY, async (_req, res, caller) => {
    const [users, byId] = await Promise.all([listAllAuthUsers(), tenantProfiles(caller)]);
    res.json({ users: users.filter((u) => byId.has(u.id)).map((u) => toUserView(u, byId.get(u.id))) });
  })
);

// GET /api/admin/auth-users - slim id/email/metadata list for sign-up matching (ADMIN, invite-people)
router.get(
  "/auth-users",
  guard(INVITE_MODULE, async (_req, res, caller) => {
    const [users, byId] = await Promise.all([listAllAuthUsers(), tenantProfiles(caller)]);
    res.json({
      users: users.filter((u) => byId.has(u.id)).map((u) => ({ id: u.id, email: u.email, user_metadata: u.user_metadata })),
    });
  })
);

// POST /api/admin/users - create a login (ADMIN any role, invite-people roles with less access than theirs)
router.post(
  "/users",
  guard(INVITE_MODULE, async (req, res, caller) => {
    const { password, role, account_status = "ACTIVE", location, branch } = req.body || {};
    const email = normalizeEmail(req.body?.email);
    validateFields({ email, role, account_status, password }, { requireAll: true });
    await assertCanManageRole(caller, role);

    const user_metadata = {
      role,
      account_status,
      ...(usesLocation(role) && location ? { location } : {}),
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
      await syncProfile(data.user.id, role, account_status, caller.tenantId);
    } catch (profileErr) {
      // Don't leave a login that can never pass the role check.
      await admin.auth.admin.deleteUser(data.user.id);
      throw profileErr;
    }
    res.status(201).json({ user: toUserView(data.user, { role, account_status }) });
  })
);

// PATCH /api/admin/users/:id - change email/role/status/location/branch/password (ADMIN, invite-people for roles
// with less access than theirs)
router.patch(
  "/users/:id",
  guard(INVITE_MODULE, async (req, res, caller) => {
    const { id } = req.params;
    const { password, role, account_status, location, branch } = req.body || {};
    const email = req.body?.email === undefined ? undefined : normalizeEmail(req.body.email);
    validateFields({ email, role, account_status, password }, { requireAll: false });

    const currentProfile = await loadTenantProfile(id, caller);
    const { data: existing, error: getError } = await admin.auth.admin.getUserById(id);
    if (getError || !existing?.user) throw new HttpError(404, "User not found");
    const current = existing.user;

    const currentRole = currentProfile?.role || current.user_metadata?.role || "STAFF";
    const nextRole = role ?? currentRole;
    if (id === caller.id && ((role && role !== currentRole) || (account_status && account_status !== "ACTIVE"))) {
      throw new HttpError(400, "You cannot change your own role or deactivate your own account");
    }
    // the account they manage, and the role it ends up with, must both be within their reach (a role that was
    // deleted cannot be given again)
    await assertCanManageRole(caller, currentRole);
    if (nextRole !== currentRole) await assertCanManageRole(caller, nextRole);

    const nextStatus = account_status ?? currentProfile?.account_status ?? current.user_metadata?.account_status ?? "ACTIVE";
    const user_metadata = {
      ...current.user_metadata,
      role: nextRole,
      account_status: nextStatus,
      updated_at: new Date().toISOString(),
    };
    if (role !== undefined || location !== undefined) {
      if (usesLocation(nextRole)) {
        if (location !== undefined) user_metadata.location = location || null;
      } else {
        user_metadata.location = null;
      }
    }
    if (branch !== undefined) user_metadata.branch = branch || null;

    if ((email !== undefined || password !== undefined) && (await belongsToOtherCompany(id, caller.tenantId))) {
      throw new HttpError(409, "This person also belongs to another company, so their email and password can only be changed by themselves (use Forgot password).");
    }

    const update = { user_metadata };
    if (email !== undefined) update.email = email;
    if (password !== undefined) update.password = password;
    // A ban applies to the whole login, so only ban when this was their last active company.
    if (account_status !== undefined) {
      const keepsLoginElsewhere = account_status !== "ACTIVE" && (await hasOtherActiveMembership(id, caller.tenantId));
      update.ban_duration = keepsLoginElsewhere ? "none" : banDuration(account_status);
    }

    const { data, error } = await admin.auth.admin.updateUserById(id, update);
    if (error) throw new HttpError(error.status === 422 ? 409 : 400, error.message);
    await syncProfile(id, nextRole, nextStatus, caller.tenantId);
    res.json({ user: toUserView(data.user, { role: nextRole, account_status: nextStatus }) });
  })
);

// DELETE /api/admin/users/:id (ADMIN)
router.delete(
  "/users/:id",
  guard(ADMIN_ONLY, async (req, res, caller) => {
    if (req.params.id === caller.id) throw new HttpError(400, "You cannot delete your own account");
    await loadTenantProfile(req.params.id, caller);
    // Leave this company; the login itself goes only when it belongs to no other company.
    const { error: leaveError } = await admin.from("memberships").delete().eq("user_id", req.params.id).eq("tenant_id", caller.tenantId);
    if (leaveError) throw leaveError;
    const { data: remaining, error: remainingError } = await admin.from("memberships").select("tenant_id").eq("user_id", req.params.id);
    if (remainingError) throw remainingError;
    if (remaining.length === 0) {
      const { error } = await admin.auth.admin.deleteUser(req.params.id);
      if (error) throw new HttpError(error.status === 404 ? 404 : 400, error.message);
      await admin.from("user_profiles").delete().eq("user_id", req.params.id);
    }
    res.json({ ok: true });
  })
);

// POST /api/admin/users/:id/reset-email - send the user a password reset email (ADMIN)
router.post(
  "/users/:id/reset-email",
  guard(ADMIN_ONLY, async (req, res, caller) => {
    await loadTenantProfile(req.params.id, caller);
    const { data, error } = await admin.auth.admin.getUserById(req.params.id);
    if (error || !data?.user?.email) throw new HttpError(404, "User not found");
    const redirectTo = typeof req.body?.redirectTo === "string" ? req.body.redirectTo : undefined;
    const { error: resetError } = await admin.auth.resetPasswordForEmail(data.user.email, redirectTo ? { redirectTo } : undefined);
    if (resetError) throw new HttpError(400, resetError.message);
    res.json({ ok: true });
  })
);

// Shared with sms_routes.js so every service-role route checks the caller the same way.
export { authenticate, HttpError, admin };

export default router;
