-- Incident Reports Table
-- This table stores workplace incident reports and whistleblowing submissions
-- Supports both anonymous and identified reporting

CREATE TABLE IF NOT EXISTS incident_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_number TEXT, -- NULL for anonymous reports
  is_anonymous BOOLEAN DEFAULT false NOT NULL,
  
  -- Report Details
  incident_type TEXT NOT NULL CHECK (incident_type IN (
    'harassment',
    'discrimination', 
    'safety_violation',
    'ethics_violation',
    'fraud',
    'theft',
    'policy_violation',
    'workplace_violence',
    'other'
  )),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  incident_date DATE,
  location TEXT,
  witnesses TEXT,
  evidence_urls TEXT[], -- Array of file URLs if attachments provided
  
  -- Status and Resolution
  status TEXT DEFAULT 'new' CHECK (status IN (
    'new',
    'under_review',
    'investigating',
    'resolved',
    'closed',
    'dismissed'
  )),
  admin_notes TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  resolution TEXT,
  resolved_at TIMESTAMP WITH TIME ZONE,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_incident_reports_status ON incident_reports(status);
CREATE INDEX IF NOT EXISTS idx_incident_reports_type ON incident_reports(incident_type);
CREATE INDEX IF NOT EXISTS idx_incident_reports_severity ON incident_reports(severity);
CREATE INDEX IF NOT EXISTS idx_incident_reports_created ON incident_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incident_reports_employee ON incident_reports(employee_number) WHERE employee_number IS NOT NULL;

-- Add comments
COMMENT ON TABLE incident_reports IS 'Stores workplace incident reports and whistleblowing submissions with anonymity protection';
COMMENT ON COLUMN incident_reports.is_anonymous IS 'If true, employee_number should be NULL to protect reporter identity';
COMMENT ON COLUMN incident_reports.evidence_urls IS 'Array of URLs to uploaded evidence files';

-- Row Level Security (RLS) Policies
ALTER TABLE incident_reports ENABLE ROW LEVEL SECURITY;

-- Policy: Staff can view only their own non-anonymous reports
CREATE POLICY "Staff can view own identified reports"
  ON incident_reports
  FOR SELECT
  USING (
    is_anonymous = false AND
    employee_number IN (
      SELECT "Employee Number" 
      FROM employees 
      WHERE "Work Email" = auth.jwt() ->> 'email'
    )
  );

-- Policy: Staff can insert reports (both anonymous and identified)
CREATE POLICY "Staff can create incident reports"
  ON incident_reports
  FOR INSERT
  WITH CHECK (
    -- For identified reports, must be their own employee number
    (is_anonymous = false AND employee_number IN (
      SELECT "Employee Number" 
      FROM employees 
      WHERE "Work Email" = auth.jwt() ->> 'email'
    ))
    OR
    -- For anonymous reports, employee_number must be NULL
    (is_anonymous = true AND employee_number IS NULL)
  );

-- Policy: Admins can view all reports
CREATE POLICY "Admins can view all incident reports"
  ON incident_reports
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM employees 
      WHERE "Work Email" = auth.jwt() ->> 'email' 
      AND "Job Title" IN ('Admin', 'HR Manager', 'System Administrator')
    )
  );

-- Policy: Admins can update all reports (status, notes, resolution)
CREATE POLICY "Admins can update incident reports"
  ON incident_reports
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM employees 
      WHERE "Work Email" = auth.jwt() ->> 'email' 
      AND "Job Title" IN ('Admin', 'HR Manager', 'System Administrator')
    )
  );

-- Function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_incident_report_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to call the timestamp update function
CREATE TRIGGER update_incident_report_timestamp
  BEFORE UPDATE ON incident_reports
  FOR EACH ROW
  EXECUTE FUNCTION update_incident_report_timestamp();

-- Function to ensure anonymous reports don't have employee_number
CREATE OR REPLACE FUNCTION enforce_anonymous_report_rules()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_anonymous = true AND NEW.employee_number IS NOT NULL THEN
    RAISE EXCEPTION 'Anonymous reports cannot have an employee_number';
  END IF;
  
  IF NEW.is_anonymous = false AND NEW.employee_number IS NULL THEN
    RAISE EXCEPTION 'Non-anonymous reports must have an employee_number';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to enforce anonymous report rules
CREATE TRIGGER enforce_anonymous_rules
  BEFORE INSERT OR UPDATE ON incident_reports
  FOR EACH ROW
  EXECUTE FUNCTION enforce_anonymous_report_rules();
