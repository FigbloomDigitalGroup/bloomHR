-- Step 4: Create Functions and Triggers
-- Run this after Step 3 completes successfully

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
