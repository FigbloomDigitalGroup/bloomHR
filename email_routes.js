// email_routes.js - sends email and reads the sent-mail log.
//
// Every route needs a signed-in caller (verified like the admin API, see admin_routes.js) whose role has the right
// module permission (the same ones the app uses to show or hide screens; ADMIN always). Without that, anyone who could
// reach this server could send mail from the company address and read its sent-mail history.
//
// The email provider account is shared by every company, so the log is never read from the provider's list. Each send
// is recorded in sent_emails with the caller's company, the log lists only that company's rows, and the provider is
// asked for one email's details only after the row has been found in the caller's company.
//
// A company can send from its own mail server (cPanel or any SMTP, company_mail_server.js): when it has one turned on,
// every send of that company's goes through it, from its own address, whatever provider the request names. Otherwise
// mail goes through Resend (or the server-wide SMTP / cPanel account, kept as a fallback) as before.
//
//   POST /api/email/send   { purpose, to, subject, html, attachments?, provider?, cpanelUser? }
//   POST /api/email/bulk   { purpose: "email-portal", to: [...], subject, html, attachments? }  (queued, see below)
//   GET  /api/email/logs?limit=&cursor=
//   GET  /api/email/logs/:id
//   GET  /api/email/sender               who the company's email comes from (any signed-in member)
//   GET  /api/email/mail-server          the company's own mail server settings, never the password (Settings)
//   PUT  /api/email/mail-server          save them; a password left out keeps the saved one (Settings)
//   POST /api/email/mail-server/test     send a test email to the caller through the saved server (Settings)
import express from "express";
import nodemailer from "nodemailer";
import { Resend } from "resend";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { authenticate, HttpError, admin } from "./admin_routes.js";
import { callerHasModule, createSharedBudget } from "./authz.js";
import {
    asSettings,
    describeSmtpError,
    fromHeader,
    isActive,
    loadMailServer,
    publicSettings,
    transportFor,
} from "./company_mail_server.js";

dotenv.config();

const router = express.Router();

// Initialize Resend if API key is present
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Fallback Nodemailer Transporter configuration
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true", // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
    },
});

// What each kind of send needs. The module ids are the sidebar permission ids.
const PURPOSES = {
    "email-portal": { modules: ["email-portal"] },
    termination: { modules: ["employees", "hr-lifecycle"] },
    "hr-reminder": { modules: ["hr-lifecycle"] },
    warning: { modules: ["staffcheck"] },
    recruitment: { modules: ["recruitment"] },
    // offer letters to candidates (FIG-831): whoever makes offers, HR or Recruitment
    offer: { modules: ["employees", "recruitment"] },
    performance: { modules: ["performance"] },
    "staff-signup": { modules: ["adminconfirm"] },
};
const LOG_MODULES = ["email-portal", "adminconfirm"];
// who may see and change the company's own mail server (ADMIN always)
const MAIL_SERVER_MODULES = ["settings"];
const MISSING_TABLE = ["42P01", "PGRST205"];

const MAX_RECIPIENTS = 50; // per request
const MAX_SUBJECT = 200;
const MAX_HTML = 1_000_000; // characters
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_TOTAL = 10_000_000; // characters of base64 across all attachments
const PROVIDERS = ["resend", "cpanel"];
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i; // sent_emails ids
const CURSOR_RE = /^\d{1,7}$/; // the log is paged by position

// A company-wide email is queued (bulk_emails, migration 20261014500000) and sent by the send-notification-emails Edge
// Function, so it can reach every employee instead of the browser sending one request per person (FIG-820).
const BULK_PURPOSES = ["email-portal"];
const MAX_BULK_RECIPIENTS = 25_000; // per request

// Budgets, counted in the database so every server instance shares them (see createSharedBudget):
//   * recipients per user per hour, so a stolen session cannot be used to spam from the company address;
//   * recipients per company per day (EMAIL_COMPANY_DAILY_LIMIT, default 50,000), inline and queued sends together,
//     so even a company-wide email cannot be sent over and over.
const HOUR = 60 * 60 * 1000;
const COMPANY_DAILY_LIMIT = (() => {
    const n = Number(process.env.EMAIL_COMPANY_DAILY_LIMIT);
    return Number.isInteger(n) && n > 0 ? n : 50_000;
})();
const takeUserBudget = createSharedBudget("email-recipients", { default: { limit: 1000, windowMs: HOUR } });
const companyBudget = createSharedBudget("email-recipients-company", { default: { limit: COMPANY_DAILY_LIMIT, windowMs: 24 * HOUR } });
const takeCompanyBudget = (caller, cost) => companyBudget(caller, "default", cost, "company");

const handler = (fn) => async (req, res) => {
    try {
        if (!admin) throw new HttpError(500, "Email API is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
        const caller = await authenticate(req);
        await fn(req, res, caller);
    } catch (err) {
        const status = err instanceof HttpError ? err.status : err.status && err.status < 500 ? err.status : 500;
        if (status >= 500) console.error("[email]", err);
        // never hand internal details (provider messages, stack traces) back to the browser
        res.status(status).json({ error: status >= 500 && !(err instanceof HttpError) ? "Request failed" : err.message || "Request failed" });
    }
};

// cPanel mailboxes a caller may send as: the default one plus any listed in CPANEL_ALLOWED_USERS (comma separated).
const allowedCpanelUsers = () =>
    [process.env.CPANEL_USER, ...(process.env.CPANEL_ALLOWED_USERS || "").split(",")]
        .map((u) => (u || "").trim())
        .filter(Boolean);

const asRecipients = (to) => {
    const list = (Array.isArray(to) ? to : [to]).map((t) => (typeof t === "string" ? t.trim() : ""));
    if (list.length === 0 || list.length > MAX_RECIPIENTS) throw new HttpError(400, `Between 1 and ${MAX_RECIPIENTS} recipients per request`);
    for (const addr of list) {
        if (!addr || addr.length > 254 || !EMAIL_RE.test(addr)) throw new HttpError(400, "Invalid recipient address");
    }
    return list;
};

// The subject and body of a send, checked: a one-line subject (no header injection) and a body of bounded size.
const asContent = ({ subject, html }) => {
    if (typeof subject !== "string" || !subject.trim() || typeof html !== "string" || !html.trim()) {
        throw new HttpError(400, "to, subject, and html are required");
    }
    if (subject.length > MAX_SUBJECT || /[\r\n]/.test(subject)) throw new HttpError(400, "Invalid subject");
    if (html.length > MAX_HTML) throw new HttpError(400, "Email body is too large");
    return { subject, html };
};

// Attachments as [{ filename, content (base64) }], checked: a few, of bounded size, with plain file names.
const asAttachments = (attachments) => {
    const files = [];
    if (attachments === undefined) return files;
    if (!Array.isArray(attachments) || attachments.length > MAX_ATTACHMENTS) throw new HttpError(400, `At most ${MAX_ATTACHMENTS} attachments`);
    let total = 0;
    for (const att of attachments) {
        const name = typeof att?.filename === "string" ? att.filename : "";
        if (!name || name.length > 200 || /[\\/\r\n]/.test(name) || typeof att.content !== "string") throw new HttpError(400, "Invalid attachment");
        total += att.content.length;
        files.push({ filename: name, content: att.content });
    }
    if (total > MAX_ATTACHMENT_TOTAL) throw new HttpError(400, "Attachments are too large");
    return files;
};

// Records a send in the caller's company log. The mail has already gone, so a failure here is logged, not reported.
async function recordSend(caller, { provider, providerId, purpose, from, to, subject }) {
    const { error } = await admin.from("sent_emails").insert({
        tenant_id: caller.tenantId,
        provider,
        provider_id: providerId || null,
        purpose,
        sent_by: caller.id,
        from_address: from || null,
        to_addresses: to,
        subject,
    });
    if (error) console.error("[email] could not record the send in sent_emails:", error);
}

const asLogEntry = (row) => ({
    id: row.id,
    from: row.from_address,
    to: row.to_addresses,
    subject: row.subject,
    created_at: row.created_at,
    last_event: "sent",
});

// The caller's company's sent mail, newest first: { object: "list", data: [...], has_more, next_cursor }
router.get(
    "/logs",
    handler(async (req, res, caller) => {
        if (!(await callerHasModule(caller, LOG_MODULES))) throw new HttpError(403, "Forbidden");

        const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, "limit must be a whole number from 1 to 100");
        const cursor = req.query.cursor === undefined ? "0" : String(req.query.cursor);
        if (!CURSOR_RE.test(cursor)) throw new HttpError(400, "Invalid cursor");
        const offset = Number(cursor);

        // one extra row tells us whether there is another page
        const { data, error } = await admin
            .from("sent_emails")
            .select("id, from_address, to_addresses, subject, created_at")
            .eq("tenant_id", caller.tenantId)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(offset, offset + limit);
        if (error) throw new HttpError(500, "Could not read the email log");

        const rows = data || [];
        const hasMore = rows.length > limit;
        res.json({
            object: "list",
            data: rows.slice(0, limit).map(asLogEntry),
            has_more: hasMore,
            next_cursor: hasMore ? String(offset + limit) : null,
        });
    })
);

// One email from the caller's company's log, with the provider's details (body, delivery status) when it has them
router.get(
    "/logs/:id",
    handler(async (req, res, caller) => {
        if (!(await callerHasModule(caller, LOG_MODULES))) throw new HttpError(403, "Forbidden");
        if (!UUID_RE.test(req.params.id)) throw new HttpError(400, "Invalid email id");

        const { data: row, error } = await admin
            .from("sent_emails")
            .select("id, provider, provider_id, from_address, to_addresses, subject, created_at")
            .eq("id", req.params.id)
            .eq("tenant_id", caller.tenantId)
            .maybeSingle();
        if (error) throw new HttpError(500, "Could not read the email log");
        if (!row) throw new HttpError(404, "Email not found");

        if (row.provider !== "resend" || !row.provider_id || !process.env.RESEND_API_KEY) return res.json(asLogEntry(row));

        const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(row.provider_id)}`, {
            method: "GET",
            headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        });
        if (!response.ok) {
            console.error("[email] Resend email lookup failed:", response.status, await response.text());
            // the log entry is still ours to show, just without the provider's details
            return res.json(asLogEntry(row));
        }
        res.json({ ...(await response.json()), id: row.id });
    })
);

// Email sending endpoint
router.post(
    "/send",
    handler(async (req, res, caller) => {
        const purpose = String(req.body?.purpose || "");
        const rule = PURPOSES[purpose];
        if (!rule) throw new HttpError(400, "Unknown email purpose");

        // permission first, so a caller without access learns nothing else about the request rules
        if (!(await callerHasModule(caller, rule.modules))) throw new HttpError(403, "Forbidden");

        const { subject, html } = asContent(req.body);
        const recipients = asRecipients(req.body.to);

        const provider = req.body.provider === undefined ? "resend" : String(req.body.provider);
        if (!PROVIDERS.includes(provider)) throw new HttpError(400, "Unknown email provider");

        const files = asAttachments(req.body.attachments);

        let cpanelUser = process.env.CPANEL_USER;
        if (provider === "cpanel" && req.body.cpanelUser !== undefined && req.body.cpanelUser !== "") {
            cpanelUser = String(req.body.cpanelUser).trim();
            if (!allowedCpanelUsers().includes(cpanelUser)) throw new HttpError(403, "You cannot send as that mailbox");
        }

        if (!(await takeUserBudget(caller, "default", recipients.length)) || !(await takeCompanyBudget(caller, recipients.length))) {
            throw new HttpError(429, "Email limit reached for now. Try again later.");
        }

        const record = (used, providerId, from) =>
            recordSend(caller, { provider: used, providerId, purpose, from, to: recipients, subject });

        // 0. The company's own mail server, when it has one turned on. It wins over any provider asked for, and a
        // failure is reported rather than the email being sent from another address instead.
        const own = await loadMailServer(caller.tenantId);
        if (isActive(own)) {
            let info;
            try {
                info = await transportFor(own).sendMail({
                    from: fromHeader(own),
                    to: recipients,
                    subject,
                    html,
                    attachments: files.map((att) => ({ filename: att.filename, content: att.content, encoding: "base64" })),
                });
            } catch (err) {
                if (err instanceof HttpError) throw err;
                console.error("[email] company mail server error:", err?.code || err);
                throw new HttpError(502, `Your mail server did not send it. ${describeSmtpError(err, own)}`);
            }
            await record("own_server", info.messageId, own.from_address);
            return res.json({ message: "Email sent successfully from your mail server", id: info.messageId });
        }

        // 1. Send via Resend
        if (provider === "resend" && resend) {
            const from = process.env.SMTP_FROM || "onboarding@resend.dev";
            const { data, error } = await resend.emails.send({
                from,
                to: recipients,
                subject,
                html,
                attachments: files.length ? files : undefined,
            });
            if (error) {
                console.error("[email] Resend error:", error);
                throw new HttpError(502, "The email provider rejected the message");
            }
            await record("resend", data.id, from);
            return res.json({ message: "Email sent successfully", id: data.id });
        }
        if (provider === "resend") {
            console.log("[email] Resend selected but not configured, falling back to default SMTP");
        }

        // 2. cPanel (SMTP) or the default SMTP account
        const mailOptions = {
            from: process.env.SMTP_FROM || `"Figbloom HR" <${process.env.SMTP_USER}>`,
            to: recipients,
            subject,
            html,
            attachments: files.map((att) => ({ filename: att.filename, content: att.content, encoding: "base64" })),
        };

        if (provider === "cpanel") {
            const cpanelPass = process.env.CPANEL_PASSWORD;
            const cpanelHost = process.env.CPANEL_HOST;
            if (!cpanelUser || !cpanelPass || !cpanelHost) {
                throw new HttpError(503, "cPanel email is not configured on the server");
            }
            const cpanelTransporter = nodemailer.createTransport({
                host: cpanelHost,
                port: 465,
                secure: true,
                auth: { user: cpanelUser, pass: cpanelPass },
            });
            const info = await cpanelTransporter.sendMail(mailOptions);
            await record("cpanel", info.messageId, cpanelUser);
            return res.json({ message: "Email sent successfully via cPanel", id: info.messageId });
        }

        const info = await transporter.sendMail(mailOptions);
        await record("smtp", info.messageId, mailOptions.from);
        res.json({ message: "Email sent successfully", id: info.messageId });
    })
);

// Who the company's email comes from, for the line under "Compose Email": its own server's address when it has one
// turned on, otherwise Figbloom HR mail. Any signed-in member may ask; it is only the From address.
router.get(
    "/sender",
    handler(async (_req, res, caller) => {
        const own = await loadMailServer(caller.tenantId);
        if (isActive(own)) return res.json({ own_server: true, from_address: own.from_address, from_name: own.from_name || "" });
        res.json({ own_server: false, from_address: null, from_name: "" });
    })
);

// The company's own mail server settings, without the password: { settings: {...} | null }
router.get(
    "/mail-server",
    handler(async (_req, res, caller) => {
        if (!(await callerHasModule(caller, MAIL_SERVER_MODULES))) throw new HttpError(403, "Forbidden");
        res.json({ settings: publicSettings(await loadMailServer(caller.tenantId)) });
    })
);

// Saves the company's own mail server. A password left out (or empty) keeps the saved one.
router.put(
    "/mail-server",
    handler(async (req, res, caller) => {
        if (!(await callerHasModule(caller, MAIL_SERVER_MODULES))) throw new HttpError(403, "Forbidden");
        const existing = await loadMailServer(caller.tenantId);
        const row = { ...asSettings(req.body, existing, caller.tenantId), updated_by: caller.id, updated_at: new Date().toISOString() };
        const { error } = await admin.from("company_mail_servers").upsert(row, { onConflict: "tenant_id" });
        if (error) {
            if (MISSING_TABLE.includes(String(error.code))) {
                throw new HttpError(503, "Own mail servers are not set up on this system yet (database update pending)");
            }
            throw new HttpError(500, "Could not save the mail server settings");
        }
        res.json({ settings: publicSettings(row) });
    })
);

// Sends a test email to the caller through the saved server (turned on or not), and records how it went:
// { ok, message, tested_at }.
router.post(
    "/mail-server/test",
    handler(async (_req, res, caller) => {
        if (!(await callerHasModule(caller, MAIL_SERVER_MODULES))) throw new HttpError(403, "Forbidden");
        const own = await loadMailServer(caller.tenantId);
        if (!own || !own.password_encrypted) throw new HttpError(400, "Save the mail server settings, with the password, first");
        const to = String(caller.email || "");
        if (!EMAIL_RE.test(to)) throw new HttpError(400, "Your login has no email address to send the test to");
        if (!(await takeUserBudget(caller, "default", 1)) || !(await takeCompanyBudget(caller, 1))) {
            throw new HttpError(429, "Email limit reached for now. Try again later.");
        }

        const subject = "Test email from Figbloom HR";
        let ok = true;
        let message = `Test email sent to ${to}.`;
        let providerId = null;
        try {
            const info = await transportFor(own).sendMail({
                from: fromHeader(own),
                to,
                subject,
                html: `<p>This is a test email sent through your mail server (${own.host}).</p><p>If you can read it, your company's email can be sent from ${own.from_address}.</p>`,
            });
            providerId = info.messageId;
        } catch (err) {
            if (err instanceof HttpError) throw err;
            console.error("[email] company mail server test failed:", err?.code || err);
            ok = false;
            message = describeSmtpError(err, own);
        }

        const testedAt = new Date().toISOString();
        const { error } = await admin
            .from("company_mail_servers")
            .update({ last_test_ok: ok, last_test_at: testedAt, last_test_message: message })
            .eq("tenant_id", caller.tenantId);
        if (error) console.error("[email] could not record the mail server test:", error);
        if (ok) await recordSend(caller, { provider: "own_server", providerId, purpose: "mail-server-test", from: own.from_address, to: [to], subject });

        // the request worked either way: the answer says whether the mail server did
        res.json({ ok, message, tested_at: testedAt });
    })
);

// A company-wide email: queued for the send-notification-emails Edge Function, which sends it through Resend, each
// person getting their own copy. Only the company's own employees' work emails are queued (queue_bulk_email()); the
// rest are skipped and counted. Answers 202 { id, queued, skipped }.
router.post(
    "/bulk",
    handler(async (req, res, caller) => {
        const purpose = String(req.body?.purpose || "");
        if (!BULK_PURPOSES.includes(purpose)) throw new HttpError(400, "Unknown email purpose");

        // permission first, so a caller without access learns nothing else about the request rules
        if (!(await callerHasModule(caller, PURPOSES[purpose].modules))) throw new HttpError(403, "Forbidden");

        const { subject, html } = asContent(req.body);
        const to = req.body.to;
        if (!Array.isArray(to) || to.length === 0 || to.length > MAX_BULK_RECIPIENTS) {
            throw new HttpError(400, `Between 1 and ${MAX_BULK_RECIPIENTS} recipients per request`);
        }
        const recipients = [...new Set(to.map((t) => (typeof t === "string" ? t.trim().toLowerCase() : "")))];
        if (recipients.some((addr) => !addr || addr.length > 254 || !EMAIL_RE.test(addr))) throw new HttpError(400, "Invalid recipient address");
        const files = asAttachments(req.body.attachments);

        if (!(await takeCompanyBudget(caller, recipients.length))) {
            throw new HttpError(429, "Your company has reached its daily email limit. Try again tomorrow.");
        }

        const { data, error } = await admin.rpc("queue_bulk_email", {
            p_tenant: caller.tenantId,
            p_created_by: caller.id,
            p_purpose: purpose,
            p_from: process.env.SMTP_FROM || "onboarding@resend.dev",
            p_subject: subject,
            p_html: html,
            p_attachments: files,
            p_emails: recipients,
        });
        if (error) throw new HttpError(500, "Could not queue the email");
        const row = (Array.isArray(data) ? data[0] : data) || {};
        if (!row.bulk_email_id) throw new HttpError(400, "None of the recipients is an employee's work email");
        res.status(202).json({ id: row.bulk_email_id, queued: row.queued, skipped: row.skipped });
    })
);

export default router;
