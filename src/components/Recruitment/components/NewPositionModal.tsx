import { X, Check } from 'lucide-react';
import { GlowButton } from './GlowButton';
import { departments } from './constants/departments';
import { employeeTypes } from './constants/employeeTypes';
import { branches } from './constants/branches';

interface NewPositionModalProps {
  onClose: () => void;
}

export const NewPositionModal = ({ onClose }: NewPositionModalProps) => {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Create New Job Position</h3>
          <button 
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <form className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Job Title</label>
            <input 
              type="text" 
              className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-green-100 focus:border-green-500"
              placeholder="e.g. Software Developer"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Department</label>
              <select className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-green-100 focus:border-green-500">
                {departments.filter(d => d !== 'All Departments').map(dept => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Employee Type</label>
              <select className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-green-100 focus:border-green-500">
                <option value="">Select Type</option>
                {employeeTypes.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Branch</label>
              <select className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-green-100 focus:border-green-500">
                <option value="">Select Branch</option>
                {branches.map(branch => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Hiring Priority</label>
              <select className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-green-100 focus:border-green-500">
                <option value="Normal">Normal</option>
                <option value="Urgent">Urgent</option>
                <option value="Critically Needed">Critically Needed</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Job Description</label>
            <textarea 
              className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-green-100 focus:border-green-500"
              rows={4}
              placeholder="Enter detailed job description..."
            />
          </div>
          <div className="flex justify-end gap-2">
            <GlowButton 
              variant="secondary"
              size="sm"
              onClick={() => onClose()}
            >
              Cancel
            </GlowButton>
            <GlowButton 
              icon={Check}
              size="sm"
              onClick={() => {
                alert("New position created successfully");
                onClose();
              }}
            >
              Create Position
            </GlowButton>
          </div>
        </form>
      </div>
    </div>
  );
};