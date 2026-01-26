import { useState, useEffect } from 'react';
import { BarChart2, X, Check, Calendar as CalendarIcon } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import Select from 'react-select';

interface EmployeePerformance {
  id?: number;
  employee_id: string;
  date: string;
  period: string;
  loans_disbursed: number;
  disbursement_target: number;
  new_loans: number; // Added for KPI tracking
  clients_visited: number;
  field_visits_target: number;
  collection_amount: number;
  collection_target: number;
  par_amount: number;
  portfolio_size: number;
  outstanding_balance: number; // Added for KPI tracking
  arrears_amount: number; // Added for KPI tracking
  loans_in_arrears: number; // Added for KPI tracking
  total_active_loans: number; // Added for KPI tracking
  attendance_days: number;
  working_days: number;
  tat_average: number;
}

interface EmployeePerformanceModalProps {
  performance?: EmployeePerformance | null;
  onClose: () => void;
  onSave: (performance: EmployeePerformance) => void;
  employees: any[];
}

const EmployeePerformanceModal: React.FC<EmployeePerformanceModalProps> = ({ 
  performance, 
  onClose, 
  onSave, 
  employees 
}) => {
  const [formData, setFormData] = useState<EmployeePerformance>({
    id: performance?.id,
    employee_id: performance?.employee_id || '',
    date: performance?.date || new Date().toISOString().split('T')[0],
    period: performance?.period || 'daily',
    loans_disbursed: performance?.loans_disbursed || 0,
    disbursement_target: performance?.disbursement_target || 0,
    new_loans: performance?.new_loans || 0, // Added
    clients_visited: performance?.clients_visited || 0,
    field_visits_target: performance?.field_visits_target || 0,
    collection_amount: performance?.collection_amount || 0,
    collection_target: performance?.collection_target || 0,
    par_amount: performance?.par_amount || 0,
    portfolio_size: performance?.portfolio_size || 0,
    outstanding_balance: performance?.outstanding_balance || 0, // Added
    arrears_amount: performance?.arrears_amount || 0, // Added
    loans_in_arrears: performance?.loans_in_arrears || 0, // Added
    total_active_loans: performance?.total_active_loans || 0, // Added
    attendance_days: performance?.attendance_days || 1,
    working_days: performance?.working_days || 1,
    tat_average: performance?.tat_average || 0
  });
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    return () => setIsMounted(false);
  }, []);

  // Prepare options for react-select components
  const employeeOptions = employees.map(emp => ({
    value: emp["Employee Number"],
    label: `${emp["First Name"]} ${emp["Last Name"]} (${emp["Employee Number"]})`
  }));

  const periodOptions = [
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'quarterly', label: 'Quarterly' },
    { value: 'annual', label: 'Annual' }
  ];

  // Get current selected values for react-select components
  const selectedEmployee = employeeOptions.find(opt => opt.value === formData.employee_id) || null;
  const selectedPeriod = periodOptions.find(opt => opt.value === formData.period) || periodOptions[0];

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: [
        'loans_disbursed', 'disbursement_target', 'new_loans', 'clients_visited', 
        'field_visits_target', 'collection_amount', 'collection_target', 'par_amount', 
        'portfolio_size', 'outstanding_balance', 'arrears_amount', 'loans_in_arrears',
        'total_active_loans', 'attendance_days', 'working_days', 'tat_average'
      ].includes(name) 
        ? parseFloat(value) || 0 
        : value
    }));
  };

  const handleSelectChange = (name: string, selectedOption: any) => {
    if (!isMounted) return;
    setFormData(prev => ({
      ...prev,
      [name]: selectedOption?.value ?? ''
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isMounted) return;
    
    setIsSubmitting(true);
    setError(null);

    try {
      if (formData.id) {
        // Update existing performance record
        const { error } = await supabase
          .from('employee_performance')
          .update(formData)
          .eq('id', formData.id);
        
        if (error) throw error;
      } else {
        // Create new performance record - exclude id to let database auto-generate it
        const { id, ...insertData } = formData;
        
        const { data, error } = await supabase
          .from('employee_performance')
          .insert([insertData])
          .select()
          .single();
        
        if (error) throw error;
        if (isMounted) {
          setFormData(prev => ({ ...prev, id: data.id }));
        }
      }

      onSave(formData);
      onClose();
    } catch (err) {
      if (isMounted) {
        console.error('Error saving performance:', err);
        setError(err instanceof Error ? err.message : 'Failed to save performance');
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
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl mx-auto max-h-[80vh] overflow-y-auto">
        <div className="border-b border-gray-200 p-4 flex justify-between items-center sticky top-0 bg-white">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <BarChart2 className="w-5 h-5" />
            {performance ? 'Edit Performance' : 'Add Performance Record'}
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
            <label className="block text-xs font-medium text-gray-700 mb-1">Employee*</label>
            <Select
              options={employeeOptions}
              value={selectedEmployee}
              onChange={(option) => handleSelectChange('employee_id', option)}
              styles={selectStyles}
              className="text-xs"
              placeholder="Select Employee"
              isSearchable
              required
            />
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Date*</label>
              <div className="relative">
                <input
                  type="date"
                  name="date"
                  value={formData.date}
                  onChange={handleChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                  required
                />
              </div>
            </div>
            
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Period*</label>
              <Select
                options={periodOptions}
                value={selectedPeriod}
                onChange={(option) => handleSelectChange('period', option)}
                styles={selectStyles}
                className="text-xs"
                isSearchable={false}
              />
            </div>
          </div>

          {/* KPI Section - New Fields */}
          <div className="border-t border-gray-200 pt-4">
            <h4 className="text-md font-semibold text-gray-800 mb-3">KPI Metrics</h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">New Loans (First-time)*</label>
                <input
                  type="number"
                  name="new_loans"
                  value={formData.new_loans}
                  onChange={handleChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                  required
                  min="0"
                />
              </div>
              
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Total Loans Disbursed*</label>
                <input
                  type="number"
                  name="loans_disbursed"
                  value={formData.loans_disbursed}
                  onChange={handleChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                  required
                  min="0"
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
                  onChange={handleChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                  required
                  min="0"
                  step="0.01"
                />
              </div>
              
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Arrears Amount (KSh)*</label>
                <input
                  type="number"
                  name="arrears_amount"
                  value={formData.arrears_amount}
                  onChange={handleChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                  required
                  min="0"
                  step="0.01"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Loans in Arrears*</label>
                <input
                  type="number"
                  name="loans_in_arrears"
                  value={formData.loans_in_arrears}
                  onChange={handleChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                  required
                  min="0"
                />
              </div>
              
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Total Active Loans*</label>
                <input
                  type="number"
                  name="total_active_loans"
                  value={formData.total_active_loans}
                  onChange={handleChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                  required
                  min="0"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Portfolio Size (KSh)*</label>
                <input
                  type="number"
                  name="portfolio_size"
                  value={formData.portfolio_size}
                  onChange={handleChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                  required
                  min="0"
                  step="0.01"
                />
              </div>
              
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">PAR Amount (KSh)*</label>
                <input
                  type="number"
                  name="par_amount"
                  value={formData.par_amount}
                  onChange={handleChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                  required
                  min="0"
                  step="0.01"
                />
              </div>
            </div>
          </div>

          {/* Targets Section */}
          <div className="border-t border-gray-200 pt-4">
            <h4 className="text-md font-semibold text-gray-800 mb-3">Targets</h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Disbursement Target*</label>
                <input
                  type="number"
                  name="disbursement_target"
                  value={formData.disbursement_target}
                  onChange={handleChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                  required
                  min="0"
                />
              </div>
              
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Collection Target (KSh)*</label>
                <input
                  type="number"
                  name="collection_target"
                  value={formData.collection_target}
                  onChange={handleChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                  required
                  min="0"
                  step="0.01"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Field Visits Target*</label>
                <input
                  type="number"
                  name="field_visits_target"
                  value={formData.field_visits_target}
                  onChange={handleChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                  required
                  min="0"
                />
              </div>
            </div>
          </div>

          {/* Activity Section */}
          <div className="border-t border-gray-200 pt-4">
            <h4 className="text-md font-semibold text-gray-800 mb-3">Activity Metrics</h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Clients Visited*</label>
                <input
                  type="number"
                  name="clients_visited"
                  value={formData.clients_visited}
                  onChange={handleChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                  required
                  min="0"
                />
              </div>
              
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Collection Amount (KSh)*</label>
                <input
                  type="number"
                  name="collection_amount"
                  value={formData.collection_amount}
                  onChange={handleChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                  required
                  min="0"
                  step="0.01"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Attendance Days*</label>
                <input
                  type="number"
                  name="attendance_days"
                  value={formData.attendance_days}
                  onChange={handleChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                  required
                  min="1"
                  max={formData.working_days}
                />
              </div>
              
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Working Days*</label>
                <input
                  type="number"
                  name="working_days"
                  value={formData.working_days}
                  onChange={handleChange}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                  required
                  min="1"
                  max="31"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Average TAT (Hours)*</label>
              <input
                type="number"
                name="tat_average"
                value={formData.tat_average}
                onChange={handleChange}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                required
                min="0"
                step="0.1"
              />
            </div>
          </div>
          
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 sticky bottom-0 bg-white">
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
                  Save Performance
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EmployeePerformanceModal;