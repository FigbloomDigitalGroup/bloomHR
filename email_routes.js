// email_routes.js - sends email and reads the sent-mail log.
//
// Every route needs a signed-in caller (verified like the admin API, see admin_routes.js) whose role has the right
// module permission (the same ones the app uses to show or hide screens; ADMIN always). Without that, anyone who could
// reach this server could send mail from the company address and read its sent-mail history.
//
//   POST /api/email/send   { purpose, to, subject, html, attachments?, provider?, cpanelUser? }
//   GET  /api/email/logs?limit=&cursor=
//   GET  /api/email/logs/:id
import express from "express";
import nodemailer from "nodemailer";
import { Resend } from "resend";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { authenticate, HttpError, admin } from "./admin_routes.js";
import { callerHasModule, createBudget } from "./authz.js";

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
    performance: { modules: ["performance"] },
    "staff-signup": { modules: ["adminconfirm"] },
};
const LOG_MODULES = ["email-portal", "adminconfirm"];

const MAX_RECIPIENTS = 50; // per request
const MAX_SUBJECT = 200;
const MAX_HTML = 1_000_000; // characters
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_TOTAL = 10_000_000; // characters of base64 across all attachments
const PROVIDERS = ["resend", "cpanel"];
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const ID_RE = /^[A-Za-z0-9_-]{1,100}$/; // provider cursors / email ids

// Per-user budget (recipients per hour) so a stolen session cannot be used to spam from the company address.
const takeBudget = createBudget({ default: { limit: 1000, windowMs: 60 * 60 * 1000 } });

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

// Get email logs from Resend using REST API
router.get(
    "/logs",
    handler(async (req, res, caller) => {
        if (!(await callerHasModule(caller, LOG_MODULES))) throw new HttpError(403, "Forbidden");
        if (!process.env.RESEND_API_KEY) throw new HttpError(503, "Email logs are not configured on the server");

        const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpError(400, "limit must be a whole number from 1 to 100");
        const cursor = req.query.cursor === undefined ? "" : String(req.query.cursor);
        if (cursor && !ID_RE.test(cursor)) throw new HttpError(400, "Invalid cursor");

        let url = `https://api.resend.com/emails?limit=${limit}`;
        if (cursor) url += `&cursor=${cursor}`;

        const response = await fetch(url, {
            method: "GET",
            headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        });
        if (!response.ok) {
            console.error("[email] Resend log lookup failed:", response.status, await response.text());
            throw new HttpError(502, "Could not read the email log from the provider");
        }
        res.json(await response.json());
    })
);

// Get single email details from Resend
router.get(
    "/logs/:id",
    handler(async (req, res, caller) => {
        if (!(await callerHasModule(caller, LOG_MODULES))) throw new HttpError(403, "Forbidden");
        if (!process.env.RESEND_API_KEY) throw new HttpError(503, "Email logs are not configured on the server");
        if (!ID_RE.test(req.params.id)) throw new HttpError(400, "Invalid email id");

        const response = await fetch(`https://api.resend.com/emails/${req.params.id}`, {
            method: "GET",
            headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        });
        if (!response.ok) {
            console.error("[email] Resend email lookup failed:", response.status, await response.text());
            throw new HttpError(response.status === 404 ? 404 : 502, response.status === 404 ? "Email not found" : "Could not read the email from the provider");
        }
        res.json(await response.json());
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

        const { subject, html, attachments } = req.body;
        if (typeof subject !== "string" || !subject.trim() || typeof html !== "string" || !html.trim()) {
            throw new HttpError(400, "to, subject, and html are required");
        }
        if (subject.length > MAX_SUBJECT || /[\r\n]/.test(subject)) throw new HttpError(400, "Invalid subject");
        if (html.length > MAX_HTML) throw new HttpError(400, "Email body is too large");
        const recipients = asRecipients(req.body.to);

        const provider = req.body.provider === undefined ? "resend" : String(req.body.provider);
        if (!PROVIDERS.includes(provider)) throw new HttpError(400, "Unknown email provider");

        let files = [];
        if (attachments !== undefined) {
            if (!Array.isArray(attachments) || attachments.length > MAX_ATTACHMENTS) throw new HttpError(400, `At most ${MAX_ATTACHMENTS} attachments`);
            let total = 0;
            for (const att of attachments) {
                const name = typeof att?.filename === "string" ? att.filename : "";
                if (!name || name.length > 200 || /[\\/\r\n]/.test(name) || typeof att.content !== "string") throw new HttpError(400, "Invalid attachment");
                total += att.content.length;
                files.push({ filename: name, content: att.content });
            }
            if (total > MAX_ATTACHMENT_TOTAL) throw new HttpError(400, "Attachments are too large");
        }

        let cpanelUser = process.env.CPANEL_USER;
        if (provider === "cpanel" && req.body.cpanelUser !== undefined && req.body.cpanelUser !== "") {
            cpanelUser = String(req.body.cpanelUser).trim();
            if (!allowedCpanelUsers().includes(cpanelUser)) throw new HttpError(403, "You cannot send as that mailbox");
        }

        if (!takeBudget(caller.id, "default", recipients.length)) throw new HttpError(429, "Email limit reached for now. Try again later.");

        // 1. Send via Resend
        if (provider === "resend" && resend) {
            const { data, error } = await resend.emails.send({
                from: process.env.SMTP_FROM || "onboarding@resend.dev",
                to: recipients,
                subject,
                html,
                attachments: files.length ? files : undefined,
            });
            if (error) {
                console.error("[email] Resend error:", error);
                throw new HttpError(502, "The email provider rejected the message");
            }
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
            return res.json({ message: "Email sent successfully via cPanel", id: info.messageId });
        }

        const info = await transporter.sendMail(mailOptions);
        res.json({ message: "Email sent successfully", id: info.messageId });
    })
);

export default router;
