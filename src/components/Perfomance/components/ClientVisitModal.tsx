import { useState } from 'react';
import { UserCheck, X, Check, Calendar as CalendarIcon, MapPin } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import Select from 'react-select';

interface ClientVisit {
  visit_id?: number;
  employee_id: string;
  client_id: string;
  visit_date: string;
  purpose: string;
  outcome: string | null;
  next_action: string | null;
  next_visit_date: string | null;
  location: string | null;
  branch_id: number | null;
}

interface ClientVisitModalProps {
  visit?: ClientVisit | null;
  onClose: () => void;
  onSave: (visit: ClientVisit) => void;
  employees: any[];
  clients: any[];
  branches: any[];
}

const ClientVisitModal: React.FC<ClientVisitModalProps> = ({ 
  visit, 
  onClose, 
  onSave, 
  employees, 
  clients, 
  branches 
}) => {
  const [formData, setFormData] = useState<ClientVisit>({
    visit_id: visit?.visit_id,
    employee_id: visit?.employee_id || '',
    client_id: visit?.client_id || '',
    visit_date: visit?.visit_date || new Date().toISOString().split('T')[0],
    purpose: visit?.purpose || 'follow_up',
    outcome: visit?.outcome || null,
    next_action: visit?.next_action || null,
    next_visit_date: visit?.next_visit_date || null,
    location: visit?.location || null,
    branch_id: visit?.branch_id || null
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Options for React Select components
  const purposeOptions = [
    { value: 'follow_up', label: 'Follow-up' },
    { value: 'collection', label: 'Collection' },
    { value: 'loan_appraisal', label: 'Loan Appraisal' },
    { value: 'training', label: 'Training' },
    { value: 'other', label: 'Other' }
  ];

  const employeeOptions = employees.map(emp => ({
    value: emp["Employee Number"],
    label: `${emp["First Name"]} ${emp["Last Name"]}`
  }));

  const clientOptions = clients.map(client => ({
    value: client.client_id,
    label: `${client.first_name} ${client.last_name}`
  }));

  const branchOptions = branches.map(branch => ({
    value: branch.id,
    label: branch["Branch Office"]
  }));

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
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
      // Validate required fields
      if (!formData.employee_id) throw new Error('Employee is required');
      if (!formData.client_id) throw new Error('Client is required');
      if (!formData.visit_date) throw new Error('Visit date is required');
      if (!formData.purpose) throw new Error('Purpose is required');

      // Prepare data without visit_id for new records
      const { visit_id, ...dataWithoutId } = formData;

      if (formData.visit_id) {
        // Update existing visit
        const { error } = await supabase
          .from('client_visits')
          .update(dataWithoutId)
          .eq('visit_id', formData.visit_id);
        
        if (error) throw error;
      } else {
        // Create new visit
        const { data, error } = await supabase
          .from('client_visits')
          .insert([dataWithoutId])
          .select()
          .single();
        
        if (error) throw error;
        formData.visit_id = data.visit_id;
      }

      onSave(formData);
      onClose();
    } catch (err) {
      console.error('Error saving visit:', err);
      setError(err instanceof Error ? err.message : 'Failed to save visit');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getCurrentValue = (name: string, options: any[]) => {
    const value = formData[name as keyof ClientVisit];
    return options.find(option => option.value === value) || null;
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-h-[80vh] overflow-y-auto w-full max-w-md">
        <div className="border-b border-gray-200 p-4 flex justify-between items-center">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <UserCheck className="w-5 h-5" />
            {visit ? 'Edit Client Visit' : 'Record New Client Visit'}
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
          
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Client</label>
            <Select
              options={clientOptions}
              value={clientOptions.find(opt => opt.value === formData.client_id) || null}
              onChange={(selected) => handleSelectChange('client_id', selected)}
              className="basic-single"
              classNamePrefix="select"
              placeholder="Select Client"
              required
            />
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Visit Date</label>
              <div className="relative">
                <input
                  type="date"
                  name="visit_date"
                  value={formData.visit_date}
                  onChange={(e) => handleDateChange('visit_date', e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                  required
                />
              </div>
            </div>
            
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Purpose</label>
              <Select
                options={purposeOptions}
                value={getCurrentValue('purpose', purposeOptions)}
                onChange={(selected) => handleSelectChange('purpose', selected)}
                className="basic-single"
                classNamePrefix="select"
                isSearchable={false}
                required
              />
            </div>
          </div>
          
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Outcome</label>
            <textarea
              name="outcome"
              value={formData.outcome || ''}
              onChange={handleChange}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
              rows={3}
            />
          </div>
          
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Next Action</label>
            <input
              type="text"
              name="next_action"
              value={formData.next_action || ''}
              onChange={handleChange}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
            />
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Next Visit Date</label>
              <div className="relative">
                <input
                  type="date"
                  name="next_visit_date"
                  value={formData.next_visit_date || ''}
                  onChange={(e) => handleDateChange('next_visit_date', e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
                  min={formData.visit_date}
                />
              </div>
            </div>
            
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Branch</label>
              <Select
                options={branchOptions}
                value={branchOptions.find(opt => opt.value === formData.branch_id) || null}
                onChange={(selected) => handleSelectChange('branch_id', selected)}
                className="basic-single"
                classNamePrefix="select"
                placeholder="Select Branch"
              />
            </div>
          </div>
          
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1 flex items-center gap-1">
              <MapPin className="w-4 h-4" /> Location
            </label>
            <input
              type="text"
              name="location"
              value={formData.location || ''}
              onChange={handleChange}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-xs"
              placeholder="GPS coordinates or address"
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
                  Save Visit
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ClientVisitModal;