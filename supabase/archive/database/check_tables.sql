-- Check if tables exist and view their structure
-- Run this to verify step 1 worked

SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('job_postings', 'job_applications');

-- If tables exist, check columns
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'job_applications' 
ORDER BY ordinal_position;
