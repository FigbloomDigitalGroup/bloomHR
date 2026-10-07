-- Step 2: Create Indexes and Enable RLS
-- Run this after Step 1 completes successfully

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_job_postings_status ON job_postings(status);
CREATE INDEX IF NOT EXISTS idx_job_postings_department ON job_postings(department);
CREATE INDEX IF NOT EXISTS idx_job_postings_deadline ON job_postings(application_deadline);
CREATE INDEX IF NOT EXISTS idx_job_applications_posting ON job_applications(job_posting_id);
CREATE INDEX IF NOT EXISTS idx_job_applications_employee ON job_applications(employee_number);
CREATE INDEX IF NOT EXISTS idx_job_applications_status ON job_applications(status);

-- Enable Row Level Security
ALTER TABLE job_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_applications ENABLE ROW LEVEL SECURITY;
