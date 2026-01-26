import { useState } from 'react';
import { Users, X, Check, Calendar as CalendarIcon } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import Select from 'react-select';

// Types
type ClientStatus = 'Active' | 'Inactive' | 'Dormant' | 'Blacklisted';
type Gender = 'Male' | 'Female' | 'Other' | '';
type MaritalStatus = 'Single' | 'Married' | 'Divorced' | 'Widowed' | '';

interface Client {
  client_id: string;
  first_name: string;
  last_name: string;
  id_number?: string | null;
  date_of_birth?: string | null;
  gender?: Gender;
  marital_status?: MaritalStatus;
  phone_number: string;
  email?: string | null;
  address?: string | null;
  town?: string | null;
  postal_code?: string | null;
  occupation?: string | null;
  monthly_income?: number | null;
  registration_date: string;
  status: ClientStatus;
  loan_officer?: string | null;
  branch_id?: number | null;
}

interface ClientModalProps {
  client?: Client | null;
  onClose: () => void;
  onSave: (client: Client) => void;
  employees: Array<{
    "Employee Number": string;
    "First Name": string;
    "Last Name": string;
  }>;
  branches: Array<{
    id: number;
    "Branch Office": string;
  }>;
}

const ClientModal = ({ client, onClose, onSave, employees, branches }: ClientModalProps) => {
  // Form state with proper initialization
  const [formData, setFormData] = useState<Client>({
    client_id: client?.client_id || '',
    first_name: client?.first_name || '',
    last_name: client?.last_name || '',
    id_number: client?.id_number || '',
    date_of_birth: client?.date_of_birth || null,
    gender: (client?.gender as Gender) || '',
    marital_status: (client?.marital_status as MaritalStatus) || '',
    phone_number: client?.phone_number || '',
    email: client?.email || '',
    address: client?.address || '',
    town: client?.town || '',
    postal_code: client?.postal_code || '',
    occupation: client?.occupation || '',
    monthly_income: client?.monthly_income || null,
    status: client?.status || 'Active',
    loan_officer: client?.loan_officer || '',
    branch_id: client?.branch_id || null,
    registration_date: client?.registration_date || new Date().toISOString().split('T')[0]
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prepare options for react-select components
  const genderOptions = [
    { value: '', label: 'Select Gender' },
    { value: 'Male', label: 'Male' },
    { value: 'Female', label: 'Female' },
    { value: 'Other', label: 'Other' }
  ];

  const maritalStatusOptions = [
    { value: '', label: 'Select Status' },
    { value: 'Single', label: 'Single' },
    { value: 'Married', label: 'Married' },
    { value: 'Divorced', label: 'Divorced' },
    { value: 'Widowed', label: 'Widowed' }
  ];

  const statusOptions = [
    { value: 'Active', label: 'Active' },
    { value: 'Inactive', label: 'Inactive' },
    { value: 'Dormant', label: 'Dormant' },
    { value: 'Blacklisted', label: 'Blacklisted' }
  ];

  const employeeOptions = employees.map(emp => ({
    value: emp["Employee Number"],
    label: `${emp["First Name"]} ${emp["Last Name"]}`,
    employee: emp
  }));

  const branchOptions = branches.map(branch => ({
    value: branch.id,
    label: branch["Branch Office"],
    branch: branch
  }));

  // Get current selected values for react-select components
  const selectedGender = genderOptions.find(opt => opt.value === formData.gender) || genderOptions[0];
  const selectedMaritalStatus = maritalStatusOptions.find(opt => opt.value === formData.marital_status) || maritalStatusOptions[0];
  const selectedStatus = statusOptions.find(opt => opt.value === formData.status) || statusOptions[0];
  const selectedEmployee = employeeOptions.find(opt => opt.value === formData.loan_officer) || null;
  const selectedBranch = branchOptions.find(opt => opt.value === formData.branch_id) || null;

  // Handle input changes
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;

    setFormData(prev => {
      let processedValue: any = value;

      // Handle empty values for nullable fields
      if (value === '') {
        if (name === 'monthly_income' || name === 'date_of_birth') {
          processedValue = null;
        }
      }

      // Convert numeric fields
      if (name === 'monthly_income' && value) {
        processedValue = parseFloat(value);
      }

      return {
        ...prev,
        [name]: processedValue
      };
    });
  };

  // Handle select changes
  const handleSelectChange = (name: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      // Prepare data for submission
      const submissionData: Client = {
        ...formData,
        // Ensure date fields are properly formatted or null
        date_of_birth: formData.date_of_birth || null,
        registration_date: formData.registration_date || new Date().toISOString().split('T')[0]
      };

      if (submissionData.client_id) {
        // Update existing client
        const { error } = await supabase
          .from('clients')
          .update(submissionData)
          .eq('client_id', submissionData.client_id);
        
        if (error) throw error;
      } else {
        // Create new client with generated ID if needed
        submissionData.client_id = submissionData.client_id || generateClientId();
        
        const { data, error } = await supabase
          .from('clients')
          .insert([submissionData])
          .select()
          .single();
        
        if (error) throw error;
        submissionData.client_id = data.client_id;
      }

      onSave(submissionData);
      onClose();
    } catch (err) {
      console.error('Error saving client:', err);
      setError(err instanceof Error ? err.message : 'Failed to save client');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Generate a client ID if none exists
  const generateClientId = () => {
    return `CL${Math.floor(Math.random() * 1000000).toString().padStart(6, '0')}`;
  };

  // Custom styles for react-select components
  const selectStyles = {
    control: (base: any) => ({
      ...base,
      minHeight: '42px',
      fontSize: '0.875rem',
      borderColor: '#d1d5db',
      '&:hover': {
        borderColor: '#9ca3af'
      }
    }),
    option: (base: any, { isFocused, isSelected }: any) => ({
      ...base,
      fontSize: '0.875rem',
      backgroundColor: isSelected ? '#059669' : isFocused ? '#f3f4f6' : 'white',
      color: isSelected ? 'white' : isFocused ? '#1f2937' : '#374151',
      ':active': {
        backgroundColor: isSelected ? '#059669' : '#e5e7eb'
      }
    }),
    singleValue: (base: any) => ({
      ...base,
      color: '#1f2937'
    })
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto">
        {/* Modal Header */}
        <div className="border-b border-gray-200 p-4 flex justify-between items-center sticky top-0 bg-white z-10">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Users className="w-5 h-5" />
            {client ? 'Edit Client' : 'Add New Client'}
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* Form Content */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="bg-red-50 text-red-600 p-3 rounded-md text-xs">
              {error}
            </div>
          )}
          
          {/* Personal Information Section */}
          <div className="space-y-4">
            <h4 className="font-medium text-gray-700">Personal Information</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">First Name*</label>
                <input
                  type="text"
                  name="first_name"
                  value={formData.first_name}
                  onChange={handleInputChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                  required
                />
              </div>
              
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Last Name*</label>
                <input
                  type="text"
                  name="last_name"
                  value={formData.last_name}
                  onChange={handleInputChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">ID Number</label>
                <input
                  type="text"
                  name="id_number"
                  value={formData.id_number || ''}
                  onChange={handleInputChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Date of Birth</label>
                <div className="relative">
                  <input
                    type="date"
                    name="date_of_birth"
                    value={formData.date_of_birth || ''}
                    onChange={handleInputChange}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                  />
                  <CalendarIcon className="absolute right-3 top-2.5 h-4 w-4 text-gray-400" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Gender</label>
                <Select
                  options={genderOptions}
                  value={selectedGender}
                  onChange={(option) => handleSelectChange('gender', option?.value || '')}
                  styles={selectStyles}
                  className="text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Marital Status</label>
                <Select
                  options={maritalStatusOptions}
                  value={selectedMaritalStatus}
                  onChange={(option) => handleSelectChange('marital_status', option?.value || '')}
                  styles={selectStyles}
                  className="text-xs"
                />
              </div>
            </div>
          </div>

          {/* Contact Information Section */}
          <div className="space-y-4">
            <h4 className="font-medium text-gray-700">Contact Information</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Phone Number*</label>
                <input
                  type="tel"
                  name="phone_number"
                  value={formData.phone_number}
                  onChange={handleInputChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  name="email"
                  value={formData.email || ''}
                  onChange={handleInputChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Address</label>
              <input
                type="text"
                name="address"
                value={formData.address || ''}
                onChange={handleInputChange}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Town</label>
                <input
                  type="text"
                  name="town"
                  value={formData.town || ''}
                  onChange={handleInputChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Postal Code</label>
                <input
                  type="text"
                  name="postal_code"
                  value={formData.postal_code || ''}
                  onChange={handleInputChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Occupation</label>
                <input
                  type="text"
                  name="occupation"
                  value={formData.occupation || ''}
                  onChange={handleInputChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                />
              </div>
            </div>
          </div>

          {/* Financial Information Section */}
          <div className="space-y-4">
            <h4 className="font-medium text-gray-700">Financial Information</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Monthly Income</label>
                <input
                  type="number"
                  name="monthly_income"
                  value={formData.monthly_income || ''}
                  onChange={handleInputChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                  step="0.01"
                  min="0"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Registration Date*</label>
                <div className="relative">
                  <input
                    type="date"
                    name="registration_date"
                    value={formData.registration_date}
                    onChange={handleInputChange}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                    required
                  />
                  <CalendarIcon className="absolute right-3 top-2.5 h-4 w-4 text-gray-400" />
                </div>
              </div>
            </div>
          </div>

          {/* Administrative Information Section */}
          <div className="space-y-4">
            <h4 className="font-medium text-gray-700">Administrative Information</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Status*</label>
                <Select
                  options={statusOptions}
                  value={selectedStatus}
                  onChange={(option) => handleSelectChange('status', option?.value || 'Active')}
                  styles={selectStyles}
                  className="text-xs"
                />
              </div>
              
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Loan Officer</label>
                <Select
                  options={employeeOptions}
                  value={selectedEmployee}
                  onChange={(option) => handleSelectChange('loan_officer', option?.value || '')}
                  styles={selectStyles}
                  className="text-xs"
                  isClearable
                  placeholder="Select Loan Officer"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Branch</label>
              <Select
                options={branchOptions}
                value={selectedBranch}
                onChange={(option) => handleSelectChange('branch_id', option?.value || null)}
                styles={selectStyles}
                className="text-xs"
                isClearable
                placeholder="Select Branch"
              />
            </div>
          </div>
          
          {/* Form Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 sticky bottom-0 bg-white pb-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center gap-1"
            >
              {isSubmitting ? 'Saving...' : (
                <>
                  <Check className="w-4 h-4" />
                  Save Client
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ClientModal;