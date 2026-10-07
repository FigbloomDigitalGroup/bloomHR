-- Internal Job Postings and Applications Tables
-- This system allows staff to browse and apply for internal job openings

-- Job Postings Table
CREATE TABLE IF NOT EXISTS job_postings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_title TEXT NOT NULL,
  department TEXT NOT NULL,
  location TEXT,
  job_type TEXT NOT NULL CHECK (job_type IN ('full_time', 'part_time', 'contract', 'temporary')),
  job_level TEXT,
  description TEXT NOT NULL,
  requirements TEXT NOT NULL,
  responsibilities TEXT,
  salary_range TEXT,
  benefits TEXT,
  application_deadline DATE,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'closed', 'filled', 'cancelled')),
  posted_by TEXT,
  posted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Job Applications Table
CREATE TABLE IF NOT EXISTS job_applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_posting_id UUID REFERENCES job_postings(id) ON DELETE CASCADE,
  employee_number TEXT NOT NULL,
  cover_letter TEXT,
  additional_info TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending',
    'under_review',
    'shortlisted',
    'interview_scheduled',
    'rejected',
    'accepted',
    'withdrawn'
  )),
  reviewed_by TEXT,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  admin_notes TEXT,
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(job_posting_id, employee_number) -- Prevent duplicate applications
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_job_postings_status ON job_postings(status);
CREATE INDEX IF NOT EXISTS idx_job_postings_department ON job_postings(department);
CREATE INDEX IF NOT EXISTS idx_job_postings_deadline ON job_postings(application_deadline);
CREATE INDEX IF NOT EXISTS idx_job_applications_posting ON job_applications(job_posting_id);
CREATE INDEX IF NOT EXISTS idx_job_applications_employee ON job_applications(employee_number);
CREATE INDEX IF NOT EXISTS idx_job_applications_status ON job_applications(status);

-- Comments
COMMENT ON TABLE job_postings IS 'Internal job postings available for staff applications';
COMMENT ON TABLE job_applications IS 'Staff applications for internal job postings';
COMMENT ON COLUMN job_applications.status IS 'Application status: pending, under_review, shortlisted, interview_scheduled, rejected, accepted, withdrawn';

-- Row Level Security
ALTER TABLE job_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_applications ENABLE ROW LEVEL SECURITY;

-- Policy: All authenticated staff can view open job postings
CREATE POLICY "Staff can view open job postings"
  ON job_postings
  FOR SELECT
  USING (
    status = 'open' AND
    (application_deadline IS NULL OR application_deadline >= CURRENT_DATE)
  );

-- Policy: Admins can view all job postings
CREATE POLICY "Admins can view all job postings"
  ON job_postings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM employees 
      WHERE "Work Email" = auth.jwt() ->> 'email' 
      AND "Job Title" IN ('Admin', 'HR Manager', 'System Administrator')
    )
  );

-- Policy: Admins can insert/update/delete job postings
CREATE POLICY "Admins can manage job postings"
  ON job_postings
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM employees 
      WHERE "Work Email" = auth.jwt() ->> 'email' 
      AND "Job Title" IN ('Admin', 'HR Manager', 'System Administrator')
    )
  );

-- Policy: Staff can view their own applications
CREATE POLICY "Staff can view own applications"
  ON job_applications
  FOR SELECT
  USING (
    employee_number IN (
      SELECT "Employee Number" 
      FROM employees 
      WHERE "Work Email" = auth.jwt() ->> 'email'
    )
  );

-- Policy: Staff can insert their own applications
CREATE POLICY "Staff can create applications"
  ON job_applications
  FOR INSERT
  WITH CHECK (
    employee_number IN (
      SELECT "Employee Number" 
      FROM employees 
      WHERE "Work Email" = auth.jwt() ->> 'email'
    )
  );

-- Policy: Staff can withdraw their own pending applications
CREATE POLICY "Staff can withdraw own applications"
  ON job_applications
  FOR UPDATE
  USING (
    employee_number IN (
      SELECT "Employee Number" 
      FROM employees 
      WHERE "Work Email" = auth.jwt() ->> 'email'
    ) AND
    status = 'pending'
  )
  WITH CHECK (
    status = 'withdrawn'
  );

-- Policy: Admins can view all applications
CREATE POLICY "Admins can view all applications"
  ON job_applications
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM employees 
      WHERE "Work Email" = auth.jwt() ->> 'email' 
      AND "Job Title" IN ('Admin', 'HR Manager', 'System Administrator')
    )
  );

-- Policy: Admins can update all applications
CREATE POLICY "Admins can update applications"
  ON job_applications
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM employees 
      WHERE "Work Email" = auth.jwt() ->> 'email' 
      AND "Job Title" IN ('Admin', 'HR Manager', 'System Administrator')
    )
  );

-- Function to update timestamps
CREATE OR REPLACE FUNCTION update_job_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for timestamp updates
CREATE TRIGGER update_job_posting_timestamp
  BEFORE UPDATE ON job_postings
  FOR EACH ROW
  EXECUTE FUNCTION update_job_timestamp();

CREATE TRIGGER update_job_application_timestamp
  BEFORE UPDATE ON job_applications
  FOR EACH ROW
  EXECUTE FUNCTION update_job_timestamp();

-- Function to prevent applying to closed positions
CREATE OR REPLACE FUNCTION check_job_posting_status()
RETURNS TRIGGER AS $$
DECLARE
  posting_status TEXT;
  posting_deadline DATE;
BEGIN
  SELECT status, application_deadline INTO posting_status, posting_deadline
  FROM job_postings
  WHERE id = NEW.job_posting_id;
  
  IF posting_status != 'open' THEN
    RAISE EXCEPTION 'Cannot apply to a job posting that is not open';
  END IF;
  
  IF posting_deadline IS NOT NULL AND posting_deadline < CURRENT_DATE THEN
    RAISE EXCEPTION 'Application deadline has passed';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to check posting status before application
CREATE TRIGGER check_posting_before_application
  BEFORE INSERT ON job_applications
  FOR EACH ROW
  EXECUTE FUNCTION check_job_posting_status();
