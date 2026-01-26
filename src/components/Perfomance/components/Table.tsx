import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Edit, Search, Upload, Download } from 'lucide-react';

// Type definitions matching table headers
type EmployeePerformance = {
  id: string;
  employee_id: string;
  full_name: string;
  branch: string;
  month: string;
  total_clients: number;
  retained_clients: number;
  new_clients_active: number;
  new_clients_inactive: number;
  retained_active: number;
  retained_inactive: number;
  total_active: number;
  total_inactive: number;
  no_of_disb: number;
  disb_amount: number;
  targeted_disb_no: number;
  targeted_disb_amount: number;
  targeted_olb: number;
  actual_olb: number;
  collected_loan_amount: number;
  overdue_loans: number;
};

type BranchPerformance = {
  id: string;
  branch: string;
  month: string;
  total_clients: number;
  retained_clients: number;
  new_clients_active: number;
  new_clients_inactive: number;
  retained_active: number;
  retained_inactive: number;
  total_active: number;
  total_inactive: number;
  no_of_disb: number;
  disb_amount: number;
  targeted_disb_no: number;
  targeted_disb_amount: number;
  targeted_olb: number;
  actual_olb: number;
  collected_loan_amount: number;
  overdue_loan_amount: number;
};

type Employee = {
  'Employee Number': string;
  'First Name': string;
  'Last Name': string;
  'Town': string;
  'Position': string;
  "Job Title": string;
  "Branch": string;
  "Entity": string;
};

// Pagination Component
const Pagination = ({
  currentPage,
  totalPages,
  onPageChange,
  className = '',
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}) => {
  const maxVisiblePages = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
  let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

  if (endPage - startPage + 1 < maxVisiblePages) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }

  const pages = [];
  for (let i = startPage; i <= endPage; i++) {
    pages.push(i);
  }

  return (
    <div className={`flex items-center justify-between ${className}`}>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
          className="text-xs p-2 rounded-lg border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
        >
          <ChevronsLeft className="w-4 h-4" />
        </button>
        <button
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          className="text-xs p-2 rounded-lg border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        
        {startPage > 1 && <span className="px-2 py-1 text-xs">...</span>}
        
        {pages.map(page => (
          <button
            key={page}
            onClick={() => onPageChange(page)}
            className={`text-xs w-10 h-10 rounded-lg border transition-colors ${
              currentPage === page 
                ? 'bg-green-100 border-green-300 text-green-700' 
                : 'border-gray-200 hover:bg-gray-50'
            }`}
          >
            {page}
          </button>
        ))}
        
        {endPage < totalPages && <span className="px-2 py-1 text-xs">...</span>}
        
        <button
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          className="text-xs p-2 rounded-lg border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <button
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages}
          className="text-xs p-2 rounded-lg border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
          >
          <ChevronsRight className="w-4 h-4" />
        </button>
      </div>
      <div className="text-xs text-gray-600">
        Page {currentPage} of {totalPages}
      </div>
    </div>
  );
};

// Search Input Component
const SearchInput = ({
  value,
  onChange,
  placeholder = "Search...",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) => {
  return (
    <div className="relative">
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <Search className="h-4 w-4 text-gray-400" />
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="text-xs pl-10 pr-4 py-2 border border-gray-300 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      />
    </div>
  );
};

// Edit Modal Component
const EditModal = ({
  isOpen,
  onClose,
  onUpdate,
  fields,
}: {
  isOpen: boolean;
  onClose: () => void;
  onUpdate: (updatedData: any) => void;
  fields: {
    key: string;
    label: string;
    type?: string;
    options?: string[];
    value: any;
  }[];
}) => {
  const [formData, setFormData] = useState<any>({});

  useEffect(() => {
    if (fields && fields.length > 0) {
      const initialData: any = {};
      fields.forEach((field) => {
        initialData[field.key] = field.value;
      });
      setFormData(initialData);
    }
  }, [fields]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev: any) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdate(formData);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white max-h-[80vh] overflow-y-auto rounded-lg p-6 w-full max-w-2xl">
        <h2 className="text-xl font-semibold mb-4">Edit Record</h2>
        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {fields.map((field) => (
              <div key={field.key} className="mb-4">
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  {field.label}
                </label>
                {field.type === "select" ? (
                  <select
                    name={field.key}
                    value={formData[field.key] ?? ""}
                    onChange={handleChange}
                    className="text-xs w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {field.options?.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : field.type === "date" ? (
                  <input
                    type="date"
                    name={field.key}
                    value={formData[field.key] ?? ""}
                    onChange={handleChange}
                    className="text-xs w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                ) : (
                  <input
                    type={field.type || "text"}
                    name={field.key}
                    value={formData[field.key] ?? ""}
                    onChange={handleChange}
                    className="text-xs w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="text-xs px-4 py-2 text-gray-600 bg-gray-100 border border-gray-300 rounded hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="text-xs px-4 py-2 bg-blue-100 text-blue-700 border border-blue-300 rounded hover:bg-blue-200 transition-colors"
            >
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Bulk Upload Modal Component
const BulkUploadModal = ({
  isOpen,
  onClose,
  onUpload,
}: {
  isOpen: boolean;
  onClose: () => void;
  onUpload: (data: any[]) => void;
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setError(null);
    }
  };

  const handleUpload = () => {
    if (!file) {
      setError('Please select a file');
      return;
    }

    setIsProcessing(true);
    setError(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const lines = content.split('\n');
        const headers = lines[0].split(',').map(h => h.trim());
        
        const data = lines.slice(1).map((line, index) => {
          if (!line.trim()) return null;
          
          const values = line.split(',').map(v => v.trim());
          const record: any = {};
          
          headers.forEach((header, i) => {
            // Convert numeric fields to numbers
            const numericFields = [
              'total_clients', 'retained_clients', 'new_clients_active', 
              'new_clients_inactive', 'retained_active', 'retained_inactive',
              'total_active', 'total_inactive', 'no_of_disb', 'disb_amount',
              'targeted_disb_no', 'targeted_disb_amount', 'targeted_olb',
              'actual_olb', 'collected_loan_amount', 'overdue_loans'
            ];
            
            if (numericFields.includes(header)) {
              record[header] = Number(values[i]) || 0;
            } else {
              record[header] = values[i];
            }
          });
          
          return record;
        }).filter(record => record !== null);

        onUpload(data);
        setIsProcessing(false);
        onClose();
      } catch (err) {
        setError('Error processing file. Please check the format.');
        setIsProcessing(false);
      }
    };

    reader.onerror = () => {
      setError('Error reading file');
      setIsProcessing(false);
    };

    reader.readAsText(file);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <h2 className="text-xl font-semibold mb-4">Bulk Upload</h2>
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-700 mb-2">
            Upload CSV File
          </label>
          <input
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="block w-full text-xs text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
          <p className="text-xs text-gray-500 mt-2">
            CSV should include headers matching the table columns
          </p>
        </div>
        
        {error && (
          <div className="mb-4 p-2 bg-red-100 text-red-700 text-xs rounded">
            {error}
          </div>
        )}
        
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-gray-600 bg-gray-100 border border-gray-300 rounded hover:bg-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={isProcessing}
            className="px-4 py-2 bg-blue-100 text-blue-700 border border-blue-300 rounded hover:bg-blue-200 transition-colors disabled:opacity-50"
          >
            {isProcessing ? 'Processing...' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
};

// Utility function to export data to CSV
const exportToCSV = (data: any[], filename: string) => {
  if (data.length === 0) return;
  
  const headers = Object.keys(data[0]);
  const csvContent = [
    headers.join(','),
    ...data.map(row => 
      headers.map(header => {
        const value = row[header];
        return typeof value === 'string' && value.includes(',') 
          ? `"${value}"` 
          : value;
      }).join(',')
    )
  ].join('\n');
  
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.csv`);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

// Employee Performance Table Component
export const EmployeePerformanceTable = ({ 
  performance, 
  employees = [],
  onUpdate,
  onBulkUpload
}: { 
  performance: EmployeePerformance[]; 
  employees?: Employee[];
  onUpdate: (perf: EmployeePerformance) => void; 
  onBulkUpload: (data: any[]) => void;
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [bulkUploadModalOpen, setBulkUploadModalOpen] = useState(false);
  const [selectedPerf, setSelectedPerf] = useState<EmployeePerformance | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  
  // Get current month for display
  const currentMonth = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
  
  // Safe employee data access with fallbacks
  const safeEmployees = employees || [];
  
  // Merge employee data with performance data - CORRECTED MAPPING
  const enhancedPerformance = performance.map(perf => {
    // Find the employee by matching employee_id from performance with Employee Number from employees table
    const employee = safeEmployees.find(emp => 
      emp['Employee Number'] === perf.employee_id
    );
    
    return {
      ...perf,
      // Employee Number → comes from the Supabase table employees, column 'Employee Number'
      employee_id: employee?.['Employee Number'] || '',
      // Full Name → comes from the Supabase table employees, columns 'First Name' + 'Last Name'
      full_name: employee ? `${employee['First Name'] || ''} ${employee['Last Name'] || ''}`.trim() : '',
      // Branch → comes from the Supabase table employees, column Town
      branch: employee?.Town || ''
    };
  });

  const filteredPerformance = enhancedPerformance.filter(perf => {
    const matchesSearch = Object.values(perf).some(
      value => value && value.toString().toLowerCase().includes(searchTerm.toLowerCase())
    );
    const matchesBranch = branchFilter === 'all' || perf.branch === branchFilter;
    return matchesSearch && matchesBranch;
  });

  const totalPages = Math.ceil(filteredPerformance.length / rowsPerPage);
  const paginatedData = filteredPerformance.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  const handleEdit = (perf: EmployeePerformance) => {
    setSelectedPerf(perf);
    setEditModalOpen(true);
  };

  const handleSave = (updatedData: any) => {
    if (!selectedPerf || !selectedPerf.id) {
      console.error('No selected performance record or missing ID');
      alert('Cannot save: Invalid performance record');
      return;
    }
    
    // Create the complete updated performance object with the original ID
    const updatedPerf: EmployeePerformance = {
      ...selectedPerf,
      ...updatedData,
      id: selectedPerf.id, // Ensure the ID is preserved
      // Convert numeric fields
      total_clients: Number(updatedData.total_clients) || 0,
      retained_clients: Number(updatedData.retained_clients) || 0,
      new_clients_active: Number(updatedData.new_clients_active) || 0,
      new_clients_inactive: Number(updatedData.new_clients_inactive) || 0,
      retained_active: Number(updatedData.retained_active) || 0,
      retained_inactive: Number(updatedData.retained_inactive) || 0,
      total_active: Number(updatedData.total_active) || 0,
      total_inactive: Number(updatedData.total_inactive) || 0,
      no_of_disb: Number(updatedData.no_of_disb) || 0,
      disb_amount: Number(updatedData.disb_amount) || 0,
      targeted_disb_no: Number(updatedData.targeted_disb_no) || 0,
      targeted_disb_amount: Number(updatedData.targeted_disb_amount) || 0,
      targeted_olb: Number(updatedData.targeted_olb) || 0,
      actual_olb: Number(updatedData.actual_olb) || 0,
      collected_loan_amount: Number(updatedData.collected_loan_amount) || 0,
      overdue_loans: Number(updatedData.overdue_loans) || 0,
    };
    
    onUpdate(updatedPerf);
    setEditModalOpen(false);
  };

  const handleExport = () => {
    exportToCSV(filteredPerformance, `employee-performance-${new Date().toISOString().split('T')[0]}`);
  };

  const handleBulkUpload = (data: any[]) => {
    onBulkUpload(data);
    setBulkUploadModalOpen(false);
  };

  // Get unique branches for filter
  const branches = [...new Set(safeEmployees.map(emp => emp.Town).filter(Boolean))];

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="p-4 flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">Employee Performance</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setBulkUploadModalOpen(true)}
              className="text-xs px-3 py-2 bg-blue-100 text-blue-700 border border-blue-300 rounded hover:bg-blue-200 transition-colors flex items-center gap-1"
            >
              <Upload className="w-4 h-4" />
              Bulk Upload
            </button>
            <button
              onClick={handleExport}
              className="text-xs px-3 py-2 bg-green-100 text-green-700 border border-green-300 rounded hover:bg-green-200 transition-colors flex items-center gap-1"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Search</label>
            <SearchInput 
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Search employees..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Branch</label>
            <select 
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="text-xs w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Branches</option>
              {branches.map(branch => (
                <option key={branch} value={branch}>{branch}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Top Pagination */}
      <div className="px-4 pb-2 border-b border-gray-200 flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600">Rows per page:</span>
          <select 
            value={rowsPerPage}
            onChange={(e) => setRowsPerPage(Number(e.target.value))}
            className="text-xs p-1 border border-gray-300 rounded"
          >
            <option value="10">10</option>
            <option value="25">25</option>
            <option value="50">50</option>
          </select>
        </div>
        <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-green-500 border-b border-gray-200">
            <tr>
              <th className="py-3 px-4 text-left font-semibold text-white">Employee Number</th>
              <th className="py-3 px-4 text-left font-semibold text-white">Full Name</th>
              <th className="py-3 px-4 text-left font-semibold text-white">Branch</th>
              <th className="py-3 px-4 text-left font-semibold text-white">Month</th>
              <th className="py-3 px-4 text-left font-semibold text-white">Total Clients</th>
              <th className="py-3 px-4 text-left font-semibold text-white">Retained Clients</th>
              <th className="py-3 px-4 text-left font-semibold text-white">New Clients Active</th>
              <th className="py-3 px-4 text-left font-semibold text-white">New Clients Inactive</th>
              <th className="py-3 px-4 text-left font-semibold text-white">Retained Active</th>
              <th className="py-3 px-4 text-left font-semibold text-white">Retained Inactive</th>
              <th className="py-3 px-4 text-left font-semibold text-white">Total Active</th>
              <th className="py-3 px-4 text-left font-semibold text-white">Total Inactive</th>
              <th className="py-3 px-4 text-left font-semibold text-white">No of Disb</th>
              <th className="py-3 px-4 text-left font-semibold text-white">Disb Amount</th>
              <th className="py-3 px-4 text-left font-semibold text-white">Targeted Disb No</th>
              <th className="py-3 px-4 text-left font-semibold text-white">Targeted Disb Amount</th>
              <th className="py-3 px-4 text-left font-semibold text-white">Targeted OLB</th>
              <th className="py-3 px-4 text-left font-semibold text-white">Actual OLB</th>
              <th className="py-3 px-4 text-left font-semibold text-white">Collected Loan Amount</th>
              <th className="py-3 px-4 text-left font-semibold text-white">Overdue Loans</th>
              <th className="py-3 px-4 text-left font-semibold text-white">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginatedData.map((perf) => (
              <tr key={perf.id} className="border-b border-gray-200 hover:bg-gray-50 transition-colors">
                <td className="py-3 px-4">{perf.employee_id}</td>
                <td className="py-3 px-4">{perf.full_name}</td>
                <td className="py-3 px-4">{perf.branch}</td>
                <td className="py-3 px-4">{currentMonth}</td>
                <td className="py-3 px-4">{perf.total_clients}</td>
                <td className="py-3 px-4">{perf.retained_clients}</td>
                <td className="py-3 px-4">{perf.new_clients_active}</td>
                <td className="py-3 px-4">{perf.new_clients_inactive}</td>
                <td className="py-3 px-4">{perf.retained_active}</td>
                <td className="py-3 px-4">{perf.retained_inactive}</td>
                <td className="py-3 px-4">{perf.total_active}</td>
                <td className="py-3 px-4">{perf.total_inactive}</td>
                <td className="py-3 px-4">{perf.no_of_disb}</td>
                <td className="py-3 px-4">{perf.disb_amount?.toLocaleString()}</td>
                <td className="py-3 px-4">{perf.targeted_disb_no}</td>
                <td className="py-3 px-4">{perf.targeted_disb_amount?.toLocaleString()}</td>
                <td className="py-3 px-4">{perf.targeted_olb?.toLocaleString()}</td>
                <td className="py-3 px-4">{perf.actual_olb?.toLocaleString()}</td>
                <td className="py-3 px-4">{perf.collected_loan_amount?.toLocaleString()}</td>
                <td className="py-3 px-4">{perf.overdue_loans?.toLocaleString()}</td>
                <td className="py-3 px-4">
                  <button 
                    onClick={() => handleEdit(perf)}
                    className="text-xs p-1 text-blue-700 bg-blue-100 hover:bg-blue-200 rounded transition-colors"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bottom Pagination */}
      <div className="p-4 border-t border-gray-200 flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="text-xs text-gray-600">
          Showing {paginatedData.length} of {filteredPerformance.length} records
        </div>
        <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
      </div>

      {/* Edit Modal */}
      <EditModal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        onUpdate={handleSave}
        fields={[
          { key: 'total_clients', label: 'Total Clients', type: 'number', value: selectedPerf?.total_clients || 0 },
          { key: 'retained_clients', label: 'Retained Clients', type: 'number', value: selectedPerf?.retained_clients || 0 },
          { key: 'new_clients_active', label: 'New Clients Active', type: 'number', value: selectedPerf?.new_clients_active || 0 },
          { key: 'new_clients_inactive', label: 'New Clients Inactive', type: 'number', value: selectedPerf?.new_clients_inactive || 0 },
          { key: 'retained_active', label: 'Retained Active', type: 'number', value: selectedPerf?.retained_active || 0 },
          { key: 'retained_inactive', label: 'Retained Inactive', type: 'number', value: selectedPerf?.retained_inactive || 0 },
          { key: 'total_active', label: 'Total Active', type: 'number', value: selectedPerf?.total_active || 0 },
          { key: 'total_inactive', label: 'Total Inactive', type: 'number', value: selectedPerf?.total_inactive || 0 },
          { key: 'no_of_disb', label: 'No of Disb', type: 'number', value: selectedPerf?.no_of_disb || 0 },
          { key: 'disb_amount', label: 'Disb Amount', type: 'number', value: selectedPerf?.disb_amount || 0 },
          { key: 'targeted_disb_no', label: 'Targeted Disb No', type: 'number', value: selectedPerf?.targeted_disb_no || 0 },
          { key: 'targeted_disb_amount', label: 'Targeted Disb Amount', type: 'number', value: selectedPerf?.targeted_disb_amount || 0 },
          { key: 'targeted_olb', label: 'Targeted OLB', type: 'number', value: selectedPerf?.targeted_olb || 0 },
          { key: 'actual_olb', label: 'Actual OLB', type: 'number', value: selectedPerf?.actual_olb || 0 },
          { key: 'collected_loan_amount', label: 'Collected Loan Amount', type: 'number', value: selectedPerf?.collected_loan_amount || 0 },
          { key: 'overdue_loans', label: 'Overdue Loans', type: 'number', value: selectedPerf?.overdue_loans || 0 },
        ]}
      />

      {/* Bulk Upload Modal */}
      <BulkUploadModal
        isOpen={bulkUploadModalOpen}
        onClose={() => setBulkUploadModalOpen(false)}
        onUpload={handleBulkUpload}
      />
    </div>
  );
};

// Branch Performance Table Component
export const BranchPerformanceTable = ({ 
  employeePerformance, 
  employees = [],
}: { 
  employeePerformance: EmployeePerformance[]; 
  employees?: Employee[];
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [searchTerm, setSearchTerm] = useState('');
  const [branchFilter, setBranchFilter] = useState('all');
  
  // Get current month for display
  const currentMonth = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
  
  // Safe employee data access with fallbacks
  const safeEmployees = employees || [];
  
  // Get unique branches from employees
  const branches = [...new Set(safeEmployees.map(emp => emp.Town).filter(Boolean))];
  
  // Calculate branch performance by aggregating employee performance data
  const branchPerformanceData = branches.map(branch => {
    // Filter employee performance for this branch
    const branchEmployees = safeEmployees
      .filter(emp => emp.Town === branch)
      .map(emp => emp['Employee Number']);
    
    const branchPerf = employeePerformance.filter(perf => 
      branchEmployees.includes(perf.employee_id)
    );
    
    // Aggregate the data
    return {
      id: `branch-${branch}`,
      branch: branch,
      month: currentMonth,
      total_clients: branchPerf.reduce((sum, perf) => sum + (perf.total_clients || 0), 0),
      retained_clients: branchPerf.reduce((sum, perf) => sum + (perf.retained_clients || 0), 0),
      new_clients_active: branchPerf.reduce((sum, perf) => sum + (perf.new_clients_active || 0), 0),
      new_clients_inactive: branchPerf.reduce((sum, perf) => sum + (perf.new_clients_inactive || 0), 0),
      retained_active: branchPerf.reduce((sum, perf) => sum + (perf.retained_active || 0), 0),
      retained_inactive: branchPerf.reduce((sum, perf) => sum + (perf.retained_inactive || 0), 0),
      total_active: branchPerf.reduce((sum, perf) => sum + (perf.total_active || 0), 0),
      total_inactive: branchPerf.reduce((sum, perf) => sum + (perf.total_inactive || 0), 0),
      no_of_disb: branchPerf.reduce((sum, perf) => sum + (perf.no_of_disb || 0), 0),
      disb_amount: branchPerf.reduce((sum, perf) => sum + (perf.disb_amount || 0), 0),
      targeted_disb_no: branchPerf.reduce((sum, perf) => sum + (perf.targeted_disb_no || 0), 0),
      targeted_disb_amount: branchPerf.reduce((sum, perf) => sum + (perf.targeted_disb_amount || 0), 0),
      targeted_olb: branchPerf.reduce((sum, perf) => sum + (perf.targeted_olb || 0), 0),
      actual_olb: branchPerf.reduce((sum, perf) => sum + (perf.actual_olb || 0), 0),
      collected_loan_amount: branchPerf.reduce((sum, perf) => sum + (perf.collected_loan_amount || 0), 0),
      overdue_loan_amount: branchPerf.reduce((sum, perf) => sum + (perf.overdue_loans || 0), 0),
    };
  });

  const filteredPerformance = branchPerformanceData.filter(perf => {
    const matchesSearch = Object.values(perf).some(
      value => value && value.toString().toLowerCase().includes(searchTerm.toLowerCase())
    );
    const matchesBranch = branchFilter === 'all' || perf.branch === branchFilter;
    return matchesSearch && matchesBranch;
  });

  const totalPages = Math.ceil(filteredPerformance.length / rowsPerPage);
  const paginatedData = filteredPerformance.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);

  const handleExport = () => {
    exportToCSV(filteredPerformance, `branch-performance-${new Date().toISOString().split('T')[0]}`);
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="p-4 flex flex-col gap-4">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">Branch Performance</h2>
          <div className="flex gap-2">
            <button
              onClick={handleExport}
              className="text-xs px-3 py-2 bg-green-100 text-green-700 border border-green-300 rounded hover:bg-green-200 transition-colors flex items-center gap-1"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Search</label>
            <SearchInput 
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Search branches..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Branch</label>
            <select 
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="text-xs w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Branches</option>
              {branches.map(branch => (
                <option key={branch} value={branch}>{branch}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Top Pagination */}
      <div className="px-4 pb-2 border-b border-gray-200 flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600">Rows per page:</span>
          <select 
            value={rowsPerPage}
            onChange={(e) => setRowsPerPage(Number(e.target.value))}
            className="text-xs p-1 border border-gray-300 rounded"
          >
            <option value="10">10</option>
            <option value="25">25</option>
            <option value="50">50</option>
          </select>
        </div>
        <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-green-500 border-b border-gray-200">
            <tr>
              <th className="py-3 px-4 text-left font-semibold text-white">Branch</th>
              <th className="py-3 px-4 text-left font-semibold text-white">Month</th>
              <th className="py-3 px-4 text-left font-semibold text-white">Total Clients</th>
              <th className="py-3 px-4 text-left font-semibold text-white">Retained Clients</th>
              <th className="py-3 px-4 text-left font-semibold text-white">New Clients Active</th>
              <th className="py-3 px-4 text-left font-semibold text-white">New Clients Inactive</th>
              <th className="py-3 px-4 text-left font-semibold text-white">Retained Active</th>
              <th className="py-3 px-4 text-left font-semibold text-white">Retained Inactive</th>
              <th className="py-3 px-4 text-left font-semibold text-white">Total Active</th>
              <th className="py-3 px-4 text-left font-semibold text-white">Total Inactive</th>
              <th className="py-3 px-4 text-left font-semibold text-white">No of Disb</th>
              <th className="py-3 px-4 text-left font-semibold text-white">Disb Amount</th>
              <th className="py-3 px-4 text-left font-semibold text-white">Targeted Disb No</th>
              <th className="py-3 px-4 text-left font-semibold text-white">Targeted Disb Amount</th>
              <th className="py-3 px-4 text-left font-semibold text-white">Targeted OLB</th>
              <th className="py-3 px-4 text-left font-semibold text-white">Actual OLB</th>
              <th className="py-3 px-4 text-left font-semibold text-white">Collected Loan Amount</th>
              <th className="py-3 px-4 text-left font-semibold text-white">Overdue Loan Amount</th>
            </tr>
          </thead>
          <tbody>
            {paginatedData.map((perf) => (
              <tr key={perf.id} className="border-b border-gray-200 hover:bg-gray-50 transition-colors">
                <td className="py-3 px-4 font-medium">{perf.branch}</td>
                <td className="py-3 px-4">{perf.month}</td>
                <td className="py-3 px-4">{perf.total_clients}</td>
                <td className="py-3 px-4">{perf.retained_clients}</td>
                <td className="py-3 px-4">{perf.new_clients_active}</td>
                <td className="py-3 px-4">{perf.new_clients_inactive}</td>
                <td className="py-3 px-4">{perf.retained_active}</td>
                <td className="py-3 px-4">{perf.retained_inactive}</td>
                <td className="py-3 px-4">{perf.total_active}</td>
                <td className="py-3 px-4">{perf.total_inactive}</td>
                <td className="py-3 px-4">{perf.no_of_disb}</td>
                <td className="py-3 px-4">{perf.disb_amount?.toLocaleString()}</td>
                <td className="py-3 px-4">{perf.targeted_disb_no}</td>
                <td className="py-3 px-4">{perf.targeted_disb_amount?.toLocaleString()}</td>
                <td className="py-3 px-4">{perf.targeted_olb?.toLocaleString()}</td>
                <td className="py-3 px-4">{perf.actual_olb?.toLocaleString()}</td>
                <td className="py-3 px-4">{perf.collected_loan_amount?.toLocaleString()}</td>
                <td className="py-3 px-4">{perf.overdue_loan_amount?.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bottom Pagination */}
      <div className="p-4 border-t border-gray-200 flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="text-xs text-gray-600">
          Showing {paginatedData.length} of {filteredPerformance.length} records
        </div>
        <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
      </div>
    </div>
  );
};