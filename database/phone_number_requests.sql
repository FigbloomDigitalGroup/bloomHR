-- Phone Number Change Requests Table
-- This table tracks all staff requests to change their primary mobile number
-- Admins must approve these requests before the phone number is updated

CREATE TABLE IF NOT EXISTS phone_number_change_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_number TEXT NOT NULL,
  current_phone TEXT,
  requested_phone TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  reviewed_by TEXT,
  admin_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_phone_requests_employee ON phone_number_change_requests(employee_number);
CREATE INDEX IF NOT EXISTS idx_phone_requests_status ON phone_number_change_requests(status);
CREATE INDEX IF NOT EXISTS idx_phone_requests_created ON phone_number_change_requests(created_at DESC);

-- Add comment to table
COMMENT ON TABLE phone_number_change_requests IS 'Tracks staff requests to change their primary mobile number, requiring admin approval';

-- Row Level Security (RLS) Policies
ALTER TABLE phone_number_change_requests ENABLE ROW LEVEL SECURITY;

-- Policy: Staff can view their own requests
CREATE POLICY "Staff can view own phone change requests"
  ON phone_number_change_requests
  FOR SELECT
  USING (
    employee_number IN (
      SELECT "Employee Number" 
      FROM employees 
      WHERE "Work Email" = auth.jwt() ->> 'email'
    )
  );

-- Policy: Staff can insert their own requests
CREATE POLICY "Staff can create phone change requests"
  ON phone_number_change_requests
  FOR INSERT
  WITH CHECK (
    employee_number IN (
      SELECT "Employee Number" 
      FROM employees 
      WHERE "Work Email" = auth.jwt() ->> 'email'
    )
  );

-- Policy: Staff can update only their pending requests (for cancellation)
CREATE POLICY "Staff can cancel pending requests"
  ON phone_number_change_requests
  FOR UPDATE
  USING (
    status = 'pending' AND
    employee_number IN (
      SELECT "Employee Number" 
      FROM employees 
      WHERE "Work Email" = auth.jwt() ->> 'email'
    )
  )
  WITH CHECK (
    status = 'pending' AND
    employee_number IN (
      SELECT "Employee Number" 
      FROM employees 
      WHERE "Work Email" = auth.jwt() ->> 'email'
    )
  );

-- Policy: Admins can view all requests
-- Note: You'll need to adjust this based on your admin role implementation
CREATE POLICY "Admins can view all phone change requests"
  ON phone_number_change_requests
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM employees 
      WHERE "Work Email" = auth.jwt() ->> 'email' 
      AND "Job Title" IN ('Admin', 'HR Manager', 'System Administrator')
    )
  );

-- Policy: Admins can update all requests (approve/reject)
CREATE POLICY "Admins can update phone change requests"
  ON phone_number_change_requests
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM employees 
      WHERE "Work Email" = auth.jwt() ->> 'email' 
      AND "Job Title" IN ('Admin', 'HR Manager', 'System Administrator')
    )
  );

-- Function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_phone_request_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to call the timestamp update function
CREATE TRIGGER update_phone_request_timestamp
  BEFORE UPDATE ON phone_number_change_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_phone_request_timestamp();
