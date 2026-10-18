// authz.js - permission and rate-limit helpers shared by the backend routes that need the signed-in caller
// (sms_routes.js, email_routes.js). admin_routes.js verifies who is calling; this decides what they may do.
import { admin, callerModules } from "./admin_routes.js";

/**
 * Does the caller's role include one of these modules (the same permissions the app uses to show or hide screens,
 * edited under Role & Permissions)? ADMIN always does. A company's own role (FIG-827) gives its own modules.
 * Scoped to the caller's own tenant.
 */
export async function callerHasModule(caller, modules) {
  if (caller.role === "ADMIN") return true;
  const granted = await callerModules(caller);
  return modules.some((m) => granted.includes(m));
}

/**
 * A budget over a sliding window counted in the database (take_rate_limit(), migration 20261014500100), so every
 * server instance shares one count: on Vercel each instance has its own memory, so an in-memory count let a caller
 * use the budget once per running instance (FIG-820).
 *
 * `name` keeps budgets apart (e.g. "ai"); `limits` maps a kind to { limit, windowMs } and must include "default".
 * The returned function takes (caller, kind, cost, key = caller.id) and resolves true if the cost fits, using it up.
 * The count is per company (caller.tenantId) and key, so a company-wide budget passes a fixed key such as "company".
 * If the database cannot be asked (e.g. the migration is not applied yet) it falls back to this instance's own count,
 * so the limit still holds per instance rather than not at all.
 */
export function createSharedBudget(name, limits) {
  const fallback = createBudget(limits);
  return async (caller, kind, cost, key = caller.id) => {
    const { limit, windowMs } = limits[kind] || limits.default;
    try {
      const { data, error } = await admin.rpc("take_rate_limit", {
        p_tenant: caller.tenantId,
        p_bucket: `${name}:${kind}:${key}`,
        p_cost: cost,
        p_limit: limit,
        p_window_seconds: Math.ceil(windowMs / 1000),
      });
      if (error) throw error;
      return data === true;
    } catch (err) {
      console.error(`[authz] shared rate limit "${name}" unavailable, counting on this server only:`, err?.message || err);
      return fallback(`${caller.tenantId}:${key}`, kind, cost);
    }
  };
}

/**
 * A per-user budget over a sliding window, so a stolen session cannot be used to drain an account.
 * In-memory: one count per server process (see createSharedBudget for one shared by all of them).
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
