// platform_events_routes.js: events between bloomHR and the other Figbloom products, relayed by the Figbloom platform
// (ERP/SCHOOLS_HR_PHASE1_CONTRACT.md, section 2).
//
//   platform --(signed POST)--> /api/platform/events          what other products (and the platform) tell HR
//   pg_cron  --(x-cron-secret)--> /api/platform/outbox/flush   HR's own events (platform_event_outbox) --> POST /events
//
// Receiving: the body is verified against x-figbloom-signature ("sha256=<hex HMAC-SHA256 of '<timestamp>.<raw body>'>",
// secret PLATFORM_WEBHOOK_SECRET) and x-figbloom-timestamp (within 5 minutes), in constant time. A delivery already
// applied (x-figbloom-delivery, kept in platform_event_receipts) is answered 200 and not applied again. The answer is
// 2xx only once the event is applied; the platform retries 5xx, 408, 425 and 429, and treats any other 4xx as
// rejected (an alarm). Events:
//   platform.module.enabled (module hr)   the customer's HR company (platform_enable_hr()), its admins invited, then
//                                         PUT /tenants/{id}/links/hr. A repeat re-links and re-sends nothing. The
//                                         product it came from (enabledSource()) picks its leave chain.
//   <product>.staff.created / .updated    the person's draft employee (platform_upsert_staff()), for each product in
//                                         STAFF_SOURCES: schools (Figbloom Schools), fleet (Figbloom Fleet,
//                                         ERP/FLEET_HR_CONTRACT.md), mapped in external_people with that source
//   <product>.staff.left                  HR's exit for them (platform_staff_left())
//   anything else                         200, ignored
// A staff event for a customer with no HR company yet is a 425, so the platform tries again later.
//
// Sending: hr.employee.left and hr.leave.*, queued by the database for a mapped employee (data.source: the product the
// person came from), are sent as POST /events with this company as tenant_local_id, retried with backoff
// (finish_platform_event()). The platform delivers them to the subscribing product linked to the same customer.
//
// Settings (server only):
//   PLATFORM_EVENTS_ENABLED        "true" to apply events and send HR's; otherwise both answer 503 (nothing is lost:
//                                  the platform and the outbox retry later)
//   PLATFORM_WEBHOOK_SECRET        the "hr" receiver's signing secret (figbloom/platform/webhook/hr)
//   PLATFORM_CLIENT_ID / PLATFORM_CLIENT_SECRET
//                                  the "hr" service client (scope platform/tenants.write); with PLATFORM_API_URL and
//                                  PLATFORM_TOKEN_URL, as the console's
//   PLATFORM_OUTBOX_CRON_SECRET    what pg_cron sends in x-cron-secret (Vault platform_outbox_cron_secret)
// People are never matched by email: only by the other product's id for them (external_people).
import express from "express";
import crypto from "node:crypto";
import { admin } from "./admin_routes.js";
import { PlatformError, createPlatformClient } from "./platform_client.js";

export const TOLERANCE_SECONDS = 5 * 60;
export const HR_SCOPE = "platform/tenants.write";
const OUTBOX_BATCH = 10;
const SEND_TIMEOUT_MS = 5 * 1000;
const TAG = "[platform/events]";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// login addresses Schools makes up for staff who sign in with a login ID: never a real mailbox
const SYNTHETIC_EMAIL_RE = /@([a-z0-9-]+\.)*(figbloom\.internal|invalid|local|localhost|example\.(com|org|net))$/i;

// the products whose staff become HR employees (external_people.source = the product id)
export const STAFF_SOURCES = ["schools", "fleet"];
export const PRODUCT_NAMES = { schools: "Figbloom Schools", fleet: "Figbloom Fleet" };
const STAFF_EVENTS = new Set(STAFF_SOURCES.flatMap((p) => [`${p}.staff.created`, `${p}.staff.updated`, `${p}.staff.left`]));

const on = (value) => /^(1|true|yes|on)$/i.test(String(value || "").trim());
export const eventsEnabled = () => on(process.env.PLATFORM_EVENTS_ENABLED);

// ---- HR's own client on the platform: the "hr" service client
export const hrClient = createPlatformClient({
  clientIdEnv: "PLATFORM_CLIENT_ID",
  clientSecretEnv: "PLATFORM_CLIENT_SECRET",
  scope: HR_SCOPE,
  tag: TAG,
  who: "Figbloom HR",
  notConnected: "Figbloom HR isn't connected to the Figbloom platform yet.",
});

// ---- signatures

/** "sha256=<hex>" over "<timestamp>.<raw body>", as the platform signs (its webhooks.ts sign()). */
export function signBody(secret, timestamp, rawBody) {
  return `sha256=${crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
}

/**
 * Whether a delivery is genuine: the signature matches the raw body and timestamp under the secret (compared in
 * constant time) and the timestamp (Unix seconds) is within TOLERANCE_SECONDS of now, so a captured request can't be
 * replayed later.
 */
export function verifySignature({ secret, rawBody, signature, timestamp, nowMs = Date.now(), toleranceSeconds = TOLERANCE_SECONDS }) {
  if (!secret || typeof signature !== "string" || typeof timestamp !== "string") return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > toleranceSeconds) return false;
  const expected = Buffer.from(signBody(secret, timestamp, rawBody));
  const given = Buffer.from(signature);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/** The same secret, in constant time (hashed first, so the lengths always match). */
function sameSecret(given, expected) {
  if (!expected || typeof given !== "string" || !given) return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

// ---- Schools staff -> an employee

/** A real email address, or null for none, a malformed one, or a login address Schools made up. */
export function realEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email) || SYNTHETIC_EMAIL_RE.test(email)) return null;
  return email;
}

/**
 * What a schools.staff.* event's data becomes on the employee: the full name split into first, middle and last (one
 * word: a first name only), the phone without spaces, the work email only if real, and the job title (Schools'
 * staff title or role label, else the role in words).
 */
export function staffToEmployee(data) {
  const words = String(data?.full_name ?? "").trim().split(/\s+/).filter(Boolean);
  const first = words[0] ?? null;
  const last = words.length > 1 ? words[words.length - 1] : null;
  const middle = words.length > 2 ? words.slice(1, -1).join(" ") : null;
  const phone = typeof data?.phone === "string" && data.phone.trim() ? data.phone.replace(/[\s()-]/g, "") : null;
  const role = typeof data?.role === "string" ? data.role.trim() : "";
  const title = typeof data?.job_title === "string" && data.job_title.trim()
    ? data.job_title.trim()
    : role ? role.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : null;
  return { first, middle, last, phone, email: realEmail(data?.email), job_title: title ? title.slice(0, 120) : null };
}

// ---- the database (service role), behind a small interface so the routes can be tested without one

export class EventError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const one = (data) => (Array.isArray(data) ? data[0] ?? null : data ?? null);

function rpcError(fn, error) {
  // P0002: the platform tenant has no HR company (yet)
  if (error?.code === "P0002") return new EventError(425, "no_hr_company", "There is no HR company for this customer yet.");
  const err = new Error(`${fn}: ${error?.message || "failed"}`);
  err.code = error?.code;
  return err;
}

export function supabaseStore(db = admin) {
  const client = () => {
    if (!db) throw new Error("Admin API is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
    return db;
  };
  const rpc = async (fn, args) => {
    const { data, error } = await client().rpc(fn, args);
    if (error) throw rpcError(fn, error);
    return data;
  };
  return {
    async getReceipt(deliveryId) {
      const { data, error } = await client().from("platform_event_receipts").select("delivery_id, result").eq("delivery_id", deliveryId).maybeSingle();
      if (error) throw new Error(`platform_event_receipts: ${error.message}`);
      return data ?? null;
    },
    async saveReceipt(receipt) {
      const { error } = await client().from("platform_event_receipts").upsert(receipt, { onConflict: "delivery_id", ignoreDuplicates: true });
      if (error) throw new Error(`platform_event_receipts: ${error.message}`);
    },
    enableHr: async ({ platformTenantId, name, slug, admins, source = "schools" }) =>
      one(await rpc("platform_enable_hr", { p_platform_tenant: platformTenantId, p_name: name, p_slug: slug, p_admins: admins, p_source: source })),
    upsertStaff: async ({ platformTenantId, source = "schools", person, first, middle, last, phone, email, jobTitle }) =>
      one(
        await rpc("platform_upsert_staff", {
          p_platform_tenant: platformTenantId, p_source: source, p_person: person, p_first: first, p_middle: middle,
          p_last: last, p_phone: phone, p_email: email, p_job_title: jobTitle,
        })
      ),
    staffLeft: async ({ platformTenantId, source = "schools", person, leftOn }) =>
      one(await rpc("platform_staff_left", { p_platform_tenant: platformTenantId, p_source: source, p_person: person, p_left_on: leftOn })),
    claimEvents: async (limit) => (await rpc("claim_platform_events", { p_limit: limit })) ?? [],
    finishEvent: async (id, ok, error = null, retry = true) =>
      rpc("finish_platform_event", { p_id: id, p_ok: ok, p_error: error, p_retry: retry }),
  };
}

// ---- applying an event

const bad = (message) => new EventError(400, "invalid_event", message);

function personId(data) {
  const id = data?.person_id;
  if (typeof id !== "string" || !id.trim() || id.length > 200) throw bad("data.person_id is missing");
  return id.trim();
}

/**
 * Which product a platform.module.enabled is for: data.source / data.product when the platform names one, else
 * "fleet" when the console named Fleet's people (admin roles fleet_*), else "schools" (as before Fleet). HR corrects
 * it from the first staff event if it guessed wrong (platform_upsert_staff()).
 */
export function enabledSource(data) {
  for (const key of ["source", "product", "source_module"]) {
    if (STAFF_SOURCES.includes(data?.[key])) return data[key];
  }
  const admins = Array.isArray(data?.admins) ? data.admins : [];
  if (admins.some((a) => typeof a?.role === "string" && /^fleet_/.test(a.role))) return "fleet";
  return "schools";
}

/**
 * Applies one event. Resolves a short description of what was done (kept with the receipt), or throws an EventError
 * (a refusal or "try later") or any other error (500: tried again).
 */
export async function applyEvent(event, { store, platform, timeoutMs }) {
  const type = event.type;
  if (type !== "platform.module.enabled" && !STAFF_EVENTS.has(type)) return "ignored";
  if (type === "platform.module.enabled" && event.data?.module !== "hr") return "ignored (another module)";

  const platformTenantId = event.platform_tenant_id;
  if (typeof platformTenantId !== "string" || !UUID_RE.test(platformTenantId)) throw bad("platform_tenant_id is missing");
  const data = event.data && typeof event.data === "object" ? event.data : {};

  if (type === "platform.module.enabled") {
    const name = typeof data.tenant?.name === "string" ? data.tenant.name.trim() : "";
    if (name.length < 2) throw bad("data.tenant.name is missing");
    const admins = (Array.isArray(data.admins) ? data.admins : [])
      .map((a) => (typeof a?.email === "string" ? { email: a.email.trim().toLowerCase() } : null))
      .filter((a) => a && EMAIL_RE.test(a.email));
    const company = await store.enableHr({
      platformTenantId,
      name,
      slug: typeof data.tenant?.slug === "string" ? data.tenant.slug : null,
      admins,
      source: enabledSource(data),
    });
    if (!company?.tenant_id) throw new Error("platform_enable_hr returned no company");
    // the platform records which HR company this school is; a repeat links again (the same values)
    await platform.call("PUT", `/tenants/${encodeURIComponent(platformTenantId)}/links/hr`,
      { local_tenant_id: company.tenant_id, local_slug: company.slug }, timeoutMs);
    console.log(TAG, "module.enabled", platformTenantId, company.created ? "created" : "found", company.tenant_id, "invited", company.invited ?? 0);
    return company.created
      ? `company ${company.tenant_id} created, ${company.invited ?? 0} admin(s) invited, linked`
      : `company ${company.tenant_id} already there, linked again`;
  }

  // <product>.staff.*: the product is the type's first part (the platform only relays a product's own types)
  const source = type.split(".")[0];

  if (type.endsWith(".staff.left")) {
    const person = personId(data);
    const leftOn = data.left_on == null ? null : String(data.left_on);
    if (leftOn !== null && (!DATE_RE.test(leftOn) || Number.isNaN(Date.parse(`${leftOn}T00:00:00Z`)))) throw bad("data.left_on must be YYYY-MM-DD");
    const r = await store.staffLeft({ platformTenantId, source, person, leftOn });
    console.log(TAG, type, platformTenantId, r?.employee_number ?? "-", r?.outcome);
    return `${r?.outcome ?? "unknown"}${r?.employee_number ? ` ${r.employee_number}` : ""}`;
  }

  // <product>.staff.created / .updated
  const person = personId(data);
  const e = staffToEmployee(data);
  if (!e.first) throw bad("data.full_name is missing");
  const r = await store.upsertStaff({
    platformTenantId, source, person, first: e.first, middle: e.middle, last: e.last, phone: e.phone, email: e.email, jobTitle: e.job_title,
  });
  if (!r?.employee_number) throw new Error("platform_upsert_staff returned no employee");
  console.log(TAG, type, platformTenantId, r.employee_number, r.created ? "created" : "updated");
  return `${r.created ? "created" : "updated"} ${r.employee_number}`;
}

const reply = (res, status, body) => res.status(status).json(body);
const refuse = (res, status, code, message) => reply(res, status, { error: { code, message } });

/**
 * POST / (mounted at /api/platform/events, with the raw body). store and platform are for tests.
 */
export function createPlatformEventsRouter({ store = supabaseStore(), platform = hrClient, now = () => Date.now(), timeoutMs = SEND_TIMEOUT_MS } = {}) {
  const router = express.Router();
  router.use(express.raw({ type: () => true, limit: "1mb" }));

  router.post("/", async (req, res) => {
    // switched off: the platform keeps the event and tries again later
    if (!eventsEnabled()) return refuse(res, 503, "events_off", "Figbloom HR isn't taking platform events yet.");
    const secret = String(process.env.PLATFORM_WEBHOOK_SECRET || "").trim();
    if (!secret) {
      console.error(TAG, "PLATFORM_WEBHOOK_SECRET is not set");
      return refuse(res, 503, "not_configured", "Figbloom HR can't check platform events yet.");
    }

    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : typeof req.body === "string" ? req.body : "";
    const genuine = verifySignature({
      secret,
      rawBody: raw,
      signature: req.get("x-figbloom-signature"),
      timestamp: req.get("x-figbloom-timestamp"),
      nowMs: now(),
    });
    if (!genuine) return refuse(res, 401, "bad_signature", "The signature or timestamp is not valid.");

    let event;
    try {
      event = JSON.parse(raw)?.event;
    } catch {
      event = null;
    }
    if (!event || typeof event !== "object" || typeof event.type !== "string" || !event.type) {
      return refuse(res, 400, "invalid_event", "The body has no event.");
    }
    const delivery = String(req.get("x-figbloom-delivery") || "").trim();
    if (!delivery || delivery.length > 200) return refuse(res, 400, "no_delivery_id", "x-figbloom-delivery is missing.");

    try {
      const seen = await store.getReceipt(delivery);
      if (seen) return reply(res, 200, { ok: true, duplicate: true, result: seen.result });

      const result = await applyEvent(event, { store, platform, timeoutMs });
      await store.saveReceipt({
        delivery_id: delivery,
        event_type: event.type,
        event_id: typeof event.id === "string" ? event.id.slice(0, 200) : null,
        result: result.slice(0, 500),
      });
      return reply(res, 200, { ok: true, result });
    } catch (err) {
      if (err instanceof EventError) {
        console.warn(TAG, event.type, delivery, err.status, err.code);
        return refuse(res, err.status, err.code, err.message);
      }
      if (err instanceof PlatformError) {
        // the platform itself could not be told (the link): try the whole event again later
        console.error(TAG, event.type, delivery, "platform call failed", err.status, err.code);
        return refuse(res, 502, "platform_call_failed", "Figbloom HR couldn't reach the platform. Try again.");
      }
      console.error(TAG, event.type, delivery, err?.message || err);
      return refuse(res, 500, "server_error", "The event could not be applied. Try again.");
    }
  });

  return router;
}

/** Whether a failed send is worth trying again: the platform's refusals are final, except "not yet" kinds. */
export const retryable = (err) =>
  !(err instanceof PlatformError) || !(err.status >= 400 && err.status < 500) || [404, 408, 425, 429].includes(err.status);

/** Sends what waits in the outbox. Resolves { sent, retrying, failed }. */
export async function flushOutbox({ store, platform, limit = OUTBOX_BATCH, timeoutMs = SEND_TIMEOUT_MS }) {
  const counts = { sent: 0, retrying: 0, failed: 0 };
  const events = await store.claimEvents(limit);
  for (const e of events) {
    try {
      await platform.call(
        "POST",
        "/events",
        {
          type: e.event_type,
          id: e.id,
          occurred_at: new Date(e.occurred_at).toISOString(),
          tenant_local_id: e.tenant_id,
          data: e.data,
        },
        timeoutMs
      );
      await store.finishEvent(e.id, true);
      counts.sent += 1;
    } catch (err) {
      const again = retryable(err);
      const message = err instanceof PlatformError ? `${err.status} ${err.code}: ${err.message}` : String(err?.message || err);
      console.error(TAG, "send", e.event_type, e.id, again ? "will retry" : "refused", message);
      const outcome = await store.finishEvent(e.id, false, message.slice(0, 500), again);
      if (outcome === "failed") counts.failed += 1;
      else counts.retrying += 1;
    }
  }
  return counts;
}

/** POST /flush (mounted at /api/platform/outbox): called by pg_cron with x-cron-secret. */
export function createOutboxRouter({ store = supabaseStore(), platform = hrClient } = {}) {
  const router = express.Router();
  router.post("/flush", async (req, res) => {
    const secret = String(process.env.PLATFORM_OUTBOX_CRON_SECRET || "").trim();
    if (!sameSecret(req.get("x-cron-secret") || "", secret)) return refuse(res, 403, "forbidden", "Forbidden");
    if (!eventsEnabled()) return refuse(res, 503, "events_off", "Figbloom HR isn't sending platform events yet.");
    if (!platform.configured()) return refuse(res, 503, "platform_not_connected", "Figbloom HR isn't connected to the Figbloom platform yet.");
    try {
      return reply(res, 200, { ok: true, ...(await flushOutbox({ store, platform })) });
    } catch (err) {
      console.error(TAG, "outbox", err?.message || err);
      return refuse(res, 500, "server_error", "The outbox could not be sent. It is tried again.");
    }
  });
  return router;
}
