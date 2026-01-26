import { useState } from 'react';
import { Target, X, Check, Calendar as CalendarIcon } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import Select from 'react-select';

interface PerformanceTarget {
  id?: number;
  target_for: string;
  target_type: string;
  employee_id: string | null;
  branch_id: number | null;
  product_type: string | null;
  period: string;
  target_value: number;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
}

interface PerformanceTargetModalProps {
  target?: PerformanceTarget | null;
  onClose: () => void;
  onSave: (target: PerformanceTarget) => void;
  employees: any[];
  branches: any[];
}

const PerformanceTargetModal: React.FC<PerformanceTargetModalProps> = ({ 
  target, 
  onClose, 
  onSave, 
  employees, 
  branches 
}) => {
  const [formData, setFormData] = useState<PerformanceTarget>({
    id: target?.id,
    target_for: target?.target_for || 'employee',
    target_type: target?.target_type || 'disbursement',
    employee_id: target?.employee_id || null,
    branch_id: target?.branch_id || null,
    product_type: target?.product_type || null,
    period: target?.period || 'monthly',
    target_value: target?.target_value || 0,
    start_date: target?.start_date || new Date().toISOString().split('T')[0],
    end_date: target?.end_date || null,
    is_active: target?.is_active || true
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetForOptions = [
    { value: 'employee', label: 'Employee' },
    { value: 'branch', label: 'Branch' },
    { value: 'product', label: 'Product' }
  ];

  const targetTypeOptions = [
    { value: 'disbursement', label: 'Disbursement' },
    { value: 'collection', label: 'Collection' },
    { value: 'field_visits', label: 'Field Visits' },
    { value: 'attendance', label: 'Attendance' },
    { value: 'par', label: 'PAR' }
  ];

  const periodOptions = [
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'quarterly', label: 'Quarterly' },
    { value: 'annual', label: 'Annual' }
  ];

  const productTypeOptions = [
    { value: 'individual', label: 'Individual' },
    { value: 'group', label: 'Group' },
    { value: 'business', label: 'Business' },
    { value: 'agriculture', label: 'Agriculture' }
  ];

  const employeeOptions = employees.map(emp => ({
    value: emp["Employee Number"],
    label: `${emp["First Name"]} ${emp["Last Name"]}`
  }));

  const branchOptions = branches.map(branch => ({
    value: branch.id,
    label: branch["Branch Office"]
  }));

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' 
        ? (e.target as HTMLInputElement).checked 
        : ['target_value'].includes(name)
        ? parseFloat(value) || 0
        : value
    }));
  };

  const handleSelectChange = (name: string, selectedOption: any) => {
    setFormData(prev => ({
      ...prev,
      [name]: selectedOption ? selectedOption.value : null
    }));
  };

  const handleDateChange = (name: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      // Validate required fields based on target_for
      if (formData.target_for === 'employee' && !formData.employee_id) {
        throw new Error('Employee is required for employee targets');
      }
      if (formData.target_for === 'branch' && !formData.branch_id) {
        throw new Error('Branch is required for branch targets');
      }
      if (formData.target_for === 'product' && !formData.product_type) {
        throw new Error('Product type is required for product targets');
      }

      // Prepare the data to be saved
      const { id, ...dataWithoutId } = formData;

      if (formData.id) {
        // Update existing target
        const { error } = await supabase
          .from('performance_targets')
          .update(dataWithoutId)
          .eq('id', formData.id);
        
        if (error) throw error;
      } else {
        // Create new target - don't include the id
        const { data, error } = await supabase
          .from('performance_targets')
          .insert([dataWithoutId])
          .select()
          .single();
        
        if (error) throw error;
        // Update the formData with the returned id
        formData.id = data.id;
      }

      onSave(formData);
      onClose();
    } catch (err) {
      console.error('Error saving target:', err);
      setError(err instanceof Error ? err.message : 'Failed to save target');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getCurrentValue = (name: string, options: any[]) => {
    const value = formData[name as keyof PerformanceTarget];
    return options.find(option => option.value === value) || null;
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white max-h-[80vh] overflow-y-auto rounded-lg shadow-xl w-full max-w-md">
        <div className="border-b border-gray-200 p-4 flex justify-between items-center">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Target className="w-5 h-5" />
            {target ? 'Edit Target' : 'Add New Target'}
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
            <label className="block text-xs font-medium text-gray-700 mb-1">Target For</label>
            <Select
              options={targetForOptions}
              value={getCurrentValue('target_for', targetForOptions)}
              onChange={(selected) => handleSelectChange('target_for', selected)}
              className="basic-single"
              classNamePrefix="select"
              isSearchable={false}
              required
            />
          </div>
          
          {formData.target_for === 'employee' && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Employee</label>
              <Select
                options={employeeOptions}
                value={employeeOptions.find(opt => opt.value === formData.employee_id) || null}
                onChange={(selected) => handleSelectChange('employee_id', selected)}
                className="basic-single"
                classNamePrefix="select"
                placeholder="Select Employee"
                required
              />
            </div>
          )}
          
          {formData.target_for === 'branch' && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Branch</label>
              <Select
                options={branchOptions}
                value={branchOptions.find(opt => opt.value === formData.branch_id) || null}
                onChange={(selected) => handleSelectChange('branch_id', selected)}
                className="basic-single"
                classNamePrefix="select"
                placeholder="Select Branch"
                required
              />
            </div>
          )}
          
          {formData.target_for === 'product' && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Product Type</label>
              <Select
                options={productTypeOptions}
                value={getCurrentValue('product_type', productTypeOptions)}
                onChange={(selected) => handleSelectChange('product_type', selected)}
                className="basic-single"
                classNamePrefix="select"
                placeholder="Select Product"
                required
              />
            </div>
          )}
          
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Target Type</label>
            <Select
              options={targetTypeOptions}
              value={getCurrentValue('target_type', targetTypeOptions)}
              onChange={(selected) => handleSelectChange('target_type', selected)}
              className="basic-single"
              classNamePrefix="select"
              isSearchable={false}
              required
            />
          </div>
          
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Period</label>
            <Select
              options={periodOptions}
              value={getCurrentValue('period', periodOptions)}
              onChange={(selected) => handleSelectChange('period', selected)}
              className="basic-single"
              classNamePrefix="select"
              isSearchable={false}
              required
            />
          </div>
          
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Target Value</label>
            <input
              type="number"
              name="target_value"
              value={formData.target_value}
              onChange={handleChange}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
              required
              min="0"
              step="0.01"
            />
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Start Date</label>
              <div className="relative">
                <input
                  type="date"
                  name="start_date"
                  value={formData.start_date}
                  onChange={(e) => handleDateChange('start_date', e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                  required
                />
                <CalendarIcon className="absolute right-3 top-2.5 h-4 w-4 text-gray-400" />
              </div>
            </div>
            
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">End Date (Optional)</label>
              <div className="relative">
                <input
                  type="date"
                  name="end_date"
                  value={formData.end_date || ''}
                  onChange={(e) => handleDateChange('end_date', e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                  min={formData.start_date}
                />
                <CalendarIcon className="absolute right-3 top-2.5 h-4 w-4 text-gray-400" />
              </div>
            </div>
          </div>
          
          <div className="flex items-center">
            <input
              type="checkbox"
              name="is_active"
              checked={formData.is_active}
              onChange={handleChange}
              className="h-4 w-4 text-green-600 focus:ring-green-500 border-gray-300 rounded"
            />
            <label className="ml-2 block text-xs text-gray-700">
              Active Target
            </label>
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
                  Save Target
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PerformanceTargetModal;