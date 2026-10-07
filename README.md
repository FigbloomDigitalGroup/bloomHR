Figbloom HR


## Migrations

Schema changes go in `supabase/migrations/` with a timestamp prefix (`YYYYMMDDHHMMSS_name.sql`) so `supabase db push` applies them in order.

- `20261006000150_baseline.sql` is the whole live schema (a `supabase db dump`); `20261006000160_reference_data.sql` adds the permissions catalogue and the default company's roles. A fresh project is just `supabase db push`.
- Locally: `supabase start` (Docker) builds a database from the migrations; `supabase db reset` rebuilds it.
- The SQL that the baseline replaced (`master_schema.sql`, the old `database/` scripts, the undated migrations, and the destructive `reset_for_new_company.sql`) is kept in `supabase/archive/` for reference only. Do not run it.
- After the private-storage migration, run `node scripts/move_private_files.mjs` once (dry run), then with `--apply`.

## Scripts

| Script | Purpose |
|---|---|
| `scripts/move_private_files.mjs` | One-off: moves staff documents and expense receipts saved under the old storage layout into per-company folders. Dry run unless `--apply`. |
| `scripts/insert_fake_employees.ts` | Inserts two dummy employees for testing. Reads `VITE_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `.env` / `.env.tenant`. |
