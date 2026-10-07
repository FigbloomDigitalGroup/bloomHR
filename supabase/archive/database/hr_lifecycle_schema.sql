-- ============================================================
-- HR LIFECYCLE ENHANCEMENT MODULE - Database Schema
-- Run this script in your Supabase SQL editor
-- ============================================================

-- 1. EMPLOYMENT STATUS / CONTRACT SETTINGS
CREATE TABLE IF NOT EXISTS hr_contract_settings (
  id SERIAL PRIMARY KEY,
  tenant_id TEXT,
  default_probation_months INT DEFAULT 3,
  default_contract_months INT DEFAULT 12,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO hr_contract_settings (default_probation_months, default_contract_months) VALUES (3, 12) ON CONFLICT DO NOTHING;

-- 2. EMPLOYMENT STATUS (per employee)
CREATE TABLE IF NOT EXISTS hr_employment_status (
  id SERIAL PRIMARY KEY,
  "Employee Number" TEXT REFERENCES employees("Employee Number") ON DELETE CASCADE,
  employment_type TEXT CHECK (employment_type IN ('Attachment', 'Probation', 'Contract', 'Permanent')),
  joining_date DATE,
  probation_duration_months INT DEFAULT 3,
  contract_duration_months INT DEFAULT 12,
  probation_end_date DATE,
  contract_end_date DATE,
  is_confirmed BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. STAFF LIFECYCLE HISTORY
CREATE TABLE IF NOT EXISTS hr_lifecycle_history (
  id SERIAL PRIMARY KEY,
  "Employee Number" TEXT REFERENCES employees("Employee Number") ON DELETE CASCADE,
  event_type TEXT CHECK (event_type IN (
    'branch_transfer', 'promotion', 'position_change', 'salary_revision',
    'status_change', 'probation_confirmed', 'probation_extended',
    'contract_renewed', 'contract_converted', 'suspension',
    'reactivation', 'termination', 'other'
  )),
  event_date TIMESTAMPTZ DEFAULT NOW(),
  old_value JSONB,
  new_value JSONB,
  notes TEXT,
  performed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. SUSPENSION MODULE
CREATE TABLE IF NOT EXISTS hr_suspensions (
  id SERIAL PRIMARY KEY,
  "Employee Number" TEXT REFERENCES employees("Employee Number") ON DELETE CASCADE,
  suspension_date DATE NOT NULL,
  suspension_reason TEXT,
  duration_days INT,
  auto_reactivate BOOLEAN DEFAULT FALSE,
  reactivation_date DATE,
  is_active BOOLEAN DEFAULT TRUE,
  exclude_from_payroll BOOLEAN DEFAULT FALSE,
  notes TEXT,
  performed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. TERMINATION MODULE
CREATE TABLE IF NOT EXISTS hr_terminations (
  id SERIAL PRIMARY KEY,
  "Employee Number" TEXT REFERENCES employees("Employee Number") ON DELETE CASCADE,
  termination_date DATE NOT NULL,
  termination_type TEXT CHECK (termination_type IN ('Voluntary', 'Dismissal', 'Contract End', 'Redundancy')),
  termination_reason TEXT,
  document_url TEXT,
  final_payroll_status TEXT DEFAULT 'Pending',
  clearance_status TEXT DEFAULT 'Pending',
  is_archived BOOLEAN DEFAULT FALSE,
  performed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. TERMINATION INTERVIEWS
CREATE TABLE IF NOT EXISTS hr_termination_interviews (
  id SERIAL PRIMARY KEY,
  "Employee Number" TEXT REFERENCES employees("Employee Number") ON DELETE CASCADE,
  interview_date TIMESTAMPTZ,
  interviewer TEXT,
  interview_notes TEXT,
  document_url TEXT,
  is_completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. DISMISSAL EMAILS
CREATE TABLE IF NOT EXISTS hr_dismissal_emails (
  id SERIAL PRIMARY KEY,
  "Employee Number" TEXT REFERENCES employees("Employee Number") ON DELETE CASCADE,
  email_subject TEXT,
  email_body TEXT,
  sent_at TIMESTAMPTZ,
  is_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. SALARY ADVANCE / DEDUCTIONS
CREATE TABLE IF NOT EXISTS hr_salary_advances (
  id SERIAL PRIMARY KEY,
  "Employee Number" TEXT REFERENCES employees("Employee Number") ON DELETE CASCADE,
  advance_date DATE NOT NULL,
  advance_amount NUMERIC(12,2) NOT NULL,
  monthly_deduction NUMERIC(12,2) NOT NULL,
  total_repaid NUMERIC(12,2) DEFAULT 0,
  remaining_balance NUMERIC(12,2) DEFAULT 0,
  is_completed BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. LEAVE SCHEDULE ASSIGNER
CREATE TABLE IF NOT EXISTS hr_leave_schedules (
  id SERIAL PRIMARY KEY,
  "Employee Number" TEXT REFERENCES employees("Employee Number") ON DELETE CASCADE,
  leave_type TEXT,
  leave_start_date DATE,
  leave_end_date DATE,
  leave_days INT,
  status TEXT DEFAULT 'Scheduled' CHECK (status IN ('Scheduled', 'Approved', 'Rejected', 'Completed')),
  notify_5days BOOLEAN DEFAULT TRUE,
  notify_1day BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Enable Row Level Security
-- ============================================================
ALTER TABLE hr_contract_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_employment_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_lifecycle_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_suspensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_terminations ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_termination_interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_dismissal_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_salary_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_leave_schedules ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS Policies (authenticated users)
-- ============================================================
CREATE POLICY "hr_contract_settings_policy" ON hr_contract_settings FOR ALL TO authenticated USING (true);
CREATE POLICY "hr_employment_status_policy" ON hr_employment_status FOR ALL TO authenticated USING (true);
CREATE POLICY "hr_lifecycle_history_policy" ON hr_lifecycle_history FOR ALL TO authenticated USING (true);
CREATE POLICY "hr_suspensions_policy" ON hr_suspensions FOR ALL TO authenticated USING (true);
CREATE POLICY "hr_terminations_policy" ON hr_terminations FOR ALL TO authenticated USING (true);
CREATE POLICY "hr_termination_interviews_policy" ON hr_termination_interviews FOR ALL TO authenticated USING (true);
CREATE POLICY "hr_dismissal_emails_policy" ON hr_dismissal_emails FOR ALL TO authenticated USING (true);
CREATE POLICY "hr_salary_advances_policy" ON hr_salary_advances FOR ALL TO authenticated USING (true);
CREATE POLICY "hr_leave_schedules_policy" ON hr_leave_schedules FOR ALL TO authenticated USING (true);
