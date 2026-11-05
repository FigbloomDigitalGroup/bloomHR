// my_hr_routes.js: "My HR" for Figbloom Schools staff, step 1 (view only): ERP/SCHOOLS_HR_PHASE2_CONTRACT.md section 2.
//
//   Schools' my-hr function --GET /api/integrations/my-hr/<route>-->  (Bearer: Schools' platform access token,
//                                                                      x-figbloom-school, x-figbloom-person)
//     1. the switch MY_HR_API_ENABLED (off: 503 my_hr_off)
//     2. the token: a Cognito ACCESS token of the platform's pool, signature checked against its JWKS
//        (PLATFORM_JWKS_URL), issuer PLATFORM_ISSUER, token_use "access", client_id PLATFORM_SCHOOLS_CLIENT_ID, not
//        expired (401 invalid_token otherwise; an id token is refused)
//     3. the school: GET /links/resolve?module=schools&local_id=<school> on the platform (the "hr" service client,
//        answers kept 10 minutes) gives the platform tenant and HR's own company for it (caller_local_id); that
//        company must be active and have that platform_tenant_id (403 school_not_linked otherwise)
//     4. the person: only external_people (company, 'schools', person id) (404 not_linked otherwise). Never by email,
//        and never an employee number from the caller.
//     5. per person: 120 calls per 10 minutes (429)
//     6. a draft employee (onboarding not approved): 200 {"status": "pending_hr"} and nothing else
//   Then the employee's own data, with the staff portal's rules (supabase/migrations/20261107100000_my_hr_api.sql):
//     GET summary                 GET payslips                 GET payslips/:id (every saved figure)
//     GET payslips/:id/pdf        501 pdf_not_available: HR makes payslip PDFs in the browser (html2pdf), there is no
//                                 server-side PDF; Schools renders GET payslips/:id
//     GET leave                   GET attendance?from&to (YYYY-MM-DD, up to 93 days; default the last 30)
//     GET kpis
//
// Leave, step 2a (ERP/SCHOOLS_HR_LEAVE_CONTRACT.md section 2; supabase/migrations/20261108300000_my_hr_leave.sql), with
// HR's own leave rules, approval chain and notifications unchanged:
//     GET leave/form              types with their rules, balances, the approval chain an application would go through
//     POST leave/applications     {type_id, start_date, end_date, half_day?, reason, document?: {name, content_type,
//                                 base64}} (document up to 5 MB, stored in HR's leave-documents bucket); HR's applicant
//                                 checks refuse with 422 leave_rules and HR's own words
//     POST leave/applications/:id/cancel
//   As an approver (same headers; the person is an HR login only through external_logins, the one-click sign-in's link;
//   not linked: 409 approver_not_linked):
//     GET approvals               HR's "waiting on me", as that login; documents as links valid for 5 minutes
//     POST approvals/:application_id/decide   {decision: "approve"|"decline", comment?}: HR's decide_approval() run as
//                                 that login (the database makes auth.uid() that login for that one transaction)
//   With no person header (the school's own history, once):
//     POST import/leave-history   {records: [...], dry_run?}: approved history, idempotent on each record's source_id
//
// Every call is written to my_hr_api_log once its company is known (route, company, employee number or approver login,
// status: never a payload or a token; calls refused earlier only to the server's log). The token, the headers, the
// bodies (documents included) and the answers are never logged.
//
// Settings (server only, never VITE_):
//   MY_HR_API_ENABLED            "true" to answer
//   PLATFORM_JWKS_URL            https://cognito-idp.<region>.amazonaws.com/<pool>/.well-known/jwks.json
//   PLATFORM_ISSUER              https://cognito-idp.<region>.amazonaws.com/<pool>
//   PLATFORM_SCHOOLS_CLIENT_ID   the Schools service client's app client id
//   PLATFORM_CLIENT_ID / PLATFORM_CLIENT_SECRET, PLATFORM_API_URL, PLATFORM_TOKEN_URL   the "hr" service client
import { randomUUID } from "node:crypto";
import express from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { admin } from "./admin_routes.js";
import { createSharedBudget } from "./authz.js";
import { PlatformError } from "./platform_client.js";
import { hrClient } from "./platform_events_routes.js";

const TAG = "[my-hr]";
export const RESOLVE_CACHE_MS = 10 * 60 * 1000;
const RESOLVE_MISS_CACHE_MS = 60 * 1000;
export const RATE_LIMIT = { limit: 120, windowMs: 10 * 60 * 1000 };
const MAX_DAYS = 93;
const DEFAULT_DAYS = 30;
// leave documents: the staff portal's file kinds (src/lib/employeeDocuments.ts), up to 5 MB from Schools
export const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
export const LEAVE_DOCUMENTS_BUCKET = "leave-documents";
export const DOCUMENT_LINK_SECONDS = 5 * 60;
const DOCUMENT_TYPES = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};
// a JSON body: a 5 MB document is about 6.7 MB of base64
const BODY_LIMIT = "8mb";
const REASON_MIN = 10;
const REASON_MAX = 2000;
const COMMENT_MAX = 1000;
export const IMPORT_MAX_RECORDS = 5000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Schools' ids (tenants.id, profiles.id) are uuids; anything else is refused before it goes anywhere
const ID_RE = UUID_RE;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const on = (value) => /^(1|true|yes|on)$/i.test(String(value || "").trim());
export const myHrEnabled = () => on(process.env.MY_HR_API_ENABLED);
const read = (name) => String(process.env[name] || "").trim();

const fail = (res, status, code, message) => res.status(status).json({ error: { code, message } });

// ---- the token

let jwks = null; // { url, set }

function remoteKeys() {
  const url = read("PLATFORM_JWKS_URL");
  if (!url) return null;
  if (!jwks || jwks.url !== url) jwks = { url, set: createRemoteJWKSet(new URL(url), { cooldownDuration: 30 * 1000, timeoutDuration: 5 * 1000 }) };
  return jwks.set;
}

export class TokenError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Checks Schools' bearer token: a Cognito access token signed by the platform's pool (keys: the JWKS, or `keys` in
 * tests), its issuer, not expired, for the Schools client. Resolves its claims, or throws a TokenError.
 */
export async function verifySchoolsToken(header, keys = remoteKeys()) {
  const issuer = read("PLATFORM_ISSUER");
  const clientId = read("PLATFORM_SCHOOLS_CLIENT_ID");
  if (!keys || !issuer || !clientId) throw new TokenError(503, "my_hr_not_configured", "My HR isn't set up on HR yet.");
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(String(header || ""));
  if (!match) throw new TokenError(401, "invalid_token", "A platform token is needed.");
  let payload;
  try {
    ({ payload } = await jwtVerify(match[1], keys, { issuer, algorithms: ["RS256"], clockTolerance: 30 }));
  } catch (err) {
    // the reason only (expired, bad signature...): never the token
    console.warn(TAG, "token refused:", err?.code || err?.name || "invalid");
    throw new TokenError(401, "invalid_token", "The platform token isn't valid.");
  }
  if (payload.token_use !== "access") throw new TokenError(401, "invalid_token", "The platform token isn't an access token.");
  if (payload.client_id !== clientId) throw new TokenError(401, "invalid_token", "The platform token isn't Figbloom Schools'.");
  return payload;
}

// ---- the platform's link: which HR company a school is

export function createLinkResolver({ platform = hrClient, now = () => Date.now() } = {}) {
  const cache = new Map(); // school -> { at, ttl, value | null }
  return {
    clear: () => cache.clear(),
    /** { platformTenantId, tenantId } for the school, or null when the platform doesn't link it to HR. */
    async resolve(school) {
      const hit = cache.get(school);
      if (hit && now() - hit.at < hit.ttl) return hit.value;
      let value = null;
      try {
        const r = await platform.call("GET", `/links/resolve?module=schools&local_id=${encodeURIComponent(school)}`);
        const ok = r && r.module === "schools" && String(r.local_id) === school
          && UUID_RE.test(String(r.platform_tenant_id ?? "")) && UUID_RE.test(String(r.caller_local_id ?? ""));
        if (!ok) throw new PlatformError(502, "platform_unavailable", "The platform's answer was not understood.");
        value = { platformTenantId: r.platform_tenant_id, tenantId: r.caller_local_id };
      } catch (err) {
        if (!(err instanceof PlatformError) || err.status !== 404) throw err;
      }
      if (cache.size > 5000) cache.clear();
      cache.set(school, { at: now(), ttl: value ? RESOLVE_CACHE_MS : RESOLVE_MISS_CACHE_MS, value });
      return value;
    },
  };
}

// ---- the database (service role), behind a small interface so the routes can be tested without one

export function supabaseMyHrStore(db = admin) {
  const client = () => {
    if (!db) throw new Error("Admin API is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
    return db;
  };
  const rpc = async (fn, args) => {
    const { data, error } = await client().rpc(fn, args);
    if (error) {
      const err = new Error(`${fn}: ${error.message || "failed"}`);
      err.code = error.code;
      // HR's own words (a leave rule, "not the approver"...), shown to the person when the code says it is theirs
      err.hrMessage = String(error.message || "");
      throw err;
    }
    return data;
  };
  const bucket = () => client().storage.from(LEAVE_DOCUMENTS_BUCKET);
  const one = (data) => (Array.isArray(data) ? data[0] ?? null : data ?? null);
  return {
    person: async ({ tenantId, platformTenantId, externalId }) =>
      one(await rpc("my_hr_person", { p_tenant: tenantId, p_platform_tenant: platformTenantId, p_external_id: externalId })),
    summary: ({ tenantId, employee }) => rpc("my_hr_summary", { p_tenant: tenantId, p_employee: employee }),
    payslips: ({ tenantId, employee }) => rpc("my_hr_payslips", { p_tenant: tenantId, p_employee: employee }),
    payslip: ({ tenantId, employee, id }) => rpc("my_hr_payslip", { p_tenant: tenantId, p_employee: employee, p_id: id }),
    leave: ({ tenantId, employee }) => rpc("my_hr_leave", { p_tenant: tenantId, p_employee: employee }),
    attendance: ({ tenantId, employee, from, to }) =>
      rpc("my_hr_attendance", { p_tenant: tenantId, p_employee: employee, p_from: from, p_to: to }),
    kpis: ({ tenantId, employee }) => rpc("my_hr_kpis", { p_tenant: tenantId, p_employee: employee }),
    leaveForm: ({ tenantId, employee }) => rpc("my_hr_leave_form", { p_tenant: tenantId, p_employee: employee }),
    leaveApply: ({ tenantId, employee, typeId, startDate, endDate, halfDay, reason, documentPath, documentName }) =>
      rpc("my_hr_leave_apply", {
        p_tenant: tenantId,
        p_employee: employee,
        p_type: typeId,
        p_start: startDate,
        p_end: endDate,
        p_half: halfDay,
        p_reason: reason,
        p_document_path: documentPath ?? null,
        p_document_name: documentName ?? null,
      }),
    leaveCancel: ({ tenantId, employee, id }) =>
      rpc("my_hr_leave_cancel", { p_tenant: tenantId, p_employee: employee, p_application: id }),
    approver: async ({ tenantId, platformTenantId, externalId }) =>
      one(await rpc("my_hr_approver", { p_tenant: tenantId, p_platform_tenant: platformTenantId, p_external_id: externalId })),
    approvals: ({ tenantId, userId }) => rpc("my_hr_leave_approvals", { p_tenant: tenantId, p_user: userId }),
    decide: ({ tenantId, userId, id, decision, comment }) =>
      rpc("my_hr_leave_decide", { p_tenant: tenantId, p_user: userId, p_application: id, p_decision: decision, p_comment: comment ?? null }),
    importLeave: ({ tenantId, platformTenantId, records, dryRun }) =>
      rpc("my_hr_leave_import", { p_tenant: tenantId, p_platform_tenant: platformTenantId, p_records: records, p_dry_run: dryRun }),
    /** Stores a document as HR stores leave documents (private bucket, under the company); resolves its path. */
    async uploadDocument({ tenantId, bytes, contentType, extension }) {
      const path = `${tenantId}/my-hr/${randomUUID()}.${extension}`;
      const { error } = await bucket().upload(path, bytes, { contentType, upsert: false });
      if (error) throw new Error(`upload: ${error.message || "failed"}`);
      return path;
    },
    async removeDocument(path) {
      const { error } = await bucket().remove([path]);
      if (error) throw new Error(`remove: ${error.message || "failed"}`);
    },
    /** A link to a document, valid for `seconds`. */
    async documentUrl(path, seconds) {
      const { data, error } = await bucket().createSignedUrl(path, seconds);
      if (error || !data?.signedUrl) throw new Error(`sign: ${error?.message || "failed"}`);
      return data.signedUrl;
    },
    async log({ tenantId, employee, userId, route, status, outcome }) {
      const { error } = await client().from("my_hr_api_log").insert({
        tenant_id: tenantId,
        employee_number: employee ? String(employee).slice(0, 100) : null,
        user_id: userId ?? null,
        route,
        status,
        outcome: outcome ? String(outcome).slice(0, 60) : null,
      });
      if (error) throw new Error(`my_hr_api_log: ${error.message}`);
    },
  };
}

// ---- KPI scores: the staff portal's achievement() and overallScore() (src/lib/kpis.ts), checked against it in tests

const ACHIEVEMENT_CAP = 150;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const clamp = (v) => Math.max(0, Math.min(ACHIEVEMENT_CAP, v));
const round1 = (v) => Math.round(v * 10) / 10;
const toNum = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

export function achievement({ unit, direction, target, actual }) {
  if (!isNum(actual)) return null;
  const lower = direction === "lower_is_better";
  if (unit === "yes_no") {
    const yes = actual >= 1;
    return (lower ? !yes : yes) ? 100 : 0;
  }
  if (unit === "rating_1_5") return clamp((actual / 5) * 100);
  if (!isNum(target)) return null;
  if (!lower) {
    if (target <= 0) return actual >= target ? 100 : 0;
    return clamp((actual / target) * 100);
  }
  if (actual <= 0) {
    if (target > 0) return ACHIEVEMENT_CAP;
    return actual <= target ? 100 : 0;
  }
  if (target <= 0) return 0;
  return clamp((target / actual) * 100);
}

export function overallScore(items) {
  let sum = 0;
  let weights = 0;
  let scored = 0;
  for (const it of items) {
    if (!isNum(it.achievement)) continue;
    scored += 1;
    const w = isNum(it.weight) ? it.weight : 0;
    if (w <= 0) continue;
    sum += it.achievement * w;
    weights += w;
  }
  return { score: weights > 0 ? round1(sum / weights) : null, scored, total: items.length };
}

function withScores(kpis) {
  const items = (Array.isArray(kpis?.items) ? kpis.items : []).map((it) => {
    const target = toNum(it.target);
    const weight = toNum(it.weight);
    // the actual a KPI is scored on: the final score, else the calculated value (kpiApi.ts actualOf)
    const actual = toNum(it.actual_value) ?? toNum(it.auto_value);
    const a = achievement({ unit: it.unit, direction: it.direction, target, actual });
    return { ...it, target, weight, actual, achievement: a === null ? null : round1(a) };
  });
  return { period: kpis?.period ?? null, items, overall: overallScore(items), attendance: kpis?.attendance ?? null };
}

// ---- dates

const isoDay = (d) => d.toISOString().slice(0, 10);
const nairobiToday = () => isoDay(new Date(Date.now() + 3 * 60 * 60 * 1000));
const validDay = (v) => DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && isoDay(new Date(`${v}T00:00:00Z`)) === v;
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const addDays = (day, n) => isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000));

/** The attendance range asked for: { from, to } or { error }. */
export function attendanceRange(query, today = nairobiToday()) {
  const from = typeof query.from === "string" && query.from ? query.from : null;
  const to = typeof query.to === "string" && query.to ? query.to : null;
  if ((from && !validDay(from)) || (to && !validDay(to))) return { error: "Dates are YYYY-MM-DD." };
  const end = to ?? (from ? addDays(from, DEFAULT_DAYS - 1) : today);
  const start = from ?? addDays(end, -(DEFAULT_DAYS - 1));
  if (daysBetween(start, end) < 0) return { error: "Choose a start date on or before the end date." };
  if (daysBetween(start, end) > MAX_DAYS - 1) return { error: `Choose a range of ${MAX_DAYS} days or less.` };
  return { from: start, to: end };
}

// ---- leave bodies

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const plainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** A document sent with an application: { extension, contentType, bytes, name } or { error }. */
export function parseDocument(doc) {
  if (!plainObject(doc)) return { error: "document is {name, content_type, base64}." };
  const name = typeof doc.name === "string" ? doc.name.trim() : "";
  if (!name || name.length > 255) return { error: "The document needs a name (255 characters at most)." };
  const extension = (name.split(".").pop() || "").toLowerCase();
  if (!name.includes(".") || !DOCUMENT_TYPES[extension]) return { error: "Upload a PDF, Word document or photo (JPG, PNG)." };
  const given = typeof doc.content_type === "string" ? doc.content_type.trim().toLowerCase() : "";
  // the type the extension says; a different one claimed by the caller is not trusted
  const contentType = DOCUMENT_TYPES[extension];
  if (given && given !== contentType && !(extension === "jpg" && given === "image/jpg")) {
    return { error: "The document's content_type doesn't match its name." };
  }
  const base64 = typeof doc.base64 === "string" ? doc.base64.replace(/\s+/g, "") : "";
  if (!base64 || base64.length % 4 !== 0 || !BASE64_RE.test(base64)) return { error: "The document's base64 isn't valid." };
  // checked before decoding: the decoded size is 3/4 of the text, less the padding
  if ((base64.length / 4) * 3 - (base64.match(/=+$/)?.[0].length ?? 0) > DOCUMENT_MAX_BYTES) {
    return { error: "The document is larger than 5 MB.", tooLarge: true };
  }
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0) return { error: "The document is empty." };
  return { extension, contentType, bytes, name };
}

/** POST leave/applications: { typeId, startDate, endDate, halfDay, reason, document } or { error }. */
export function parseApplication(body) {
  if (!plainObject(body)) return { error: "Send the application as JSON." };
  const { type_id: typeId, start_date: startDate, end_date: endDate } = body;
  if (typeof typeId !== "string" || !UUID_RE.test(typeId)) return { error: "type_id is a leave type's id (GET leave/form)." };
  if (typeof startDate !== "string" || !validDay(startDate) || typeof endDate !== "string" || !validDay(endDate)) {
    return { error: "start_date and end_date are YYYY-MM-DD." };
  }
  if (body.half_day !== undefined && body.half_day !== null && typeof body.half_day !== "boolean") {
    return { error: "half_day is true or false." };
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  // the staff portal's rule for the reason
  if (reason.length < REASON_MIN) return { error: `Please give a reason of at least ${REASON_MIN} characters.` };
  if (reason.length > REASON_MAX) return { error: `The reason is too long (${REASON_MAX} characters at most).` };
  let document = null;
  if (body.document !== undefined && body.document !== null) {
    document = parseDocument(body.document);
    if (document.error) return document;
  }
  return { typeId, startDate, endDate, halfDay: body.half_day === true, reason, document };
}

/** POST approvals/:id/decide: { decision: 'approved'|'rejected', comment } or { error }. */
export function parseDecision(body) {
  if (!plainObject(body)) return { error: "Send {decision, comment?} as JSON." };
  const decision = body.decision === "approve" ? "approved" : body.decision === "decline" ? "rejected" : null;
  if (!decision) return { error: 'decision is "approve" or "decline".' };
  if (body.comment !== undefined && body.comment !== null && typeof body.comment !== "string") return { error: "comment is text." };
  const comment = typeof body.comment === "string" ? body.comment.trim() : "";
  if (comment.length > COMMENT_MAX) return { error: `The comment is too long (${COMMENT_MAX} characters at most).` };
  return { decision, comment: comment || null };
}

/** POST import/leave-history: { records, dryRun } or { error }. */
export function parseImport(body) {
  if (!plainObject(body) || !Array.isArray(body.records)) return { error: "Send {records: [...], dry_run?} as JSON." };
  if (body.records.length > IMPORT_MAX_RECORDS) return { error: `Send ${IMPORT_MAX_RECORDS} records or fewer at a time.` };
  if (body.dry_run !== undefined && body.dry_run !== null && typeof body.dry_run !== "boolean") return { error: "dry_run is true or false." };
  const field = (v, max) => (typeof v === "string" || typeof v === "number" ? String(v).slice(0, max) : null);
  const records = body.records.map((r) =>
    plainObject(r)
      ? {
          external_id: field(r.external_id, 200),
          leave_type_name: field(r.leave_type_name, 200),
          start_date: field(r.start_date, 10),
          end_date: field(r.end_date, 10),
          days: typeof r.days === "number" && Number.isFinite(r.days) && r.days >= 0 ? String(r.days) : field(r.days, 20),
          status: field(r.status, 40),
          source_id: field(r.source_id, 201),
        }
      : {}
  );
  return { records, dryRun: body.dry_run === true };
}

// HR's rule messages joined by leave_application_check() ("A. B"): one per rule, for a form to list
export const ruleProblems = (message) =>
  String(message || "")
    .split(/\.\s+(?=[A-Z])/)
    .map((p) => p.trim().replace(/\.$/, ""))
    .filter(Boolean);

// ---- per person: shared by every server through take_rate_limit() (this server's own count if the database can't)

export function sharedRateLimit() {
  const take = createSharedBudget("my_hr", { default: RATE_LIMIT });
  return ({ tenantId, employee }) => take({ tenantId, id: employee }, "default", 1);
}

// ---- the router

/** Mounted at /api/integrations/my-hr. store, links, verifyToken and rateLimit ({ tenantId, employee } -> whether
 * the call fits) are for tests. */
export function createMyHrRouter({
  store = supabaseMyHrStore(),
  links = createLinkResolver(),
  verifyToken = (header) => verifySchoolsToken(header),
  rateLimit = sharedRateLimit(),
} = {}) {
  const router = express.Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  const audit = async (entry) => {
    console.log(TAG, entry.route, entry.status, entry.outcome ?? "-", entry.tenantId ?? "-", entry.employee ?? entry.userId ?? "-");
    // the table is per company: a call refused before the company is known (switch, token, school) is only logged here
    if (!UUID_RE.test(String(entry.tenantId ?? ""))) return;
    try {
      await store.log(entry);
    } catch (err) {
      console.error(TAG, "not logged:", err?.message || err);
    }
  };

  const refuse = async (res, entry, status, code, message, extra = {}) => {
    await audit({ ...entry, status, outcome: code });
    fail(res, status, code, message);
    return null;
  };

  /** The switch, the token and the school: { link, person } or an answer already sent (null). */
  async function gate(req, res, route, { person: needPerson = true } = {}) {
    const entry = { route };
    if (!myHrEnabled()) return refuse(res, entry, 503, "my_hr_off", "My HR isn't available yet.");
    try {
      await verifyToken(req.headers.authorization);
    } catch (err) {
      if (err instanceof TokenError) return refuse(res, entry, err.status, err.code, err.message);
      console.error(TAG, "token check failed", err?.name || "error");
      return refuse(res, entry, 401, "invalid_token", "The platform token isn't valid.");
    }
    const school = String(req.get("x-figbloom-school") || "").trim();
    const person = String(req.get("x-figbloom-person") || "").trim();
    if (!ID_RE.test(school) || (needPerson && !ID_RE.test(person))) {
      return refuse(res, entry, 400, "bad_request", needPerson ? "The school and the person are needed." : "The school is needed.");
    }

    let link;
    try {
      link = await links.resolve(school);
    } catch (err) {
      return refuse(res, entry, 502, "platform_unavailable", "The Figbloom platform didn't answer. Try again.", { detail: err?.code });
    }
    if (!link) return refuse(res, entry, 403, "school_not_linked", "This school isn't connected to Figbloom HR.");
    return { link, person };
  }

  const limited = async (res, who, route) => {
    if (await rateLimit(who)) return false;
    res.set("Retry-After", String(Math.ceil(RATE_LIMIT.windowMs / 1000)));
    await refuse(res, { route, ...who }, 429, "rate_limited", "Too many requests. Try again in a few minutes.");
    return true;
  };

  /** Who is calling, as an employee: { tenantId, employee, draft } or an answer already sent (null). */
  async function caller(req, res, route) {
    const gated = await gate(req, res, route);
    if (!gated) return null;
    const { link, person } = gated;
    const entry = { route, tenantId: link.tenantId };
    let found;
    try {
      found = await store.person({ tenantId: link.tenantId, platformTenantId: link.platformTenantId, externalId: person });
    } catch (err) {
      console.error(TAG, "person", err?.message || err);
      return refuse(res, entry, 500, "server_error", "Something went wrong. Try again.");
    }
    if (found?.outcome === "unknown_company") return refuse(res, entry, 403, "school_not_linked", "This school isn't connected to Figbloom HR.");
    if (found?.outcome !== "found" || !found.employee_number) {
      return refuse(res, entry, 404, "not_linked", "Your HR record isn't ready yet.");
    }
    const who = { tenantId: link.tenantId, employee: found.employee_number };
    if (await limited(res, who, route)) return null;
    return { ...who, draft: found.onboarding_status !== "approved" };
  }

  /** Who is calling, as an approver: { tenantId, userId } (an HR login, only through external_logins) or null. */
  async function approver(req, res, route) {
    const gated = await gate(req, res, route);
    if (!gated) return null;
    const { link, person } = gated;
    const entry = { route, tenantId: link.tenantId };
    let found;
    try {
      found = await store.approver({ tenantId: link.tenantId, platformTenantId: link.platformTenantId, externalId: person });
    } catch (err) {
      console.error(TAG, "approver", err?.message || err);
      return refuse(res, entry, 500, "server_error", "Something went wrong. Try again.");
    }
    if (found?.outcome === "unknown_company") return refuse(res, entry, 403, "school_not_linked", "This school isn't connected to Figbloom HR.");
    if (found?.outcome === "no_access") {
      return refuse(res, { ...entry, userId: found.user_id }, 403, "approver_no_access", "You don't have access to HR for this school. Ask your HR administrator.");
    }
    if (found?.outcome !== "found" || !UUID_RE.test(String(found.user_id ?? ""))) {
      return refuse(res, entry, 409, "approver_not_linked", "Open HR & Payroll once to connect your HR account.");
    }
    const who = { tenantId: link.tenantId, userId: found.user_id };
    if (await limited(res, { tenantId: who.tenantId, employee: `login:${who.userId}` }, route)) return null;
    return who;
  }

  const jsonBody = express.json({ limit: BODY_LIMIT, strict: true });
  /** Reads a JSON body once the caller is known (nobody unverified gets megabytes parsed). Resolves an error or null. */
  const readBody = (req, res) =>
    new Promise((resolve) => {
      jsonBody(req, res, (err) => resolve(err || null));
    });
  const bodyError = (err) =>
    err?.type === "entity.too.large" || err?.status === 413
      ? { status: 413, outcome: "too_large", body: { error: { code: "too_large", message: "The request is too large (a document can be 5 MB at most)." } } }
      : { status: 400, outcome: "bad_json", body: { error: { code: "bad_request", message: "Send the request as JSON." } } };

  const answer = async (res, entry, work) => {
    try {
      const a = await work();
      await audit({ ...entry, status: a.status, outcome: a.outcome ?? "ok" });
      return res.status(a.status).json(a.body);
    } catch (err) {
      // a draft between the two checks, or a database failure: the message stays here
      const pending = entry.employee && err?.code === "42501";
      console.error(TAG, entry.route, pending ? "not approved" : err?.message || err);
      await audit({ ...entry, status: pending ? 200 : 500, outcome: pending ? "pending_hr" : "server_error" });
      if (pending) return res.json({ status: "pending_hr" });
      return fail(res, 500, "server_error", "Something went wrong. Try again.");
    }
  };

  /** A route for the employee. `body`: read a JSON body first. */
  const handle = (route, work, { body = false } = {}) => async (req, res) => {
    const who = await caller(req, res, route);
    if (!who) return;
    const entry = { route, tenantId: who.tenantId, employee: who.employee };
    if (who.draft) {
      await audit({ ...entry, status: 200, outcome: "pending_hr" });
      return res.json({ status: "pending_hr" });
    }
    if (body) {
      const err = await readBody(req, res);
      if (err) return answer(res, entry, async () => bodyError(err));
    }
    return answer(res, entry, () => work(req, who));
  };

  /** A route for an approver. */
  const handleApprover = (route, work, { body = false } = {}) => async (req, res) => {
    const who = await approver(req, res, route);
    if (!who) return;
    const entry = { route, tenantId: who.tenantId, userId: who.userId };
    if (body) {
      const err = await readBody(req, res);
      if (err) return answer(res, entry, async () => bodyError(err));
    }
    return answer(res, entry, () => work(req, who));
  };

  const ok = (body) => ({ status: 200, body: { status: "active", ...body } });
  const refusal = (status, code, message, extra = {}) => ({ status, outcome: code, body: { error: { code, message, ...extra } } });
  const notFound = () => ({ status: 404, outcome: "payslip_not_found", body: { error: { code: "not_found", message: "No such payslip." } } });

  router.get("/summary", handle("summary", async (_req, who) => ok(await store.summary(who))));

  router.get("/payslips", handle("payslips", async (_req, who) => ok({ payslips: (await store.payslips(who)) ?? [] })));

  router.get("/payslips/:id", handle("payslip", async (req, who) => {
    if (!UUID_RE.test(req.params.id)) return notFound();
    const payslip = await store.payslip({ ...who, id: req.params.id });
    return payslip ? ok({ payslip }) : notFound();
  }));

  router.get("/payslips/:id/pdf", handle("payslip_pdf", async (req, who) => {
    if (!UUID_RE.test(req.params.id)) return notFound();
    const payslip = await store.payslip({ ...who, id: req.params.id });
    if (!payslip) return notFound();
    return {
      status: 501,
      outcome: "pdf_not_available",
      body: {
        error: {
          code: "pdf_not_available",
          message: "HR makes payslip PDFs in the browser. Use GET payslips/:id and render it.",
        },
        payslip_url: `payslips/${payslip.id}`,
      },
    };
  }));

  router.get("/leave", handle("leave", async (_req, who) => ok(await store.leave(who))));

  // ---- leave: the employee's own

  router.get("/leave/form", handle("leave_form", async (_req, who) => ok(await store.leaveForm(who))));

  router.post("/leave/applications", handle("leave_apply", async (req, who) => {
    const app = parseApplication(req.body);
    if (app.error) return app.tooLarge ? refusal(413, "too_large", app.error) : refusal(400, "bad_request", app.error);
    let documentPath = null;
    if (app.document) {
      documentPath = await store.uploadDocument({ tenantId: who.tenantId, bytes: app.document.bytes, contentType: app.document.contentType, extension: app.document.extension });
    }
    try {
      const application = await store.leaveApply({ ...who, ...app, documentPath, documentName: app.document?.name ?? null });
      return { status: 201, outcome: "applied", body: { status: "active", application } };
    } catch (err) {
      if (documentPath) {
        await store.removeDocument(documentPath).catch((e) => console.error(TAG, "document not removed", e?.message || e));
      }
      // HR's applicant checks (leave_application_check()): its own words, every rule that failed
      if (err?.code === "P0001") return refusal(422, "leave_rules", err.hrMessage, { problems: ruleProblems(err.hrMessage) });
      if (err?.code === "22023") return refusal(422, "invalid", err.hrMessage);
      throw err;
    }
  }, { body: true }));

  router.post("/leave/applications/:id/cancel", handle("leave_cancel", async (req, who) => {
    if (!UUID_RE.test(req.params.id)) return refusal(404, "not_found", "No such leave application.");
    try {
      return ok({ application: await store.leaveCancel({ ...who, id: req.params.id }) });
    } catch (err) {
      if (err?.code === "P0002") return refusal(404, "not_found", "No such leave application.");
      if (err?.code === "55000") return refusal(409, "not_cancellable", err.hrMessage);
      throw err;
    }
  }));

  // ---- leave: approvers

  const withLinks = async (item) => {
    const link = async (doc) => {
      if (!doc?.path) return null;
      try {
        const url = await store.documentUrl(doc.path, DOCUMENT_LINK_SECONDS);
        return { name: doc.name ?? null, url, expires_at: new Date(Date.now() + DOCUMENT_LINK_SECONDS * 1000).toISOString() };
      } catch (err) {
        console.error(TAG, "document link", err?.message || err);
        return { name: doc.name ?? null, url: null, expires_at: null };
      }
    };
    return { ...item, document: await link(item.document), followup_document: await link(item.followup_document) };
  };

  router.get("/approvals", handleApprover("approvals", async (_req, who) => {
    const items = (await store.approvals(who)) ?? [];
    return ok({ approvals: await Promise.all(items.map(withLinks)) });
  }));

  router.post("/approvals/:id/decide", handleApprover("approval_decide", async (req, who) => {
    if (!UUID_RE.test(req.params.id)) return refusal(404, "not_found", "No such leave application waiting for a decision.");
    const d = parseDecision(req.body);
    if (d.error) return refusal(400, "bad_request", d.error);
    try {
      const result = await store.decide({ ...who, id: req.params.id, decision: d.decision, comment: d.comment });
      return { status: 200, outcome: d.decision, body: { status: "active", ...result } };
    } catch (err) {
      // decide_approval()'s answers, in HR's words
      if (err?.code === "P0002") return refusal(404, "not_found", "No such leave application waiting for a decision.");
      if (err?.code === "42501") return refusal(403, "not_your_approval", err.hrMessage || "You are not the approver for this step.");
      if (err?.code === "55000") return refusal(409, "already_decided", err.hrMessage);
      if (err?.code === "22023") return refusal(422, "invalid", err.hrMessage);
      if (err?.code === "P0001") return refusal(422, "leave_rules", err.hrMessage, { problems: ruleProblems(err.hrMessage) });
      throw err;
    }
  }, { body: true }));

  // ---- history from Schools (the school's token, no person)

  router.post("/import/leave-history", async (req, res) => {
    const route = "leave_import";
    const gated = await gate(req, res, route, { person: false });
    if (!gated) return;
    const { link } = gated;
    const entry = { route, tenantId: link.tenantId };
    if (await limited(res, { tenantId: link.tenantId, employee: "import:leave-history" }, route)) return;
    const err = await readBody(req, res);
    if (err) return answer(res, entry, async () => bodyError(err));
    return answer(res, entry, async () => {
      const imp = parseImport(req.body);
      if (imp.error) return refusal(400, "bad_request", imp.error);
      try {
        const result = await store.importLeave({ tenantId: link.tenantId, platformTenantId: link.platformTenantId, ...imp });
        return { status: 200, outcome: imp.dryRun ? "dry_run" : "imported", body: { status: "active", ...result } };
      } catch (e) {
        if (e?.code === "P0002") return refusal(403, "school_not_linked", "This school isn't connected to Figbloom HR.");
        throw e;
      }
    });
  });

  router.get("/attendance", handle("attendance", async (req, who) => {
    const range = attendanceRange(req.query);
    if (range.error) return { status: 400, outcome: "bad_range", body: { error: { code: "bad_request", message: range.error } } };
    return ok(await store.attendance({ ...who, from: range.from, to: range.to }));
  }));

  router.get("/kpis", handle("kpis", async (_req, who) => ok(withScores(await store.kpis(who)))));

  router.use((_req, res) => fail(res, 404, "not_found", "Not found."));
  return router;
}
