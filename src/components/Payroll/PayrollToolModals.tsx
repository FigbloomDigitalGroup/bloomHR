import { useState, useEffect } from "react";
import EmployeePicker from '../UI/EmployeePicker';
import { FileText, Download, Calendar, FileSpreadsheet } from "lucide-react";
import { supabase } from "../../lib/supabase";
import toast from "react-hot-toast";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import jsPDF from "jspdf";
import "jspdf-autotable";
import SearchableDropdown from "../UI/SearchableDropdown";
import { downloadP9Pdf, loadEmployerPin, loadP9For, saveEmployerPin } from "../../lib/p9";

// The P9 tax card and the payroll table export, moved from PayrollDashboard.

// P9 Form Generator Component
export const P9FormGenerator = ({
  isOpen,
  onClose,
  records,
}: {
  isOpen: boolean;
  onClose: () => void;
  records: any[];
  companyInfo: any;
}) => {
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [taxYear, setTaxYear] = useState(new Date().getFullYear().toString());
  const [isGenerating, setIsGenerating] = useState(false);
  const [employerPin, setEmployerPin] = useState<string | null>(null);
  const [pinDraft, setPinDraft] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    loadEmployerPin().then((pin) => { setEmployerPin(pin); setPinDraft(pin); }, () => setEmployerPin(""));
  }, [isOpen]);

  const savePin = async () => {
    try {
      setEmployerPin(await saveEmployerPin(pinDraft));
      toast.success("Employer KRA PIN saved");
    } catch (error: any) {
      toast.error(error.message || "The PIN was not saved");
    }
  };

  // the year's P9 from the employee's approved payslips, worked out as payroll and the P10 are (lib/p9)
  const generateP9Form = async (employeeData: any) => {
    setIsGenerating(true);
    try {
      const { data: employee, error } = await supabase
        .from("employees").select("*").eq("Employee Number", employeeData.employee_id).maybeSingle();
      if (error) throw error;
      if (!employee) throw new Error("Employee not found");
      const p9 = await loadP9For(employee, Number(taxYear));
      if (p9.rows.every((r) => r.values.every((v) => v === 0))) {
        toast.error(`No approved payslips for ${taxYear}`);
        return;
      }
      downloadP9Pdf(p9);
      toast.success("P9 downloaded");
    } catch (error: any) {
      toast.error(`The P9 could not be made: ${error.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
          <FileText className="h-5 w-5 text-blue-600" />
          Generate P9 Forms
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Tax Year
            </label>
            <SearchableDropdown
              options={[0, 1, 2].map((n) => String(new Date().getFullYear() - n))}
              value={taxYear}
              onChange={setTaxYear}
              placeholder="Select Year"
              icon={Calendar}
            />
          </div>

          <div>
            <label htmlFor="employer-kra-pin" className="block text-xs font-medium text-gray-700 mb-1">
              Employer KRA PIN (printed on every P9)
            </label>
            <div className="flex gap-2">
              <input id="employer-kra-pin" value={pinDraft} onChange={(e) => setPinDraft(e.target.value.toUpperCase())}
                placeholder="P051234567X" className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs" />
              <button type="button" onClick={() => void savePin()} disabled={employerPin === null || pinDraft.trim() === employerPin}
                className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-md disabled:opacity-50">Save</button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Select Employee
            </label>
            <EmployeePicker
              value={selectedEmployee}
              allowedNumbers={records.map((r) => r.employee_id)}
              placeholder="Select Employee"
              onChange={(emp) => setSelectedEmployee(emp?.employeeNumber ?? "")}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300"
            disabled={isGenerating}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              const employee = records.find(
                (r: any) => r.employee_id === selectedEmployee,
              );
              if (employee) generateP9Form(employee);
            }}
            className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 flex items-center gap-2"
            disabled={!selectedEmployee || isGenerating}
          >
            {isGenerating ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div>
                Generating...
              </>
            ) : (
              <>
                <FileText size={16} />
                Generate P9
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// Export Modal Component
export const ExportModal = ({
  isOpen,
  onClose,
  records,
}: {
  isOpen: boolean;
  onClose: () => void;
  records: any[];
}) => {
  const [exportFormat, setExportFormat] = useState("excel");
  const [isExporting, setIsExporting] = useState(false);

  const exportToExcel = () => {
    setIsExporting(true);
    try {
      const ws = XLSX.utils.json_to_sheet(
        records.map((record: any) => ({
          "Employee ID": record.employee_id,
          "Employee Name": record.employee_name,
          Department: record.department,
          Position: record.position,
          "Basic Salary": record.basic_salary,
          "House Allowance": record.house_allowance,
          "Transport Allowance": record.transport_allowance,
          "Medical Allowance": record.medical_allowance,
          "Overtime Hours": record.overtime_hours,
          "Overtime Pay": record.overtime_hours * record.overtime_rate,
          "Gross Pay": record.gross_pay,
          "PAYE Tax": Math.round(record.paye_tax),
          NHIF: record.nhif_deduction,
          NSSF: record.nssf_deduction,
          "Housing Levy": record.housing_levy,
          "Total Deductions": record.total_deductions,
          "Net Pay": Math.round(record.net_pay),
          "Pay Period": record.pay_period,
        })),
      );

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Payroll");

      const excelBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      const data = new Blob([excelBuffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      saveAs(data, `payroll_${new Date().toISOString().slice(0, 10)}.xlsx`);

      toast.success("Excel file exported successfully!");
    } catch {
      toast.error("Failed to export Excel file");
    } finally {
      setIsExporting(false);
    }
  };

  const exportToCSV = () => {
    setIsExporting(true);
    try {
      const ws = XLSX.utils.json_to_sheet(
        records.map((record: any) => ({
          "Employee ID": record.employee_id,
          "Employee Name": record.employee_name,
          Department: record.department,
          Position: record.position,
          "Basic Salary": record.basic_salary,
          "House Allowance": record.house_allowance,
          "Transport Allowance": record.transport_allowance,
          "Medical Allowance": record.medical_allowance,
          "Overtime Hours": record.overtime_hours,
          "Overtime Pay": record.overtime_hours * record.overtime_rate,
          "Gross Pay": record.gross_pay,
          "PAYE Tax": Math.round(record.paye_tax),
          NHIF: record.nhif_deduction,
          NSSF: record.nssf_deduction,
          "Housing Levy": record.housing_levy,
          "Total Deductions": record.total_deductions,
          "Net Pay": Math.round(record.net_pay),
          "Pay Period": record.pay_period,
        })),
      );

      const csv = XLSX.utils.sheet_to_csv(ws);
      const data = new Blob([csv], { type: "text/csv" });
      saveAs(data, `payroll_${new Date().toISOString().slice(0, 10)}.csv`);

      toast.success("CSV file exported successfully!");
    } catch {
      toast.error("Failed to export CSV file");
    } finally {
      setIsExporting(false);
    }
  };

  const exportToPDF = () => {
    setIsExporting(true);
    try {
      const doc = new jsPDF();

      doc.setFontSize(16);
      doc.text("Payroll Report", 14, 22);
      doc.setFontSize(12);
      doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 14, 32);

      const tableData = records.map((record: any) => [
        record.employee_id,
        record.employee_name,
        record.department,
        `KSh ${record.gross_pay.toLocaleString()}`,
        `KSh ${Math.round(record.paye_tax).toLocaleString()}`,
        `KSh ${record.total_deductions.toLocaleString()}`,
        `KSh ${Math.round(record.net_pay).toLocaleString()}`,
      ]);

      (doc as any).autoTable({
        head: [
          [
            "ID",
            "Name",
            "Department",
            "Gross Pay",
            "PAYE",
            "Total Deductions",
            "Net Pay",
          ],
        ],
        body: tableData,
        startY: 40,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [34, 197, 94] },
      });

      doc.save(`payroll_${new Date().toISOString().slice(0, 10)}.pdf`);
      toast.success("PDF file exported successfully!");
    } catch {
      toast.error("Failed to export PDF file");
    } finally {
      setIsExporting(false);
    }
  };

  const handleExport = () => {
    switch (exportFormat) {
      case "excel":
        exportToExcel();
        break;
      case "csv":
        exportToCSV();
        break;
      case "pdf":
        exportToPDF();
        break;
      default:
        break;
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
          <Download className="h-5 w-5 text-primary" />
          Export Payroll Data
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">
              Export Format
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  value="excel"
                  checked={exportFormat === "excel"}
                  onChange={(e) => setExportFormat(e.target.value)}
                  className="mr-2"
                />
                <FileSpreadsheet className="w-5 h-5 mr-2 text-green-600" />
                Excel
              </label>
              <label className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  value="csv"
                  checked={exportFormat === "csv"}
                  onChange={(e) => setExportFormat(e.target.value)}
                  className="mr-2"
                />
                <FileText className="w-5 h-5 mr-2 text-blue-600" />
                CSV
              </label>
              <label className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  value="pdf"
                  checked={exportFormat === "pdf"}
                  onChange={(e) => setExportFormat(e.target.value)}
                  className="mr-2"
                />
                <FileText className="w-5 h-5 mr-2 text-red-600" />
                PDF
              </label>
            </div>
          </div>

          <div className="text-xs text-gray-600">
            <p>Exporting {records.length} payroll records</p>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-gray-700 bg-gray-200 rounded-md hover:bg-gray-300"
            disabled={isExporting}
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            className="px-4 py-2 text-xs font-medium text-white bg-primary rounded-md hover:bg-primary/90 flex items-center gap-2"
            disabled={isExporting}
          >
            {isExporting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div>
                Exporting...
              </>
            ) : (
              <>
                <Download size={16} />
                Export {exportFormat.toUpperCase()}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
