export interface Employee {
  id: string;
  employee_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  id_number: string;
  kra_pin: string;
  nssf_number: string;
  nhif_number: string;
  department: string;
  position: string;
  salary: number;
  hire_date: string;
  status: 'active' | 'inactive' | 'terminated';
  profile_photo?: string;
  created_at: string;
  updated_at: string;
}

export interface Leave {
  id: string;
  employee_id: string;
  leave_type: 'annual' | 'sick' | 'maternity' | 'paternity' | 'compassionate' | 'unpaid';
  start_date: string;
  end_date: string;
  days_requested: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  approved_by?: string;
  created_at: string;
}

export interface Payroll {
  id: string;
  employee_id: string;
  pay_period: string;
  basic_salary: number;
  allowances: number;
  overtime: number;
  gross_pay: number;
  paye_tax: number;
  nhif_deduction: number;
  nssf_deduction: number;
  other_deductions: number;
  net_pay: number;
  created_at: string;
}

export interface Performance {
  id: string;
  employee_id: string;
  review_period: string;
  overall_score: number;
  goals_achievement: number;
  competencies_score: number;
  reviewer_id: string;
  comments: string;
  status: 'draft' | 'completed' | 'approved';
  created_at: string;
}

export interface Training {
  id: string;
  title: string;
  description: string;
  trainer: string;
  start_date: string;
  end_date: string;
  cost: number;
  status: 'scheduled' | 'ongoing' | 'completed' | 'cancelled';
  participants: string[];
  created_at: string;
}

export interface Recruitment {
  id: string;
  job_title: string;
  department: string;
  description: string;
  requirements: string;
  salary_range: string;
  application_deadline: string;
  status: 'open' | 'closed' | 'filled';
  applications_count: number;
  created_at: string;
}

export interface User {
  id: string;
  email: string;
  role: 'admin' | 'hr' | 'manager' | 'employee';
  employee_id?: string;
}