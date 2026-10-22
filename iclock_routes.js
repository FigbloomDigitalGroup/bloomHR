// iclock_routes.js: door scanners (ZKTeco fingerprint terminals) send attendance here by themselves, with ZKTeco's push
// protocol ("ADMS" / "iclock"). No sign-in: a scanner is known by its serial number, which HR registers in Attendance >
// Scanners (migration 20261023600000_attendance_scanners.sql).
//
//   GET  /iclock/cdata?SN=...&options=all   hello: the settings the scanner should use (handshakeText)
//   POST /iclock/cdata?SN=...&table=ATTLOG  punches, one per line: "PIN<tab>YYYY-MM-DD HH:MM:SS<tab>status<tab>verify..."
//                                           -> "OK: <lines>"; other tables (OPERLOG, ATTPHOTO, USERINFO...) -> "OK"
//   GET  /iclock/getrequest?SN=...          the check-in every few seconds, asking for commands -> "OK" (we send none)
//   POST /iclock/devicecmd?SN=...           a command's result -> "OK"
// (some firmware adds .aspx to these; anything else under /iclock -> "OK")
//
// The database decides what is kept: attendance_scanner_seen records a check-in, attendance_scanner_receive stores and
// applies punches. An unregistered or switched-off scanner, or one calling from outside its IP lock, is answered "OK"
// all the same (so it doesn't retry every few seconds) and nothing it sends is kept. Answers are plain text and short.
//
// Where the scanner is calling from: older scanners only speak plain HTTP, so they call an AWS CloudFront relay that
// passes the request on over HTTPS with the header x-figbloom-relay = ICLOCK_RELAY_SECRET, and the scanner's own address
// in cloudfront-viewer-address. That header is believed only with the secret; otherwise the address is Vercel's
// x-real-ip (or the first x-forwarded-for).
import express from "express";
import crypto from "node:crypto";
import { admin } from "./admin_routes.js";

const router = express.Router();

// a scanner's body is text whatever content type it claims (often none, or an odd one): read it raw and decode it here
router.use(express.raw({ type: () => true, limit: "5mb" }));

/** The settings a scanner gets in answer to its hello (the push protocol's "GET OPTION FROM"). */
export function handshakeText(serial) {
  return [
    `GET OPTION FROM: ${serial}`,
    // send every punch it holds (the database ignores ones it already has and ones before attendance counts)
    "ATTLOGStamp=None",
    // don't send the operation log or photos
    "OPERLOGStamp=9999",
    "ATTPHOTOStamp=None",
    // after an error, try again in 30 seconds; check in for commands every 30 (punches go at once, Realtime below)
    "ErrorDelay=30",
    "Delay=30",
    "TransTimes=00:00;14:05",
    "TransInterval=1",
    // only attendance punches
    "TransFlag=TransData AttLog",
    // East Africa Time (UTC+3)
    "TimeZone=3",
    // send each punch as it happens
    "Realtime=1",
    "Encrypt=None",
  ].join("\n");
}

/** The scanner's serial number from the query (SN), trimmed and in capitals; null when it doesn't look like one. */
export function readSerial(query) {
  const raw = query?.SN ?? query?.sn ?? query?.Sn;
  const value = String(Array.isArray(raw) ? raw[0] : raw ?? "").trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(value) ? value : null;
}

/** How many non-empty lines a body has (what the scanner is told was received). */
export function countLines(text) {
  return String(text || "")
    .split("\n")
    .filter((l) => l.trim() !== "").length;
}

const first = (value) => String(Array.isArray(value) ? value[0] : value ?? "").split(",")[0].trim();

/** "198.51.100.10:46532", "2001:db8::1:46532" or "[2001:db8::1]:46532" -> the address without the port. */
export function stripPort(value) {
  const v = first(value);
  if (!v) return "";
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(v);
  if (bracketed) return bracketed[1];
  const at = v.lastIndexOf(":");
  return at > 0 && /^\d+$/.test(v.slice(at + 1)) ? v.slice(0, at) : v;
}

/** Is `given` the relay's secret? Compared in constant time; never true when no secret is set. */
export function relaySecretMatches(given, secret = process.env.ICLOCK_RELAY_SECRET) {
  if (!secret || typeof given !== "string" || !given) return false;
  const digest = (s) => crypto.createHash("sha256").update(s, "utf8").digest();
  return crypto.timingSafeEqual(digest(given), digest(secret));
}

/** The scanner's own public address (see the top of this file). */
export function clientIp(req, secret = process.env.ICLOCK_RELAY_SECRET) {
  const h = req.headers || {};
  if (relaySecretMatches(first(h["x-figbloom-relay"]), secret)) {
    const viewer = stripPort(h["cloudfront-viewer-address"]);
    if (viewer) return viewer;
  }
  return first(h["x-real-ip"]) || first(h["x-forwarded-for"]) || req.socket?.remoteAddress || "";
}

const reply = (res, text, status = 200) => res.status(status).type("text/plain").send(text);
const bodyText = (req) => (Buffer.isBuffer(req.body) ? req.body.toString("utf8") : typeof req.body === "string" ? req.body : "");

/** Calls one of the receiver's database functions; null (logged, without what the scanner sent) when it fails. */
async function call(fn, args) {
  if (!admin) {
    console.error(`[iclock] ${fn}: the server is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)`);
    return null;
  }
  try {
    const { data, error } = await admin.rpc(fn, args);
    if (error) throw error;
    return data ?? {};
  } catch (err) {
    console.error(`[iclock] ${fn} failed:`, err?.message || err);
    return null;
  }
}

// hello: the settings, for a registered scanner
router.get(/^\/cdata(\.aspx)?$/i, async (req, res) => {
  const serial = readSerial(req.query);
  if (!serial) return reply(res, "OK");
  const seen = await call("attendance_scanner_seen", { p_serial: serial, p_ip: clientIp(req) });
  return reply(res, seen?.accepted ? handshakeText(serial) : "OK");
});

// uploads: punches are kept, everything else is acknowledged and dropped
router.post(/^\/cdata(\.aspx)?$/i, async (req, res) => {
  const serial = readSerial(req.query);
  const table = String(req.query.table || "").toUpperCase();
  if (!serial || table !== "ATTLOG") return reply(res, "OK");
  const lines = bodyText(req);
  const result = await call("attendance_scanner_receive", { p_serial: serial, p_ip: clientIp(req), p_lines: lines });
  // the database didn't answer: not "OK", so the scanner keeps the punches and sends them again
  if (!result) return reply(res, "ERROR", 503);
  return reply(res, result.accepted ? `OK: ${countLines(lines)}` : "OK");
});

// the check-in, asking for commands: none
router.get(/^\/getrequest(\.aspx)?$/i, async (req, res) => {
  const serial = readSerial(req.query);
  if (serial) await call("attendance_scanner_seen", { p_serial: serial, p_ip: clientIp(req) });
  return reply(res, "OK");
});

router.all("*", (_req, res) => reply(res, "OK"));

export default router;
