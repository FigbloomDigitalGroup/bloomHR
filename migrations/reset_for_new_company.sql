-- SQL Script to Reset Figbloom HR for a New Company
-- WARNING: This will delete ALL employee data, transactions, and company-specific records.
-- Run this in your Supabase SQL Editor.

-- 1. Disable triggers temporarily if needed (optional, depends on your setup)
-- SET session_replication_role = 'replica';

-- 2. Clear Transactional & Child Tables First (to avoid foreign key constraint errors)
-- Each table is truncated only if it exists, so a table missing from this deployment
-- (the list below covers several optional modules) does not abort the whole script.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'dependents', 'emergency_contact', 'employee_specific', 'salary_advance',
    'loan_requests', 'leave_application', 'attendance_logs', 'warnings',
    'job_applications', 'expenses', 'company_news', 'payroll_records',
    'mpesa_transactions'
  ]
  LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NOT NULL THEN
      EXECUTE format('TRUNCATE TABLE public.%I CASCADE', t);
    ELSE
      RAISE NOTICE 'Skipping % (table does not exist)', t;
    END IF;
  END LOOP;
END $$;

-- 3. Clear Main Employee Table
TRUNCATE TABLE employees CASCADE;

-- 4. Clear Authentication Users (Optional - if you want to remove all login access)
-- Note: This requires special permissions in Supabase. Usually better to delete users via the Dashboard.
-- DELETE FROM auth.users WHERE email != 'your_admin_email@example.com';

-- 5. Reset Company Details (Update with new company info)
-- Assuming 'company_logo' table holds the company profile
-- Only columns defined in master_schema.sql are touched; extend this if your company_logo has more.
UPDATE company_logo
SET
  company_name = 'New Company Name',
  company_tagline = 'Your tagline',
  image_url = 'https://example.com/logo.png' -- Replace with new logo URL
WHERE id = (SELECT id FROM company_logo LIMIT 1);
-- Or if you want to start fresh:
-- TRUNCATE TABLE company_logo;
-- INSERT INTO company_logo (company_name, ...) VALUES (...);

-- 6. Add a default Admin User (if you deleted everyone)
-- You will need to sign up a new user via the app or add them to auth.users manually.
-- Then insert their details into 'employees' table with 'System Administrator' role.

-- Enable triggers back
-- SET session_replication_role = 'origin';

SELECT 'Figbloom HR data reset complete. Ready for new company setup.' as status;
