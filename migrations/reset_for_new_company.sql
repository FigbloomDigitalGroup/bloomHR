-- SQL Script to Reset ZiraPro for a New Company
-- WARNING: This will delete ALL employee data, transactions, and company-specific records.
-- Run this in your Supabase SQL Editor.

-- 1. Disable triggers temporarily if needed (optional, depends on your setup)
-- SET session_replication_role = 'replica';

-- 2. Clear Transactional & Child Tables First (to avoid foreign key constraint errors)
TRUNCATE TABLE dependents CASCADE;
TRUNCATE TABLE emergency_contact CASCADE;
TRUNCATE TABLE employee_specific CASCADE;
TRUNCATE TABLE salary_advance CASCADE;
TRUNCATE TABLE loan_requests CASCADE;
TRUNCATE TABLE leave_applications CASCADE;
TRUNCATE TABLE attendance_logs CASCADE;
TRUNCATE TABLE warnings CASCADE;
TRUNCATE TABLE job_applications CASCADE;
TRUNCATE TABLE expenses CASCADE;
TRUNCATE TABLE company_news CASCADE;
TRUNCATE TABLE payroll_records CASCADE; -- If exists
TRUNCATE TABLE mpesa_transactions CASCADE; -- If exists

-- 3. Clear Main Employee Table
TRUNCATE TABLE employees CASCADE;

-- 4. Clear Authentication Users (Optional - if you want to remove all login access)
-- Note: This requires special permissions in Supabase. Usually better to delete users via the Dashboard.
-- DELETE FROM auth.users WHERE email != 'your_admin_email@example.com';

-- 5. Reset Company Details (Update with new company info)
-- Assuming 'company_logo' table holds the company profile
UPDATE company_logo
SET 
  company_name = 'New Company Name',
  company_email = 'info@newcompany.com',
  company_phone = '+254700000000',
  kra_pin = 'P000000000A',
  nssf = '00000',
  nhif = '00000',
  logo_url = 'https://example.com/logo.png' -- Replace with new logo URL
WHERE id = (SELECT id FROM company_logo LIMIT 1); 
-- Or if you want to start fresh:
-- TRUNCATE TABLE company_logo;
-- INSERT INTO company_logo (company_name, ...) VALUES (...);

-- 6. Add a default Admin User (if you deleted everyone)
-- You will need to sign up a new user via the app or add them to auth.users manually.
-- Then insert their details into 'employees' table with 'System Administrator' role.

-- Enable triggers back
-- SET session_replication_role = 'origin';

SELECT 'ZiraPro data reset complete. Ready for new company setup.' as status;
