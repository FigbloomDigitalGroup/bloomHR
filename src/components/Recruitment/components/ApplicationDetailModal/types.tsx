export interface Application {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  id_number?: string;
  nationality?: string;
  address?: string;
  county?: string;
  constituency?: string;
  preferred_location?: string;
  university?: string;
  education?: string;
  graduation_year?: string;
  previous_company?: string;
  previous_role?: string;
  work_experience?: string;
  previous_salary?: string;
  expected_salary?: string;
  skills?: string;
  languages?: string;
  markets_worked?: string;
  cover_letter?: string;
  resume_file_url?: string;
  resume_file_name?: string;
  position?: string;
  department?: string;
  status?: string;
  created_at: string;
}

export interface ApplicationDetailModalProps {
  application: Application | null;
  onClose: () => void;
}