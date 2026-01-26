import { useState, useEffect } from 'react';
import { Wallet, X, Check, Calendar as CalendarIcon } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import Select from 'react-select';
import { v4 as uuidv4 } from '@lukeed/uuid';

interface LoanPayment {
  payment_id?: number;
  loan_id: string;
  amount_paid: number;
  payment_date: string;
  payment_method: string;
  received_by: string | null;
  branch_id: number | null;
  is_on_time: boolean | null;
  principal_amount: number;
  interest_amount: number;
  fees_amount: number;
  penalty_amount: number;
}

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
  status: string;
  par_days: number;
  last_payment_date: string | null;
  next_payment_date: string | null;
}

interface Employee {
  "Employee Number": string;
  "First Name": string;
  "Last Name": string;
}

interface Branch {
  id: number;
  "Branch Office": string;
}

interface LoanPaymentModalProps {
  payment?: LoanPayment | null;
  onClose: () => void;
  onSave: (payment: LoanPayment) => void;
  loans?: Loan[];
  employees?: Employee[];
  branches?: Branch[];
}

const LoanPaymentModal: React.FC<LoanPaymentModalProps> = ({ 
  payment, 
  onClose, 
  onSave, 
  loans = [], 
  employees = [], 
  branches = [] 
}) => {
  const [formData, setFormData] = useState<LoanPayment>({
    payment_id: payment?.payment_id,
    loan_id: payment?.loan_id || '',
    amount_paid: payment?.amount_paid || 0,
    payment_date: payment?.payment_date || new Date().toISOString().split('T')[0],
    payment_method: payment?.payment_method || 'cash',
    received_by: payment?.received_by || null,
    branch_id: payment?.branch_id || null,
    is_on_time: payment?.is_on_time || null,
    principal_amount: payment?.principal_amount || 0,
    interest_amount: payment?.interest_amount || 0,
    fees_amount: payment?.fees_amount || 0,
    penalty_amount: payment?.penalty_amount || 0
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    return () => setIsMounted(false);
  }, []);

  // Prepare options for react-select components
  const loanOptions = loans.map(loan => ({
    value: loan.loan_id,
    label: `${loan.loan_id} - ${loan.client_id} (KSh ${loan.amount_disbursed?.toLocaleString()})`
  }));

  const paymentMethodOptions = [
    { value: 'cash', label: 'Cash' },
    { value: 'mpesa', label: 'M-Pesa' },
    { value: 'bank_transfer', label: 'Bank Transfer' },
    { value: 'cheque', label: 'Cheque' }
  ];

  const employeeOptions = employees.map(emp => ({
    value: emp["Employee Number"],
    label: `${emp["First Name"]} ${emp["Last Name"]}`
  }));

  const branchOptions = branches.map(branch => ({
    value: branch.id,
    label: branch["Branch Office"]
  }));

  const booleanOptions = [
    { value: true, label: 'Yes' },
    { value: false, label: 'No' }
  ];

  // Get current selected values for react-select components
  const selectedLoan = loanOptions.find(opt => opt.value === formData.loan_id) || null;
  const selectedPaymentMethod = paymentMethodOptions.find(opt => opt.value === formData.payment_method) || paymentMethodOptions[0];
  const selectedEmployee = employeeOptions.find(opt => opt.value === formData.received_by) || null;
  const selectedBranch = branchOptions.find(opt => opt.value === formData.branch_id) || null;
  const selectedIsOnTime = booleanOptions.find(opt => opt.value === formData.is_on_time) || null;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: ['amount_paid', 'principal_amount', 'interest_amount', 'fees_amount', 'penalty_amount'].includes(name) 
        ? parseFloat(value) || 0 
        : value
    }));
  };

  const handleSelectChange = (name: string, selectedOption: any) => {
    if (!isMounted) return;
    setFormData(prev => ({
      ...prev,
      [name]: selectedOption?.value ?? null
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isMounted) return;
    
    setIsSubmitting(true);
    setError(null);

    try {
      // Validate that the sum of components equals the total amount
      const sumComponents = formData.principal_amount + formData.interest_amount + 
                          (formData.fees_amount || 0) + (formData.penalty_amount || 0);
      
      if (Math.abs(sumComponents - formData.amount_paid) > 0.01) {
        throw new Error('Sum of payment components must equal total amount paid');
      }

      if (formData.payment_id) {
        // Update existing payment
        const { error } = await supabase
          .from('loan_payments')
          .update(formData)
          .eq('payment_id', formData.payment_id);
        
        if (error) throw error;
      } else {
        // Create new payment - exclude payment_id to let database auto-generate it
        const { payment_id, ...insertData } = formData;
        
        const { data, error } = await supabase
          .from('loan_payments')
          .insert([insertData])
          .select()
          .single();
        
        if (error) throw error;
        if (isMounted) {
          setFormData(prev => ({ ...prev, payment_id: data.payment_id }));
        }
      }

      onSave(formData);
      onClose();
    } catch (err) {
      if (isMounted) {
        console.error('Error saving payment:', err);
        setError(err instanceof Error ? err.message : 'Failed to save payment');
      }
    } finally {
      if (isMounted) {
        setIsSubmitting(false);
      }
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
            <Wallet className="w-5 h-5" />
            {payment ? 'Edit Payment' : 'Record New Payment'}
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
            <label className="block text-xs font-medium text-gray-700 mb-1">Loan*</label>
            <Select
              options={loanOptions}
              value={selectedLoan}
              onChange={(option) => handleSelectChange('loan_id', option)}
              styles={selectStyles}
              className="text-xs"
              placeholder="Select Loan"
              isSearchable
              required
            />
          </div>
          
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Payment Date*</label>
            <div className="relative">
              <input
                type="date"
                name="payment_date"
                value={formData.payment_date}
                onChange={handleInputChange}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                required
              />
              <CalendarIcon className="absolute right-3 top-2.5 h-4 w-4 text-gray-400" />
            </div>
          </div>
          
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Payment Method*</label>
            <Select
              options={paymentMethodOptions}
              value={selectedPaymentMethod}
              onChange={(option) => handleSelectChange('payment_method', option)}
              styles={selectStyles}
              className="text-xs"
              isSearchable={false}
            />
          </div>
          
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Total Amount Paid (KSh)*</label>
            <input
              type="number"
              name="amount_paid"
              value={formData.amount_paid}
              onChange={handleInputChange}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
              required
              min="0"
              step="0.01"
            />
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Principal Amount (KSh)*</label>
              <input
                type="number"
                name="principal_amount"
                value={formData.principal_amount}
                onChange={handleInputChange}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                required
                min="0"
                step="0.01"
              />
            </div>
            
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Interest Amount (KSh)*</label>
              <input
                type="number"
                name="interest_amount"
                value={formData.interest_amount}
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
              <label className="block text-xs font-medium text-gray-700 mb-1">Fees Amount (KSh)</label>
              <input
                type="number"
                name="fees_amount"
                value={formData.fees_amount}
                onChange={handleInputChange}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                min="0"
                step="0.01"
              />
            </div>
            
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Penalty Amount (KSh)</label>
              <input
                type="number"
                name="penalty_amount"
                value={formData.penalty_amount}
                onChange={handleInputChange}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                min="0"
                step="0.01"
              />
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Received By</label>
              <Select
                options={employeeOptions}
                value={selectedEmployee}
                onChange={(option) => handleSelectChange('received_by', option)}
                styles={selectStyles}
                className="text-xs"
                placeholder="Select Employee"
                isSearchable
              />
            </div>
            
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Branch</label>
              <Select
                options={branchOptions}
                value={selectedBranch}
                onChange={(option) => handleSelectChange('branch_id', option)}
                styles={selectStyles}
                className="text-xs"
                placeholder="Select Branch"
                isSearchable
              />
            </div>
          </div>
          
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Payment On Time?</label>
            <Select
              options={booleanOptions}
              value={selectedIsOnTime}
              onChange={(option) => handleSelectChange('is_on_time', option)}
              styles={selectStyles}
              className="text-xs"
              placeholder="Select Option"
              isClearable
            />
          </div>
          
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
                  Save Payment
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LoanPaymentModal;