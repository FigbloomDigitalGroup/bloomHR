-- ========================================================
-- ZiraPro COMPLETE Master Schema Replicator
-- Optimized for Security (RLS) and Performance
-- ========================================================

-- Enable core extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 0. CLEANUP
DROP VIEW IF EXISTS users CASCADE;

-- 1. ASSETS & LOGS
CREATE TABLE IF NOT EXISTS assets (model text, status text, condition text, location text, assigned_to text, notes text, purchase_date date, purchase_value numeric, id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), updated_at timestamp without time zone DEFAULT NOW(), created_at timestamp without time zone DEFAULT NOW(), next_maintenance date, last_maintenance date, warranty_expiry date, asset_name text, asset_tag text, category text, serial_number text, brand text);
CREATE TABLE IF NOT EXISTS attendance_logs (employee_number text, id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY, created_at timestamp with time zone DEFAULT NOW(), login_time timestamp with time zone, logout_time timestamp with time zone, geolocation jsonb, status text);
CREATE TABLE IF NOT EXISTS audit_log (user_agent text, id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), record_id uuid, old_data jsonb, new_data jsonb, performed_by uuid, performed_at timestamp with time zone DEFAULT NOW(), action_type character varying, table_name character varying, ip_address character varying);

-- 2. BRANCHES & PERFORMANCE
CREATE TABLE IF NOT EXISTS kenya_branches (id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY, "Town" text, created_at timestamp with time zone DEFAULT NOW(), "Area" text, "Branch Office" text);
CREATE TABLE IF NOT EXISTS kenya_branches_duplicate (id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY, "Town" text, "Branch Office" text, "Area" text, created_at timestamp with time zone DEFAULT NOW());

CREATE TABLE IF NOT EXISTS branch_performance (portfolio_at_risk numeric, total_active_loans integer, loans_in_arrears integer, arrears_amount numeric, new_loans integer, updated_at timestamp without time zone DEFAULT NOW(), total_loans_disbursed integer, created_at timestamp without time zone DEFAULT NOW(), staff_count integer, disbursement_target integer, total_collection numeric, collection_target numeric, average_tat numeric, total_par numeric, id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY, branch_id bigint REFERENCES kenya_branches(id), date date, period text, portfolio_quality text, portfolio_size numeric, client_dropout_rate numeric, new_clients integer, active_clients integer, loan_officer_count integer);

-- 3. CHAT & TEAMS
CREATE TABLE IF NOT EXISTS channels (is_private boolean DEFAULT false, created_by uuid, job_title text, description text, type text, updated_at timestamp with time zone DEFAULT NOW(), created_at timestamp with time zone DEFAULT NOW(), name text, id uuid PRIMARY KEY DEFAULT uuid_generate_v4());
CREATE TABLE IF NOT EXISTS channel_members (channel_id uuid REFERENCES channels(id) ON DELETE CASCADE, user_id uuid, joined_at timestamp with time zone DEFAULT NOW(), last_read_at timestamp with time zone, is_muted boolean DEFAULT false, role text DEFAULT 'member', id uuid PRIMARY KEY DEFAULT uuid_generate_v4());
CREATE TABLE IF NOT EXISTS messages (reactions jsonb DEFAULT '[]', channel_id uuid REFERENCES channels(id) ON DELETE CASCADE, id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), author_id uuid, content text, mentions jsonb DEFAULT '[]', attachments jsonb DEFAULT '[]', reply_to uuid, is_edited boolean DEFAULT false, created_at timestamp with time zone DEFAULT NOW(), author_name text, updated_at timestamp with time zone DEFAULT NOW(), author_initials text, author_avatar text, author_town text);
CREATE TABLE IF NOT EXISTS message_reactions (message_id uuid REFERENCES messages(id) ON DELETE CASCADE, emoji text, id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), user_id uuid, created_at timestamp with time zone DEFAULT NOW());

-- 4. EMPLOYEES
CREATE TABLE IF NOT EXISTS employees (
    "Employee Number" text PRIMARY KEY, 
    "First Name" text, 
    "Middle Name" text, 
    "Last Name" text, 
    "Work Email" text UNIQUE, 
    "Town" text, 
    "Branch" text, 
    "Office" text,
    "ID Number" bigint, 
    "Job Title" text, 
    "Work Mobile" text, 
    "Start Date" text, 
    "created_at" timestamp with time zone DEFAULT NOW()
);

-- 5. HR MODULES
CREATE TABLE IF NOT EXISTS leave_application (recommendation_notes text, recstatus text, Region text, id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "Employee Number" text REFERENCES employees("Employee Number"), "Application Type" text, Reason text, "Leave Type" text, "Start Date" text, Status text, "Office Branch" text, time_added timestamp with time zone DEFAULT NOW(), Days bigint, Name text, "End Date" text, Type text, notes text);

-- 11. USER PROFILES
CREATE TABLE IF NOT EXISTS user_profiles (
    user_id uuid PRIMARY KEY, 
    full_name text, 
    email text UNIQUE, 
    role text DEFAULT 'STAFF', 
    department text, 
    created_at timestamp with time zone DEFAULT NOW()
);

CREATE OR REPLACE VIEW users AS SELECT user_id as id, email, full_name, role, department, created_at FROM user_profiles;

-- 13. MFA TABLES
CREATE TABLE IF NOT EXISTS mfa_numbers (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), email text UNIQUE NOT NULL, phone_number text NOT NULL, created_at timestamp with time zone DEFAULT NOW());
CREATE TABLE IF NOT EXISTS mfa_codes (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), email text NOT NULL, code text NOT NULL, phone_number text NOT NULL, expires_at timestamp with time zone NOT NULL, used boolean DEFAULT false, created_at timestamp with time zone DEFAULT NOW());

-- 14. COMPANY PROFILE
CREATE TABLE IF NOT EXISTS company_logo (id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY, image_url text, company_name text, company_tagline text, created_at timestamp with time zone DEFAULT NOW());

-- 15. PERMISSIONS
CREATE TABLE IF NOT EXISTS role_permissions (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), role_name text UNIQUE, permissions text[], created_at timestamp with time zone DEFAULT NOW());

-- ========================================================
-- SECURITY: GLOBAL RLS POLICY GENERATOR
-- ========================================================

DO $$ 
DECLARE 
    r RECORD;
BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
        EXECUTE format('DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.%I', r.tablename);
        EXECUTE format('CREATE POLICY "Enable all access for authenticated users" ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', r.tablename);
    END LOOP;
END $$;

-- MASTER PERMISSIONS GRANT
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- REFRESH API
NOTIFY pgrst, 'reload schema';
