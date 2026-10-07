-- Birthday SMS Automation - Database Schema
-- Run this in Supabase SQL Editor

-- ============================================
-- BIRTHDAY SMS LOG TABLE
-- ============================================
-- Tracks automated birthday SMS sends to prevent duplicates

CREATE TABLE IF NOT EXISTS birthday_sms_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  birthday_date DATE NOT NULL,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status TEXT CHECK (status IN ('sent', 'failed')),
  error_message TEXT,
  
  -- Prevent duplicate sends on same day
  UNIQUE(employee_id, birthday_date)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_birthday_sms_log_date ON birthday_sms_log(birthday_date);
CREATE INDEX IF NOT EXISTS idx_birthday_sms_log_status ON birthday_sms_log(status);
CREATE INDEX IF NOT EXISTS idx_birthday_sms_log_employee ON birthday_sms_log(employee_id);

-- Comments
COMMENT ON TABLE birthday_sms_log IS 'Tracks automated birthday SMS sends to prevent duplicates';
COMMENT ON COLUMN birthday_sms_log.employee_id IS 'Employee Number from employees table';
COMMENT ON COLUMN birthday_sms_log.birthday_date IS 'Date when birthday SMS was sent (YYYY-MM-DD)';
COMMENT ON COLUMN birthday_sms_log.status IS 'Status of SMS send: sent or failed';

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE birthday_sms_log ENABLE ROW LEVEL SECURITY;

-- Allow service role (Edge Function) to insert and select
CREATE POLICY "Service role can manage birthday SMS log"
  ON birthday_sms_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow authenticated users to view logs
CREATE POLICY "Authenticated users can view birthday SMS log"
  ON birthday_sms_log
  FOR SELECT
  TO authenticated
  USING (true);

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Check today's sends
-- SELECT * FROM birthday_sms_log WHERE birthday_date = CURRENT_DATE;

-- Check success rate
-- SELECT 
--   status,
--   COUNT(*) as count,
--   ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentage
-- FROM birthday_sms_log
-- WHERE birthday_date >= CURRENT_DATE - INTERVAL '30 days'
-- GROUP BY status;
