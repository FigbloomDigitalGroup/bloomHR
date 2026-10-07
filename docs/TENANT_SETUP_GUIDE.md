# New Tenant Setup Guide

This guide explains how to add a new tenant to the Figbloom HR system while maintaining a completely separate database and independence for each client.

## 1. Create a New Supabase Project
Each tenant requires its own Supabase project:
1. Go to [Supabase Dashboard](https://supabase.com/dashboard).
2. Create a new project.
3. Note down the following credentials:
   - **Project URL**
   - **Anon Key**
   - **Service Role Key**

## 2. Initialize the Database Schema
Since each tenant has a separate database, you must apply the required schema. With the [Supabase CLI](https://supabase.com/docs/guides/cli):
1. `supabase link --project-ref <new project ref>`
2. `supabase db push` — applies every file in `supabase/migrations/` in order: the baseline schema, the reference data (permissions and default roles), then later changes.

Do not run the files in `supabase/archive/`; they are superseded by the baseline.

## 3. Configure Environment Variables
Create a new environment file for the tenant (e.g., `.env.tenant2`).

1. Copy `.env.tenant.template` to `.env.tenant2`.
2. Update the credentials with the new tenant's information:
   ```env
   # Backend Port (e.g., 3002)
   PORT=3002
   
   # Frontend API URL (must match PORT)
   VITE_API_URL=http://localhost:3002/api
   
   # Supabase Credentials
   VITE_SUPABASE_URL=https://new-tenant.supabase.co
   VITE_SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   ```

## 4. Run the Application for the New Tenant

### Local Development
To run the application for the new tenant locally:
```bash
# Set the environment file for the backend and run the frontend in the specific mode
cross-env ENV_FILE=.env.tenant2 npm run dev:tenant
```
*Note: You may need to adjust the `package.json` scripts if you use a different filename than `.env.tenant`.*

### Production Build
To build the application for a specific tenant:
```bash
# Build the frontend with the specific tenant environment
npm run build:tenant
```

## 5. Deployment Considerations
1. **Compute**: Each tenant can run as a separate process (container) on your server, listening on a unique port.
2. **URLs**: You should typically point a unique subdomain to each tenant's frontend (e.g., `tenant1.zirahrapp.com`, `tenant2.zirahrapp.com`).
3. **M-Pesa Callbacks**: Ensure that the M-Pesa callback URLs in the `.env` file are unique to this tenant's backend instance so that notifications reach the correct database.

## Summary of Changes Made to Support This
- **Dynamic Port**: Backend now accepts `PORT` from environment.
- **Dynamic .env**: Backend can load a specific `.env` file using the `ENV_FILE` variable.
- **Vite Modes**: Frontend uses Vite's `--mode` feature to load tenant-specific variables.
- **Dynamic Proxy**: `vite.config.ts` now dynamically proxies to the correct backend port based on `VITE_API_URL`.
