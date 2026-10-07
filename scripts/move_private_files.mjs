// One-off: move files saved under the old storage layout into the per-company folders the private-bucket policies
// expect (supabase/migrations/20261007000100_private_files_storage.sql). Run it once, after that migration.
//
//   node scripts/move_private_files.mjs           shows what would move (changes nothing)
//   node scripts/move_private_files.mjs --apply   moves the files and updates expense records
//
// Needs SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY, e.g. in .env.
//
//   documents          <email name>/<file>   ->  <company id>/<login id>/<file>
//                      the old folder was the part of the login's email before "@"; when that matches no login, or
//                      logins in more than one company, the folder is listed for a person to sort out and left alone
//   expense-receipts   receipts/<file>       ->  <company id>/receipts/<file>   (company from the expense record,
//                      whose receipt column is changed from the old public link to the new path)
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: process.env.ENV_FILE || ".env" });

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.");
  process.exit(1);
}
const apply = process.argv.includes("--apply");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function listAll(bucket, prefix) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) throw new Error(`listing ${bucket}/${prefix}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

async function move(bucket, from, to) {
  if (!apply) return console.log(`  would move ${bucket}/${from} -> ${to}`);
  const { error } = await db.storage.from(bucket).move(from, to);
  if (error) throw new Error(`moving ${bucket}/${from}: ${error.message}`);
  console.log(`  moved ${bucket}/${from} -> ${to}`);
}

async function loginsByEmailName() {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listing logins: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }
  const { data: profiles, error } = await db.from("user_profiles").select("user_id, tenant_id");
  if (error) throw new Error(`reading user_profiles: ${error.message}`);
  const tenantOf = new Map(profiles.map((p) => [p.user_id, p.tenant_id]));

  const byName = new Map();
  for (const u of users) {
    const name = (u.email || "").split("@")[0].toLowerCase();
    const tenantId = tenantOf.get(u.id);
    if (!name || !tenantId) continue;
    byName.set(name, [...(byName.get(name) || []), { userId: u.id, tenantId }]);
  }
  return byName;
}

async function moveDocuments() {
  console.log("documents:");
  const byName = await loginsByEmailName();
  const folders = (await listAll("documents", "")).filter((f) => !f.id && !UUID_RE.test(f.name)); // folders have no id
  const leftOver = [];
  for (const folder of folders) {
    const matches = byName.get(folder.name.toLowerCase()) || [];
    if (matches.length !== 1) {
      leftOver.push(`${folder.name} (${matches.length === 0 ? "no matching login" : `${matches.length} logins share this email name`})`);
      continue;
    }
    const { userId, tenantId } = matches[0];
    for (const file of await listAll("documents", folder.name)) {
      if (!file.id) continue;
      await move("documents", `${folder.name}/${file.name}`, `${tenantId}/${userId}/${file.name}`);
    }
  }
  if (leftOver.length) console.log(`  left alone, sort out by hand:\n    ${leftOver.join("\n    ")}`);
}

async function moveReceipts() {
  console.log("expense-receipts:");
  const { data: expenses, error } = await db.from("expenses").select("id, tenant_id, receipt").not("receipt", "is", null);
  if (error) throw new Error(`reading expenses: ${error.message}`);
  for (const e of expenses) {
    const at = e.receipt.indexOf("/expense-receipts/");
    const path = at >= 0 ? decodeURIComponent(e.receipt.slice(at + "/expense-receipts/".length).split("?")[0]) : e.receipt;
    if (!path || UUID_RE.test(path.split("/")[0])) continue; // already in a company folder
    const to = `${e.tenant_id}/receipts/${path.split("/").pop()}`;
    await move("expense-receipts", path, to);
    if (apply) {
      const { error: updateError } = await db.from("expenses").update({ receipt: to }).eq("id", e.id).eq("tenant_id", e.tenant_id);
      if (updateError) throw new Error(`updating expense ${e.id}: ${updateError.message}`);
    }
  }
}

try {
  if (!apply) console.log("Dry run: nothing is changed. Run with --apply to move the files.\n");
  await moveDocuments();
  await moveReceipts();
  console.log("\nDone.");
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
