// company_mail_server.js - a company's own mail server (cPanel or any SMTP), used instead of Figbloom HR mail.
//
// The settings live in company_mail_servers (migration 20261022300000), read and written only by the backend. The
// password is encrypted here before it is stored and decrypted only to log in to the mail server; it is never sent
// back to the browser.
//
// Encryption: AES-256-GCM with MAIL_SERVER_ENCRYPTION_KEY (32 random bytes, base64 or hex; make one with
// `openssl rand -base64 32`). The company's id is bound in as extra authenticated data, so one company's stored
// password cannot be copied onto another company's row and used there. Without the key, saving a password and sending
// through a company's server fail with a clear message; companies without their own server are not affected.
import crypto from "node:crypto";
import net from "node:net";
import nodemailer from "nodemailer";
import { HttpError, admin } from "./admin_routes.js";

export const KEY_ENV = "MAIL_SERVER_ENCRYPTION_KEY";
const VERSION = "v1";

// The ports mail servers listen on. Anything else is refused, so the setting cannot be used to make our server
// connect to arbitrary services.
export const SMTP_PORTS = [25, 465, 587, 2525];

export const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
const HOST_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

// a table that is not there yet (the migration has not been applied): treated as "no own server"
const MISSING_TABLE = ["42P01", "PGRST205"];

function encryptionKey() {
    const raw = (process.env[KEY_ENV] || "").trim();
    if (!raw) return null;
    const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
    return key.length === 32 ? key : null;
}

const keyMissing = () =>
    new HttpError(503, `Mail server passwords can't be saved or used yet: ${KEY_ENV} is not set (or is not 32 bytes) on the server`);

/**
 * Encrypts a secret with MAIL_SERVER_ENCRYPTION_KEY, binding `binding` in as extra authenticated data: it decrypts only
 * with the same binding. "v1:<iv>:<tag>:<ciphertext>", all base64. Shared with the personal mailboxes
 * (mailbox_routes.js), which bind in the person and their company.
 */
export function encryptSecret(secret, binding) {
    const key = encryptionKey();
    if (!key) throw keyMissing();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(String(binding), "utf8"));
    const data = Buffer.concat([cipher.update(String(secret), "utf8"), cipher.final()]);
    return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

/** The secret encryptSecret stored, or an HttpError(500, unreadable) when the key or the binding is not the same. */
export function decryptSecret(stored, binding, unreadable) {
    const key = encryptionKey();
    if (!key) throw keyMissing();
    const [version, iv, tag, data] = String(stored || "").split(":");
    if (version !== VERSION || !iv || !tag || !data) throw new HttpError(500, unreadable);
    try {
        const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
        decipher.setAAD(Buffer.from(String(binding), "utf8"));
        decipher.setAuthTag(Buffer.from(tag, "base64"));
        return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
    } catch {
        // a changed key, or a value copied from another row
        throw new HttpError(500, unreadable);
    }
}

const UNREADABLE = "The saved mail server password can't be read. Enter it again.";

/** The company's mail server password, tied to the company (its id is the binding). */
export const encryptPassword = (password, tenantId) => encryptSecret(password, String(tenantId));
export const decryptPassword = (stored, tenantId) => decryptSecret(stored, String(tenantId), UNREADABLE);

/** The company's saved settings (with the encrypted password), or null. */
export async function loadMailServer(tenantId) {
    const { data, error } = await admin
        .from("company_mail_servers")
        .select("tenant_id, host, port, secure, username, from_name, from_address, password_encrypted, enabled, last_test_ok, last_test_at, last_test_message, updated_at")
        .eq("tenant_id", tenantId)
        .maybeSingle();
    if (error) {
        if (MISSING_TABLE.includes(String(error.code))) return null;
        throw new HttpError(500, "Could not read the mail server settings");
    }
    return data || null;
}

/** What the browser may see: everything but the password, which is only "set" or not. */
export const publicSettings = (row) =>
    row
        ? {
              host: row.host,
              port: row.port,
              secure: row.secure,
              username: row.username,
              from_name: row.from_name || "",
              from_address: row.from_address,
              enabled: row.enabled,
              password_set: Boolean(row.password_encrypted),
              last_test_ok: row.last_test_ok ?? null,
              last_test_at: row.last_test_at ?? null,
              last_test_message: row.last_test_message ?? null,
              updated_at: row.updated_at ?? null,
          }
        : null;

/** The company's server when it is turned on and has a password: its sends go through it. */
export const isActive = (row) => Boolean(row && row.enabled && row.password_encrypted);

// a host that is an IP address on our own machine or private network
export function isPrivateAddress(host) {
    if (!net.isIP(host)) return false;
    if (net.isIPv6(host)) return true; // mail servers are entered by name; an IPv6 literal is refused outright
    const [a, b] = host.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/**
 * An address a mail server's name resolved to that is not on the public internet: our own machine, a private network,
 * link-local, multicast, or (IPv6) unique-local, link-local or an IPv4 address in IPv6 form that is one of those.
 */
export function isNonPublicResolved(address) {
    if (net.isIPv4(address)) return isPrivateAddress(address);
    if (!net.isIPv6(address)) return true;
    const a = address.toLowerCase();
    if (a === "::" || a === "::1") return true;
    const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (a.startsWith("::ffff:") || a.startsWith("64:ff9b:")) return true; // other IPv4-in-IPv6 forms: not worth the risk
    const first = parseInt(a.split(":")[0] || "0", 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00;
}

/** A mail server's name, checked: a public host name (or public IPv4 address), lower case, or an HttpError(400). */
export function asMailHost(value, message = "Enter the mail server's name, e.g. mail.yourdomain.com") {
    const host = (typeof value === "string" ? value.trim() : "").toLowerCase();
    if (!host || host.length > 253 || /[\r\n]/.test(host) ||(!HOST_RE.test(host) && !net.isIP(host)) || host === "localhost" || isPrivateAddress(host)) {
        throw new HttpError(400, message);
    }
    return host;
}

const oneLine = (v, max) => {
    const s = typeof v === "string" ? v.trim() : "";
    if (s.length > max || /[\r\n]/.test(s)) throw new HttpError(400, "Invalid mail server settings");
    return s;
};

/**
 * The settings from a PUT body, checked. `existing` is the saved row: a password left out (or empty) keeps the saved
 * one. Returns the row to store (password encrypted).
 */
export function asSettings(body, existing, tenantId) {
    const b = body || {};
    const host = asMailHost(oneLine(b.host, 253));
    const port = b.port === undefined || b.port === "" ? 465 : Number(b.port);
    if (!SMTP_PORTS.includes(port)) throw new HttpError(400, `The port must be one of ${SMTP_PORTS.join(", ")}`);
    const secure = b.secure === undefined ? port === 465 : b.secure === true;
    const username = oneLine(b.username, 254);
    if (!username) throw new HttpError(400, "Enter the mailbox username (usually the full email address)");
    const fromAddress = oneLine(b.from_address, 254);
    if (!fromAddress || !EMAIL_RE.test(fromAddress)) throw new HttpError(400, "Enter a valid From address");
    const fromName = oneLine(b.from_name ?? "", 100);
    if (/["<>]/.test(fromName)) throw new HttpError(400, "The From name can't contain quotes or < >");
    const enabled = b.enabled === true;

    let passwordEncrypted = existing?.password_encrypted || null;
    if (b.password !== undefined && b.password !== null && b.password !== "") {
        if (typeof b.password !== "string" || b.password.length > 500) throw new HttpError(400, "Invalid password");
        passwordEncrypted = encryptPassword(b.password, tenantId);
    }
    if (enabled && !passwordEncrypted) throw new HttpError(400, "Enter the mailbox password before turning this on");

    // a changed server or login means the last test no longer says anything about it
    const sameServer =
        existing && existing.host === host && existing.port === port && existing.secure === secure && existing.username === username && passwordEncrypted === existing.password_encrypted;

    return {
        tenant_id: tenantId,
        host,
        port,
        secure,
        username,
        from_name: fromName || null,
        from_address: fromAddress,
        password_encrypted: passwordEncrypted,
        enabled,
        last_test_ok: sameServer ? existing.last_test_ok ?? null : null,
        last_test_at: sameServer ? existing.last_test_at ?? null : null,
        last_test_message: sameServer ? existing.last_test_message ?? null : null,
    };
}

/** The From header for a company's server: "Name <address>" or just the address. */
export const fromHeader = (row) => (row.from_name ? `"${row.from_name}" <${row.from_address}>` : row.from_address);

/** A mail transport that logs in to the company's server. Short timeouts, so a wrong host fails fast. */
export function transportFor(row) {
    return nodemailer.createTransport({
        host: row.host,
        port: row.port,
        secure: row.secure,
        requireTLS: !row.secure, // STARTTLS: never send the password unencrypted
        auth: { user: row.username, pass: decryptPassword(row.password_encrypted, row.tenant_id) },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
    });
}

/**
 * What went wrong talking to the mail server, in words an administrator can act on. Never the server's own reply,
 * which can echo the login.
 */
export function describeSmtpError(err, row) {
    const code = String(err?.code || "");
    if (code === "EAUTH") return "The mail server refused the username or password.";
    if (["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNREFUSED", "ENOTFOUND"].includes(code)) {
        return `Could not connect to ${row.host} on port ${row.port}. Check the server name, port and SSL setting.`;
    }
    if (code === "ETLS") return "The secure connection to the mail server failed. Try the other SSL setting or port.";
    if (code === "EENVELOPE") return "The mail server would not send from or to these addresses. Check the From address.";
    return "The mail server rejected the email.";
}
