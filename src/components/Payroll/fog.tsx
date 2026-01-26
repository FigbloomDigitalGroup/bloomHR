import { useState, useEffect } from 'react';
import { X, Search, Filter, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Loader2, AlertCircle, Check, Edit2, Save, Plus, Upload, Download, FileSpreadsheet, Users, CheckCircle, AlertTriangle, Eye, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { TownProps } from '../../types/supabase';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';

type Employee = {
  "Account Number": string | null
  account_number_name: string | null
  "Alternate Approver": string | null
  alternate_second_level_approver: string | null
  "Alternative Mobile Number": string | null
  Area: string | null
  Bank: string | null
  "Bank Branch": string | null
  "Basic Salary": number | null
  blood_group: string | null
  Branch: string | null
  City: string | null
  manager_email: string | null,
  regional_manager: string | null,
  "Contract End Date": string | null
  "Contract Start Date": string | null
  Country: string | null
  Currency: string | null
  "Date of Birth": string | null
  "Disability Cert No": string | null
  "Employee AVC": string | null
  "Employee Id": number | null
  "Employee Number": string
  "Employee Type": string | null
  "Employer AVC": string | null
  Entity: string | null
  "First Name": string | null
  Gender: string | null
  HELB: string | null
  "HELB option": string | null
  "House Number": string | null
  "Housing Levy Deduction": string | null
  "ID Number": number | null
  "Internship End Date": string | null
  internship_start_date: string | null
  "Job Group": string | null
  "Job Level": string | null
  "Job Title": string | null
  "Last Name": string | null
  "Leave Approver": string | null
  Manager: string | null
  "Marital Status": string | null
  "Middle Name": string | null
  "Mobile Number": string | null
  "NHIF Deduction": string | null
  "NHIF Number": string | null
  NITA: string | null
  "NITA Deductions": string | null
  "NSSF Deduction": string | null
  "NSSF Number": string | null
  Office: string | null
  passport_number: string | null
  payment_method: string | null
  "Payroll Number": string | null
  "Pension Deduction": string | null
  "Pension Start Date": string | null
  "Personal Email": string | null
  "Personal Mobile": string | null
  "Postal Address": string | null
  "Postal Code": string | null
  "Postal Location": string | null
  "Probation End Date": string | null
  "Probation Start Date": string | null
  "Profile Image": string | null
  religion: string | null
  Road: string | null
  second_level_leave_approver: string | null
  "SHIF Number": string | null
  "Start Date": string | null
  "Tax Exempted": string | null
  "Tax PIN": string | null
  "Termination Date": string | null
  Town: string | null
  "Type of Identification": string | null
  WIBA: string | null
  "Work Email": string | null
  "Work Mobile": string | null
  id: string
};

type UploadOperation = {
  employee: Partial<Employee>;
  operation: 'create' | 'update' | 'error';
  existingData?: Partial<Employee>;
  changes?: { field: string; oldValue: any; newValue: any }[];
  error?: string;
};

type BulkUploadPreview = {
  operations: UploadOperation[];
  file: File;
  summary: {
    create: number;
    update: number;
    error: number;
  };
};

const EmployeeDataTable: React.FC<TownProps> = ({ selectedTown, onTownChange }) => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [filteredEmployees, setFilteredEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState({
    Town: '',
    "Employee Type": '',
    "Job Group": ''
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editableData, setEditableData] = useState<Partial<Employee>>({});
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newEmployee, setNewEmployee] = useState<Partial<Employee>>({
    "Employee Number": '',
    "First Name": '',
    "Last Name": '',
    "Work Email": '',
    Town: selectedTown && selectedTown !== 'ADMIN_ALL' ? selectedTown : '',
    "Job Title": '',
    "Employee Type": '',
    "Job Group": '',
    "Basic Salary": null,
    "SHIF Number": '',
    "NSSF Number": '',
    "NHIF Number": '',
    "Tax PIN": '',
    "ID Number": null,
    manager_email: '',
    regional_manager: ''
  });
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState<UploadOperation[]>([]);
  const [showUploadResults, setShowUploadResults] = useState(false);
  const [bulkUploadPreview, setBulkUploadPreview] = useState<BulkUploadPreview | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({
    processed: 0,
    total: 0,
    success: 0,
    errors: 0
  });

  // Fetch data from Supabase
  useEffect(() => {
    fetchData();
  }, [selectedTown]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      let query = supabase.from('employees').select('*');
      
      if (selectedTown && selectedTown !== 'ADMIN_ALL') {
        query = query.eq('Town', selectedTown);
      }
      
      const { data, error } = await query;
      
      if (error) throw error;
      
      const employeesWithId = data?.map(emp => ({
        ...emp,
        id: emp.id || `emp-${emp["Employee Number"] || Math.random().toString(36).substring(2, 9)}`
      })) || [];
      
      setEmployees(employeesWithId);
      setFilteredEmployees(employeesWithId);
    } catch (err) {
      setError('Failed to fetch employee data. Please try again.');
      console.error('Error fetching employee data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Apply search and filters
  useEffect(() => {
    let result = [...employees];
    
    if (selectedTown && selectedTown !== 'ADMIN_ALL') {
      result = result.filter(emp => emp.Town === selectedTown);
    }
    
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(emp => 
        (emp["First Name"]?.toLowerCase().includes(term) ||
        emp["Last Name"]?.toLowerCase().includes(term) ||
        emp["Work Email"]?.toLowerCase().includes(term) ||
        emp["Employee Number"]?.toLowerCase().includes(term) ||
        emp["ID Number"]?.toString().includes(term) ||
        emp.manager_email?.toLowerCase().includes(term) ||
        emp.regional_manager?.toLowerCase().includes(term))
      );
    }
    
    if (filters.Town) {
      result = result.filter(emp => emp.Town === filters.Town);
    }
    if (filters["Employee Type"]) {
      result = result.filter(emp => emp["Employee Type"] === filters["Employee Type"]);
    }
    if (filters["Job Group"]) {
      result = result.filter(emp => emp["Job Group"] === filters["Job Group"]);
    }
    
    setFilteredEmployees(result);
    setCurrentPage(1);
  }, [employees, searchTerm, filters, selectedTown]);

  // Handle pagination
  const totalPages = Math.ceil(filteredEmployees.length / itemsPerPage);
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = filteredEmployees.slice(indexOfFirstItem, indexOfLastItem);

  // Toggle row selection
  const toggleRowSelection = (id: string) => {
    setSelectedRows(prev => 
      prev.includes(id) 
        ? prev.filter(rowId => rowId !== id) 
        : [...prev, id]
    );
  };

  // Toggle select all
  const toggleSelectAll = () => {
    if (selectAll) {
      setSelectedRows([]);
    } else {
      setSelectedRows(currentItems.map(emp => emp.id));
    }
    setSelectAll(!selectAll);
  };

  // Start editing a row
  const startEditing = (employee: Employee) => {
    setEditingId(employee.id);
    setEditableData({
      "First Name": employee["First Name"],
      "Last Name": employee["Last Name"],
      "Work Email": employee["Work Email"],
      Town: employee.Town,
      "Job Title": employee["Job Title"],
      "Employee Type": employee["Employee Type"],
      "Job Group": employee["Job Group"],
      "Basic Salary": employee["Basic Salary"],
      "SHIF Number": employee["SHIF Number"],
      "NSSF Number": employee["NSSF Number"],
      "NHIF Number": employee["NHIF Number"],
      "Tax PIN": employee["Tax PIN"],
      "ID Number": employee["ID Number"],
      manager_email: employee.manager_email,
      regional_manager: employee.regional_manager
    });
  };

  // Save edited data to Supabase
  const saveEditing = async (id: string) => {
    try {
      setLoading(true);
      
      const originalEmployee = employees.find(emp => emp.id === id);
      if (!originalEmployee) {
        toast.error('Employee not found');
        return;
      }
      
      const { error } = await supabase
        .from('employees')
        .update(editableData)
        .eq('id', originalEmployee.id);
      
      if (error) throw error;
      
      setEmployees(prev => 
        prev.map(emp => 
          emp.id === id ? { ...emp, ...editableData } : emp
        )
      );
      setEditingId(null);
      setEditableData({});
      toast.success('Employee updated successfully!');
    } catch (err) {
      setError('Failed to update employee. Please try again.');
      console.error('Error updating employee:', err);
      toast.error('Failed to update employee');
    } finally {
      setLoading(false);
    }
  };

  // Cancel editing
  const cancelEditing = () => {
    setEditingId(null);
    setEditableData({});
  };

  // Start adding new employee
  const startAddingNew = () => {
    setIsAddingNew(true);
    setNewEmployee({
      "Employee Number": '',
      "First Name": '',
      "Last Name": '',
      "Work Email": '',
      Town: selectedTown && selectedTown !== 'ADMIN_ALL' ? selectedTown : '',
      "Job Title": '',
      "Employee Type": '',
      "Job Group": '',
      "Basic Salary": null,
      "SHIF Number": '',
      "NSSF Number": '',
      "NHIF Number": '',
      "Tax PIN": '',
      "ID Number": null,
      manager_email: '',
      regional_manager: ''
    });
  };

  // Save new employee
  const saveNewEmployee = async () => {
    try {
      setLoading(true);
      
      if (!newEmployee["Employee Number"] || !newEmployee["First Name"] || !newEmployee["Last Name"]) {
        setError('Employee Number, First Name, and Last Name are required.');
        return;
      }
      
      const { data, error } = await supabase
        .from('employees')
        .insert([newEmployee])
        .select();
      
      if (error) throw error;
      
      if (data && data[0]) {
        const newEmployeeWithId = {
          ...data[0],
          id: data[0].id || `emp-${data[0]["Employee Number"]}`
        };
        
        setEmployees(prev => [...prev, newEmployeeWithId]);
        setIsAddingNew(false);
        setNewEmployee({
          "Employee Number": '',
          "First Name": '',
          "Last Name": '',
          "Work Email": '',
          Town: '',
          "Job Title": '',
          "Employee Type": '',
          "Job Group": '',
          "Basic Salary": null,
          "SHIF Number": '',
          "NSSF Number": '',
          "NHIF Number": '',
          "Tax PIN": '',
          "ID Number": null,
          manager_email: '',
          regional_manager: ''
        });
        toast.success('Employee added successfully!');
      }
    } catch (err) {
      setError('Failed to add new employee. Please try again.');
      console.error('Error adding new employee:', err);
    } finally {
      setLoading(false);
    }
  };

  // Cancel adding new employee
  const cancelAddingNew = () => {
    setIsAddingNew(false);
    setNewEmployee({
      "Employee Number": '',
      "First Name": '',
      "Last Name": '',
      "Work Email": '',
      Town: '',
      "Job Title": '',
      "Employee Type": '',
      "Job Group": '',
      "Basic Salary": null,
      "SHIF Number": '',
      "NSSF Number": '',
      "NHIF Number": '',
      "Tax PIN": '',
      "ID Number": null,
      manager_email: '',
      regional_manager: ''
    });
  };

  // FIXED: Bulk Upload with proper create/update logic
  const handleBulkUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setShowUploadModal(true);

    try {
      const data = await readExcelFile(file);
      const previewData = await generateBulkUploadPreview(data);
      
      setBulkUploadPreview(previewData);
      setUploadProgress({
        processed: 0,
        total: previewData.operations.length,
        success: 0,
        errors: 0
      });
      
      // Automatically execute the upload after preview
      await executeBulkUpload(previewData);
      
    } catch (error) {
      console.error('Bulk upload error:', error);
      toast.error('Failed to process bulk upload. Please check the file format.');
      setShowUploadModal(false);
    } finally {
      setIsUploading(false);
      if (event.target) event.target.value = ''; // Reset file input
    }
  };

  const readExcelFile = (file: File): Promise<any[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const worksheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json(worksheet);
          resolve(jsonData);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  };

  const generateBulkUploadPreview = async (data: any[]): Promise<BulkUploadPreview> => {
    const operations: UploadOperation[] = [];

    for (const row of data) {
      try {
        // Map Excel columns to database columns
        const employeeData: Partial<Employee> = {
          "Employee Number": row['Employee Number'] || row['employee_number'] || row['EmployeeID'],
          "First Name": row['First Name'] || row['first_name'] || row['FirstName'],
          "Last Name": row['Last Name'] || row['last_name'] || row['LastName'],
          "Work Email": row['Work Email'] || row['work_email'] || row['Email'],
          Town: row['Town'] || row['town'] || row['Office'] || row['office'],
          "Job Title": row['Job Title'] || row['job_title'] || row['Position'],
          "Employee Type": row['Employee Type'] || row['employee_type'] || row['Type'],
          "Job Group": row['Job Group'] || row['job_group'] || row['Grade'],
          "Basic Salary": parseFloat(row['Basic Salary'] || row['basic_salary'] || row['Salary']) || null,
          "SHIF Number": row['SHIF Number'] || row['shif_number'] || row['SHIF'],
          "NSSF Number": row['NSSF Number'] || row['nssf_number'] || row['NSSF'],
          "NHIF Number": row['NHIF Number'] || row['nhif_number'] || row['NHIF'],
          "Tax PIN": row['Tax PIN'] || row['tax_pin'] || row['KRA'],
          "ID Number": parseInt(row['ID Number'] || row['id_number'] || row['NationalID']) || null,
          "Mobile Number": row['Mobile Number'] || row['mobile_number'] || row['Phone'],
          "Personal Email": row['Personal Email'] || row['personal_email'],
          Gender: row['Gender'] || row['gender'],
          "Marital Status": row['Marital Status'] || row['marital_status'],
          "Date of Birth": row['Date of Birth'] || row['date_of_birth'] || row['DOB'],
          manager_email: row['manager_email'] || row['managerEmail'] || row['Manager Email'],
          regional_manager: row['regional_manager'] || row['regionalManager'] || row['Regional Manager']
        };

        // Validate required fields
        if (!employeeData["Employee Number"] || !employeeData["First Name"] || !employeeData["Last Name"]) {
          operations.push({
            employee: employeeData,
            operation: 'error',
            error: 'Missing required fields (Employee Number, First Name, Last Name)'
          });
          continue;
        }

        // Check if employee exists using Employee Number
        const { data: existingEmployee, error } = await supabase
          .from('employees')
          .select('*')
          .eq('Employee Number', employeeData["Employee Number"])
          .maybeSingle();

        if (error) {
          console.error('Error checking existing employee:', error);
          operations.push({
            employee: employeeData,
            operation: 'error',
            error: 'Database error while checking existing record'
          });
          continue;
        }

        if (existingEmployee) {
          operations.push({
            employee: employeeData,
            operation: 'update',
            existingData: existingEmployee
          });
        } else {
          operations.push({
            employee: employeeData,
            operation: 'create'
          });
        }

      } catch (error) {
        console.error('Error processing row:', error);
        operations.push({
          employee: row,
          operation: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    const summary = {
      create: operations.filter(op => op.operation === 'create').length,
      update: operations.filter(op => op.operation === 'update').length,
      error: operations.filter(op => op.operation === 'error').length
    };

    return {
      operations,
      file: new File([], 'upload.xlsx'),
      summary
    };
  };

  // FIXED: Upload execution with proper error handling and progress
  const executeBulkUpload = async (previewData: BulkUploadPreview) => {
    if (!previewData) return;

    setIsUploading(true);
    let successCount = 0;
    let errorCount = 0;

    try {
      for (let i = 0; i < previewData.operations.length; i++) {
        const operation = previewData.operations[i];
        
        // Update progress
        setUploadProgress(prev => ({
          ...prev,
          processed: i + 1
        }));

        if (operation.operation === 'error') {
          errorCount++;
          setUploadProgress(prev => ({
            ...prev,
            errors: prev.errors + 1
          }));
          continue;
        }

        try {
          if (operation.operation === 'update') {
            // Update existing employee using Employee Number
            const { error } = await supabase
              .from('employees')
              .update(operation.employee)
              .eq('Employee Number', operation.employee["Employee Number"]);
            
            if (error) {
              console.error('Update error:', error);
              throw error;
            }
            successCount++;
            setUploadProgress(prev => ({
              ...prev,
              success: prev.success + 1
            }));
          } else if (operation.operation === 'create') {
            // Insert new employee
            const { error } = await supabase
              .from('employees')
              .insert([operation.employee]);
            
            if (error) {
              console.error('Create error:', error);
              throw error;
            }
            successCount++;
            setUploadProgress(prev => ({
              ...prev,
              success: prev.success + 1
            }));
          }
        } catch (error) {
          errorCount++;
          setUploadProgress(prev => ({
            ...prev,
            errors: prev.errors + 1
          }));
          console.error('Error processing employee:', operation.employee["Employee Number"], error);
        }
      }

      // Refresh the data
      await fetchData();
      
      // Show success message and auto-close modal after delay
      if (errorCount === 0) {
        toast.success(`Bulk upload completed successfully: ${successCount} records processed`);
      } else {
        toast.success(`Bulk upload completed: ${successCount} successful, ${errorCount} errors`);
      }
      
      // Auto-close modal after 2 seconds
      setTimeout(() => {
        setShowUploadModal(false);
        setBulkUploadPreview(null);
        setUploadProgress({
          processed: 0,
          total: 0,
          success: 0,
          errors: 0
        });
      }, 2000);
      
    } catch (error) {
      console.error('Bulk upload execution error:', error);
      toast.error('Failed to execute bulk upload.');
      setShowUploadModal(false);
    } finally {
      setIsUploading(false);
    }
  };

  // FIXED: Manual close function for the upload modal
  const closeUploadModal = () => {
    setShowUploadModal(false);
    setBulkUploadPreview(null);
    setUploadProgress({
      processed: 0,
      total: 0,
      success: 0,
      errors: 0
    });
  };

  const downloadTemplate = () => {
    const templateData = [
      {
        'Employee Number': 'EMP001',
        'First Name': 'John',
        'Last Name': 'Doe',
        'Work Email': 'john.doe@company.com',
        'Town': 'Nairobi',
        'Job Title': 'Software Engineer',
        'Employee Type': 'Permanent',
        'Job Group': 'JG5',
        'Basic Salary': '150000',
        'SHIF Number': 'SHIF001',
        'NSSF Number': 'NSSF001',
        'NHIF Number': 'NHIF001',
        'Tax PIN': 'A001234567B',
        'ID Number': '12345678',
        'Mobile Number': '0712345678',
        'Personal Email': 'john@gmail.com',
        'Gender': 'Male',
        'Marital Status': 'Single',
        'Date of Birth': '1990-01-01',
        'manager_email': 'manager@company.com',
        'regional_manager': 'regional.manager@company.com'
      }
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    
    const colWidths = [
      { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 10 },
      { wch: 15 }, { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 12 },
      { wch: 12 }, { wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 12 },
      { wch: 20 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 20 }
    ];
    ws['!cols'] = colWidths;
    
    XLSX.writeFile(wb, 'employee_bulk_upload_template.xlsx');
    toast.success('Template downloaded successfully!');
  };

  const exportToExcel = () => {
    const exportData = employees.map(emp => ({
      'Employee Number': emp["Employee Number"],
      'First Name': emp["First Name"],
      'Last Name': emp["Last Name"],
      'Work Email': emp["Work Email"],
      'Town': emp.Town,
      'Job Title': emp["Job Title"],
      'Employee Type': emp["Employee Type"],
      'Job Group': emp["Job Group"],
      'Basic Salary': emp["Basic Salary"],
      'SHIF Number': emp["SHIF Number"],
      'NSSF Number': emp["NSSF Number"],
      'NHIF Number': emp["NHIF Number"],
      'Tax PIN': emp["Tax PIN"],
      'ID Number': emp["ID Number"],
      'Mobile Number': emp["Mobile Number"],
      'Personal Email': emp["Personal Email"],
      'Gender': emp.Gender,
      'Marital Status': emp["Marital Status"],
      'Date of Birth': emp["Date of Birth"],
      'manager_email': emp.manager_email,
      'regional_manager': emp.regional_manager
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Employees');
    XLSX.writeFile(wb, `employees_export_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success('Data exported successfully!');
  };

  // Format currency
  const formatCurrency = (amount: number | null) => {
    if (amount === null || amount === undefined) return '--';
    return new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency: 'KES',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Get unique values for filters
  const getUniqueValues = (key: keyof Employee) => {
    const values = employees.map(emp => emp[key]).filter(Boolean) as string[];
    return [...new Set(values)];
  };

  // FIXED: Upload Progress Modal with close button and proper state management
  const UploadProgressModal = () => {
    if (!showUploadModal) return null;

    const progressPercentage = uploadProgress.total > 0 
      ? (uploadProgress.processed / uploadProgress.total) * 100 
      : 0;

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg max-w-md w-full">
          <div className="p-6 border-b border-gray-200 flex justify-between items-center">
            <h3 className="text-lg font-semibold">Processing Bulk Upload</h3>
            <button
              onClick={closeUploadModal}
              className="text-gray-400 hover:text-gray-600 transition-colors"
              disabled={isUploading}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          
          <div className="p-6">
            {bulkUploadPreview && (
              <div className="mb-4">
                <p className="text-sm text-gray-600 mb-2">
                  {bulkUploadPreview.summary.create} new employees, {bulkUploadPreview.summary.update} updates, {bulkUploadPreview.summary.error} errors
                </p>
                
                {/* Progress Bar */}
                <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                  <div 
                    className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${progressPercentage}%` }}
                  ></div>
                </div>
                
                <div className="flex justify-between text-xs text-gray-500 mb-4">
                  <span>Processed: {uploadProgress.processed}/{uploadProgress.total}</span>
                  <span>{Math.round(progressPercentage)}%</span>
                </div>

                {/* Success/Error Counts */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle className="w-4 h-4" />
                    <span>Success: {uploadProgress.success}</span>
                  </div>
                  <div className="flex items-center gap-2 text-red-600">
                    <AlertCircle className="w-4 h-4" />
                    <span>Errors: {uploadProgress.errors}</span>
                  </div>
                </div>
              </div>
            )}
            
            <div className="flex items-center justify-center gap-3">
              {isUploading ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                  <span className="text-sm text-gray-700">
                    Applying changes to database...
                  </span>
                </>
              ) : (
                <>
                  <CheckCircle className="w-6 h-6 text-green-500" />
                  <span className="text-sm text-gray-700">
                    Processing completed! Closing automatically...
                  </span>
                </>
              )}
            </div>
          </div>

          {!isUploading && (
            <div className="p-4 border-t border-gray-200 bg-gray-50">
              <button
                onClick={closeUploadModal}
                className="w-full px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors"
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
        <p className="mt-4 text-gray-600">Loading employee data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 p-6 bg-red-50 rounded-lg">
        <AlertCircle className="w-8 h-8 text-red-500" />
        <p className="mt-4 text-red-600 text-center">{error}</p>
        <button 
          onClick={() => window.location.reload()}
          className="mt-4 px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (employees.length === 0 && !loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 p-6 bg-gray-50 rounded-lg">
        <AlertCircle className="w-8 h-8 text-gray-400" />
        <p className="mt-4 text-gray-600">No employee data found</p>
        <div className="flex gap-3 mt-4">
          <label className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors cursor-pointer">
            <Upload className="w-4 h-4" />
            Bulk Upload Excel
            <input
              type="file"
              accept=".xlsx, .xls, .csv"
              onChange={handleBulkUpload}
              className="hidden"
              disabled={isUploading}
            />
          </label>
          <button
            onClick={startAddingNew}
            className="px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors flex items-center"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add New Employee
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
      <UploadProgressModal />

      {/* Table Controls */}
      <div className="p-4 border-b border-gray-100 bg-white">
        <div className="flex flex-col xs:flex-row xs:items-center justify-between gap-3">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="w-4 h-4 text-gray-400" />
            </div>
            <input
              type="text"
              placeholder="Search employees..."
              className="pl-9 pr-4 py-2 w-full text-xs border border-green-200 rounded-lg focus:border-green-100 focus:outline focus:outline-green-200 focus:outline-2 focus:outline-offset-2 transition-all bg-green-50"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          
          {/* Filters and Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <select
                className="appearance-none pl-3 pr-8 py-2 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-gray-50"
                value={filters.Town}
                onChange={(e) => setFilters({...filters, Town: e.target.value})}
              >
                <option value="">Office Town</option>
                {getUniqueValues('Town').map(branch => (
                  <option key={branch} value={branch}>{branch}</option>
                ))}
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                <Filter className="w-3 h-3 text-gray-400" />
              </div>
            </div>
            
            <div className="relative">
              <select
                className="appearance-none pl-3 pr-8 py-2 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-gray-50"
                value={filters["Employee Type"]}
                onChange={(e) => setFilters({...filters, "Employee Type": e.target.value})}
              >
                <option value="">All Types</option>
                {getUniqueValues('Employee Type').map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                <Filter className="w-3 h-3 text-gray-400" />
              </div>
            </div>
            
            <div className="relative">
              <select
                className="appearance-none pl-3 pr-8 py-2 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-gray-50"
                value={filters["Job Group"]}
                onChange={(e) => setFilters({...filters, "Job Group": e.target.value})}
              >
                <option value="">All Job Groups</option>
                {getUniqueValues('Job Group').map(group => (
                  <option key={group} value={group}>{group}</option>
                ))}
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                <Filter className="w-3 h-3 text-gray-400" />
              </div>
            </div>
            
            <button 
              onClick={() => setFilters({ Town: '', "Employee Type": '', "Job Group": '' })}
              className="px-3 py-2 text-xs text-gray-500 hover:text-gray-700 flex items-center transition-colors"
            >
              <X className="w-3 h-3 mr-1" />
              Clear
            </button>

            {/* Upload/Download Buttons */}
            <label className="flex items-center gap-2 px-3 py-2 text-xs bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors cursor-pointer">
              <Upload className="w-3 h-3" />
              Bulk Upload
              <input
                type="file"
                accept=".xlsx, .xls, .csv"
                onChange={handleBulkUpload}
                className="hidden"
                disabled={isUploading}
              />
            </label>

            <button
              onClick={downloadTemplate}
              className="flex items-center gap-2 px-3 py-2 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
            >
              <Download className="w-3 h-3" />
              Template
            </button>

            <button
              onClick={exportToExcel}
              className="flex items-center gap-2 px-3 py-2 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
            >
              <FileSpreadsheet className="w-3 h-3" />
              Export
            </button>

            <button
              onClick={startAddingNew}
              className="px-3 py-2 text-xs bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors flex items-center"
            >
              <Plus className="w-3 h-3 mr-1" />
              Add New
            </button>
          </div>
        </div>

        {/* Loading indicator for upload */}
        {isUploading && (
          <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-100">
            <div className="flex items-center gap-3">
              <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
              <span className="text-sm text-blue-700">Processing bulk upload... This may take a few moments.</span>
            </div>
          </div>
        )}
      </div>
      
      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 overflow-scroll">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <input
                  type="checkbox"
                  checked={selectAll}
                  onChange={toggleSelectAll}
                  className="h-3 w-3 text-emerald-500 rounded border-gray-300 focus:ring-emerald-500"
                />
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Employee ID
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                ID Number
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Name
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Work Email
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Office
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Job Title
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Type
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Job Group
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Basic Salary
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Manager Email
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Regional Manager
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                SHIF Number
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                NSSF Number
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                NHIF Number
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Tax PIN
              </th>
              <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {/* New Employee Row */}
            {isAddingNew && (
              <tr className="bg-blue-50">
                <td className="px-4 py-3 whitespace-nowrap"></td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <input
                    type="text"
                    className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-emerald-500 focus:border-emerald-500"
                    value={newEmployee["Employee Number"] || ''}
                    onChange={(e) => setNewEmployee({...newEmployee, "Employee Number": e.target.value})}
                    placeholder="Employee Number *"
                  />
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <input
                    type="number"
                    className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-emerald-500 focus:border-emerald-500"
                    value={newEmployee["ID Number"] || ''}
                    onChange={(e) => setNewEmployee({...newEmployee, "ID Number": parseInt(e.target.value) || null})}
                    placeholder="ID Number"
                    min="0"
                  />
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <div className="space-y-1">
                    <input
                      type="text"
                      className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-emerald-500 focus:border-emerald-500"
                      value={newEmployee["First Name"] || ''}
                      onChange={(e) => setNewEmployee({...newEmployee, "First Name": e.target.value})}
                      placeholder="First Name *"
                    />
                    <input
                      type="text"
                      className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-emerald-500 focus:border-emerald-500"
                      value={newEmployee["Last Name"] || ''}
                      onChange={(e) => setNewEmployee({...newEmployee, "Last Name": e.target.value})}
                      placeholder="Last Name *"
                    />
                  </div>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <input
                    type="email"
                    className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-emerald-500 focus:border-emerald-500"
                    value={newEmployee["Work Email"] || ''}
                    onChange={(e) => setNewEmployee({...newEmployee, "Work Email": e.target.value})}
                    placeholder="Work Email"
                  />
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <select
                    className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-emerald-500 focus:border-emerald-500"
                    value={newEmployee.Town || ''}
                    onChange={(e) => setNewEmployee({...newEmployee, Town: e.target.value})}
                  >
                    <option value="">Select Town</option>
                    {getUniqueValues('Town').map(branch => (
                      <option key={branch} value={branch}>{branch}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <input
                    type="text"
                    className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-emerald-500 focus:border-emerald-500"
                    value={newEmployee["Job Title"] || ''}
                    onChange={(e) => setNewEmployee({...newEmployee, "Job Title": e.target.value})}
                    placeholder="Job Title"
                  />
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <select
                    className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-emerald-500 focus:border-emerald-500"
                    value={newEmployee["Employee Type"] || ''}
                    onChange={(e) => setNewEmployee({...newEmployee, "Employee Type": e.target.value})}
                  >
                    <option value="">Select Type</option>
                    {getUniqueValues('Employee Type').map(type => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <select
                    className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-emerald-500 focus:border-emerald-500"
                    value={newEmployee["Job Group"] || ''}
                    onChange={(e) => setNewEmployee({...newEmployee, "Job Group": e.target.value})}
                  >
                    <option value="">Select Job Group</option>
                    {getUniqueValues('Job Group').map(group => (
                      <option key={group} value={group}>{group}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <input
                    type="number"
                    className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-emerald-500 focus:border-emerald-500"
                    value={newEmployee["Basic Salary"] || ''}
                    onChange={(e) => setNewEmployee({...newEmployee, "Basic Salary": parseFloat(e.target.value) || null})}
                    placeholder="Basic Salary"
                    min="0"
                    step="1000"
                  />
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <input
                    type="email"
                    className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-emerald-500 focus:border-emerald-500"
                    value={newEmployee.manager_email || ''}
                    onChange={(e) => setNewEmployee({...newEmployee, manager_email: e.target.value})}
                    placeholder="Manager Email"
                  />
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <input
                    type="text"
                    className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-emerald-500 focus:border-emerald-500"
                    value={newEmployee.regional_manager || ''}
                    onChange={(e) => setNewEmployee({...newEmployee, regional_manager: e.target.value})}
                    placeholder="Regional Manager"
                  />
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <input
                    type="text"
                    className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-emerald-500 focus:border-emerald-500"
                    value={newEmployee["SHIF Number"] || ''}
                    onChange={(e) => setNewEmployee({...newEmployee, "SHIF Number": e.target.value})}
                    placeholder="SHIF Number"
                  />
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <input
                    type="text"
                    className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-emerald-500 focus:border-emerald-500"
                    value={newEmployee["NSSF Number"] || ''}
                    onChange={(e) => setNewEmployee({...newEmployee, "NSSF Number": e.target.value})}
                    placeholder="NSSF Number"
                  />
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <input
                    type="text"
                    className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-emerald-500 focus:border-emerald-500"
                    value={newEmployee["NHIF Number"] || ''}
                    onChange={(e) => setNewEmployee({...newEmployee, "NHIF Number": e.target.value})}
                    placeholder="NHIF Number"
                  />
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <input
                    type="text"
                    className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-emerald-500 focus:border-emerald-500"
                    value={newEmployee["Tax PIN"] || ''}
                    onChange={(e) => setNewEmployee({...newEmployee, "Tax PIN": e.target.value})}
                    placeholder="Tax PIN"
                  />
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-right text-xs font-medium">
                  <div className="flex justify-end space-x-2">
                    <button
                      onClick={saveNewEmployee}
                      className="text-emerald-600 hover:text-emerald-800 flex items-center transition-colors"
                    >
                      <Save className="w-3 h-3 mr-1" />
                      Save
                    </button>
                    <button
                      onClick={cancelAddingNew}
                      className="text-gray-600 hover:text-gray-800 flex items-center transition-colors"
                    >
                      <X className="w-3 h-3 mr-1" />
                      Cancel
                    </button>
                  </div>
                </td>
              </tr>
            )}
            
            {/* Existing Employees */}
            {currentItems.length > 0 ? (
              currentItems.map((employee) => (
                <tr 
                  key={employee.id} 
                  className={selectedRows.includes(employee.id) ? 'bg-emerald-50/50' : 'hover:bg-gray-50 transition-colors'}
                >
                  <td className="px-4 py-3 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={selectedRows.includes(employee.id)}
                      onChange={() => toggleRowSelection(employee.id)}
                      className="h-3 w-3 text-emerald-500 rounded border-gray-300 focus:ring-emerald-500"
                    />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-xs font-medium text-gray-900">
                    {employee["Employee Number"]}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {editingId === employee.id ? (
                      <input
                        type="number"
                        className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-emerald-500 focus:border-emerald-500"
                        value={editableData["ID Number"] || ''}
                        onChange={(e) => setEditableData({...editableData, "ID Number": parseInt(e.target.value) || null})}
                        placeholder="ID Number"
                        min="0"
                      />
                    ) : (
                      <div className="text-xs text-gray-500">{employee["ID Number"]}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {editingId === employee.id ? (
                      <div className="space-y-1">
                        <input
                          type="text"
                          className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-emerald-500 focus:border-emerald-500"
                          value={editableData["First Name"] || ''}
                          onChange={(e) => setEditableData({...editableData, "First Name": e.target.value})}
                          placeholder="First Name"
                        />
                        <input
                          type="text"
                          className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-emerald-500 focus:border-emerald-500"
                          value={editableData["Last Name"] || ''}
                          onChange={(e) => setEditableData({...editableData, "Last Name": e.target.value})}
                          placeholder="Last Name"
                        />
                      </div>
                    ) : (
                      <div className="text-xs font-medium text-gray-900">
                        {employee["First Name"]} {employee["Last Name"]}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {editingId === employee.id ? (
                      <input
                        type="email"
                        className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-emerald-500 focus:border-emerald-500"
                        value={editableData["Work Email"] || ''}
                        onChange={(e) => setEditableData({...editableData, "Work Email": e.target.value})}
                      />
                    ) : (
                      <div className="text-xs text-gray-500">{employee["Work Email"]}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {editingId === employee.id ? (
                      <select
                        className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-emerald-500 focus:border-emerald-500"
                        value={editableData.Town || ''}
                        onChange={(e) => setEditableData({...editableData, Town: e.target.value})}
                      >
                        {getUniqueValues('Town').map(branch => (
                          <option key={branch} value={branch}>{branch}</option>
                        ))}
                      </select>
                    ) : (
                      <div className="text-xs text-gray-500">{employee.Town}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {editingId === employee.id ? (
                      <input
                        type="text"
                        className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-emerald-500 focus:border-emerald-500"
                        value={editableData["Job Title"] || ''}
                        onChange={(e) => setEditableData({...editableData, "Job Title": e.target.value})}
                      />
                    ) : (
                      <div className="text-xs text-gray-500">{employee["Job Title"]}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {editingId === employee.id ? (
                      <select
                        className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-emerald-500 focus:border-emerald-500"
                        value={editableData["Employee Type"] || ''}
                        onChange={(e) => setEditableData({...editableData, "Employee Type": e.target.value})}
                      >
                        {getUniqueValues('Employee Type').map(type => (
                          <option key={type} value={type}>{type}</option>
                        ))}
                      </select>
                    ) : (
                      <div className="text-xs text-gray-500">{employee["Employee Type"]}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {editingId === employee.id ? (
                      <select
                        className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-emerald-500 focus:border-emerald-500"
                        value={editableData["Job Group"] || ''}
                        onChange={(e) => setEditableData({...editableData, "Job Group": e.target.value})}
                      >
                        {getUniqueValues('Job Group').map(group => (
                          <option key={group} value={group}>{group}</option>
                        ))}
                      </select>
                    ) : (
                      <div className="text-xs text-gray-500">{employee["Job Group"]}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {editingId === employee.id ? (
                      <input
                        type="number"
                        className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-emerald-500 focus:border-emerald-500"
                        value={editableData["Basic Salary"] || ''}
                        onChange={(e) => setEditableData({...editableData, "Basic Salary": parseFloat(e.target.value) || null})}
                        placeholder="Basic Salary"
                        min="0"
                        step="1000"
                      />
                    ) : (
                      <div className="text-xs font-medium text-gray-900">
                        {formatCurrency(employee["Basic Salary"])}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {editingId === employee.id ? (
                      <input
                        type="email"
                        className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-emerald-500 focus:border-emerald-500"
                        value={editableData.manager_email || ''}
                        onChange={(e) => setEditableData({...editableData, manager_email: e.target.value})}
                        placeholder="Manager Email"
                      />
                    ) : (
                      <div className="text-xs text-gray-500">{employee.manager_email}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {editingId === employee.id ? (
                      <input
                        type="text"
                        className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-emerald-500 focus:border-emerald-500"
                        value={editableData.regional_manager || ''}
                        onChange={(e) => setEditableData({...editableData, regional_manager: e.target.value})}
                        placeholder="Regional Manager"
                      />
                    ) : (
                      <div className="text-xs text-gray-500">{employee.regional_manager}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {editingId === employee.id ? (
                      <input
                        type="text"
                        className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-emerald-500 focus:border-emerald-500"
                        value={editableData["SHIF Number"] || ''}
                        onChange={(e) => setEditableData({...editableData, "SHIF Number": e.target.value})}
                        placeholder="SHIF Number"
                      />
                    ) : (
                      <div className="text-xs text-gray-500">{employee["SHIF Number"]}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {editingId === employee.id ? (
                      <input
                        type="text"
                        className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-emerald-500 focus:border-emerald-500"
                        value={editableData["NSSF Number"] || ''}
                        onChange={(e) => setEditableData({...editableData, "NSSF Number": e.target.value})}
                        placeholder="NSSF Number"
                      />
                    ) : (
                      <div className="text-xs text-gray-500">{employee["NSSF Number"]}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {editingId === employee.id ? (
                      <input
                        type="text"
                        className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-emerald-500 focus:border-emerald-500"
                        value={editableData["NHIF Number"] || ''}
                        onChange={(e) => setEditableData({...editableData, "NHIF Number": e.target.value})}
                        placeholder="NHIF Number"
                      />
                    ) : (
                      <div className="text-xs text-gray-500">{employee["NHIF Number"]}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {editingId === employee.id ? (
                      <input
                        type="text"
                        className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:ring-emerald-500 focus:border-emerald-500"
                        value={editableData["Tax PIN"] || ''}
                        onChange={(e) => setEditableData({...editableData, "Tax PIN": e.target.value})}
                        placeholder="Tax PIN"
                      />
                    ) : (
                      <div className="text-xs text-gray-500">{employee["Tax PIN"]}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-right text-xs font-medium">
                    {editingId === employee.id ? (
                      <div className="flex justify-end space-x-2">
                        <button
                          onClick={() => saveEditing(employee.id)}
                          className="text-emerald-600 hover:text-emerald-800 flex items-center transition-colors"
                        >
                          <Save className="w-3 h-3 mr-1" />
                          Save
                        </button>
                        <button
                          onClick={cancelEditing}
                          className="text-gray-600 hover:text-gray-800 flex items-center transition-colors"
                        >
                          <X className="w-3 h-3 mr-1" />
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEditing(employee)}
                        className="text-blue-600 hover:text-blue-800 flex items-center transition-colors"
                      >
                        <Edit2 className="w-3 h-3 mr-1" />
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={17} className="px-4 py-4 text-center text-xs text-gray-500">
                  No employees found matching your criteria
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      
      {/* Pagination */}
      <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between bg-white">
        <div className="flex-1 flex justify-between sm:hidden">
          <button
            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
            disabled={currentPage === 1}
            className="relative inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50"
          >
            Previous
          </button>
          <button
            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
            disabled={currentPage === totalPages}
            className="ml-3 relative inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50"
          >
            Next
          </button>
        </div>
        <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
          <div>
            <p className="text-xs text-gray-700">
              Showing <span className="font-medium">{indexOfFirstItem + 1}</span> to{' '}
              <span className="font-medium">{Math.min(indexOfLastItem, filteredEmployees.length)}</span> of{' '}
              <span className="font-medium">{filteredEmployees.length}</span> results
            </p>
          </div>
          <div>
            <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
              <button
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className="relative inline-flex items-center px-1.5 py-1.5 rounded-l-md border border-gray-200 bg-white text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="sr-only">First</span>
                <ChevronsLeft className="h-3 w-3" aria-hidden="true" />
              </button>
              <button
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="relative inline-flex items-center px-1.5 py-1.5 border border-gray-200 bg-white text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="sr-only">Previous</span>
                <ChevronLeft className="h-3 w-3" aria-hidden="true" />
              </button>
              
              {/* Page numbers */}
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }
                
                return (
                  <button
                    key={pageNum}
                    onClick={() => setCurrentPage(pageNum)}
                    className={`relative inline-flex items-center px-2 py-1.5 border text-xs font-medium ${
                      currentPage === pageNum
                        ? 'z-10 bg-emerald-50 border-emerald-500 text-emerald-600'
                        : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
              
              <button
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="relative inline-flex items-center px-1.5 py-1.5 border border-gray-200 bg-white text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="sr-only">Next</span>
                <ChevronRight className="h-3 w-3" aria-hidden="true" />
              </button>
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className="relative inline-flex items-center px-1.5 py-1.5 rounded-r-md border border-gray-200 bg-white text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="sr-only">Last</span>
                <ChevronsRight className="h-3 w-3" aria-hidden="true" />
              </button>
            </nav>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmployeeDataTable;