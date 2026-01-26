import { Search } from 'lucide-react';
import { branches } from './constants/branches';
import { departments } from './constants/departments';
import { statusOptions } from './constants/statusOptions';
import { employeeTypes } from './constants/employeeTypes';

interface FiltersSectionProps {
  selectedBranch: string;
  setSelectedBranch: (value: string) => void;
  selectedDepartment: string;
  setSelectedDepartment: (value: string) => void;
  selectedStatus: string;
  setSelectedStatus: (value: string) => void;
  selectedType: string;
  setSelectedType: (value: string) => void;
  searchTerm: string;
  setSearchTerm: (value: string) => void;
}

export const FiltersSection = ({
  selectedBranch,
  setSelectedBranch,
  selectedDepartment,
  setSelectedDepartment,
  selectedStatus,
  setSelectedStatus,
  selectedType,
  setSelectedType,
  searchTerm,
  setSearchTerm,
}: FiltersSectionProps) => {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Recruitment Filters</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">Branch Location</label>
          <select
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
            className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-green-100 focus:border-green-500"
          >
            <option value="all">All Branches</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>{branch.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">Department</label>
          <select
            value={selectedDepartment}
            onChange={(e) => setSelectedDepartment(e.target.value)}
            className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-green-100 focus:border-green-500"
          >
            {departments.map((dept) => (
              <option key={dept} value={dept}>{dept}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">Hiring Status</label>
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-green-100 focus:border-green-500"
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">Employee Type</label>
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-green-100 focus:border-green-500"
          >
            <option value="All Types">All Types</option>
            {employeeTypes.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">Search</label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-gray-400" />
            </div>
            <input
              type="text"
              placeholder="Search positions or applicants..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg bg-gray-50 focus:ring-2 focus:ring-green-100 focus:border-green-500 text-xs"
            />
          </div>
        </div>
      </div>
    </div>
  );
};