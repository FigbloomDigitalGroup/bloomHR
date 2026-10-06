// sms_routes.js - sends SMS and reads the balance through Celcom Africa.
//
// The Celcom key lives only here (server side). The browser calls these endpoints with its own session
// token; the caller is verified exactly like the admin API (admin_routes.js) and then checked against the
// same module permissions the app uses to show or hide screens (role_permissions, ADMIN always allowed).
//
//   POST /api/sms/send     { purpose, messages: [{ phone, message }], senderId? }
//   GET  /api/sms/balance
import express from "express";
import dotenv from "dotenv";
import { authenticate, HttpError, admin } from "./admin_routes.js";
import { callerHasModule, createBudget } from "./authz.js";

dotenv.config({ path: process.env.ENV_FILE || ".env" });

const router = express.Router();

const CELCOM_SEND_URL = "https://isms.celcomafrica.com/api/services/sendsms/";
const CELCOM_BALANCE_URL = "https://isms.celcomafrica.com/api/services/getbalance/";

const MAX_BATCH = 1000; // recipients in one request
const MAX_MESSAGE_LENGTH = 612; // 4 x 153: four parts of a long GSM-7 message
const SEND_CONCURRENCY = 8;
const CELCOM_TIMEOUT_MS = 15000;

// What each kind of send needs. 'mfa' is special: it may only go to the caller's own registered number.
const PURPOSES = {
  "sms-center": { modules: ["sms"] },
  "salary-advance": { modules: ["salaryadmin"] },
  birthday: { modules: ["sms", "hr-lifecycle"] },
  mfa: { modules: null },
};

// Per-user budgets (in recipients) so a stolen session cannot be used to drain the account.
const takeBudget = createBudget({
  default: { limit: 3000, windowMs: 60 * 60 * 1000 },
  mfa: { limit: 5, windowMs: 10 * 60 * 1000 },
});

// 07XXXXXXXX / 7XXXXXXXX / +254... / 254... -> 2547XXXXXXXX (12 digits), or '' when it is not a Kenyan mobile.
export const formatPhone = (phone) => {
  let cleaned = String(phone ?? "").replace(/\D/g, "");
  if (cleaned.startsWith("0") && cleaned.length === 10) cleaned = `254${cleaned.slice(1)}`;
  else if (cleaned.length === 9 && /^[17]/.test(cleaned)) cleaned = `254${cleaned}`;
  return /^254[17]\d{8}$/.test(cleaned) ? cleaned : "";
};

const config = () => ({
  apiKey: process.env.CELCOM_API_KEY || "",
  partnerId: process.env.CELCOM_PARTNER_ID || "",
  shortcode: process.env.CELCOM_SHORTCODE || "",
});

// Celcom's reply format is not documented in one place; accept the shapes it is known to use and treat an
// unreadable body on an HTTP 200 as "accepted but not confirmed" rather than guessing failure.
export const interpretCelcomResponse = (httpOk, body) => {
  const first = Array.isArray(body?.responses) ? body.responses[0] : body;
  const code = first?.["response-code"] ?? first?.responseCode ?? first?.code;
  if (code !== undefined && code !== null && code !== "") {
    const ok = Number(code) === 200;
    return {
      success: ok,
      confirmed: true,
      messageId: first?.messageid ?? first?.messageId ?? undefined,
      error: ok ? undefined : String(first?.["response-description"] ?? first?.description ?? `Provider error ${code}`),
    };
  }
  return httpOk
    ? { success: true, confirmed: false }
    : { success: false, confirmed: true, error: "SMS provider rejected the request" };
};

const withTimeout = async (url, init) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CELCOM_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
};

async function sendOne({ apiKey, partnerId }, shortcode, mobile, message) {
  const query = new URLSearchParams({ apikey: apiKey, partnerID: partnerId, message, shortcode, mobile });
  try {
    const res = await withTimeout(`${CELCOM_SEND_URL}?${query.toString()}`, { method: "GET" });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return interpretCelcomResponse(res.ok, body);
  } catch (err) {
    return { success: false, confirmed: true, error: err?.name === "AbortError" ? "SMS provider timed out" : "Could not reach the SMS provider" };
  }
}

const handler = (fn) => async (req, res) => {
  try {
    if (!admin) throw new HttpError(500, "SMS API is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
    const caller = await authenticate(req);
    await fn(req, res, caller);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : err.status && err.status < 500 ? err.status : 500;
    if (status >= 500) console.error("[sms]", err);
    res.status(status).json({ error: err.message || "Request failed" });
  }
};

router.post(
  "/send",
  handler(async (req, res, caller) => {
    const purpose = String(req.body?.purpose || "sms-center");
    const rule = PURPOSES[purpose];
    if (!rule) throw new HttpError(400, "Unknown SMS purpose");

    const messages = req.body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) throw new HttpError(400, "messages must be a non-empty list");
    if (messages.length > MAX_BATCH) throw new HttpError(400, `At most ${MAX_BATCH} messages per request`);
    for (const m of messages) {
      const text = typeof m?.message === "string" ? m.message.trim() : "";
      if (!text) throw new HttpError(400, "Message cannot be empty");
      if (text.length > MAX_MESSAGE_LENGTH) throw new HttpError(400, `Message is longer than ${MAX_MESSAGE_LENGTH} characters`);
    }

    if (purpose === "mfa") {
      // Login codes go to the caller's own registered number and nowhere else.
      if (messages.length !== 1) throw new HttpError(400, "One MFA message at a time");
      const { data, error } = await admin.from("mfa_numbers").select("phone_number").eq("email", caller.email).maybeSingle();
      if (error) throw new HttpError(500, "Could not verify MFA number");
      const registered = formatPhone(data?.phone_number);
      if (!registered || formatPhone(messages[0].phone) !== registered) {
        throw new HttpError(403, "MFA codes can only be sent to your registered number");
      }
    } else if (!(await callerHasModule(caller, rule.modules))) {
      throw new HttpError(403, "Forbidden");
    }

    // checked after permissions so a caller without access learns nothing about the server's setup
    const cfg = config();
    if (!cfg.apiKey || !cfg.partnerId) throw new HttpError(503, "SMS service is not configured on the server");

    if (!takeBudget(caller.id, purpose === "mfa" ? "mfa" : "default", messages.length)) {
      throw new HttpError(429, "SMS limit reached for now. Try again later.");
    }

    const requestedSender = typeof req.body?.senderId === "string" ? req.body.senderId.trim() : "";
    const shortcode = /^[A-Za-z0-9]{3,11}$/.test(requestedSender) ? requestedSender : cfg.shortcode;

    // Send with a small pool so a big batch does not open hundreds of connections at once.
    const results = new Array(messages.length);
    let next = 0;
    const worker = async () => {
      while (next < messages.length) {
        const i = next++;
        const phone = formatPhone(messages[i].phone);
        if (!phone) {
          results[i] = { phone: String(messages[i].phone ?? ""), success: false, confirmed: true, error: "Invalid phone number" };
          continue;
        }
        const out = await sendOne(cfg, shortcode, phone, messages[i].message.trim());
        results[i] = { phone, ...out };
      }
    };
    await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, messages.length) }, worker));

    res.json({ results, sent: results.filter((r) => r.success).length, failed: results.filter((r) => !r.success).length });
  })
);

router.get(
  "/balance",
  handler(async (_req, res, caller) => {
    if (!(await callerHasModule(caller, ["sms", "salaryadmin"]))) throw new HttpError(403, "Forbidden");
    const cfg = config();
    if (!cfg.apiKey || !cfg.partnerId) throw new HttpError(503, "SMS service is not configured on the server");

    let body = null;
    try {
      const r = await withTimeout(CELCOM_BALANCE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apikey: cfg.apiKey, partnerID: cfg.partnerId }),
      });
      body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch (err) {
      console.error("[sms] balance lookup failed:", err?.message);
      throw new HttpError(502, "Could not read the balance from the SMS provider");
    }

    // The balance field name is not documented; look for the usual ones.
    const find = (obj) => {
      if (!obj || typeof obj !== "object") return null;
      for (const [k, v] of Object.entries(obj)) {
        if (/^(credit|credits|balance|sms_?balance|available)$/i.test(k) && v !== null && v !== "" && !Number.isNaN(Number(v))) return Number(v);
        if (v && typeof v === "object") {
          const inner = find(v);
          if (inner !== null) return inner;
        }
      }
      return null;
    };
    res.json({ balance: find(body) });
  })
);

export default router;
