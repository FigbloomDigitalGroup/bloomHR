// Registers where the Figbloom platform delivers events for HR (PUT /products/hr/event-webhook), once per environment
// (ERP/SCHOOLS_HR_PHASE1_CONTRACT.md section 1, "Receive"). Uses the "hr" service client, as the backend does:
//
//   PLATFORM_API_URL, PLATFORM_TOKEN_URL, PLATFORM_CLIENT_ID, PLATFORM_CLIENT_SECRET   (as on Vercel)
//   PLATFORM_EVENTS_URL   https://<the HR website>/api/platform/events (default: SITE_URL + /api/platform/events)
//
//   ENV_FILE=.env.staging node scripts/register-platform-event-webhook.mjs
//
// Prints the platform's answer, never the secret or the token.
import dotenv from "dotenv";
import { createPlatformClient } from "../platform_client.js";

dotenv.config({ path: process.env.ENV_FILE || ".env", quiet: true });

const site = String(process.env.SITE_URL || "").trim().replace(/\/+$/, "");
const url = String(process.env.PLATFORM_EVENTS_URL || (site ? `${site}/api/platform/events` : "")).trim();
if (!/^https:\/\/[^/\s]+\/\S*$/.test(url)) {
  console.error("Set PLATFORM_EVENTS_URL (or SITE_URL) to the HR website's https address.");
  process.exit(1);
}

const client = createPlatformClient({
  clientIdEnv: "PLATFORM_CLIENT_ID",
  clientSecretEnv: "PLATFORM_CLIENT_SECRET",
  scope: "platform/tenants.write",
  tag: "[register-event-webhook]",
  who: "Figbloom HR",
  notConnected: "Set PLATFORM_API_URL, PLATFORM_TOKEN_URL, PLATFORM_CLIENT_ID and PLATFORM_CLIENT_SECRET.",
});

try {
  const result = await client.call("PUT", "/products/hr/event-webhook", { url });
  console.log("Registered", url);
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error(`Not registered: ${err.status ?? ""} ${err.code ?? ""} ${err.message}`);
  process.exit(1);
}
