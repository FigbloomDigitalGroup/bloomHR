// careers_routes.js: each company's careers feed and applications, for its own website (FIG-838). No sign-in.
//
//   GET  /api/careers/:slug                       the company's name, logo and colours
//   GET  /api/careers/:slug/jobs                  its open jobs shown on the careers page
//   GET  /api/careers/:slug/jobs/:id              one of them, with a form token for applying
//   POST /api/careers/:slug/jobs/:id/cv-upload    { file_name, size } -> a one-time address to PUT the CV to
//   POST /api/careers/:slug/jobs/:id/apply        { first_name, last_name, email, phone, cover_note, answers, cv_path,
//                                                   cv_name, form_token, website (left empty), turnstile_token }
//
// What is read comes from the database's careers_* functions (20261016500000_careers_api.sql), which return only what
// a job ad shows, only for the slug's own company. A browser may call this from the company's allowed websites (Settings >
// Careers page) or from this site; any other site is refused. Every request is rate-limited per visitor (by IP, counted
// in the company's take_rate_limit budgets), applications per email address too. Spam protection: a hidden field
// people leave empty, a minimum time between opening the job and applying (the form token), and Cloudflare Turnstile
// when TURNSTILE_SECRET is set. CVs (PDF, DOC or DOCX, at most 5 MB) are uploaded straight to the private resumes
// bucket (an upload this size doesn't fit through a Vercel function) and checked here before the application is made.
import express from "express";
import crypto from "node:crypto";
import dotenv from "dotenv";
import { Resend } from "resend";
import { admin, HttpError } from "./admin_routes.js";
import { createBudget, createSharedBudget } from "./authz.js";

dotenv.config({ path: process.env.ENV_FILE || ".env" });

const router = express.Router();

export const MAX_CV_BYTES = 5 * 1024 * 1024;
const CV_TYPES = { pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9][0-9 ()-]{5,24}$/;
const FORM_TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const NEUTRAL_MESSAGE = "Thank you for applying. We have received your application and will be in touch if your profile matches what we are looking for.";

// per visitor, per company (shared by every server instance)
const budget = createSharedBudget("careers", {
  read: { limit: 120, windowMs: 60_000 },
  upload: { limit: 10, windowMs: 60 * 60_000 },
  apply: { limit: 5, windowMs: 60 * 60_000 },
  email: { limit: 3, windowMs: 24 * 60 * 60_000 },
  default: { limit: 60, windowMs: 60_000 },
});
// unknown slugs have no company to count against: this server's own count, so guessing slugs stays slow
const misses = createBudget({ default: { limit: 30, windowMs: 60_000 } });

const hash = (value) => crypto.createHash("sha256").update(String(value), "utf8").digest("hex").slice(0, 32);
const clientIp = (req) =>
  String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
const cleanOrigin = (value) => String(value || "").trim().toLowerCase().replace(/\/+$/, "");

/** The sites this app itself is served from: always allowed (the hosted careers page is one of them). */
function ownOrigins(req) {
  const list = [process.env.SITE_URL, process.env.PUBLIC_SITE_URL, ...(process.env.CORS_ORIGIN || "").split(",")];
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) list.push(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`);
  if (process.env.VERCEL_URL) list.push(`https://${process.env.VERCEL_URL}`);
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  if (host) list.push(`${String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0]}://${host}`);
  return list.map(cleanOrigin).filter(Boolean);
}

/** May a page on `origin` call this company's careers API from a browser? */
export function originAllowed(origin, company, req) {
  const o = cleanOrigin(origin);
  if (!o || o === "null") return false;
  if ((company.allowed_origins || []).map(cleanOrigin).includes(o)) return true;
  if (ownOrigins(req).includes(o)) return true;
  // local development (the Vite dev server proxies to this one under another port)
  return process.env.NODE_ENV !== "production" && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
}

// The form token: when the visitor opened the job, signed so it can't be made up. Applying sooner than the minimum
// fill time after it is a bot; a token over a day old asks them to reload.
const formSecret = () =>
  crypto
    .createHash("sha256")
    .update(`careers-form:${process.env.CAREERS_FORM_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ""}`)
    .digest();
const sign = (payload) => crypto.createHmac("sha256", formSecret()).update(payload).digest("base64url");
export function formToken(slug, jobId, now = Date.now()) {
  const issued = String(now);
  return `${issued}.${sign(`${slug}|${jobId}|${issued}`)}`;
}
/** "ok", "fast" (sooner than the minimum fill time) or "invalid" (missing, forged, for another job, or expired). */
export function checkFormToken(token, slug, jobId, now = Date.now()) {
  const [issued, mac] = String(token || "").split(".");
  if (!/^\d{13}$/.test(issued || "") || !mac) return "invalid";
  const expected = sign(`${slug}|${jobId}|${issued}`);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return "invalid";
  const age = now - Number(issued);
  if (age < 0 || age > FORM_TOKEN_MAX_AGE_MS) return "invalid";
  const minimum = Number(process.env.CAREERS_MIN_FILL_SECONDS ?? 4) * 1000;
  return age < minimum ? "fast" : "ok";
}

/** Cloudflare Turnstile: checked only when TURNSTILE_SECRET is set (the page then shows the widget). */
async function turnstilePassed(token, ip) {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) return true;
  if (typeof token !== "string" || !token || token.length > 2048) return false;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
    });
    const data = await res.json();
    return data?.success === true;
  } catch (err) {
    console.error("[careers] Turnstile could not be reached:", err?.message || err);
    return false;
  }
}

/** Is this file what its extension says (by its first bytes)? */
export function looksLikeCv(bytes, extension) {
  const b = bytes.subarray(0, 8);
  if (extension === "pdf") return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF
  if (extension === "docx") return b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04; // a zip
  if (extension === "doc") return b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0; // OLE2
  return false;
}
const cvExtension = (name) => {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || "").trim());
  const ext = m ? m[1].toLowerCase() : "";
  return Object.hasOwn(CV_TYPES, ext) ? ext : null;
};

const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max + 1) : "");

// what the public sees of the company
const publicCompany = (c) => ({
  slug: c.slug,
  name: c.company_name,
  tagline: c.tagline || null,
  logo_url: c.logo_url || null,
  primary_color: c.primary_color || null,
  secondary_color: c.secondary_color || null,
  website: c.website || null,
  description: c.description || null,
});

const fail = (res, err, label) => {
  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500) console.error(`[careers] ${label}:`, err);
  res.status(status).json({ error: err instanceof HttpError ? err.message : "Something went wrong. Please try again." });
};

async function listedJobs(tenantId, jobId = null) {
  const { data, error } = await admin.rpc("careers_jobs", { p_tenant: tenantId, p_job: jobId });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function listedJob(company, jobId) {
  if (!UUID_RE.test(jobId)) throw new HttpError(404, "This job is not open for applications");
  const [job] = await listedJobs(company.tenant_id, jobId);
  if (!job) throw new HttpError(404, "This job is not open for applications");
  return job;
}

const visitor = (req, company) => ({ tenantId: company.tenant_id, id: hash(clientIp(req)) });

// Every request: the company behind the slug, and whether the calling site may use it (CORS).
router.use("/:slug", async (req, res, next) => {
  try {
    if (!admin) throw new HttpError(503, "The careers API is not configured");
    const slug = String(req.params.slug || "").toLowerCase();
    let company = null;
    if (SLUG_RE.test(slug)) {
      const { data, error } = await admin.rpc("careers_company", { p_slug: slug });
      if (error) throw error;
      company = Array.isArray(data) ? data[0] : data;
    }
    if (!company) {
      if (!misses(hash(clientIp(req)), "default", 1)) return res.status(429).json({ error: "Too many requests. Please try again later." });
      return res.status(404).json({ error: "Not found" });
    }

    const origin = req.headers.origin;
    res.setHeader("Vary", "Origin");
    if (origin) {
      if (!originAllowed(origin, company, req)) {
        return res.status(403).json({ error: "This website may not use this careers API. Add it under Settings > Careers page." });
      }
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Max-Age", "600");
      return res.status(204).end();
    }

    if (!(await budget(visitor(req, company), req.method === "GET" ? "read" : "default", 1))) {
      return res.status(429).json({ error: "Too many requests. Please try again later." });
    }
    res.locals.company = company;
    next();
  } catch (err) {
    fail(res, err, "lookup failed");
  }
});

router.use(express.json({ limit: "100kb" }));

const cacheFor = (res, seconds, shared = true) =>
  res.setHeader("Cache-Control", `${shared ? "public" : "private"}, max-age=${seconds}${shared ? `, s-maxage=${seconds}, stale-while-revalidate=${seconds * 5}` : ""}`);

router.get("/:slug", (_req, res) => {
  cacheFor(res, 300);
  res.json({ company: publicCompany(res.locals.company) });
});

router.get("/:slug/jobs", async (_req, res) => {
  try {
    const company = res.locals.company;
    const jobs = await listedJobs(company.tenant_id);
    cacheFor(res, 60);
    res.json({ company: publicCompany(company), jobs });
  } catch (err) {
    fail(res, err, "listing failed");
  }
});

router.get("/:slug/jobs/:id", async (req, res) => {
  try {
    const company = res.locals.company;
    const job = await listedJob(company, req.params.id);
    // the form token is per visitor, so this answer is cached by the browser only
    cacheFor(res, 60, false);
    res.json({ company: publicCompany(company), job, form_token: formToken(company.slug, job.id) });
  } catch (err) {
    fail(res, err, "job failed");
  }
});

router.post("/:slug/jobs/:id/cv-upload", async (req, res) => {
  try {
    const company = res.locals.company;
    const job = await listedJob(company, req.params.id);
    const extension = cvExtension(req.body?.file_name);
    const size = Number(req.body?.size);
    if (!extension) throw new HttpError(400, "Your CV must be a PDF, DOC or DOCX file");
    if (!Number.isFinite(size) || size <= 0 || size > MAX_CV_BYTES) throw new HttpError(400, "Your CV must be at most 5 MB");
    if (!(await budget(visitor(req, company), "upload", 1))) throw new HttpError(429, "Too many uploads. Please try again later.");

    const path = `careers/${company.tenant_id}/${crypto.randomUUID()}.${extension}`;
    const { data, error } = await admin.storage.from("resumes").createSignedUploadUrl(path);
    if (error || !data?.signedUrl) throw error || new Error("No upload address");
    res.setHeader("Cache-Control", "no-store");
    res.json({ upload_url: data.signedUrl, token: data.token, path, content_type: CV_TYPES[extension], max_bytes: MAX_CV_BYTES, job_id: job.id });
  } catch (err) {
    fail(res, err, "upload address failed");
  }
});

/** The uploaded CV is there, at most 5 MB, and really a PDF, DOC or DOCX; otherwise it is removed. */
async function checkUploadedCv(company, path) {
  const match = new RegExp(`^careers/${company.tenant_id}/[0-9a-f-]{36}\\.(pdf|docx?)$`).exec(String(path || ""));
  if (!match) throw new HttpError(400, "Please attach your CV");
  const { data, error } = await admin.storage.from("resumes").download(path);
  if (error || !data) throw new HttpError(400, "Please attach your CV (the upload did not finish)");
  const bytes = Buffer.from(await data.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_CV_BYTES || !looksLikeCv(bytes, match[1])) {
    await admin.storage.from("resumes").remove([path]).catch(() => {});
    throw new HttpError(400, "Your CV must be a PDF, DOC or DOCX file of at most 5 MB");
  }
}

// The answers to the job's questions: [{ question, answer }], at most 20.
function cleanAnswers(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 20) throw new HttpError(400, "Too many answers");
  return value.map((a) => {
    const question = text(a?.question, 300);
    const answer = text(a?.answer, 2000);
    if (question.length > 300 || answer.length > 2000) throw new HttpError(400, "An answer is too long");
    return { question, answer };
  });
}

router.post("/:slug/jobs/:id/apply", async (req, res) => {
  const neutral = () => res.json({ ok: true, message: NEUTRAL_MESSAGE });
  try {
    const company = res.locals.company;
    const body = req.body || {};
    // the hidden field only a bot fills in: answered as if it worked, nothing saved
    if (typeof body.website === "string" && body.website.trim() !== "") return neutral();

    const job = await listedJob(company, req.params.id);
    const timing = checkFormToken(body.form_token, company.slug, job.id);
    if (timing === "invalid") throw new HttpError(400, "This form has expired. Please reload the page and try again.");
    if (timing === "fast") return neutral();

    if (!(await budget(visitor(req, company), "apply", 1))) {
      throw new HttpError(429, "Too many applications from your connection. Please try again later.");
    }
    if (!(await turnstilePassed(body.turnstile_token, clientIp(req)))) {
      throw new HttpError(400, "Please complete the check that you are not a robot");
    }

    const firstName = text(body.first_name, 80);
    const lastName = text(body.last_name, 80);
    const email = text(body.email, 254).toLowerCase();
    const phone = text(body.phone, 30);
    const coverNote = text(body.cover_note, 5000);
    if (!firstName || firstName.length > 80 || lastName.length > 80) throw new HttpError(400, "Please enter your name (up to 80 characters)");
    if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, "Please enter a valid email address");
    if (phone && !PHONE_RE.test(phone)) throw new HttpError(400, "Please enter a valid phone number");
    if (coverNote.length > 5000) throw new HttpError(400, "Your cover note is too long (5,000 characters at most)");
    const answers = cleanAnswers(body.answers);
    const cvName = text(body.cv_name, 200).replace(/[^\w .()-]/g, "_");

    await checkUploadedCv(company, body.cv_path);
    if (!(await budget(visitor(req, company), "email", 1, hash(email)))) {
      throw new HttpError(429, "You have sent several applications today. Please try again tomorrow.");
    }

    const { data, error } = await admin.rpc("careers_apply", {
      p_tenant: company.tenant_id,
      p_job: job.id,
      p_first_name: firstName,
      p_last_name: lastName,
      p_email: email,
      p_phone: phone || null,
      p_cover_note: coverNote || null,
      p_answers: answers,
      p_resume_path: body.cv_path,
      p_resume_name: cvName || null,
      p_source: body.source === "careers_page" ? "careers_page" : "careers_api",
    });
    if (error) {
      if (error.code === "P0002") throw new HttpError(404, "This job is not open for applications");
      if (error.code === "22023") throw new HttpError(400, String(error.message || "").replace(/^careers: /, ""));
      throw error;
    }
    const result = Array.isArray(data) ? data[0] : data;
    if (result && !result.duplicate) {
      await emailRecruiters(company, job, `${firstName} ${lastName}`.trim(), req).catch((err) =>
        console.error("[careers] the email to HR failed:", err?.message || err)
      );
    }
    neutral();
  } catch (err) {
    fail(res, err, "apply failed");
  }
});

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Best effort: an email to the company's admins and HR (the bell notification is made in the database anyway). */
async function emailRecruiters(company, job, candidate, req) {
  if (!process.env.RESEND_API_KEY) return;
  const { data, error } = await admin
    .from("user_profiles")
    .select("email")
    .eq("tenant_id", company.tenant_id)
    .in("role", ["ADMIN", "HR"])
    .eq("account_status", "ACTIVE")
    .limit(20);
  if (error) throw error;
  const to = [...new Set((data || []).map((r) => String(r.email || "").trim().toLowerCase()).filter((e) => EMAIL_RE.test(e)))];
  if (!to.length) return;
  const site = (process.env.SITE_URL || process.env.PUBLIC_SITE_URL || ownOrigins(req)[0] || "").replace(/\/+$/, "");
  const link = `${site}/recruitment`;
  const subject = `New application: ${candidate} for ${job.title}`;
  const textBody = `${candidate} applied for ${job.title} on the ${company.company_name} careers page.\n\nSee the application: ${link}`;
  const html = `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;"><strong>${escapeHtml(candidate)}</strong> applied for <strong>${escapeHtml(job.title)}</strong> on the ${escapeHtml(company.company_name)} careers page.</p>
<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;"><a href="${escapeHtml(link)}">See the application</a></p>`;
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error: sendError } = await resend.emails.send({
    from: process.env.SMTP_FROM || "Figbloom HR <onboarding@resend.dev>",
    to,
    subject,
    html,
    text: textBody,
  });
  if (sendError) throw new Error(sendError.message || "Resend rejected the message");
}

export default router;
