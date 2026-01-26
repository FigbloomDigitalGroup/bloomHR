import React, { useState, useEffect } from 'react';
import { Download, FileText, X, Loader, Users } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';

interface P10FormData {
  pin: string;
  name: string;
  residentStatus: string;
  employeeType: string;
  pwd: string;
  exemptionCert: string;
  cashPay: number;
  carBenefit: number;
  meals: number;
  nonCashBenefits: number;
  housingType: string;
  housingBenefit: number;
  otherBenefits: number;
  grossPay: number;
  shif: number;
  nssf: number;
  pension: number;
  medicalFund: number;
  mortgageInterest: number;
  housingLevy: number;
  taxablePay: number;
  personalRelief: number;
  insuranceRelief: number;
  payeTax: number;
  selfAssessedPaye: number;
}

const P10FormGenerator: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [isLoading, setIsLoading] = useState(false);
  const [employees, setEmployees] = useState<any[]>([]);
  const [payrollData, setPayrollData] = useState<any[]>([]);

  useEffect(() => {
    if (isOpen) {
      fetchEmployees();
    }
  }, [isOpen]);

  const fetchEmployees = async () => {
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('*');
      
      if (error) {
        throw error;
      }
      
      if (data) {
        setEmployees(data);
      }
    } catch (error) {
      console.error('Error fetching employees:', error);
      toast.error('Failed to fetch employees');
    }
  };

  const fetchPayrollData = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('payroll_records')
        .select('*')
        .like('pay_period', `${selectedYear}%`);

      if (error) {
        throw error;
      }
      
      if (data) {
        setPayrollData(data);
        return data;
      }
      return [];
    } catch (error) {
      console.error('Error fetching payroll data:', error);
      toast.error('Failed to fetch payroll data');
      return [];
    }
  };

  const generateP10Form = async () => {
    setIsLoading(true);
    try {
      const payrollRecords = await fetchPayrollData();
      
      // Group payroll data by employee
      const employeePayrollMap = new Map();
      
      payrollRecords.forEach(record => {
        if (!employeePayrollMap.has(record.employee_id)) {
          employeePayrollMap.set(record.employee_id, []);
        }
        employeePayrollMap.get(record.employee_id).push(record);
      });

      // Prepare P10 data for all employees
      const p10Data = employees.map(employee => {
        const employeeRecords = employeePayrollMap.get(employee['Employee Number'] || employee.employee_id) || [];
        
        // Calculate annual totals for this employee
        const annualTotals = employeeRecords.reduce((acc, record) => ({
          basicSalary: (acc.basicSalary || 0) + (record.basic_salary || 0),
          grossPay: (acc.grossPay || 0) + (record.gross_pay || 0),
          paye: (acc.paye || 0) + (record.paye_tax || 0),
          nssf: (acc.nssf || 0) + (record.nssf_deduction || 0),
          housingLevy: (acc.housingLevy || 0) + (record.housing_levy || 0),
          nhif: (acc.nhif || 0) + (record.nhif_deduction || 0)
        }), {});

        // Create P10 record according to the template
        return {
          pin: employee['Tax PIN'] || 'A000000000W',
          name: `${employee['First Name'] || ''} ${employee['Last Name'] || ''}`.trim() || 'employee_name',
          residentStatus: 'Resident',
          employeeType: 'Primary Employee',
          pwd: 'No',
          exemptionCert: '',
          cashPay: annualTotals.basicSalary || 0,
          carBenefit: 0,
          meals: 0,
          nonCashBenefits: 0,
          housingType: 'Benefit not given',
          housingBenefit: 0,
          otherBenefits: 0,
          grossPay: annualTotals.grossPay || 0,
          shif: annualTotals.nhif || 0,
          nssf: annualTotals.nssf || 0,
          pension: 0,
          medicalFund: 0,
          mortgageInterest: 0,
          housingLevy: annualTotals.housingLevy || 0,
          taxablePay: (annualTotals.grossPay || 0) - (annualTotals.nssf || 0) - (annualTotals.housingLevy || 0),
          personalRelief: 2400 * 12, // Annual personal relief
          insuranceRelief: 0,
          payeTax: annualTotals.paye || 0,
          selfAssessedPaye: 0
        };
      });

      // Convert to CSV format (without headers)
      const csvData = p10Data.map(employee => [
        employee.pin,
        employee.name,
        employee.residentStatus,
        employee.employeeType,
        employee.pwd,
        employee.exemptionCert,
        employee.cashPay,
        employee.carBenefit,
        employee.meals,
        employee.nonCashBenefits,
        employee.housingType,
        employee.housingBenefit,
        employee.otherBenefits,
        employee.grossPay,
        employee.shif,
        employee.nssf,
        employee.pension,
        employee.medicalFund,
        employee.mortgageInterest,
        employee.housingLevy,
        employee.taxablePay,
        employee.personalRelief,
        employee.insuranceRelief,
        employee.payeTax,
        employee.selfAssessedPaye
      ]);

      // Create worksheet
      const ws = XLSX.utils.aoa_to_sheet(csvData);
      
      // Create workbook
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'P10 Form');
      
      // Generate Excel file
      const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const data = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      
      // Create download link
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `P10_Form_${selectedYear}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success(`P10 Form for ${p10Data.length} employees generated successfully!`);
    } catch (error) {
      console.error('Error generating P10 form:', error);
      toast.error('Failed to generate P10 form');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-600" />
            Generate P10 Form (Employer Return)
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            disabled={isLoading}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="bg-blue-50 p-3 rounded-md border border-blue-100">
            <div className="flex items-center gap-2 text-blue-800">
              <Users className="w-4 h-4" />
              <span className="text-xs font-medium">
                This will generate a P10 form for all {employees.length} employees
              </span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Tax Year</label>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
              disabled={isLoading}
            >
              <option value="2024">2024</option>
              <option value="2023">2023</option>
              <option value="2022">2022</option>
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300"
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            onClick={generateP10Form}
            className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 flex items-center gap-2"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Download size={16} />
                Generate P10 for All Employees
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default P10FormGenerator;