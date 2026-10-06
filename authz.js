// authz.js - permission and rate-limit helpers shared by the backend routes that need the signed-in caller
// (sms_routes.js, email_routes.js). admin_routes.js verifies who is calling; this decides what they may do.
import { admin, HttpError } from "./admin_routes.js";

/**
 * Does the caller's role include one of these modules (the same permissions the app uses to show or hide screens,
 * edited under Role & Permissions)? ADMIN always does. Scoped to the caller's own tenant.
 */
export async function callerHasModule(caller, modules) {
  if (caller.role === "ADMIN") return true;
  const { data, error } = await admin
    .from("role_permissions")
    .select("permissions")
    .eq("tenant_id", caller.tenantId)
    .eq("role_name", caller.role)
    .maybeSingle();
  if (error) throw new HttpError(500, "Could not verify permissions");
  const granted = Array.isArray(data?.permissions) ? data.permissions : [];
  return modules.some((m) => granted.includes(m));
}

/**
 * A per-user budget over a sliding window, so a stolen session cannot be used to drain an account.
 * In-memory: fine for one server process; move to a shared store if this is ever scaled out.
 *
 * `spent` is keyed by `${kind}:${userId}`; `limits` maps a kind to { limit, windowMs } and must include "default".
 */
export function createBudget(limits) {
  const spent = new Map();
  return (userId, kind, cost, now = Date.now()) => {
    const { limit, windowMs } = limits[kind] || limits.default;
    const key = `${kind}:${userId}`;
    const recent = (spent.get(key) || []).filter((e) => now - e.at < windowMs);
    const used = recent.reduce((n, e) => n + e.cost, 0);
    if (used + cost > limit) {
      spent.set(key, recent);
      return false;
    }
    recent.push({ at: now, cost });
    spent.set(key, recent);
    return true;
  };
}
