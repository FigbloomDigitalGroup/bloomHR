// attendance_routes.js - the staff portal's Clock in / Clock out, through the server (FIG-1200).
//
// A company can allow app clock-ins only from its office network (migration 20261024100000_attendance_clock_in_policy).
// The browser talks to Supabase directly, so the database never sees the person's IP address, and an address the
// browser sends could be anything. So the app clocks in here instead:
//
//   POST /api/attendance/clock   { action: 'in' | 'out', location?: { latitude, longitude, accuracy } }
//     -> 200 today's attendance (what attendance_today() returns)
//     -> 403 { error, reason: 'clock_policy' } when the company's rule says no ("Clock in at the office scanner")
//
// The person's sign-in token is verified with Supabase Auth (authenticate), and the address is the one the request
// came from as the platform's edge saw it (clientIp below), never anything in the body. attendance_clock_for_user
// (service_role only) then applies the same rule the browser's own attendance_clock_in does, with that address.
import express from "express";
import { authenticate, HttpError, admin } from "./admin_routes.js";

const router = express.Router();

const first = (value) => String(Array.isArray(value) ? value[0] : value ?? "").split(",")[0].trim();

/** "::ffff:41.90.12.7" -> "41.90.12.7"; anything else as it is. */
export const plainIp = (ip) => String(ip || "").trim().replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, "$1");

/**
 * The address the request came from. On Vercel (process.env.VERCEL) the edge sets x-real-ip and x-forwarded-for
 * itself, overwriting whatever the caller sent, so they can be believed; anywhere else (a local server) they are just
 * headers anyone can send, so only the connection's own address counts. ATTENDANCE_TRUST_PROXY=1 believes them behind
 * another proxy that overwrites them in the same way.
 */
export function clientIp(req, env = process.env) {
  const h = req.headers || {};
  const behindProxy = !!env.VERCEL || env.ATTENDANCE_TRUST_PROXY === "1";
  const fromProxy = behindProxy ? first(h["x-real-ip"]) || first(h["x-forwarded-for"]) : "";
  return plainIp(fromProxy || req.socket?.remoteAddress || "") || null;
}

/** The location the browser gave, as the database keeps it, or null: numbers only, nothing else. */
export function cleanLocation(loc) {
  if (!loc || typeof loc !== "object") return null;
  const lat = Number(loc.latitude);
  const lon = Number(loc.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const out = { latitude: lat, longitude: lon };
  const acc = Number(loc.accuracy);
  if (Number.isFinite(acc) && acc >= 0) out.accuracy = Math.round(acc);
  return out;
}

/** The reason the person gave for clocking via the web; null when absent or blank. */
export function cleanReason(reason) {
  if (typeof reason !== "string") return null;
  const s = reason.trim().slice(0, 300);
  return s.length > 0 ? s : null;
}

router.post("/clock", async (req, res) => {
  try {
    if (!admin) throw new HttpError(503, "Clocking in through the server is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
    const action = req.body?.action;
    if (action !== "in" && action !== "out") throw new HttpError(400, "Say whether to clock in or out");
    const caller = await authenticate(req);
    const { data, error } = await admin.rpc("attendance_clock_for_user", {
      p_user: caller.id,
      p_kind: action,
      p_location: cleanLocation(req.body?.location),
      p_ip: clientIp(req),
      p_reason: cleanReason(req.body?.reason),
    });
    if (error) {
      if (error.hint === "clock_policy") return res.status(403).json({ error: error.message, reason: "clock_policy" });
      // the database's own refusals (not linked to an employee, not clocked in yet) are the person's to read
      if (["42501", "P0001", "22023"].includes(error.code)) return res.status(409).json({ error: error.message });
      throw error;
    }
    return res.json(data ?? {});
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error("[attendance]", err?.message || err);
    return res.status(status).json({ error: err instanceof HttpError ? err.message : "Could not record the clock-in" });
  }
});

export default router;
