Figbloom HR


## Migrations

Schema changes go in `supabase/migrations/` with a timestamp prefix (`YYYYMMDDHHMMSS_name.sql`) so `supabase db push` applies them in order. The `role_permissions` / `permissions` tables are defined in `20260930000000_role_permissions.sql`. `migrations/reset_for_new_company.sql` is a manual, destructive tenant-reset script, not part of `db push`.

## Scripts

| Script | Purpose |
|---|---|
| `scripts/insert_fake_employees.ts` | Inserts two dummy employees for testing. Reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_SERVICE_ROLE_KEY` from `.env` / `.env.tenant`. |
