import { useState } from 'react';
import { Building, X, Check, Calendar as CalendarIcon, TrendingUp, Target, Activity } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import Select from 'react-select';

interface BranchPerformance {
  id?: number;
  branch_id: number;
  date: string;
  period: string;
  total_loans_disbursed: number;
  disbursement_target: number;
  new_loans: number;
  total_collection: number;
  collection_target: number;
  total_par: number;
  portfolio_size: number;
  arrears_amount: number;
  loans_in_arrears: number;
  total_active_loans: number;
  average_tat: number;
  staff_count: number;
}

interface BranchPerformanceModalProps {
  performance?: BranchPerformance | null;
  onClose: () => void;
  onSave: (performance: BranchPerformance) => void;
  branches: any[];
}

interface BranchOption {
  value: number;
  label: string;
}

const BranchPerformanceTable: React.FC<BranchPerformanceModalProps> = ({ 
  performance, 
  onClose, 
  onSave, 
  branches 
}) => {
  const [formData, setFormData] = useState<BranchPerformance>({
    id: performance?.id,
    branch_id: performance?.branch_id || 0,
    date: performance?.date || new Date().toISOString().split('T')[0],
    period: performance?.period || 'daily',
    total_loans_disbursed: performance?.total_loans_disbursed || 0,
    disbursement_target: performance?.disbursement_target || 0,
    new_loans: performance?.new_loans || 0,
    total_collection: performance?.total_collection || 0,
    collection_target: performance?.collection_target || 0,
    total_par: performance?.total_par || 0,
    portfolio_size: performance?.portfolio_size || 0,
    arrears_amount: performance?.arrears_amount || 0,
    loans_in_arrears: performance?.loans_in_arrears || 0,
    total_active_loans: performance?.total_active_loans || 0,
    average_tat: performance?.average_tat || 0,
    staff_count: performance?.staff_count || 0
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Convert branches to options for React Select
  const branchOptions: BranchOption[] = branches.map(branch => ({
    value: branch.id,
    label: branch["Branch Office"]
  }));

  const selectedBranchOption = branchOptions.find(
    option => option.value === formData.branch_id
  );

  // Custom styles for React Select
  const selectStyles = {
    control: (base: any) => ({
      ...base,
      minHeight: '32px',
      fontSize: '0.75rem',
      border: '1px solid #d1d5db',
      borderRadius: '0.375rem',
      '&:hover': {
        borderColor: '#6366f1',
      },
      '&:focus-within': {
        borderColor: '#6366f1',
        boxShadow: '0 0 0 3px rgba(99, 102, 241, 0.1)',
      }
    }),
    option: (base: any) => ({
      ...base,
      fontSize: '0.75rem',
      padding: '8px 12px',
    }),
    placeholder: (base: any) => ({
      ...base,
      fontSize: '0.75rem',
      color: '#9ca3af',
    })
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: [
        'total_loans_disbursed', 'disbursement_target', 'new_loans', 'total_collection',
        'collection_target', 'total_par', 'portfolio_size', 'arrears_amount', 
        'loans_in_arrears', 'total_active_loans', 'average_tat', 'staff_count'
      ].includes(name) 
        ? parseFloat(value) || 0 
        : value
    }));
  };

  const handleBranchChange = (selectedOption: BranchOption | null) => {
    if (selectedOption) {
      setFormData(prev => ({
        ...prev,
        branch_id: selectedOption.value
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      if (formData.id) {
        const { error } = await supabase
          .from('branch_performance')
          .update(formData)
          .eq('id', formData.id);
        
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('branch_performance')
          .insert({
            branch_id: formData.branch_id,
            date: formData.date,
            period: formData.period,
            total_loans_disbursed: formData.total_loans_disbursed,
            disbursement_target: formData.disbursement_target,
            new_loans: formData.new_loans,
            total_collection: formData.total_collection,
            collection_target: formData.collection_target,
            total_par: formData.total_par,
            portfolio_size: formData.portfolio_size,
            arrears_amount: formData.arrears_amount,
            loans_in_arrears: formData.loans_in_arrears,
            total_active_loans: formData.total_active_loans,
            average_tat: formData.average_tat,
            staff_count: formData.staff_count
          })
          .select()
          .single();
        
        if (error) throw error;
        formData.id = data.id;
      }

      onSave(formData);
      onClose();
    } catch (err) {
      console.error('Error saving performance:', err);
      setError(err instanceof Error ? err.message : 'Failed to save performance');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-h-[85vh] overflow-hidden max-w-3xl border border-gray-100">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-500 to-purple-600 p-4 text-white">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Building className="w-5 h-5" />
              <h3 className="text-lg font-semibold">
                {performance ? 'Edit Performance' : 'Add Branch Performance'}
              </h3>
            </div>
            <button 
              onClick={onClose} 
              className="text-white/80 hover:text-white hover:bg-white/20 rounded-full p-1 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        
        <div className="overflow-y-auto max-h-[calc(85vh-80px)]">
          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-red-400 rounded-full"></div>
                  {error}
                </div>
              </div>
            )}
            
            {/* Basic Information */}
            <div className="bg-gray-50 rounded-xl p-4 space-y-4">
              <h4 className="text-xs font-semibold text-gray-800 flex items-center gap-2">
                <CalendarIcon className="w-4 h-4 text-indigo-500" />
                Basic Information
              </h4>
              
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">Branch Office</label>
                <Select
                  options={branchOptions}
                  value={selectedBranchOption}
                  onChange={handleBranchChange}
                  styles={selectStyles}
                  placeholder="Select Branch Office"
                  isClearable={false}
                  isSearchable={true}
                  required
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">Date</label>
                  <input
                    type="date"
                    name="date"
                    value={formData.date}
                    onChange={handleChange}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                    required
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">Reporting Period</label>
                  <select
                    name="period"
                    value={formData.period}
                    onChange={handleChange}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                    required
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="annual">Annual</option>
                  </select>
                </div>
              </div>
            </div>

            {/* KPI Metrics */}
            <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl p-4 border border-emerald-100">
              <h4 className="text-xs font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
                Key Performance Indicators
              </h4>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">
                    New Loans (First-time)
                    <span className="text-red-500 ml-1">*</span>
                  </label>
                  <input
                    type="number"
                    name="new_loans"
                    value={formData.new_loans}
                    onChange={handleChange}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors"
                    required
                    min="0"
                    placeholder="0"
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">
                    Total Loans Disbursed
                    <span className="text-red-500 ml-1">*</span>
                  </label>
                  <input
                    type="number"
                    name="total_loans_disbursed"
                    value={formData.total_loans_disbursed}
                    onChange={handleChange}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors"
                    required
                    min="0"
                    placeholder="0"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">
                    Arrears Amount (KSh)
                    <span className="text-red-500 ml-1">*</span>
                  </label>
                  <input
                    type="number"
                    name="arrears_amount"
                    value={formData.arrears_amount}
                    onChange={handleChange}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors"
                    required
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">
                    Loans in Arrears
                    <span className="text-red-500 ml-1">*</span>
                  </label>
                  <input
                    type="number"
                    name="loans_in_arrears"
                    value={formData.loans_in_arrears}
                    onChange={handleChange}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors"
                    required
                    min="0"
                    placeholder="0"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">
                    Total Active Loans
                    <span className="text-red-500 ml-1">*</span>
                  </label>
                  <input
                    type="number"
                    name="total_active_loans"
                    value={formData.total_active_loans}
                    onChange={handleChange}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors"
                    required
                    min="0"
                    placeholder="0"
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">
                    Portfolio Size (KSh)
                    <span className="text-red-500 ml-1">*</span>
                  </label>
                  <input
                    type="number"
                    name="portfolio_size"
                    value={formData.portfolio_size}
                    onChange={handleChange}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors"
                    required
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-700 mb-2">
                    Total PAR (KSh)
                    <span className="text-red-500 ml-1">*</span>
                  </label>
                  <input
                    type="number"
                    name="total_par"
                    value={formData.total_par}
                    onChange={handleChange}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-colors"
                    required
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                  />
                </div>
              </div>
            </div>

            {/* Targets */}
            <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-4 border border-amber-100">
              <h4 className="text-xs font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <Target className="w-4 h-4 text-amber-600" />
                Performance Targets
              </h4>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">
                    Disbursement Target
                    <span className="text-red-500 ml-1">*</span>
                  </label>
                  <input
                    type="number"
                    name="disbursement_target"
                    value={formData.disbursement_target}
                    onChange={handleChange}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-colors"
                    required
                    min="0"
                    placeholder="0"
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">
                    Collection Target (KSh)
                    <span className="text-red-500 ml-1">*</span>
                  </label>
                  <input
                    type="number"
                    name="collection_target"
                    value={formData.collection_target}
                    onChange={handleChange}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-colors"
                    required
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                  />
                </div>
              </div>
            </div>

            {/* Activity Metrics */}
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-100">
              <h4 className="text-xs font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-600" />
                Activity Metrics
              </h4>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">
                    Total Collection (KSh)
                    <span className="text-red-500 ml-1">*</span>
                  </label>
                  <input
                    type="number"
                    name="total_collection"
                    value={formData.total_collection}
                    onChange={handleChange}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                    required
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">
                    Average TAT (Hours)
                    <span className="text-red-500 ml-1">*</span>
                  </label>
                  <input
                    type="number"
                    name="average_tat"
                    value={formData.average_tat}
                    onChange={handleChange}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                    required
                    min="0"
                    step="0.1"
                    placeholder="0.0"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-700 mb-2">
                    Staff Count
                    <span className="text-red-500 ml-1">*</span>
                  </label>
                  <input
                    type="number"
                    name="staff_count"
                    value={formData.staff_count}
                    onChange={handleChange}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                    required
                    min="0"
                    placeholder="0"
                  />
                </div>
              </div>
            </div>
            
            {/* Action Buttons */}
            <div className="flex justify-end gap-3 pt-6 border-t border-gray-200">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors border border-gray-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-2 text-xs font-medium text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-md transition-all"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin"></div>
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="w-3 h-3" />
                    Save Performance
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default BranchPerformanceTable;