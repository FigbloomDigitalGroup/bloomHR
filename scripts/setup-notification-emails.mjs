// Sets up the notification emails (FIG-771) on the Supabase project in .env, in one go:
//   1. deploys the send-notification-emails Edge Function (no user login needed to call it: it checks a secret);
//   2. gives it its settings: a new random CRON_SECRET, RESEND_API_KEY and EMAIL_FROM (SMTP_FROM) from .env, and
//      APP_URL (the staff portal, for the button in the email) when given;
//   3. puts the function's address and the same secret in the Vault, where the every-minute cron job reads them.
// Run again at any time: it makes a new secret and sets it in both places.
//
//   node scripts/setup-notification-emails.mjs https://your-portal-address
//
// Needs the migration 20261013800000 applied, and `npx supabase login` done once on this computer.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: process.env.ENV_FILE || ".env" });

const fail = (message) => {
  console.error(`\n✗ ${message}`);
  process.exit(1);
};

const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const resendKey = process.env.RESEND_API_KEY || process.env.VITE_RESEND_API_KEY || "";
const from = process.env.EMAIL_FROM || process.env.SMTP_FROM || "";
const appUrl = (process.argv[2] || process.env.APP_URL || "").replace(/\/+$/, "");

const ref = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co$/)?.[1];
if (!ref) fail("SUPABASE_URL in .env is not a https://<project>.supabase.co address.");
if (!serviceKey) fail("SUPABASE_SERVICE_ROLE_KEY is missing from .env.");
if (!resendKey) fail("RESEND_API_KEY is missing from .env.");
if (!from) fail("SMTP_FROM (the address emails come from) is missing from .env.");
if (appUrl && !/^https:\/\//.test(appUrl)) fail("The portal address must start with https://");

const secret = randomBytes(32).toString("hex");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const run = (args) => execFileSync(npx, args, { stdio: "inherit", shell: process.platform === "win32" });

console.log(`Setting up notification emails on ${ref}…\n`);

console.log("1/3 Deploying the Edge Function");
run(["supabase", "functions", "deploy", "send-notification-emails", "--project-ref", ref, "--no-verify-jwt"]);

console.log("\n2/3 Setting its secrets");
// through a file, so the keys never appear in the list of running commands
const dir = mkdtempSync(join(tmpdir(), "fb-secrets-"));
const file = join(dir, "secrets.env");
try {
  writeFileSync(
    file,
    [`CRON_SECRET=${secret}`, `RESEND_API_KEY=${resendKey}`, `EMAIL_FROM=${from}`, ...(appUrl ? [`APP_URL=${appUrl}`] : [])].join("\n") + "\n",
    { mode: 0o600 }
  );
  run(["supabase", "secrets", "set", "--project-ref", ref, "--env-file", file]);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("\n3/3 Putting the address and secret in the Vault for the cron job");
const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const { error } = await db.rpc("set_notification_email_secrets", { p_project_url: url, p_secret: secret });
if (error) fail(`Could not write the Vault secrets: ${error.message}. Is the migration 20261013800000 applied?`);

console.log(`\n✓ Done. Notification emails go out within a few minutes of each notification, from ${from}.`);
if (!appUrl) console.log("  (No portal address given, so the emails have no \"Open the staff portal\" button. Run again with it to add one.)");
