import React, { useState } from 'react';
import { Upload, FileText, CheckCircle, AlertTriangle, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import GlowButton from '../UI/GlowButton';
import { saveSalaryHistoryBatch } from '../../lib/salaryHistory';
import toast from 'react-hot-toast';

interface BulkSalaryHistoryUploadProps {
    onClose: () => void;
    onSuccess: () => void;
}

const BulkSalaryHistoryUpload: React.FC<BulkSalaryHistoryUploadProps> = ({ onClose, onSuccess }) => {
    const [file, setFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [parsedData, setParsedData] = useState<any[]>([]);
    const [errors, setErrors] = useState<string[]>([]);

    const EXPECTED_HEADERS = [
        'employee_id',
        'pay_period',
        'basic_salary',
        'gross_pay',
        'net_pay',
        'total_deductions'
    ]; // At minimum we need these to validate

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (!selectedFile) return;

        setFile(selectedFile);
        parseFile(selectedFile);
    };

    const parseFile = (file: File) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const data = e.target?.result;
                const workbook = XLSX.read(data, { type: 'binary' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];

                const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

                validateData(jsonData);
            } catch (error) {
                console.error("Error parsing file:", error);
                setErrors(["Failed to parse the file. Please ensure it's a valid Excel or CSV."]);
            }
        };

        reader.readAsBinaryString(file);
    };

    const validateData = (data: any[]) => {
        const newErrors: string[] = [];

        if (data.length === 0) {
            newErrors.push("The uploaded file is empty");
            setErrors(newErrors);
            setParsedData([]);
            return;
        }

        // Check headers
        const firstRow = data[0];
        const missingHeaders = EXPECTED_HEADERS.filter(header => !(header in firstRow));

        if (missingHeaders.length > 0) {
            newErrors.push(`Missing required columns: ${missingHeaders.join(', ')}`);
        }

        // Process rows
        const processedData = data.map((row, index) => {
            if (!row.employee_id) newErrors.push(`Row ${index + 2}: Missing employee_id`);
            if (!row.pay_period) newErrors.push(`Row ${index + 2}: Missing pay_period (Format YYYY-MM)`);

            return {
                employee_id: String(row.employee_id).trim(),
                employee_name: row.employee_name || '',
                pay_period: String(row.pay_period).trim(),
                basic_salary: Number(row.basic_salary) || 0,
                gross_pay: Number(row.gross_pay) || 0,
                net_pay: Number(row.net_pay) || 0,
                total_deductions: Number(row.total_deductions) || 0,
                paye_tax: Number(row.paye_tax) || 0,
                nhif_deduction: Number(row.nhif_deduction) || 0,
                nssf_deduction: Number(row.nssf_deduction) || 0,
                housing_levy: Number(row.housing_levy) || 0,
                house_allowance: Number(row.house_allowance) || 0,
                transport_allowance: Number(row.transport_allowance) || 0,
                medical_allowance: Number(row.medical_allowance) || 0,
                other_allowances: Number(row.other_allowances) || 0,
                advance_deduction: Number(row.advance_deduction) || 0,
                loan_deduction: Number(row.loan_deduction) || 0
            };
        });

        setErrors(newErrors);

        if (newErrors.length === 0) {
            setParsedData(processedData);
        } else {
            setParsedData([]);
        }
    };

    const handleUpload = async () => {
        if (parsedData.length === 0) return;

        setIsUploading(true);
        try {
            await saveSalaryHistoryBatch(parsedData);
            toast.success(`Successfully uploaded ${parsedData.length} historical records!`);
            onSuccess();
            onClose();
        } catch (error) {
            toast.error('Failed to upload historical records. See console for details.');
            console.error(error);
        } finally {
            setIsUploading(false);
        }
    };

    const downloadTemplate = () => {
        const template = [
            {
                employee_id: "EMP001",
                employee_name: "John Doe",
                pay_period: "2024-01",
                basic_salary: 50000,
                gross_pay: 55000,
                net_pay: 40000,
                total_deductions: 15000,
                paye_tax: 8000,
                nssf_deduction: 1080,
                nhif_deduction: 1500,
                housing_levy: 825,
                house_allowance: 5000,
                transport_allowance: 0,
                advance_deduction: 0
            }
        ];

        const ws = XLSX.utils.json_to_sheet(template);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Template");
        XLSX.writeFile(wb, "salary_history_upload_template.xlsx");
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
                            <Upload className="w-5 h-5 text-indigo-600" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold tracking-tight text-gray-900">Bulk Upload Salary History</h2>
                            <p className="text-sm text-gray-500">Import historical payslips from external sources</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto">
                    <div className="mb-6 flex items-center justify-between p-4 bg-indigo-50 border border-indigo-100 rounded-xl">
                        <div>
                            <h3 className="font-semibold text-indigo-900 mb-1">Need a template?</h3>
                            <p className="text-sm text-indigo-700">Download our sample Excel file to see the exact format required.</p>
                        </div>
                        <GlowButton variant="secondary" icon={FileText} size="sm" onClick={downloadTemplate} className="bg-white">
                            Download Template
                        </GlowButton>
                    </div>

                    <div className="border-2 border-dashed border-gray-300 bg-gray-50 rounded-xl p-8 text-center relative hover:border-indigo-500 hover:bg-indigo-50/50 transition-all group">
                        <input
                            type="file"
                            accept=".xlsx,.xls,.csv"
                            onChange={handleFileUpload}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                        <div className="flex flex-col items-center gap-3 pointer-events-none">
                            <div className="w-12 h-12 bg-white rounded-full shadow-sm flex items-center justify-center text-gray-400 group-hover:text-indigo-500 group-hover:scale-110 transition-all">
                                <Upload className="w-6 h-6" />
                            </div>
                            <div>
                                <p className="font-medium text-gray-900">Drop your file here, or browse</p>
                                <p className="text-sm text-gray-500 mt-1">Supports EXCEL and CSV files</p>
                            </div>
                        </div>
                    </div>

                    {file && (
                        <div className="mt-4 p-4 rounded-xl border border-gray-200 bg-white shadow-sm flex items-center gap-3">
                            <FileText className="w-5 h-5 text-indigo-500" />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                                <p className="text-xs text-gray-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                            </div>
                            <button
                                onClick={() => {
                                    setFile(null);
                                    setParsedData([]);
                                    setErrors([]);
                                }}
                                className="p-1.5 hover:bg-gray-100 rounded-md text-gray-400"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    )}

                    {errors.length > 0 && (
                        <div className="mt-6 p-4 rounded-xl bg-red-50 border border-red-100">
                            <div className="flex items-center gap-2 text-red-800 font-semibold mb-3">
                                <AlertTriangle className="w-5 h-5" />
                                Validation Errors Found
                            </div>
                            <ul className="space-y-1.5 list-disc list-inside text-sm text-red-600">
                                {errors.slice(0, 5).map((error, idx) => (
                                    <li key={idx}>{error}</li>
                                ))}
                                {errors.length > 5 && (
                                    <li className="font-medium">...and {errors.length - 5} more errors</li>
                                )}
                            </ul>
                        </div>
                    )}

                    {parsedData.length > 0 && errors.length === 0 && (
                        <div className="mt-6 p-4 rounded-xl bg-green-50 border border-green-100 flex items-center gap-3">
                            <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                            <div>
                                <p className="font-semibold text-green-800">Ready to Upload</p>
                                <p className="text-sm text-green-600">{parsedData.length} valid records found in the file.</p>
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-6 border-t border-gray-100 flex gap-3 justify-end bg-gray-50/50">
                    <GlowButton variant="secondary" onClick={onClose} disabled={isUploading}>
                        Cancel
                    </GlowButton>
                    <GlowButton
                        onClick={handleUpload}
                        disabled={parsedData.length === 0 || errors.length > 0 || isUploading}
                        icon={Upload}
                    >
                        {isUploading ? 'Uploading...' : 'Confirm Upload'}
                    </GlowButton>
                </div>
            </div>
        </div>
    );
};

export default BulkSalaryHistoryUpload;
