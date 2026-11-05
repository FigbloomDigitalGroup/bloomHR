// Registers where the Figbloom platform sends people opening HR from another product (PUT /products/hr/handoff-url),
// once per environment (ERP/SCHOOLS_HR_HANDOFF_CONTRACT.md section 1). Uses the "hr" service client, as the backend does:
//
//   PLATFORM_API_URL, PLATFORM_TOKEN_URL, PLATFORM_CLIENT_ID, PLATFORM_CLIENT_SECRET   (as on the backend)
//   PLATFORM_HANDOFF_URL   https://<the HR website>/api/platform/handoff (default: SITE_URL + /api/platform/handoff)
//
//   ENV_FILE=.env.staging node scripts/register-platform-handoff-url.mjs
//
// Prints the platform's answer, never the secret or the token.
import dotenv from "dotenv";
import { createPlatformClient } from "../platform_client.js";

dotenv.config({ path: process.env.ENV_FILE || ".env", quiet: true });

const site = String(process.env.SITE_URL || "").trim().replace(/\/+$/, "");
const url = String(process.env.PLATFORM_HANDOFF_URL || (site ? `${site}/api/platform/handoff` : "")).trim();
if (!/^https:\/\/[^/\s]+\/\S*$/.test(url)) {
  console.error("Set PLATFORM_HANDOFF_URL (or SITE_URL) to the HR website's https address.");
  process.exit(1);
}

const client = createPlatformClient({
  clientIdEnv: "PLATFORM_CLIENT_ID",
  clientSecretEnv: "PLATFORM_CLIENT_SECRET",
  scope: "platform/tenants.write",
  tag: "[register-handoff-url]",
  who: "Figbloom HR",
  notConnected: "Set PLATFORM_API_URL, PLATFORM_TOKEN_URL, PLATFORM_CLIENT_ID and PLATFORM_CLIENT_SECRET.",
});

try {
  const result = await client.call("PUT", "/products/hr/handoff-url", { url });
  console.log("Registered", url);
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error(`Not registered: ${err.status ?? ""} ${err.code ?? ""} ${err.message}`);
  process.exit(1);
}
