# Database changes (since 31 October 2026)

bloomHR's database no longer runs on Supabase Cloud. Production and staging are self-hosted Supabase on Figbloom's AWS
accounts (`hr-db.figbloom.org`, `hr-db-staging.figbloom.org`). The Supabase Cloud project is kept unchanged for a while
as a fallback, but **nothing goes to it any more**: no `supabase db push`, no `supabase functions deploy`, no SQL editor
changes there. Anything changed on Cloud is lost.

## What stays the same for developers

- Migrations go in `supabase/migrations/` exactly as before (`YYYYMMDDHHMMSS_name.sql`, later than the latest one).
- Edge functions go in `supabase/functions/` as before.
- Locally: `supabase start` / `supabase db reset` as before.
- Tests, PRs and review as before.

## What changed: who applies it, and when

Developers don't apply database changes to staging or production themselves. Mike (or whoever has AWS access) applies
them with one command, from the PR's branch, **before the PR is merged**:

1. The PR is reviewed and its tests pass.
2. Staging: `.\scripts\apply-db-changes.ps1 -Env staging -Ref figbloom/<branch>`, then check the change on
   hr-staging.figbloom.org.
3. Production: `.\scripts\apply-db-changes.ps1 -Env prod -Ref figbloom/<branch>`. It takes a backup first.
4. Merge the PR. Vercel publishes the app, which now finds the database it expects.

Why before merging: Vercel publishes `main` within a minute of a merge. An app that expects a column or function the
database doesn't have yet breaks for everyone until the migration runs. So the database goes first, and **every
migration must also work with the app as it is before the PR** (add columns and functions; don't rename or remove
something the current app uses in the same PR; remove it in a later PR once nothing uses it).

The script packs `supabase/` at that commit, uploads it, and runs it on the database server, which:

- lists the pending migrations and applies them in order with `supabase db push`;
- refuses if the database has tables but no migration history, or if more than 10 migrations are pending at once
  (a sign that something is wrong; check the list with Mike);
- copies the edge functions and restarts them.

A migration that fails stops there: the ones before it are applied, it and the ones after are not. Fix it in a new
commit and run the script again. **Never edit a migration that has already been applied anywhere**; add a new one.

## In your PR description

If the PR has a migration or changes an edge function, say so at the top:

> **Database change:** `supabase/migrations/2026..._name.sql`. Apply to staging and production before merging.

Mention anything that needs data afterwards (a one-off script, a setting).

## Questions

- Studio (the database dashboard) isn't public. Ask Mike for a read-only look if you need one.
- Setup of the servers themselves (backups, email settings, scheduled jobs) lives in the `figbloom-platform` repo
  (`assets/supabase-host/`, `docs/bloomhr-cutover.md`).
