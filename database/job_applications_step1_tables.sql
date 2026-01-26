-- Step 1: Create Tables First
-- Run this section first

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
  UNIQUE(job_posting_id, employee_number)
);
