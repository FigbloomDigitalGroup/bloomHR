// mailbox_routes.js - each person's own mailbox, read and sent from inside the app (FIG-1205: PR 1 reading, PR 2 sending).
//
// A person with the "My mailbox" module connects their own mailbox (e.g. mary@company.com on the company's cPanel) and
// reads it here. Every request is on its own (Vercel keeps nothing between requests): it signs the caller in, loads
// THEIR mailbox (found by their own user id and company, never by anything in the request), decrypts the password,
// logs in to the mail server over TLS with short timeouts, does one thing, and logs out. No mail is stored.
//
// The password is encrypted (company_mail_server.js: AES-256-GCM with MAIL_SERVER_ENCRYPTION_KEY) with the person's
// user id and company id bound in, so a stored password only opens for that person in that company. It is never sent
// back to the browser.
//
// Limits: IMAP on 993 (SSL/TLS) or 143 (STARTTLS, required) only; a server name that is (or resolves to) our own
// machine or a private network is refused, so this cannot be used to probe internal networks; emails and attachments
// over 25 MB are not opened; connection tests are rate limited. Nothing about a message (contents, addresses,
// subjects) or a password is ever logged, only error codes.
//
//   GET    /api/mailbox/account                 the caller's mailbox (never the password) and the suggested settings
//   POST   /api/mailbox/test                    try logging in with these settings: { ok, message }
//   PUT    /api/mailbox/account                 connect (or change): logs in first, saves only if that works
//   DELETE /api/mailbox/account                 disconnect: deletes the row, password included
//   GET    /api/mailbox/folders                 folders with their special use and unread counts
//   GET    /api/mailbox/messages?folder=&page=  50 per page, newest first
//   GET    /api/mailbox/message?folder=&uid=    one email: headers, text, html, attachments; marks it read
//   GET    /api/mailbox/attachment?folder=&uid=&part=   the file, as a download
//   POST   /api/mailbox/send                    send from your own mailbox (PR 2 of 3; see "sending" below)
//   POST   /api/mailbox/flags | move | delete   read/unread, flag, move, delete (PR 3 of 3; see "managing mail" below)
//   GET    /api/mailbox/search?folder=&q=       search one folder, newest first
//   GET    /api/mailbox/unread                  INBOX's unread count, for the sidebar badge
import crypto from "node:crypto";
import express from "express";
import dns from "node:dns";
import net from "node:net";
import { pipeline } from "node:stream/promises";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { authenticate, HttpError, admin } from "./admin_routes.js";
import { callerHasModule, createSharedBudget } from "./authz.js";
import { EMAIL_RE, SMTP_PORTS, asMailHost, decryptSecret, encryptSecret, isNonPublicResolved, loadMailServer } from "./company_mail_server.js";

const router = express.Router();

export const MAILBOX_MODULES = ["mailbox"];
/** 993: SSL/TLS from the start; 143: plain, then STARTTLS (required: never logs in unencrypted). */
export const IMAP_PORTS = [993, 143];
export const PAGE_SIZE = 50;
export const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;
const MISSING_TABLE = ["42P01", "PGRST205"];
const UNREADABLE = "Your saved mailbox password can't be read. Disconnect and connect your mailbox again.";
const NOT_CONNECTED = "Connect your mailbox first";
const COLUMNS =
    "user_id, tenant_id, email, imap_host, imap_port, secure, username, password_encrypted, smtp_host, smtp_port, connected_at, last_ok_at, last_error";

// logging in with a password typed into the form: a budget per person, so the test cannot be used to guess passwords
const HOUR = 60 * 60 * 1000;
const takeLoginBudget = createSharedBudget("mailbox-login", { default: { limit: 20, windowMs: HOUR } });

/** What the password is bound to: this person in this company (never usable for anyone else's row). */
export const mailboxBinding = (userId, tenantId) => `user-mailbox:${tenantId}:${userId}`;

const handler = (fn) => async (req, res) => {
    try {
        if (!admin) throw new HttpError(500, "Mailbox API is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
        const caller = await authenticate(req);
        if (!(await callerHasModule(caller, MAILBOX_MODULES))) throw new HttpError(403, "Forbidden");
        await fn(req, res, caller);
    } catch (err) {
        const status = err instanceof HttpError ? err.status : 500;
        // only what kind of error it was: a mail server's reply can quote the login, an address or a subject
        if (status >= 500) console.error("[mailbox]", err instanceof HttpError ? `${status} ${err.message}` : err?.code || err?.name || "error");
        if (res.headersSent) {
            res.destroy();
            return;
        }
        res.status(status).json({ error: err instanceof HttpError ? err.message : "Request failed" });
    }
};

// ---------------------------------------------------------------------------------------------
// the stored mailbox
// ---------------------------------------------------------------------------------------------

/** The caller's own mailbox row (with the encrypted password), or null. */
async function loadMailbox(caller) {
    const { data, error } = await admin
        .from("user_mailboxes")
        .select(COLUMNS)
        .eq("user_id", caller.id)
        .eq("tenant_id", caller.tenantId)
        .maybeSingle();
    if (error) {
        if (MISSING_TABLE.includes(String(error.code))) return null;
        throw new HttpError(500, "Could not read your mailbox settings");
    }
    return data || null;
}

/** What the browser may see: everything but the password. */
export const publicMailbox = (row) =>
    row
        ? {
              email: row.email,
              imap_host: row.imap_host,
              imap_port: row.imap_port,
              secure: row.secure,
              username: row.username,
              smtp_host: row.smtp_host ?? null,
              smtp_port: row.smtp_port ?? null,
              connected_at: row.connected_at ?? null,
              last_ok_at: row.last_ok_at ?? null,
              last_error: row.last_error ?? null,
              password_set: Boolean(row.password_encrypted),
          }
        : null;

// services that only send mail: their host is no guess for where to read it
const SENDING_ONLY = /(^smtp\.|sendgrid|mailgun|amazonaws|resend|postmark|sparkpost|brevo|sendinblue|office365|outlook|gmail|google)/i;

/**
 * The settings to suggest: the caller's login email, and the company's own mail server (FIG-904) for both reading and
 * sending when it is cPanel-style (cPanel serves IMAP and SMTP on the same host); otherwise mail.<their domain>.
 */
export function suggestedSettings(email, companyServer) {
    const address = EMAIL_RE.test(String(email || "")) ? String(email).toLowerCase() : "";
    const domain = address ? address.split("@")[1] : "";
    const guess = domain ? `mail.${domain}` : "";
    const useCompany = companyServer?.host && !SENDING_ONLY.test(companyServer.host);
    return {
        email: address,
        imap_host: useCompany ? companyServer.host : guess,
        imap_port: 993,
        smtp_host: useCompany ? companyServer.host : guess,
        smtp_port: useCompany && SMTP_PORTS.includes(companyServer.port) ? companyServer.port : 465,
        from_company_server: Boolean(useCompany),
    };
}

const oneLine = (v, max, message) => {
    const s = typeof v === "string" ? v.trim() : "";
    if (s.length > max || /[\r\n\0]/.test(s)) throw new HttpError(400, message);
    return s;
};

/**
 * The mailbox from a request body, checked. A password left out (or empty) keeps the saved one, as long as the server
 * and login are the same. Returns { row (without the password), password (plain), changed }.
 */
export function asMailboxInput(body, existing, caller) {
    const b = body || {};
    const email = oneLine(b.email, 254, "Enter a valid email address").toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, "Enter a valid email address");
    const imapHost = asMailHost(oneLine(b.imap_host, 253, "Invalid mail server"), "Enter the mail server's name, e.g. mail.yourcompany.com");
    const imapPort = b.imap_port === undefined || b.imap_port === "" || b.imap_port === null ? 993 : Number(b.imap_port);
    if (!IMAP_PORTS.includes(imapPort)) throw new HttpError(400, "The incoming mail port must be 993 (SSL/TLS) or 143 (STARTTLS)");
    const username = oneLine(b.username ?? "", 254, "Invalid username") || email;
    const smtpHost = b.smtp_host ? asMailHost(oneLine(b.smtp_host, 253, "Invalid outgoing mail server"), "Enter the outgoing mail server's name") : imapHost;
    const smtpPort = b.smtp_port === undefined || b.smtp_port === "" || b.smtp_port === null ? 465 : Number(b.smtp_port);
    if (!SMTP_PORTS.includes(smtpPort)) throw new HttpError(400, `The outgoing mail port must be one of ${SMTP_PORTS.join(", ")}`);

    const sameLogin = existing && existing.imap_host === imapHost && existing.imap_port === imapPort && existing.username === username;
    let password;
    if (b.password !== undefined && b.password !== null && b.password !== "") {
        if (typeof b.password !== "string" || b.password.length > 500) throw new HttpError(400, "Invalid password");
        password = b.password;
    } else if (sameLogin && existing.password_encrypted) {
        password = decryptSecret(existing.password_encrypted, mailboxBinding(caller.id, caller.tenantId), UNREADABLE);
    } else {
        throw new HttpError(400, "Enter your mailbox password");
    }

    return {
        row: {
            user_id: caller.id,
            tenant_id: caller.tenantId,
            email,
            imap_host: imapHost,
            imap_port: imapPort,
            secure: imapPort === 993,
            username,
            smtp_host: smtpHost,
            smtp_port: smtpPort,
        },
        password,
    };
}

// ---------------------------------------------------------------------------------------------
// talking to the mail server
// ---------------------------------------------------------------------------------------------

/**
 * The address to connect to for a mail server's name: refused when the name is (or resolves to) our own machine or a
 * private network. Connecting to the address that was checked (with the name kept for TLS) means a second lookup
 * cannot point somewhere else.
 */
export async function resolvePublicAddress(host) {
    if (net.isIP(host)) {
        if (isNonPublicResolved(host)) throw new HttpError(400, `${host} is not a public mail server`);
        return host;
    }
    let found;
    try {
        found = await dns.promises.lookup(host, { all: true, verbatim: true });
    } catch {
        throw new HttpError(400, `Can't find a mail server called ${host}. Check the name.`);
    }
    if (!found.length) throw new HttpError(400, `Can't find a mail server called ${host}. Check the name.`);
    if (found.some((a) => isNonPublicResolved(a.address))) throw new HttpError(400, `${host} is not a public mail server`);
    return (found.find((a) => a.family === 4) || found[0]).address;
}

/** What went wrong logging in or reading, in plain words. Never the server's own reply, which can echo the login. */
export function describeImapError(err, box) {
    if (err instanceof HttpError) return err.message;
    const where = `${box.imap_host} on port ${box.imap_port}`;
    if (err?.authenticationFailed) return "Wrong email or password. Check them (the username is usually your full email address).";
    const code = String(err?.code || "");
    if (["ENOTFOUND", "EAI_AGAIN"].includes(code)) return `Can't find a mail server called ${box.imap_host}. Check the name.`;
    if (err?.tlsFailed || /CERT|TLS|SSL|ALTNAME|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code)) {
        return `The secure connection to ${box.imap_host} failed: its certificate is not valid for that name. Ask your host for the right mail server name (often your hosting server's name).`;
    }
    if (["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ETIMEOUT", "EHOSTUNREACH", "ENETUNREACH", "CONNECT_TIMEOUT", "GREETING_TIMEOUT", "NoConnection", "EPIPE"].includes(code)) {
        return `Can't reach ${where}. Check the server name and port.`;
    }
    return `The mail server ${box.imap_host} did not accept the request.`;
}

const errorCode = (err) => (err?.authenticationFailed ? "AUTH" : String(err?.code || err?.name || "error"));

/** Logs in to the mailbox. Throws HttpError(400/502) with a plain message when it can't. */
export async function connectMailbox(box, password) {
    const address = await resolvePublicAddress(box.imap_host);
    const client = new ImapFlow({
        host: address,
        servername: box.imap_host, // the certificate is checked against the name, not the address
        port: box.imap_port,
        secure: box.imap_port === 993,
        doSTARTTLS: box.imap_port === 143 ? true : undefined,
        auth: { user: box.username, pass: password },
        tls: { minVersion: "TLSv1.2" },
        logger: false,
        emitLogs: false,
        disableAutoIdle: true,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
    });
    // a socket error after logging in must not crash the process
    client.on?.("error", () => {});
    try {
        await client.connect();
    } catch (err) {
        console.error("[mailbox] login failed:", errorCode(err));
        safeClose(client);
        throw new HttpError(err?.authenticationFailed ? 400 : 502, describeImapError(err, box));
    }
    return client;
}

function safeClose(client) {
    try {
        client.close();
    } catch {
        // already closed
    }
}

async function logout(client) {
    try {
        await client.logout();
    } catch {
        safeClose(client);
    }
}

/** How the last use went, kept on the row (only when it changed, or an hour on, so reading is not a write each time). */
async function recordOutcome(box, error) {
    const now = Date.now();
    const recent = box.last_ok_at && now - new Date(box.last_ok_at).getTime() < HOUR;
    if (!error && !box.last_error && recent) return;
    if (error && box.last_error === error) return;
    const patch = error ? { last_error: error } : { last_error: null, last_ok_at: new Date(now).toISOString() };
    const { error: dbError } = await admin.from("user_mailboxes").update(patch).eq("user_id", box.user_id).eq("tenant_id", box.tenant_id);
    if (dbError) console.error("[mailbox] could not record the last connection:", dbError.code || "error");
}

/** Runs `fn(client, box)` logged in to the caller's own mailbox (`loaded`, or read now), and always logs out. */
async function withMailbox(caller, fn, loaded) {
    const box = loaded || (await loadMailbox(caller));
    if (!box) throw new HttpError(404, NOT_CONNECTED);
    const password = decryptSecret(box.password_encrypted, mailboxBinding(caller.id, caller.tenantId), UNREADABLE);
    let client;
    try {
        client = await connectMailbox(box, password);
    } catch (err) {
        await recordOutcome(box, err.message);
        throw err;
    }
    try {
        const result = await fn(client, box);
        await recordOutcome(box, null);
        return result;
    } catch (err) {
        if (err instanceof HttpError) throw err;
        console.error("[mailbox] request failed:", errorCode(err));
        if (err?.responseStatus === "NO" || err?.serverResponseCode === "NONEXISTENT") throw new HttpError(404, "That folder or email isn't there any more. Refresh.");
        throw new HttpError(502, describeImapError(err, box));
    } finally {
        await logout(client);
    }
}

// ---------------------------------------------------------------------------------------------
// reading
// ---------------------------------------------------------------------------------------------

const asFolder = (v) => {
    const s = v === undefined || v === "" ? "INBOX" : typeof v === "string" ? v : "";
    if (!s || s.length > 512 || /[\r\n\0]/.test(s)) throw new HttpError(400, "Invalid folder");
    return s;
};
const asUid = (v) => {
    const s = String(v ?? "");
    if (!/^[1-9]\d{0,9}$/.test(s) || Number(s) > 4294967295) throw new HttpError(400, "Invalid email id");
    return s;
};
const asPage = (v) => {
    if (v === undefined || v === "") return 1;
    const s = String(v);
    if (!/^[1-9]\d{0,4}$/.test(s)) throw new HttpError(400, "Invalid page");
    return Number(s);
};
const asPart = (v) => {
    const s = String(v ?? "");
    if (!/^\d{1,3}(\.\d{1,3}){0,9}$/.test(s)) throw new HttpError(400, "Invalid attachment");
    return s;
};

const SPECIAL = { "\\Inbox": "inbox", "\\Sent": "sent", "\\Drafts": "drafts", "\\Trash": "trash", "\\Junk": "junk", "\\Archive": "archive" };
const SPECIAL_ORDER = ["inbox", "drafts", "sent", "archive", "junk", "trash"];

const person = (a) => ({ name: a?.name || "", address: a?.address || "" });
const people = (list) => (Array.isArray(list) ? list.map(person) : []);
const parsedPeople = (field) => (field ? (Array.isArray(field) ? field : [field]).flatMap((f) => f.value || []).map(person) : []);

const filenameOf = (node) => node.dispositionParameters?.filename || node.parameters?.name || "";

/** Decoded size of a part, roughly: base64 grows things by a third. */
const partSize = (node) => {
    const size = Number(node.size) || 0;
    return String(node.encoding || "").toLowerCase() === "base64" ? Math.floor((size * 3) / 4) : size;
};

/**
 * The attachments in a message's body structure: parts sent as attachments, or with a file name that are not the
 * message's own text or an image shown inside it. Each with its part number for downloading.
 */
export function attachmentsOf(structure) {
    const found = [];
    const walk = (node) => {
        if (!node) return;
        if (Array.isArray(node.childNodes) && node.childNodes.length) {
            node.childNodes.forEach(walk);
            return;
        }
        const type = String(node.type || "").toLowerCase();
        const disposition = String(node.disposition || "").toLowerCase();
        const filename = filenameOf(node);
        const embedded = disposition === "inline" && node.id && type.startsWith("image/");
        const isText = (type === "text/plain" || type === "text/html") && !filename;
        if (disposition === "attachment" || (filename && !embedded && !isText) || (type === "message/rfc822" && node !== structure)) {
            found.push({ part: node.part || "1", filename: filename || `attachment-${node.part || "1"}`, size: partSize(node), contentType: type || "application/octet-stream" });
        }
    };
    walk(structure);
    return found;
}

const findPart = (node, part) => {
    if (!node) return null;
    if ((node.part || "1") === part && !(Array.isArray(node.childNodes) && node.childNodes.length)) return node;
    for (const child of node.childNodes || []) {
        const hit = findPart(child, part);
        if (hit) return hit;
    }
    return null;
};

const flagsOf = (msg) => (msg.flags instanceof Set ? msg.flags : new Set(msg.flags || []));

const asIso = (d) => {
    const t = d ? new Date(d) : null;
    return t && !Number.isNaN(t.getTime()) ? t.toISOString() : null;
};

/** One line of the message list. */
export const listEntry = (msg) => {
    const flags = flagsOf(msg);
    const env = msg.envelope || {};
    return {
        uid: msg.uid,
        from: env.from?.[0] ? person(env.from[0]) : null,
        to: people(env.to),
        subject: env.subject || "",
        date: asIso(env.date || msg.internalDate),
        seen: flags.has("\\Seen"),
        flagged: flags.has("\\Flagged"),
        answered: flags.has("\\Answered"),
        has_attachments: attachmentsOf(msg.bodyStructure).length > 0,
        size: Number(msg.size) || 0,
    };
};

router.get(
    "/account",
    handler(async (_req, res, caller) => {
        const [box, company] = await Promise.all([loadMailbox(caller), loadMailServer(caller.tenantId).catch(() => null)]);
        res.json({ account: publicMailbox(box), defaults: suggestedSettings(caller.email, company) });
    })
);

/** The settings from the body, checked, then the login budget: { row, password }. */
async function checkedInput(req, caller, existing) {
    const input = asMailboxInput(req.body, existing, caller);
    if (!(await takeLoginBudget(caller, "default", 1))) throw new HttpError(429, "Too many tries. Wait a while and try again.");
    return input;
}

router.post(
    "/test",
    handler(async (req, res, caller) => {
        const existing = await loadMailbox(caller);
        const { row, password } = await checkedInput(req, caller, existing);
        let client;
        try {
            client = await connectMailbox(row, password);
        } catch (err) {
            if (!(err instanceof HttpError)) throw err;
            // the request worked: the answer says whether the mail server let us in
            return res.json({ ok: false, message: err.message });
        }
        await logout(client);
        // reading works: now sending (the same login, on the outgoing server)
        const smtp = await checkSmtp(row, password);
        if (!smtp.ok) return res.json({ ok: false, message: `Reading works, but sending doesn't: ${smtp.message}` });
        res.json({ ok: true, message: `Connected to ${row.imap_host}. Your mailbox is ready.` });
    })
);

router.put(
    "/account",
    handler(async (req, res, caller) => {
        const existing = await loadMailbox(caller);
        const { row, password } = await checkedInput(req, caller, existing);
        // saved only once logging in works
        await logout(await connectMailbox(row, password));
        const now = new Date().toISOString();
        const sameServer = existing && existing.imap_host === row.imap_host && existing.username === row.username;
        const saved = {
            ...row,
            password_encrypted: encryptSecret(password, mailboxBinding(caller.id, caller.tenantId)),
            connected_at: sameServer && existing.connected_at ? existing.connected_at : now,
            last_ok_at: now,
            last_error: null,
            updated_at: now,
        };
        const { error } = await admin.from("user_mailboxes").upsert(saved, { onConflict: "user_id,tenant_id" });
        if (error) {
            if (MISSING_TABLE.includes(String(error.code))) throw new HttpError(503, "Mailboxes are not set up on this system yet (database update pending)");
            throw new HttpError(500, "Could not save your mailbox");
        }
        // reading is what connecting needs; whether sending works is reported alongside, so it can be fixed here
        res.json({ account: publicMailbox(saved), smtp: await checkSmtp(row, password) });
    })
);

router.delete(
    "/account",
    handler(async (_req, res, caller) => {
        const { error } = await admin.from("user_mailboxes").delete().eq("user_id", caller.id).eq("tenant_id", caller.tenantId);
        if (error && !MISSING_TABLE.includes(String(error.code))) throw new HttpError(500, "Could not disconnect your mailbox");
        res.json({ ok: true });
    })
);

router.get(
    "/folders",
    handler(async (_req, res, caller) => {
        const folders = await withMailbox(caller, (client) => client.list({ statusQuery: { messages: true, unseen: true } }));
        const out = folders
            .filter((f) => !(f.flags instanceof Set ? f.flags : new Set(f.flags || [])).has("\\Noselect"))
            .map((f) => ({
                path: f.path,
                name: f.path.toUpperCase() === "INBOX" ? "Inbox" : f.name || f.path,
                special: SPECIAL[f.specialUse] || (f.path.toUpperCase() === "INBOX" ? "inbox" : null),
                unread: Number(f.status?.unseen) || 0,
                total: Number(f.status?.messages) || 0,
                delimiter: f.delimiter || "/",
            }));
        const rank = (f) => (f.special ? SPECIAL_ORDER.indexOf(f.special) : SPECIAL_ORDER.length);
        out.sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
        res.json({ folders: out });
    })
);

router.get(
    "/messages",
    handler(async (req, res, caller) => {
        const folder = asFolder(req.query.folder);
        const page = asPage(req.query.page);
        const result = await withMailbox(caller, async (client) => {
            const mailbox = await client.mailboxOpen(folder, { readOnly: true });
            const total = Number(mailbox?.exists) || 0;
            const end = total - (page - 1) * PAGE_SIZE;
            const messages = [];
            if (end >= 1) {
                const start = Math.max(1, end - PAGE_SIZE + 1);
                // envelope and body structure only: no message is downloaded for the list
                for await (const msg of client.fetch(`${start}:${end}`, { uid: true, flags: true, envelope: true, bodyStructure: true, size: true, internalDate: true })) {
                    messages.push({ seq: msg.seq, entry: listEntry(msg) });
                }
            }
            messages.sort((a, b) => b.seq - a.seq);
            return { total, messages: messages.map((m) => m.entry) };
        });
        res.json({ folder, page, page_size: PAGE_SIZE, total: result.total, has_more: page * PAGE_SIZE < result.total, messages: result.messages });
    })
);

router.get(
    "/message",
    handler(async (req, res, caller) => {
        const folder = asFolder(req.query.folder);
        const uid = asUid(req.query.uid);
        const message = await withMailbox(caller, async (client) => {
            // opened for writing, so the email can be marked read (as every mail program does on opening it)
            await client.mailboxOpen(folder);
            const meta = await client.fetchOne(uid, { uid: true, size: true, flags: true, bodyStructure: true }, { uid: true });
            if (!meta) throw new HttpError(404, "That email isn't there any more. Refresh.");
            if (Number(meta.size) > MAX_MESSAGE_BYTES) throw new HttpError(413, "This email is too large to open here (over 25 MB).");
            const full = await client.fetchOne(uid, { uid: true, source: true }, { uid: true });
            if (!full?.source) throw new HttpError(404, "That email isn't there any more. Refresh.");
            const parsed = await simpleParser(full.source, { skipTextToHtml: true, skipTextLinks: true });
            let flags = flagsOf(meta);
            if (!flags.has("\\Seen")) {
                try {
                    await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
                    flags = new Set([...flags, "\\Seen"]);
                } catch {
                    // a read-only folder: it stays unread
                }
            }
            return {
                uid: Number(uid),
                folder,
                subject: parsed.subject || "",
                from: parsedPeople(parsed.from),
                to: parsedPeople(parsed.to),
                cc: parsedPeople(parsed.cc),
                reply_to: parsedPeople(parsed.replyTo),
                date: asIso(parsed.date),
                message_id: parsed.messageId || null,
                seen: flags.has("\\Seen"),
                flagged: flags.has("\\Flagged"),
                // embedded images (cid:) are already data: URLs here; the browser shows the html in a sandbox
                html: typeof parsed.html === "string" ? parsed.html : null,
                text: parsed.text || "",
                attachments: attachmentsOf(meta.bodyStructure),
            };
        });
        res.set("Cache-Control", "no-store");
        res.json({ message });
    })
);

/** A file name safe for a Content-Disposition header: no paths, quotes or control characters, ASCII fallback too. */
export function safeFilename(name) {
    const clean =
        String(name || "")
            .replace(/[\u0000-\u001f\u007f"\\/:*?<>|]+/g, "_")
            .replace(/^[.\s]+/, "")
            .trim()
            .slice(0, 150) || "attachment";
    const ascii = clean.replace(/[^\x20-\x7e]/g, "_").replace(/[%;]/g, "_");
    return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

router.get(
    "/attachment",
    handler(async (req, res, caller) => {
        const folder = asFolder(req.query.folder);
        const uid = asUid(req.query.uid);
        const part = asPart(req.query.part);
        await withMailbox(caller, async (client) => {
            await client.mailboxOpen(folder, { readOnly: true });
            const meta = await client.fetchOne(uid, { uid: true, bodyStructure: true }, { uid: true });
            const node = meta && findPart(meta.bodyStructure, part);
            if (!node) throw new HttpError(404, "That attachment isn't there any more. Refresh.");
            if (partSize(node) > MAX_MESSAGE_BYTES) throw new HttpError(413, "This attachment is too large to download here (over 25 MB).");
            const download = await client.download(uid, part, { uid: true, maxBytes: MAX_MESSAGE_BYTES });
            if (!download?.content) throw new HttpError(404, "That attachment isn't there any more. Refresh.");
            res.status(200);
            // always a download, never shown by the browser: a file from an email could be a web page
            res.set({
                "Content-Type": "application/octet-stream",
                "Content-Disposition": safeFilename(download.meta?.filename || filenameOf(node) || `attachment-${part}`),
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": "no-store",
            });
            await pipeline(download.content, res);
        });
    })
);

// ---------------------------------------------------------------------------------------------
// sending (FIG-1205, PR 2 of 3)
// ---------------------------------------------------------------------------------------------
//
// POST /api/mailbox/send, JSON:
//   { to, cc, bcc: [ "a@b.co" | { name, address } ],   at least one, 50 in all
//     subject, text, html,                              text and html up to 256 KB each
//     attachments: [{ filename, content_type, data }],  data in base64; 3 MB in all (see below)
//     reply: { folder, uid },                           replying: threaded (In-Reply-To, References) from the original
//     forward: { folder, uid, parts: ["2", ...] } }     forwarding: those attachments, fetched here from the original
// -> { ok, saved_to_sent, sent_folder, rejected, message }
//
// JSON with base64 rather than multipart: the API has no multipart parser (and no new dependency is wanted), and
// Vercel refuses any request body over 4.5 MB. Base64 grows files by a third, so 3 MB of files is about 4 MB on the
// wire, leaving room for the text. Attachments being forwarded never pass through the browser: they are read from the
// original email here, so they count only towards the 20 MB limit for the whole email.
//
// The From is always the mailbox's own address (never anything in the request), named with the person's name in the
// app. It goes out through their own outgoing server with their own login, and a copy (Bcc kept, marked read) is put in
// their Sent folder: the folder the server marks \Sent, else one called Sent (INBOX.Sent on cPanel). If that copy can't
// be saved, the email has still gone, and the answer says so. 30 sends an hour per person.

export const MAX_RECIPIENTS = 50;
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
export const MAX_SEND_BYTES = 20 * 1024 * 1024;
export const MAX_BODY_CHARS = 256 * 1024;
export const MAX_ATTACHMENTS = 20;
export const SENDS_PER_HOUR = 30;
const takeSendBudget = createSharedBudget("mailbox-send", { default: { limit: SENDS_PER_HOUR, windowMs: HOUR } });

const MB = (bytes) => `${Math.round(bytes / (1024 * 1024))} MB`;
const CONTROL = /[\u0000-\u001f\u007f]+/g;
const CONTENT_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

const LABELS = { to: "To", cc: "Cc", bcc: "Bcc" };

/** One list of recipients, checked: [{ name, address }]. */
function asRecipients(value, field) {
    if (value === undefined || value === null || value === "") return [];
    const list = Array.isArray(value) ? value : [value];
    if (list.length > MAX_RECIPIENTS) throw new HttpError(400, `Send to at most ${MAX_RECIPIENTS} people at once`);
    return list.map((item) => {
        const raw = typeof item === "string" ? { address: item } : item && typeof item === "object" ? item : {};
        const address = typeof raw.address === "string" ? raw.address.trim() : "";
        if (!address || address.length > 254 || !EMAIL_RE.test(address)) {
            const shown = address ? `"${address.replace(CONTROL, "").slice(0, 80)}"` : "An empty address";
            throw new HttpError(400, `${shown} in ${LABELS[field]} is not a valid email address`);
        }
        const name = typeof raw.name === "string" ? raw.name.replace(CONTROL, " ").trim().slice(0, 100) : "";
        return { name, address };
    });
}

const asBody = (v, what) => {
    if (v === undefined || v === null) return "";
    if (typeof v !== "string") throw new HttpError(400, `Invalid ${what}`);
    if (v.length > MAX_BODY_CHARS) throw new HttpError(413, "The message is too long to send from here.");
    return v;
};

/** A file name for an attachment: no paths or control characters. */
export const attachmentName = (name) =>
    String(name || "")
        .replace(CONTROL, "")
        .replace(/[\\/]+/g, "_")
        .replace(/^[.\s]+/, "")
        .trim()
        .slice(0, 150) || "attachment";

const asSource = (v, what) => {
    if (!v || typeof v !== "object") throw new HttpError(400, `Invalid ${what}`);
    return { folder: asFolder(v.folder), uid: asUid(v.uid) };
};

/** The body of a send, checked, with the uploaded files decoded. */
export function asSendInput(body) {
    const b = body && typeof body === "object" ? body : {};
    const to = asRecipients(b.to, "to");
    const cc = asRecipients(b.cc, "cc");
    const bcc = asRecipients(b.bcc, "bcc");
    const everyone = [...to, ...cc, ...bcc];
    if (!everyone.length) throw new HttpError(400, "Add at least one recipient");
    if (everyone.length > MAX_RECIPIENTS) throw new HttpError(400, `Send to at most ${MAX_RECIPIENTS} people at once`);

    if (b.subject !== undefined && b.subject !== null && typeof b.subject !== "string") throw new HttpError(400, "Invalid subject");
    const subject = String(b.subject ?? "").replace(CONTROL, " ").trim().slice(0, 900);
    const text = asBody(b.text, "message");
    const html = asBody(b.html, "message");

    const files = b.attachments === undefined || b.attachments === null ? [] : b.attachments;
    if (!Array.isArray(files)) throw new HttpError(400, "Invalid attachments");
    let uploaded = 0;
    const attachments = files.map((f) => {
        if (!f || typeof f !== "object" || typeof f.data !== "string" || f.data.length > MAX_UPLOAD_BYTES * 2 || !BASE64.test(f.data)) {
            throw new HttpError(400, "An attachment could not be read. Attach it again.");
        }
        const content = Buffer.from(f.data, "base64");
        uploaded += content.length;
        if (uploaded > MAX_UPLOAD_BYTES) throw new HttpError(413, `Attachments are too large: up to ${MB(MAX_UPLOAD_BYTES)} of files can be added at once.`);
        const type = typeof f.content_type === "string" && CONTENT_TYPE.test(f.content_type) ? f.content_type.toLowerCase() : "application/octet-stream";
        return { filename: attachmentName(f.filename), contentType: type, content };
    });

    const reply = b.reply ? asSource(b.reply, "reply") : null;
    let forward = null;
    if (b.forward) {
        forward = asSource(b.forward, "forward");
        const parts = b.forward.parts === undefined ? [] : b.forward.parts;
        if (!Array.isArray(parts)) throw new HttpError(400, "Invalid attachment");
        forward.parts = [...new Set(parts.map(asPart))];
    }
    if (reply && forward) throw new HttpError(400, "Reply or forward, not both");
    if (attachments.length + (forward?.parts.length || 0) > MAX_ATTACHMENTS) throw new HttpError(400, `Attach at most ${MAX_ATTACHMENTS} files`);

    return { to, cc, bcc, subject, text, html, attachments, uploaded, reply, forward };
}

/** Message-ID and References of an email, from its raw header lines: the ids only. */
export function threadHeaders(raw) {
    const headers = String(raw || "").replace(/\r?\n[ \t]+/g, " ");
    const ids = (name) => {
        const line = new RegExp(`^${name}:(.*)$`, "im").exec(headers);
        return line ? line[1].match(/<[^<>\s"]{1,250}>/g) || [] : [];
    };
    return { messageId: ids("message-id")[0] || null, references: ids("references") };
}

/** In-Reply-To and References for a reply to `original`: the original's chain plus the original (the last 20). */
export function replyThreading(original) {
    if (!original.messageId) return {};
    const chain = [...original.references.filter((id) => id !== original.messageId), original.messageId].slice(-20);
    return { inReplyTo: original.messageId, references: chain };
}

/** The person's name in the app, for the From line ("" when there is none). */
async function displayName(caller) {
    const { data } = await admin.from("user_profiles").select("full_name").eq("user_id", caller.id).eq("tenant_id", caller.tenantId).maybeSingle();
    return typeof data?.full_name === "string" ? data.full_name.replace(CONTROL, " ").trim().slice(0, 100) : "";
}

const smtpHostOf = (box) => box.smtp_host || box.imap_host;
const smtpPortOf = (box) => Number(box.smtp_port) || 465;

/**
 * Logs in to the person's outgoing server (their login: cPanel uses the same one for both) at the address that was
 * checked, with the name kept for the certificate. 465: SSL/TLS from the start; 587, 25, 2525: STARTTLS, required.
 */
export function mailboxTransport(box, password, address) {
    const port = smtpPortOf(box);
    return nodemailer.createTransport({
        host: address,
        port,
        secure: port === 465,
        requireTLS: port !== 465, // never send the password unencrypted
        auth: { user: box.username, pass: password },
        tls: { servername: smtpHostOf(box), minVersion: "TLSv1.2" },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
        logger: false,
        debug: false,
    });
}

const smtpErrorCode = (err) => `${String(err?.code || err?.name || "error")}${err?.responseCode ? ` ${err.responseCode}` : ""}`;

/** What went wrong sending, in plain words. Never the server's reply (it can quote the login or addresses). */
export function describeSendError(err, box) {
    if (err instanceof HttpError) return err.message;
    const host = smtpHostOf(box);
    const code = String(err?.code || "");
    const reply = Number(err?.responseCode) || 0;
    if (code === "EAUTH" || reply === 535 || reply === 534) {
        return "Your mail server refused your password for sending. If you changed your email password, enter the new one under Change server settings.";
    }
    if (reply === 552 || reply === 523) return "This email is too large for your mail server. Remove some attachments and try again.";
    if (code === "EENVELOPE") {
        const refused = Array.isArray(err?.rejected) ? err.rejected.filter((a) => typeof a === "string") : [];
        return refused.length
            ? `Your mail server refused to send to ${refused.slice(0, 5).join(", ")}${refused.length > 5 ? " and others" : ""}. Check the address${refused.length > 1 ? "es" : ""}.`
            : "Your mail server would not send this email from or to these addresses.";
    }
    if (["ENOTFOUND", "EAI_AGAIN", "EDNS"].includes(code)) return `Can't find an outgoing mail server called ${host}. Check it under Change server settings.`;
    if (code === "ETLS" || /CERT|TLS|SSL|ALTNAME|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code)) {
        return `The secure connection to ${host} failed. Try the other outgoing port (465 or 587) under Change server settings.`;
    }
    if (["ECONNECTION", "ETIMEDOUT", "ESOCKET", "ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH"].includes(code)) {
        return `Can't reach ${host} on port ${smtpPortOf(box)} to send. Check the outgoing server and port under Change server settings.`;
    }
    if (reply === 550 || reply === 553 || reply === 554) return "Your mail server refused this email (it may look like spam to it, or sending to these people isn't allowed).";
    return "Your mail server didn't accept the email. Try again in a moment.";
}

const sendStatus = (err) => {
    const code = String(err?.code || "");
    const reply = Number(err?.responseCode) || 0;
    if (reply === 552 || reply === 523) return 413;
    if (code === "EAUTH" || reply === 535 || reply === 534 || code === "EENVELOPE" || reply === 550 || reply === 553 || reply === 554) return 400;
    return 502;
};

const closeTransport = (transport) => {
    try {
        transport?.close();
    } catch {
        // already closed
    }
};

/** Whether sending works with these settings: { ok, message }. Used when connecting. */
async function checkSmtp(box, password) {
    let transport;
    try {
        if (!SMTP_PORTS.includes(smtpPortOf(box))) throw new HttpError(400, `The outgoing mail port must be one of ${SMTP_PORTS.join(", ")}`);
        transport = mailboxTransport(box, password, await resolvePublicAddress(smtpHostOf(box)));
        await transport.verify();
        return { ok: true, message: `Sending works through ${smtpHostOf(box)}.` };
    } catch (err) {
        if (!(err instanceof HttpError)) console.error("[mailbox] outgoing check failed:", smtpErrorCode(err));
        return { ok: false, message: describeSendError(err, box) };
    } finally {
        closeTransport(transport);
    }
}

const SENT_NAMES = ["sent", "inbox.sent", "inbox/sent", "sent items", "sent messages", "inbox.sent items", "inbox.sent messages"];

/** The Sent folder: the one the server marks \Sent, else the first called Sent (INBOX.Sent on cPanel), or null. */
export function findSentFolder(folders) {
    const usable = (folders || []).filter((f) => !(f.flags instanceof Set ? f.flags : new Set(f.flags || [])).has("\\Noselect"));
    const special = usable.find((f) => f.specialUse === "\\Sent");
    if (special) return special.path;
    for (const name of SENT_NAMES) {
        const hit = usable.find((f) => String(f.path).toLowerCase() === name);
        if (hit) return hit.path;
    }
    return null;
}

const TOO_LARGE = `The attachments are too large to send (over ${MB(MAX_SEND_BYTES)} in all).`;

/** Reads one part of an email into memory, up to `limit` bytes (an HttpError(413) past it). */
async function readPart(client, uid, node, part, limit) {
    if (partSize(node) > limit) throw new HttpError(413, TOO_LARGE);
    const download = await client.download(uid, part, { uid: true, maxBytes: limit + 1 });
    if (!download?.content) throw new HttpError(404, "An attachment you're forwarding isn't there any more. Refresh.");
    const chunks = [];
    let size = 0;
    for await (const chunk of download.content) {
        size += chunk.length;
        if (size > limit) throw new HttpError(413, TOO_LARGE);
        chunks.push(chunk);
    }
    return {
        filename: attachmentName(download.meta?.filename || filenameOf(node) || `attachment-${part}`),
        contentType: CONTENT_TYPE.test(String(node.type || "")) ? String(node.type).toLowerCase() : "application/octet-stream",
        content: Buffer.concat(chunks),
    };
}

const domainOf = (address) => String(address).split("@")[1] || "localhost";

/** The original's threading headers (replying) or the files being forwarded, read from the mailbox. */
async function readSource(client, input) {
    const source = input.reply || input.forward;
    if (!source) return { threading: {}, forwarded: [] };
    // opened for writing only when replying, to mark the original answered
    await client.mailboxOpen(source.folder, { readOnly: !input.reply });
    if (input.reply) {
        const original = await client.fetchOne(source.uid, { uid: true, headers: ["message-id", "references"] }, { uid: true });
        if (!original) throw new HttpError(404, "The email you're replying to isn't there any more. Refresh.");
        return { threading: replyThreading(threadHeaders(original.headers)), forwarded: [] };
    }
    const forwarded = [];
    if (!input.forward.parts.length) return { threading: {}, forwarded };
    const meta = await client.fetchOne(source.uid, { uid: true, bodyStructure: true }, { uid: true });
    if (!meta) throw new HttpError(404, "The email you're forwarding isn't there any more. Refresh.");
    let room = MAX_SEND_BYTES - input.uploaded;
    for (const part of input.forward.parts) {
        const node = findPart(meta.bodyStructure, part);
        if (!node) throw new HttpError(404, "An attachment you're forwarding isn't there any more. Refresh.");
        const file = await readPart(client, source.uid, node, part, room);
        room -= file.content.length;
        forwarded.push(file);
    }
    return { threading: {}, forwarded };
}

router.post(
    "/send",
    handler(async (req, res, caller) => {
        const input = asSendInput(req.body);
        const box = await loadMailbox(caller);
        if (!box) throw new HttpError(404, NOT_CONNECTED);
        if (!SMTP_PORTS.includes(smtpPortOf(box))) {
            throw new HttpError(400, `The outgoing mail port must be one of ${SMTP_PORTS.join(", ")}. Change it under Change server settings.`);
        }
        // the outgoing server is checked before anything connects: refused when it is (or resolves to) our own machine
        // or a private network, and the address checked is the one connected to
        const smtpAddress = await resolvePublicAddress(asMailHost(smtpHostOf(box), "Your outgoing mail server's name is not valid. Change it under Change server settings."));
        if (!(await takeSendBudget(caller, "default", 1))) {
            throw new HttpError(429, `You've sent ${SENDS_PER_HOUR} emails from here in the last hour. Wait a while and try again.`);
        }
        const name = await displayName(caller).catch(() => "");

        const { sentFolder, rejected } = await withMailbox(
            caller,
            async (client, mailbox) => {
                const password = decryptSecret(mailbox.password_encrypted, mailboxBinding(caller.id, caller.tenantId), UNREADABLE);
                const { threading, forwarded } = await readSource(client, input);

                const mail = {
                    from: { name, address: mailbox.email },
                    to: input.to,
                    cc: input.cc,
                    bcc: input.bcc,
                    subject: input.subject,
                    text: input.text || (input.html ? undefined : ""),
                    html: input.html || undefined,
                    attachments: [...input.attachments, ...forwarded],
                    messageId: `<${crypto.randomUUID()}@${domainOf(mailbox.email)}>`,
                    date: new Date(),
                    ...threading,
                    // only what is given here goes in: the mailer reads no files or web addresses
                    disableFileAccess: true,
                    disableUrlAccess: true,
                };

                // the copy for Sent, built before sending (the mailer may change what it is given), with the Bcc kept
                let raw = null;
                try {
                    const node = new MailComposer({ ...mail }).compile();
                    node.keepBcc = true;
                    raw = await node.build();
                } catch (err) {
                    console.error("[mailbox] could not build the Sent copy:", smtpErrorCode(err));
                }

                const transport = mailboxTransport(mailbox, password, smtpAddress);
                let info;
                try {
                    info = await transport.sendMail({ ...mail });
                } catch (err) {
                    console.error("[mailbox] send failed:", smtpErrorCode(err));
                    throw new HttpError(sendStatus(err), describeSendError(err, mailbox));
                } finally {
                    closeTransport(transport);
                }

                // sent: nothing below may turn this into an error (the person would send it again)
                let saved = null;
                try {
                    const path = raw && findSentFolder(await client.list());
                    if (path && (await client.append(path, raw, ["\\Seen"], mail.date))) saved = path;
                } catch (err) {
                    console.error("[mailbox] could not save to Sent:", errorCode(err));
                }
                if (input.reply) {
                    try {
                        await client.messageFlagsAdd(input.reply.uid, ["\\Answered"], { uid: true });
                    } catch {
                        // a read-only folder: it just isn't marked answered
                    }
                }
                const refused = Array.isArray(info?.rejected) ? info.rejected.map((a) => (typeof a === "string" ? a : a?.address)).filter(Boolean) : [];
                return { sentFolder: saved, rejected: refused };
            },
            box
        );

        let message = sentFolder ? "Sent." : "Sent, but couldn't save a copy to Sent.";
        if (rejected.length) message += ` Your mail server refused ${rejected.join(", ")}.`;
        res.json({ ok: true, saved_to_sent: Boolean(sentFolder), sent_folder: sentFolder, rejected, message });
    })
);

// ---------------------------------------------------------------------------------------------
// managing mail (FIG-1205, PR 3 of 3)
// ---------------------------------------------------------------------------------------------
//
//   POST /api/mailbox/flags    { folder, uids, seen?, flagged? }   mark read / unread, flag / unflag
//   POST /api/mailbox/move     { folder, uids, to }                to an existing folder from the account's own list
//   POST /api/mailbox/delete   { folder, uids, permanent? }        to Trash; permanently only in Trash, and only with
//                                                                  permanent: true (the screen asks first)
//   GET  /api/mailbox/search?folder=&q=&unread=1&attachments=1&since=YYYY-MM-DD&before=YYYY-MM-DD&page=
//                                                                  one folder, newest first, 50 a page, 500 at most
//   GET  /api/mailbox/unread                                       INBOX's unread count (STATUS UNSEEN), for the badge
//
// Up to 200 emails at a time, by uid, in one folder. Trash is the folder the server marks \Trash, else one called
// Trash (INBOX.Trash on cPanel), else Deleted Items. With no Trash, nothing is deleted: never permanent by surprise.
// Removing an email for good ("EXPUNGE") removes only the ones asked for: with UIDPLUS by uid; without it, only when
// no other email in the folder is already marked deleted (a plain EXPUNGE would take those too). Moving on a server
// without MOVE is a copy and such a removal, so the same check applies.
//
// Per-person limits (shared across servers through take_rate_limit): changes 300 an hour, searches 60 an hour, the
// unread count 90 an hour (the badge asks at most every 2 minutes, from one tab at a time).

export const MAX_UIDS = 200;
export const MAX_SEARCH_RESULTS = 500;
export const MAX_QUERY_CHARS = 200;
export const MANAGE_LIMITS = {
    default: { limit: 300, windowMs: HOUR },
    search: { limit: 60, windowMs: HOUR },
    unread: { limit: 90, windowMs: HOUR },
};
const takeManageBudget = createSharedBudget("mailbox-manage", MANAGE_LIMITS);

const TOO_MANY = {
    default: "You've made a lot of changes to your mail in the last hour. Wait a while and try again.",
    search: "You've searched a lot in the last hour. Wait a while and try again.",
    unread: "Too many checks for new mail. Wait a while and try again.",
};

/** Runs `fn` in the caller's own mailbox, after taking one from their `kind` budget (only when connected). */
async function withManagedMailbox(caller, kind, fn) {
    const box = await loadMailbox(caller);
    if (!box) throw new HttpError(404, NOT_CONNECTED);
    if (!(await takeManageBudget(caller, kind, 1))) throw new HttpError(429, TOO_MANY[kind]);
    return withMailbox(caller, fn, box);
}

/** The emails to act on: 1 to 200 uids, each checked, without repeats. */
export function asUids(v) {
    if (!Array.isArray(v) || v.length === 0) throw new HttpError(400, "Choose at least one email");
    if (v.length > MAX_UIDS) throw new HttpError(400, `Choose at most ${MAX_UIDS} emails at a time`);
    return [...new Set(v.map(asUid))];
}

const asOptionalBool = (v, what) => {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "boolean") throw new HttpError(400, `Invalid ${what}`);
    return v;
};

const selectable = (folders) => (folders || []).filter((f) => !(f.flags instanceof Set ? f.flags : new Set(f.flags || [])).has("\\Noselect"));

const TRASH_NAMES = ["trash", "inbox.trash", "inbox/trash", "deleted items", "inbox.deleted items", "inbox/deleted items", "deleted messages", "inbox.deleted messages"];

/** The Trash folder: the one the server marks \Trash, else Trash (INBOX.Trash on cPanel), else Deleted Items, or null. */
export function findTrashFolder(folders) {
    const usable = selectable(folders);
    const special = usable.find((f) => f.specialUse === "\\Trash");
    if (special) return special.path;
    for (const name of TRASH_NAMES) {
        const hit = usable.find((f) => String(f.path).toLowerCase() === name);
        if (hit) return hit.path;
    }
    return null;
}

const NO_TRASH = "Your mailbox has no Trash folder, so nothing was deleted. Create a folder called Trash (in your webmail), then try again.";
const UNSAFE_EXPUNGE =
    "Your mail server can't remove only these emails: other emails in this folder are already marked deleted and would go too. Empty the folder's deleted emails in your webmail first.";

const hasCapability = (client, name) => Boolean(client.capabilities?.has?.(name));

/**
 * Whether removing `uids` for good removes only them. With UIDPLUS, by uid (yes). Without, a plain EXPUNGE removes
 * every email marked deleted in the folder: only when those are all among `uids`.
 */
async function onlyTheseExpunge(client, uids) {
    if (hasCapability(client, "UIDPLUS")) return true;
    const marked = (await client.search({ deleted: true }, { uid: true })) || [];
    const asked = new Set(uids.map(String));
    return marked.every((uid) => asked.has(String(uid)));
}

router.post(
    "/flags",
    handler(async (req, res, caller) => {
        const b = req.body || {};
        const folder = asFolder(b.folder);
        const uids = asUids(b.uids);
        const seen = asOptionalBool(b.seen, "read state");
        const flagged = asOptionalBool(b.flagged, "flag");
        if (seen === undefined && flagged === undefined) throw new HttpError(400, "Nothing to change");
        await withManagedMailbox(caller, "default", async (client) => {
            await client.mailboxOpen(folder);
            const range = uids.join(",");
            const change = async (flag, on) => {
                if (on === undefined) return;
                const ok = on ? await client.messageFlagsAdd(range, [flag], { uid: true }) : await client.messageFlagsRemove(range, [flag], { uid: true });
                if (ok === false) throw new HttpError(502, "Your mail server didn't accept the change. Try again.");
            };
            await change("\\Seen", seen);
            await change("\\Flagged", flagged);
        });
        res.json({ ok: true, folder, uids: uids.map(Number), ...(seen !== undefined ? { seen } : {}), ...(flagged !== undefined ? { flagged } : {}) });
    })
);

/** Moves `uids` from the open folder to `to`; refuses when the removal from the source would take other emails too. */
async function moveUids(client, uids, to) {
    if (!hasCapability(client, "MOVE") && !(await onlyTheseExpunge(client, uids))) throw new HttpError(409, UNSAFE_EXPUNGE);
    const moved = await client.messageMove(uids.join(","), to, { uid: true });
    if (!moved) throw new HttpError(502, "Your mail server didn't move the emails. Try again.");
}

router.post(
    "/move",
    handler(async (req, res, caller) => {
        const b = req.body || {};
        const folder = asFolder(b.folder);
        const uids = asUids(b.uids);
        if (typeof b.to !== "string" || !b.to) throw new HttpError(400, "Choose a folder to move to");
        const to = asFolder(b.to);
        if (to === folder) throw new HttpError(400, "The emails are already in that folder");
        await withManagedMailbox(caller, "default", async (client) => {
            // only a folder from the account's own list, that can hold mail
            if (!selectable(await client.list()).some((f) => f.path === to)) throw new HttpError(400, "That folder isn't in your mailbox. Refresh.");
            await client.mailboxOpen(folder);
            await moveUids(client, uids, to);
        });
        res.json({ ok: true, folder, to, uids: uids.map(Number) });
    })
);

router.post(
    "/delete",
    handler(async (req, res, caller) => {
        const b = req.body || {};
        const folder = asFolder(b.folder);
        const uids = asUids(b.uids);
        if (b.permanent !== undefined && b.permanent !== null && typeof b.permanent !== "boolean") throw new HttpError(400, "Invalid request");
        const permanent = b.permanent === true;
        const result = await withManagedMailbox(caller, "default", async (client) => {
            const trash = findTrashFolder(await client.list());
            if (folder !== trash) {
                if (permanent) throw new HttpError(400, "Emails are deleted permanently only from Trash. Delete them to Trash first.");
                if (!trash) throw new HttpError(409, NO_TRASH);
                await client.mailboxOpen(folder);
                await moveUids(client, uids, trash);
                return { permanent: false, trash };
            }
            if (!permanent) throw new HttpError(400, "These emails are in Trash: deleting them here is permanent. Confirm to delete them permanently.");
            await client.mailboxOpen(folder);
            if (!(await onlyTheseExpunge(client, uids))) throw new HttpError(409, UNSAFE_EXPUNGE);
            // \Deleted on these uids, then UID EXPUNGE of these uids (imapflow)
            if (!(await client.messageDelete(uids.join(","), { uid: true }))) throw new HttpError(502, "Your mail server didn't delete the emails. Try again.");
            return { permanent: true, trash };
        });
        res.json({ ok: true, folder, uids: uids.map(Number), permanent: result.permanent, trash: result.trash });
    })
);

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const asDay = (v, what) => {
    if (v === undefined || v === "") return null;
    const m = DAY.exec(String(v));
    const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
    if (!d || d.toISOString().slice(0, 10) !== String(v)) throw new HttpError(400, `Invalid ${what} date`);
    return d;
};
const asFlag = (v) => v === "1" || v === "true";

/** The search from the query string: the IMAP SEARCH object, checked. */
export function asSearch(query) {
    const raw = query.q === undefined ? "" : typeof query.q === "string" ? query.q : null;
    if (raw === null) throw new HttpError(400, "Invalid search");
    const q = raw.replace(CONTROL, " ").trim();
    if (q.length > MAX_QUERY_CHARS) throw new HttpError(400, `Search for at most ${MAX_QUERY_CHARS} characters`);
    const since = asDay(query.since, "from");
    const before = asDay(query.before, "to");
    if (since && before && since > before) throw new HttpError(400, "The from date is after the to date");
    const unread = asFlag(query.unread);
    const attachments = asFlag(query.attachments);
    if (!q && !unread && !attachments && !since && !before) throw new HttpError(400, "Type something to search for");

    const search = {};
    // the words in the subject, the sender, the recipients or the text
    if (q) search.or = [{ subject: q }, { from: q }, { to: q }, { body: q }];
    if (unread) search.seen = false;
    // IMAP has no "has attachments": an email with files is (almost always) multipart/mixed
    if (attachments) search.header = { "content-type": "multipart/mixed" };
    if (since) search.since = since;
    // "to" is inclusive: before the next day
    if (before) search.before = new Date(before.getTime() + 24 * 60 * 60 * 1000);
    return { search, echo: { q, unread, attachments, since: since ? query.since : null, before: before ? query.before : null } };
}

router.get(
    "/search",
    handler(async (req, res, caller) => {
        const folder = asFolder(req.query.folder);
        const page = asPage(req.query.page);
        const { search, echo } = asSearch(req.query);
        const result = await withManagedMailbox(caller, "search", async (client) => {
            await client.mailboxOpen(folder, { readOnly: true });
            const found = ((await client.search(search, { uid: true })) || []).map(Number).filter((n) => n > 0);
            // newest first (uids grow as mail arrives), at most 500
            found.sort((a, b) => b - a);
            const capped = found.length > MAX_SEARCH_RESULTS;
            const kept = found.slice(0, MAX_SEARCH_RESULTS);
            const pageUids = kept.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
            const messages = [];
            if (pageUids.length) {
                for await (const msg of client.fetch(pageUids.join(","), { uid: true, flags: true, envelope: true, bodyStructure: true, size: true, internalDate: true }, { uid: true })) {
                    messages.push(listEntry(msg));
                }
            }
            messages.sort((a, b) => b.uid - a.uid);
            return { total: kept.length, capped, messages };
        });
        res.set("Cache-Control", "no-store");
        res.json({
            folder,
            ...echo,
            page,
            page_size: PAGE_SIZE,
            total: result.total,
            capped: result.capped,
            has_more: page * PAGE_SIZE < result.total,
            messages: result.messages,
        });
    })
);

router.get(
    "/unread",
    handler(async (_req, res, caller) => {
        res.set("Cache-Control", "no-store");
        const box = await loadMailbox(caller);
        // not connected: no mail server to ask (the badge stops asking)
        if (!box) return res.json({ connected: false, unread: 0 });
        if (!(await takeManageBudget(caller, "unread", 1))) throw new HttpError(429, TOO_MANY.unread);
        // STATUS, without opening the folder: the cheapest question IMAP has
        const status = await withMailbox(caller, (client) => client.status("INBOX", { unseen: true }), box);
        res.json({ connected: true, unread: Number(status?.unseen) || 0 });
    })
);

export default router;
