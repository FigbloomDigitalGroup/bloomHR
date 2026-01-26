import { useState } from 'react';
import { CreditCard, X, Check, Calendar as CalendarIcon } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import Select from 'react-select';
import { v4 as uuidv4 } from '@lukeed/uuid';

interface Loan {
  loan_id: string;
  client_id: string;
  loan_officer: string;
  branch_id: number;
  product_type: string;
  amount_disbursed: number;
  outstanding_balance: number;
  interest_rate: number;
  term_months: number;
  disbursement_date: string;
  maturity_date: string;
  repayment_frequency: string;
  status: string;
  par_days: number;
  last_payment_date: string | null;
  next_payment_date: string | null;
}

interface LoanModalProps {
  loan?: Loan | null;
  onClose: () => void;
  onSave: (loan: Loan) => void;
  clients: Array<{
    client_id: string;
    first_name: string;
    last_name: string;
  }>;
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

const LoanModal: React.FC<LoanModalProps> = ({ loan, onClose, onSave, clients, employees, branches }) => {
  const calculateMaturityDate = (disbursementDate: string, termMonths: number): string => {
    const date = new Date(disbursementDate);
    date.setMonth(date.getMonth() + termMonths);
    return date.toISOString().split('T')[0];
  };

  const calculateNextPaymentDate = (disbursementDate: string, frequency: string = 'monthly'): string => {
    const date = new Date(disbursementDate);
    
    switch (frequency) {
      case 'weekly':
        date.setDate(date.getDate() + 7);
        break;
      case 'biweekly':
        date.setDate(date.getDate() + 14);
        break;
      case 'monthly':
        date.setMonth(date.getMonth() + 1);
        break;
      case 'quarterly':
        date.setMonth(date.getMonth() + 3);
        break;
      default:
        date.setMonth(date.getMonth() + 1);
    }
    
    return date.toISOString().split('T')[0];
  };

  const [formData, setFormData] = useState<Loan>({
    loan_id: loan?.loan_id || '',
    client_id: loan?.client_id || '',
    loan_officer: loan?.loan_officer || '',
    branch_id: loan?.branch_id || 0,
    product_type: loan?.product_type || 'individual',
    amount_disbursed: loan?.amount_disbursed || 0,
    outstanding_balance: loan?.outstanding_balance || 0,
    interest_rate: loan?.interest_rate || 12,
    term_months: loan?.term_months || 12,
    disbursement_date: loan?.disbursement_date || new Date().toISOString().split('T')[0],
    maturity_date: loan?.maturity_date || calculateMaturityDate(
      loan?.disbursement_date || new Date().toISOString().split('T')[0],
      loan?.term_months || 12
    ),
    repayment_frequency: loan?.repayment_frequency || 'monthly',
    status: loan?.status || 'Pending',
    par_days: loan?.par_days || 0,
    last_payment_date: loan?.last_payment_date || null,
    next_payment_date: loan?.next_payment_date || calculateNextPaymentDate(
      loan?.disbursement_date || new Date().toISOString().split('T')[0],
      loan?.repayment_frequency || 'monthly'
    )
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientOptions = clients.map(client => ({
    value: client.client_id,
    label: `${client.first_name} ${client.last_name}`,
    client: client
  }));

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

  const productTypeOptions = [
    { value: 'individual', label: 'Individual' },
    { value: 'group', label: 'Group' },
    { value: 'business', label: 'Business' },
    { value: 'agriculture', label: 'Agriculture' }
  ];

  const repaymentFrequencyOptions = [
    { value: 'weekly', label: 'Weekly' },
    { value: 'biweekly', label: 'Bi-Weekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'quarterly', label: 'Quarterly' }
  ];

  const statusOptions = [
    { value: 'Pending', label: 'Pending' },
    { value: 'Approved', label: 'Approved' },
    { value: 'Disbursed', label: 'Disbursed' },
    { value: 'Active', label: 'Active' },
    { value: 'Completed', label: 'Completed' },
    { value: 'Defaulted', label: 'Defaulted' }
  ];

  const selectedClient = clientOptions.find(opt => opt.value === formData.client_id) || null;
  const selectedEmployee = employeeOptions.find(opt => opt.value === formData.loan_officer) || null;
  const selectedBranch = branchOptions.find(opt => opt.value === formData.branch_id) || null;
  const selectedProductType = productTypeOptions.find(opt => opt.value === formData.product_type) || productTypeOptions[0];
  const selectedRepaymentFrequency = repaymentFrequencyOptions.find(opt => opt.value === formData.repayment_frequency) || repaymentFrequencyOptions[2];
  const selectedStatus = statusOptions.find(opt => opt.value === formData.status) || statusOptions[0];

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    
    setFormData(prev => {
      const newData = {
        ...prev,
        [name]: ['amount_disbursed', 'outstanding_balance', 'interest_rate', 'term_months', 'par_days'].includes(name) 
          ? parseFloat(value) || 0 
          : value
      };

      if (name === 'term_months' || name === 'disbursement_date') {
        newData.maturity_date = calculateMaturityDate(
          name === 'disbursement_date' ? value : newData.disbursement_date,
          name === 'term_months' ? parseFloat(value) || 0 : newData.term_months
        );
      }

      return newData;
    });
  };

  const handleSelectChange = (name: string, selectedOption: any) => {
    setFormData(prev => {
      const newData = {
        ...prev,
        [name]: selectedOption?.value || ''
      };

      if (name === 'repayment_frequency') {
        newData.next_payment_date = calculateNextPaymentDate(
          newData.disbursement_date,
          selectedOption?.value
        );
      }

      return newData;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const loanData = {
        ...formData,
        loan_id: formData.loan_id || uuidv4(), // Generate ID if not exists
        maturity_date: formData.maturity_date || calculateMaturityDate(formData.disbursement_date, formData.term_months),
        next_payment_date: formData.next_payment_date || calculateNextPaymentDate(formData.disbursement_date, formData.repayment_frequency)
      };

      if (loan?.loan_id) {
        // Update existing loan
        const { error } = await supabase
          .from('loans')
          .update(loanData)
          .eq('loan_id', loanData.loan_id);
        
        if (error) throw error;
      } else {
        // Create new loan
        const { error } = await supabase
          .from('loans')
          .insert([loanData]);
        
        if (error) throw error;
      }

      onSave(loanData);
      onClose();
    } catch (err) {
      console.error('Error saving loan:', err);
      setError(err instanceof Error ? err.message : 'Failed to save loan');
    } finally {
      setIsSubmitting(false);
    }
  };

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
      <div className="bg-white max-h-[80vh] overflow-y-auto rounded-lg shadow-xl w-full max-w-2xl">
        <div className="border-b border-gray-200 p-4 flex justify-between items-center">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <CreditCard className="w-5 h-5" />
            {loan ? 'Edit Loan' : 'Add New Loan'}
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="bg-red-50 text-red-600 p-3 rounded-md text-xs">
              {error}
            </div>
          )}
          
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Client*</label>
            <Select
              options={clientOptions}
              value={selectedClient}
              onChange={(option) => handleSelectChange('client_id', option)}
              styles={selectStyles}
              className="text-xs"
              placeholder="Select Client"
              isSearchable
              required
            />
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Loan Officer*</label>
              <Select
                options={employeeOptions}
                value={selectedEmployee}
                onChange={(option) => handleSelectChange('loan_officer', option)}
                styles={selectStyles}
                className="text-xs"
                placeholder="Select Loan Officer"
                isSearchable
                required
              />
            </div>
            
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Branch*</label>
              <Select
                options={branchOptions}
                value={selectedBranch}
                onChange={(option) => handleSelectChange('branch_id', option)}
                styles={selectStyles}
                className="text-xs"
                placeholder="Select Branch"
                isSearchable
                required
              />
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Product Type*</label>
              <Select
                options={productTypeOptions}
                value={selectedProductType}
                onChange={(option) => handleSelectChange('product_type', option)}
                styles={selectStyles}
                className="text-xs"
                isSearchable={false}
              />
            </div>
            
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Repayment Frequency*</label>
              <Select
                options={repaymentFrequencyOptions}
                value={selectedRepaymentFrequency}
                onChange={(option) => handleSelectChange('repayment_frequency', option)}
                styles={selectStyles}
                className="text-xs"
                isSearchable={false}
              />
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Status*</label>
              <Select
                options={statusOptions}
                value={selectedStatus}
                onChange={(option) => handleSelectChange('status', option)}
                styles={selectStyles}
                className="text-xs"
                isSearchable={false}
              />
            </div>
            
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Amount Disbursed (KSh)*</label>
              <input
                type="number"
                name="amount_disbursed"
                value={formData.amount_disbursed}
                onChange={handleInputChange}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                required
                min="0"
                step="0.01"
              />
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Outstanding Balance (KSh)*</label>
              <input
                type="number"
                name="outstanding_balance"
                value={formData.outstanding_balance}
                onChange={handleInputChange}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                required
                min="0"
                step="0.01"
              />
            </div>
            
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Interest Rate (%)*</label>
              <input
                type="number"
                name="interest_rate"
                value={formData.interest_rate}
                onChange={handleInputChange}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                required
                min="0"
                max="100"
                step="0.01"
              />
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Term (Months)*</label>
              <input
                type="number"
                name="term_months"
                value={formData.term_months}
                onChange={handleInputChange}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                required
                min="1"
              />
            </div>
            
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Disbursement Date*</label>
              <div className="relative">
                <input
                  type="date"
                  name="disbursement_date"
                  value={formData.disbursement_date}
                  onChange={handleInputChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                  required
                />
                <CalendarIcon className="absolute right-3 top-2.5 h-4 w-4 text-gray-400" />
              </div>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Maturity Date</label>
              <div className="relative">
                <input
                  type="date"
                  name="maturity_date"
                  value={formData.maturity_date}
                  readOnly
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs bg-gray-100"
                />
                <CalendarIcon className="absolute right-3 top-2.5 h-4 w-4 text-gray-400" />
              </div>
            </div>
            
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Next Payment Date</label>
              <div className="relative">
                <input
                  type="date"
                  name="next_payment_date"
                  value={formData.next_payment_date || ''}
                  readOnly
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs bg-gray-100"
                />
                <CalendarIcon className="absolute right-3 top-2.5 h-4 w-4 text-gray-400" />
              </div>
            </div>
          </div>
          
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">PAR Days</label>
            <input
              type="number"
              name="par_days"
              value={formData.par_days}
              onChange={handleInputChange}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
              min="0"
            />
          </div>
          
          {formData.last_payment_date && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Last Payment Date</label>
              <div className="relative">
                <input
                  type="date"
                  name="last_payment_date"
                  value={formData.last_payment_date || ''}
                  onChange={handleInputChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                />
                <CalendarIcon className="absolute right-3 top-2.5 h-4 w-4 text-gray-400" />
              </div>
            </div>
          )}
          
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
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
                  Save Loan
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LoanModal;