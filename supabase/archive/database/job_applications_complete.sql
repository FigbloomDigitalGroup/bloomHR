-- Complete Job Applications Setup - Run All at Once
-- This creates everything needed for the job applications feature

-- Drop existing tables if they exist (to start fresh)
DROP TABLE IF EXISTS job_applications CASCADE;
DROP TABLE IF EXISTS job_postings CASCADE;

-- Create Job Postings Table
CREATE TABLE job_postings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_title TEXT NOT NULL,
  department TEXT NOT NULL,
  location TEXT,
  job_type TEXT NOT NULL,
  job_level TEXT,
  description TEXT NOT NULL,
  requirements TEXT NOT NULL,
  responsibilities TEXT,
  salary_range TEXT,
  benefits TEXT,
  application_deadline DATE,
  status TEXT DEFAULT 'open',
  posted_by TEXT,
  posted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create Job Applications Table
CREATE TABLE job_applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_posting_id UUID NOT NULL,
  employee_number TEXT NOT NULL,
  cover_letter TEXT,
  additional_info TEXT,
  status TEXT DEFAULT 'pending',
  reviewed_by TEXT,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  admin_notes TEXT,
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add foreign key constraint
ALTER TABLE job_applications 
  ADD CONSTRAINT fk_job_posting 
  FOREIGN KEY (job_posting_id) 
  REFERENCES job_postings(id) 
  ON DELETE CASCADE;

-- Add unique constraint
ALTER TABLE job_applications 
  ADD CONSTRAINT unique_application 
  UNIQUE(job_posting_id, employee_number);

-- Create Indexes
CREATE INDEX idx_job_postings_status ON job_postings(status);
CREATE INDEX idx_job_postings_department ON job_postings(department);
CREATE INDEX idx_job_postings_deadline ON job_postings(application_deadline);
CREATE INDEX idx_job_applications_posting ON job_applications(job_posting_id);
CREATE INDEX idx_job_applications_employee ON job_applications(employee_number);
CREATE INDEX idx_job_applications_status ON job_applications(status);

-- Enable RLS
ALTER TABLE job_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_applications ENABLE ROW LEVEL SECURITY;

-- RLS Policies for job_postings
CREATE POLICY "Staff can view open job postings"
  ON job_postings FOR SELECT
  USING (status = 'open' AND (application_deadline IS NULL OR application_deadline >= CURRENT_DATE));

CREATE POLICY "Admins can view all job postings"
  ON job_postings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM employees 
      WHERE "Work Email" = auth.jwt() ->> 'email' 
      AND "Job Title" IN ('Admin', 'HR Manager', 'System Administrator')
    )
  );

CREATE POLICY "Admins can manage job postings"
  ON job_postings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM employees 
      WHERE "Work Email" = auth.jwt() ->> 'email' 
      AND "Job Title" IN ('Admin', 'HR Manager', 'System Administrator')
    )
  );

-- RLS Policies for job_applications
CREATE POLICY "Staff can view own applications"
  ON job_applications FOR SELECT
  USING (
    employee_number IN (
      SELECT "Employee Number" 
      FROM employees 
      WHERE "Work Email" = auth.jwt() ->> 'email'
    )
  );

CREATE POLICY "Staff can create applications"
  ON job_applications FOR INSERT
  WITH CHECK (
    employee_number IN (
      SELECT "Employee Number" 
      FROM employees 
      WHERE "Work Email" = auth.jwt() ->> 'email'
    )
  );

CREATE POLICY "Staff can withdraw own applications"
  ON job_applications FOR UPDATE
  USING (
    employee_number IN (
      SELECT "Employee Number" 
      FROM employees 
      WHERE "Work Email" = auth.jwt() ->> 'email'
    ) AND status = 'pending'
  )
  WITH CHECK (status = 'withdrawn');

CREATE POLICY "Admins can view all applications"
  ON job_applications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM employees 
      WHERE "Work Email" = auth.jwt() ->> 'email' 
      AND "Job Title" IN ('Admin', 'HR Manager', 'System Administrator')
    )
  );

CREATE POLICY "Admins can update applications"
  ON job_applications FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM employees 
      WHERE "Work Email" = auth.jwt() ->> 'email' 
      AND "Job Title" IN ('Admin', 'HR Manager', 'System Administrator')
    )
  );

-- Create timestamp update function
CREATE OR REPLACE FUNCTION update_job_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers
CREATE TRIGGER update_job_posting_timestamp
  BEFORE UPDATE ON job_postings
  FOR EACH ROW
  EXECUTE FUNCTION update_job_timestamp();

CREATE TRIGGER update_job_application_timestamp
  BEFORE UPDATE ON job_applications
  FOR EACH ROW
  EXECUTE FUNCTION update_job_timestamp();
