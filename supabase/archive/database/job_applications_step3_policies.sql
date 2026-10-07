-- Step 3: Create RLS Policies
-- Run this after Step 2 completes successfully

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
