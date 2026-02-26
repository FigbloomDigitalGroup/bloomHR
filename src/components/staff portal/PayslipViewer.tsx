import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import {
  FileText,
  Download,
  Printer,
  ArrowLeft,
  ArrowRight,
  X,
  Calendar,
  Search,
  Filter,
  ChevronDown,
  ChevronUp,
  Users,
  DollarSign,
  Calculator,
  Eye,
  Box,
  TrendingUp,
  AlertTriangle
} from 'lucide-react';
import toast from 'react-hot-toast';
import html2pdf from 'html2pdf.js';

// HARDCODED STATUTORY SETTINGS - Updated to match payroll dashboard
const statutorySettings = {
  payeBrackets: [
    { threshold: 24000, rate: 0.10 },
    { threshold: 32333, rate: 0.25 },
    { threshold: 500000, rate: 0.30 },
    { threshold: 800000, rate: 0.325 },
    { threshold: 999999999, rate: 0.35 }
  ],
  personalRelief: 2400,
  nssfLowerLimit: 8000,
  nssfUpperLimit: 72000,
  nssfRate: 0.06,
  nssfMaximum: 4320,
  nhifRate: 0.0275, // Flat rate system - 2.75%
  housingLevyRate: 0.015,
  currency: 'KSh',
  welfareDeduction: 300
};

// UPDATED calculation functions to match payroll dashboard
const statutoryCalculations = {
  calculatePAYE: (taxableIncome) => {
    if (!taxableIncome || taxableIncome <= 0) return 0;

    let tax = 0;
    let remainingIncome = taxableIncome;

    for (let i = 0; i < statutorySettings.payeBrackets.length; i++) {
      const bracket = statutorySettings.payeBrackets[i];
      const prevBracket = i > 0 ? statutorySettings.payeBrackets[i - 1] : { threshold: 0 };

      if (remainingIncome > 0) {
        const bracketAmount = i === 0
          ? Math.min(remainingIncome, bracket.threshold)
          : Math.min(remainingIncome, bracket.threshold - prevBracket.threshold);

        tax += bracketAmount * bracket.rate;
        remainingIncome -= bracketAmount;
      }
    }

    return Number(tax.toFixed(2));
  },

  calculateNSSF: (grossSalary) => {
    if (!grossSalary || grossSalary <= 0) return 0;

    const tier1 = Math.min(grossSalary, statutorySettings.nssfLowerLimit) * statutorySettings.nssfRate;
    let tier2 = 0;

    if (grossSalary > statutorySettings.nssfLowerLimit) {
      const tier2Salary = Math.min(
        grossSalary - statutorySettings.nssfLowerLimit,
        statutorySettings.nssfUpperLimit - statutorySettings.nssfLowerLimit
      );
      tier2 = tier2Salary * statutorySettings.nssfRate;
    }

    const total = Math.min(tier1 + tier2, statutorySettings.nssfMaximum);
    return Number(total.toFixed(2));
  },

  calculateNHIF: (grossPay) => {
    if (!grossPay || grossPay <= 0) return 0;

    // UPDATED: Use taxable gross instead of gross pay (minus per diem)
    const nhif = grossPay * statutorySettings.nhifRate;
    return Number(nhif.toFixed(2));
  },

  calculateHousingLevy: (grossSalary) => {
    if (!grossSalary || grossSalary <= 0) return 0;
    const levy = grossSalary * statutorySettings.housingLevyRate;
    return Number(levy.toFixed(2));
  }
};

// UPDATED: EXACT SAME calculation logic as payroll dashboard with salary advances
const calculatePayrollValues = (employee, overrideStatutoryChecks = true, salaryAdvances = [], payPeriod = null) => {
  const basicSalary = parseFloat(employee["Basic Salary"] || employee.basic_salary || 0);
  const houseAllowance = parseFloat(employee["House Allowance"] || employee.house_allowance || 0);
  const transportAllowance = parseFloat(employee["Transport Allowance"] || employee.transport_allowance || 0);
  const medicalAllowance = parseFloat(employee["Medical Allowance"] || employee.medical_allowance || 0);
  const otherAllowances = parseFloat(employee["Other Allowances"] || employee.other_allowances || 0);
  const overtimeHours = parseFloat(employee["Overtime Hours"] || employee.overtime_hours || 0);
  const overtimeRate = parseFloat(employee["Overtime Rate"] || employee.overtime_rate || 0);
  const commission = parseFloat(employee["Commission"] || employee.commission || 0);
  const bonus = parseFloat(employee["Bonus"] || employee.bonus || 0);

  // EXACT SAME: Per diem is 33% of basic salary
  const perDiem = basicSalary * 0.33;

  // EXACT SAME: Overtime pay
  const overtimePay = overtimeHours * overtimeRate;

  // EXACT SAME: Gross pay (basic salary already includes per diem)
  const grossPay = basicSalary + houseAllowance + transportAllowance +
    medicalAllowance + otherAllowances + overtimePay +
    commission + bonus;

  // Get employee info for statutory checks
  const nhifNumber = employee["NHIF Number"] || employee.nhif_number || employee["SHIF Number"] || '';
  const nssfNumber = employee["NSSF Number"] || employee.nssf_number || '';
  const taxPin = employee["Tax PIN"] || employee.tax_pin || '';
  const employeeId = employee["Employee ID"] || employee.employee_id || employee["Employee Number"] || '';

  // EXACT SAME: Taxable amount EXCLUDES the per diem portion
  const taxableGross = grossPay - perDiem;

  // EXACT SAME: Statutory deductions with override
  let nhifDeduction = 0;
  let nssfDeduction = 0;
  let housingLevy = 0;

  if (overrideStatutoryChecks || nhifNumber) {
    nhifDeduction = statutoryCalculations.calculateNHIF(taxableGross);
  }

  if (overrideStatutoryChecks || nssfNumber) {
    nssfDeduction = statutoryCalculations.calculateNSSF(taxableGross);
  }

  if (overrideStatutoryChecks || taxPin) {
    housingLevy = statutoryCalculations.calculateHousingLevy(taxableGross);
  }

  // EXACT SAME: Calculate taxable income for PAYE AFTER deducting NSSF and Housing Levy
  const taxableIncomeForPAYE = taxableGross - nssfDeduction - housingLevy;

  let payeTax = 0;
  let taxRelief = 0;

  if (overrideStatutoryChecks || taxPin) {
    payeTax = statutoryCalculations.calculatePAYE(taxableIncomeForPAYE);
    taxRelief = Math.min(payeTax, statutorySettings.personalRelief);
    payeTax = Math.max(0, payeTax - taxRelief);
  }

  // UPDATED: Calculate salary advance deduction for CURRENT PAY PERIOD ONLY
  const calculateAdvanceDeduction = (employeeNumber) => {
    if (!employeeNumber || !salaryAdvances || salaryAdvances.length === 0) return 0;

    // Parse the pay period to get year and month
    let payPeriodYear = null;
    let payPeriodMonth = null;

    if (payPeriod) {
      // Pay period format could be "January 2026" or "2026-01" or a date string
      const periodStr = String(payPeriod);

      // Try to parse different formats
      if (periodStr.includes('-')) {
        // Format: "2026-01" or "2026-01-15"
        const parts = periodStr.split('-');
        payPeriodYear = parseInt(parts[0]);
        payPeriodMonth = parseInt(parts[1]);
      } else {
        // Format: "January 2026" or similar
        const date = new Date(periodStr);
        if (!isNaN(date.getTime())) {
          payPeriodYear = date.getFullYear();
          payPeriodMonth = date.getMonth() + 1; // getMonth() is 0-indexed
        }
      }
    }

    // Find advances for this employee in the CURRENT PAY PERIOD
    const employeeAdvances = salaryAdvances.filter(adv => {
      const advanceEmpNumber = adv["Employee Number"];
      if (advanceEmpNumber != employeeNumber) return false;

      // If we have a pay period, filter by payment date
      if (payPeriodYear && payPeriodMonth && adv.payment_date) {
        const paymentDate = new Date(adv.payment_date);
        const paymentYear = paymentDate.getFullYear();
        const paymentMonth = paymentDate.getMonth() + 1;

        // Only include advances paid in the same month/year as the payslip
        return paymentYear === payPeriodYear && paymentMonth === payPeriodMonth;
      }

      // If no pay period specified, don't include any advances (safer default)
      return false;
    });

    if (employeeAdvances.length === 0) return 0;

    // Sum advances for this employee in the current period
    const totalAmount = employeeAdvances.reduce((sum, adv) => {
      return sum + (parseFloat(adv["Amount Requested"]) || 0);
    }, 0);

    console.log(`Advance deduction for ${employeeNumber} in period ${payPeriod}: KSh ${totalAmount} (${employeeAdvances.length} advances)`);

    return totalAmount;
  };

  const advanceDeduction = calculateAdvanceDeduction(employeeId);

  // EXACT SAME: Voluntary deductions set to 0 except welfare
  const loanDeduction = 0;
  const welfareDeduction = 300; // Fixed welfare deduction
  const otherDeductions = 0;

  // EXACT SAME: Total deductions
  const totalDeductions = payeTax +
    nhifDeduction +
    nssfDeduction +
    housingLevy +
    loanDeduction +
    advanceDeduction +
    welfareDeduction +
    otherDeductions;

  const netPay = grossPay - totalDeductions;

  return {
    basicSalary,
    houseAllowance,
    transportAllowance,
    medicalAllowance,
    otherAllowances,
    overtimeHours,
    overtimeRate,
    overtimePay,
    commission,
    bonus,
    perDiem,
    grossPay,
    payeTax,
    nhifDeduction,
    nssfDeduction,
    housingLevy,
    taxRelief,
    loanDeduction,
    advanceDeduction,
    welfareDeduction,
    otherDeductions,
    totalDeductions,
    netPay,
    taxableGross,
    taxableIncomeForPAYE,
    employeeId
  };
};

// Summary Card Component (Updated to show advance deductions)
const SummaryCard = ({
  label,
  value,
  icon: Icon,
  color,
  isCount = false,
}) => {
  const colorClasses = {
    emerald: 'bg-emerald-100 text-emerald-600',
    red: 'bg-red-100 text-red-600',
    blue: 'bg-blue-100 text-blue-600',
    purple: 'bg-purple-100 text-purple-600',
    yellow: 'bg-yellow-100 text-yellow-600',
    orange: 'bg-orange-100 text-orange-600'
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className={`p-2 rounded-lg ${colorClasses[color]}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-gray-600 text-xs font-semibold uppercase tracking-wide">{label}</p>
        <p className="text-gray-900 text-lg font-normal">
          {isCount ? value : `KSh ${value.toLocaleString()}`}
        </p>
      </div>
    </div>
  );
};

// Statutory Card Component
const StatutoryCard = ({
  label,
  value,
  icon: Icon,
  color,
  rate
}) => {
  const colorClasses = {
    red: 'bg-red-100 text-red-600',
    blue: 'bg-blue-100 text-blue-600',
    green: 'bg-green-100 text-green-600',
    yellow: 'bg-yellow-100 text-yellow-600',
    purple: 'bg-purple-100 text-purple-600'
  };

  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className={`p-2 rounded-md ${colorClasses[color]}`}>
          <Icon className="w-4 h-4" />
        </div>
        <span className="text-xs font-medium text-gray-500 bg-white px-2 py-1 rounded-full">
          {rate}
        </span>
      </div>
      <div className="space-y-1">
        <p className="text-gray-600 text-xs font-semibold">{label}</p>
        <p className="text-gray-900 text-lg font-bold">KSh {Math.round(value).toLocaleString()}</p>
      </div>
    </div>
  );
};

// Glow Button Component
const GlowButton = ({
  children,
  variant = 'primary',
  icon: Icon,
  size = 'md',
  onClick,
  disabled = false
}) => {
  const baseClasses = "inline-flex items-center gap-2 rounded-lg font-medium transition-all duration-300 border";
  const sizeClasses = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-xs",
    lg: "px-6 py-3 text-base"
  };
  const variantClasses = {
    primary: "bg-green-50 border-green-500 text-green-600 hover:bg-green-100 hover:border-green-600 hover:text-green-700 hover:shadow-[0_0_20px_rgba(34,197,94,0.5)] focus:shadow-[0_0_25px_rgba(34,197,94,0.6)]",
    secondary: "bg-gray-50 hover:bg-gray-100 text-gray-700 border-gray-300 hover:border-gray-400",
    danger: "bg-red-50 border-red-500 text-red-600 hover:bg-red-100 hover:border-red-600 hover:text-red-700 hover:shadow-[0_0_20px_rgba(239,68,68,0.5)]"
  };

  return (
    <button
      className={`${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      {Icon && <Icon className="w-4 h-4" />}
      {children}
    </button>
  );
};

// PayslipModal Component (Updated with advance deduction)
const PayslipModal = ({
  record,
  onClose,
  onPrevious,
  onNext,
  companyInfo,
  overrideStatutoryChecks = true,
  salaryAdvances = []
}) => {
  // Extract pay period from record
  const payPeriod = record["Pay Period"] || record.pay_period || null;
  const calculated = calculatePayrollValues(record, overrideStatutoryChecks, salaryAdvances, payPeriod);

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <html>
          <head>
            <title>Payslip - ${record["Employee Name"] || record.employee_name}</title>
            <style>
              * { margin: 0; padding: 0; box-sizing: border-box; }
              body { 
                font-family: 'Avenir Next', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
                line-height: 1.6; 
                color: #1f2937; 
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                padding: 20px;
              }
              .payslip-container { 
                max-width: 900px; 
                margin: 0 auto; 
                background: white;
                border-radius: 20px;
                box-shadow: 0 25px 50px rgba(0, 0, 0, 0.15);
                overflow: hidden;
                position: relative;
              }
              .header-bg {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                height: 120px;
                position: relative;
              }
              .header-overlay {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(255, 255, 255, 0.1);
              }
              .header-content {
                position: relative;
                z-index: 2;
                padding: 30px 40px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                color: white;
              }
              .company-info {
                display: flex;
                align-items: center;
                gap: 20px;
              }
              .company-logo { 
                width: 60px; 
                height: 60px; 
                border-radius: 12px; 
                background: rgba(255, 255, 255, 0.2);
                padding: 8px;
                backdrop-filter: blur(10px);
              }
              .company-details h1 { 
                font-size: 28px; 
                font-weight: 800; 
                margin-bottom: 4px;
                text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
              }
              .company-tagline { 
                font-size: 14px; 
                opacity: 0.9;
                font-weight: 500;
              }
              .payslip-title {
                text-align: right;
              }
              .payslip-title h2 { 
                font-size: 24px; 
                font-weight: 700; 
                margin-bottom: 8px;
                text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
              }
              .pay-period { 
                font-size: 14px; 
                opacity: 0.9;
                background: rgba(255, 255, 255, 0.2);
                padding: 8px 16px;
                border-radius: 20px;
                backdrop-filter: blur(10px);
              }
              .content {
                padding: 40px;
              }
              .employee-section {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 30px;
                margin-bottom: 40px;
                padding-bottom: 30px;
                border-bottom: 2px solid #f3f4f6;
              }
              .info-card {
                background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
                padding: 25px;
                border-radius: 16px;
                box-shadow: 0 4px 15px rgba(0, 0, 0, 0.05);
                border: 1px solid #e2e8f0;
              }
              .info-card h3 {
                font-size: 14px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                color: #6366f1;
                margin-bottom: 15px;
              }
              .info-item {
                display: flex;
                justify-content: space-between;
                margin-bottom: 8px;
                font-size: 14px;
              }
              .info-label {
                color: #6b7280;
                font-weight: 500;
              }
              .info-value {
                font-weight: 600;
                color: #1f2937;
              }
              .section {
                margin-bottom: 35px;
              }
              .section-header {
                background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
                color: white;
                padding: 15px 25px;
                border-radius: 12px;
                margin-bottom: 20px;
                font-weight: 700;
                font-size: 16px;
                text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
              }
              .earnings-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                gap: 20px;
                margin-bottom: 25px;
              }
              .earning-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 15px 20px;
                background: #f8fafc;
                border-radius: 10px;
                border-left: 4px solid #10b981;
                transition: all 0.3s ease;
              }
              .earning-item:hover {
                background: #ecfdf5;
                transform: translateY(-2px);
                box-shadow: 0 5px 15px rgba(0, 0, 0, 0.08);
              }
              .earning-label {
                font-weight: 500;
                color: #374151;
              }
              .earning-amount {
                font-weight: 700;
                color: #059669;
                font-size: 16px;
              }
              .deduction-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 15px 20px;
                background: #fef2f2;
                border-radius: 10px;
                border-left: 4px solid #ef4444;
                margin-bottom: 12px;
                transition: all 0.3s ease;
              }
              .deduction-item:hover {
                background: #fee2e2;
                transform: translateY(-2px);
                box-shadow: 0 5px 15px rgba(0, 0, 0, 0.08);
              }
              .deduction-label {
                font-weight: 500;
                color: #374151;
              }
              .deduction-amount {
                font-weight: 700;
                color: #dc2626;
                font-size: 16px;
              }
              .summary-section {
                background: linear-gradient(135deg, #1f2937 0%, #374151 100%);
                color: white;
                padding: 30px;
                border-radius: 16px;
                margin-bottom: 30px;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
              }
              .summary-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 15px 0;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
              }
              .summary-row:last-child {
                border-bottom: none;
                border-top: 2px solid rgba(255, 255, 255, 0.2);
                margin-top: 15px;
                font-size: 20px;
                font-weight: 800;
              }
              .net-pay {
                background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                font-size: 24px;
              }
              .signature-section {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 40px;
                margin-top: 50px;
                padding-top: 30px;
                border-top: 2px solid #f3f4f6;
              }
              .signature-box {
                text-align: center;
              }
              .signature-line {
                border-top: 2px solid #374151;
                margin-bottom: 10px;
                width: 200px;
                margin: 40px auto 10px;
              }
              .signature-label {
                font-weight: 600;
                color: #6b7280;
                margin-bottom: 5px;
              }
              .footer {
                text-align: center;
                margin-top: 40px;
                padding: 25px;
                background: #f8fafc;
                border-radius: 12px;
                color: #6b7280;
                font-size: 12px;
                border: 1px solid #e5e7eb;
              }
              .footer-line {
                margin-bottom: 5px;
              }
              @media print {
                body { 
                  background: white;
                  padding: 0;
                }
                .no-print { display: none !important; }
                .payslip-container { 
                  box-shadow: none;
                  border-radius: 0;
                }
              }
            </style>
          </head>
          <body>
            ${document.getElementById('payslip-content')?.innerHTML}
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 500);
    }
  };

  const handleDownloadPDF = () => {
    const element = document.getElementById('payslip-content');
    const opt = {
      margin: 0.5,
      filename: `payslip_${record["Employee ID"] || record.employee_id}_${record["Pay Period"] || record.pay_period}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
    };

    html2pdf().from(element).set(opt).save();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-6xl max-h-[90vh] overflow-auto">
        <div className="sticky top-0 bg-white p-4 border-b border-gray-200 flex justify-between items-center z-10">
          <h2 className="text-xl font-semibold text-gray-900">Modern Payslip</h2>
          <div className="flex gap-2">
            <GlowButton
              variant="secondary"
              icon={Download}
              size="sm"
              onClick={handleDownloadPDF}
            >
              Download PDF
            </GlowButton>
            <GlowButton
              variant="danger"
              icon={X}
              size="sm"
              onClick={onClose}
            >
              Close
            </GlowButton>
          </div>
        </div>

        <div className="p-2 bg-gray-50 payslip-container print:p-0 print:w-[210mm] print:h-[297mm]">
          <div id="payslip-content" className="bg-white rounded-lg shadow-lg overflow-hidden text-xs leading-tight">
            <div className="bg-gray-800 text-white p-4 flex justify-between items-center">
              <div className="flex items-center">
                {companyInfo?.image_url && (
                  <img src={companyInfo.image_url} alt="Company Logo" className="h-12 w-12 mr-3 bg-white p-1 rounded" />
                )}
                <div>
                  <h1 className="text-lg font-bold">{companyInfo?.company_name || 'Your Company Name'}</h1>
                  <div className="text-gray-300 text-xs">{companyInfo?.company_tagline || 'Excellence in Service'}</div>
                </div>
              </div>
              <div className="text-right">
                <h2 className="text-xl font-bold">PAYSLIP</h2>
                <div className="text-gray-300 text-xs">
                  {record["Pay Period"] || record.pay_period ?
                    new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'N/A'}
                </div>
              </div>
            </div>

            <div className="p-4">
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="border p-3 rounded">
                  <h3 className="font-semibold border-b mb-2">EMPLOYEE INFORMATION</h3>
                  <div className="space-y-1">
                    <div className="flex justify-between"><span>Full Name:</span><span>{record["Employee Name"] || record.employee_name || 'N/A'}</span></div>
                    <div className="flex justify-between"><span>Employee No:</span><span>{record["Employee ID"] || record.employee_id || 'N/A'}</span></div>
                    <div className="flex justify-between"><span>Position:</span><span>{record["Position"] || record.position || 'N/A'}</span></div>
                    <div className="flex justify-between"><span>Dept:</span><span>Operations</span></div>
                    <div className="flex justify-between"><span>Region:</span><span>{record["Branch"] || record.branch || 'N/A'}</span></div>
                  </div>
                </div>

                <div className="border p-3 rounded">
                  <h3 className="font-semibold border-b mb-2">PAYMENT DETAILS</h3>
                  <div className="space-y-1">
                    <div className="flex justify-between"><span>Method:</span><span>{record["Payment Method"] || record.payment_method || 'M-Pesa'}</span></div>
                    {(record["Payment Method"] || record.payment_method) === 'Bank Transfer' && (
                      <>
                        <div className="flex justify-between"><span>Bank:</span><span>{record["Bank Name"] || record.bank_name || 'N/A'}</span></div>
                        <div className="flex justify-between"><span>Account:</span><span>{record["Account Number"] || record.account_number || 'N/A'}</span></div>
                      </>
                    )}
                    {(record["Payment Method"] || record.payment_method) === 'M-Pesa' && (
                      <div className="flex justify-between"><span>M-Pesa No:</span><span>{record["Phone Number"] || record.employeeNu || 'N/A'}</span></div>
                    )}
                    <div className="flex justify-between"><span>Job Group:</span><span>{record["Job Group"] || record.jobGroup || 'N/A'}</span></div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="border rounded">
                  <div className="bg-gray-200 font-semibold p-2">EARNINGS</div>
                  <div className="p-2 space-y-1">
                    <div className="flex justify-between"><span>Basic</span><span>KSh {calculated.basicSalary.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>House</span><span>KSh {calculated.houseAllowance.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Transport</span><span>KSh {calculated.transportAllowance.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Medical</span><span>KSh {calculated.medicalAllowance.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Other</span><span>KSh {calculated.otherAllowances.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Overtime</span><span>KSh {calculated.overtimePay.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Commission</span><span>KSh {calculated.commission.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Bonus</span><span>KSh {calculated.bonus.toLocaleString()}</span></div>
                    <div className="flex justify-between bg-yellow-50 p-1"><span>Per Diem</span><span>KSh {calculated.perDiem.toLocaleString()}</span></div>
                  </div>
                </div>

                <div className="border rounded">
                  <div className="bg-gray-200 font-semibold p-2">DEDUCTIONS</div>
                  <div className="p-2 space-y-1">
                    <div className="flex justify-between"><span>PAYE</span><span>KSh {Math.round(calculated.payeTax).toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>SHIF</span><span>KSh {calculated.nhifDeduction.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>NSSF</span><span>KSh {calculated.nssfDeduction.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>AHL</span><span>KSh {calculated.housingLevy.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Loan</span><span>KSh {calculated.loanDeduction.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Advance</span><span>KSh {calculated.advanceDeduction.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Welfare</span><span>KSh {calculated.welfareDeduction.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Other</span><span>KSh {calculated.otherDeductions.toLocaleString()}</span></div>
                    <div className="flex justify-between text-green-600"><span>Tax Relief:</span><span>KSh -2400</span></div>
                  </div>
                </div>
              </div>

              <div className="border p-3 rounded mb-4">
                <div className="flex justify-between border-b pb-1"><span>Gross Pay</span><span>KSh {calculated.grossPay.toLocaleString()}</span></div>
                <div className="flex justify-between border-b pb-1"><span>Total Deductions</span><span className="text-red-600">KSh {calculated.totalDeductions.toLocaleString()}</span></div>
                <div className="flex justify-between font-bold text-green-700"><span>NET PAY</span><span>KSh {Math.round(calculated.netPay).toLocaleString()}</span></div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4 text-center text-xs">
                <div className="border border-dashed p-2">Employee Signature<br />Date: __________</div>
                <div className="border border-dashed p-2">Authorized Signatory<br />Date: __________</div>
              </div>

              <div className="text-center text-gray-500 text-xs">
                Generated on {new Date().toLocaleDateString()} {new Date().toLocaleTimeString()} • {companyInfo?.company_name || 'Company'} • Confidential
              </div>
            </div>
          </div>
        </div>

        {(onPrevious || onNext) && (
          <div className="sticky bottom-0 bg-white p-4 border-t border-gray-200 flex justify-between">
            {onPrevious && (
              <GlowButton icon={ArrowLeft} onClick={onPrevious}>
                Previous
              </GlowButton>
            )}
            {onNext && (
              <GlowButton icon={ArrowRight} onClick={onNext} className="ml-auto">
                Next
              </GlowButton>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// Main PayslipViewer Component
const PayslipViewer = () => {
  const [payslips, setPayslips] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPayslip, setSelectedPayslip] = useState(null);
  const [currentPayslipIndex, setCurrentPayslipIndex] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPeriod, setSelectedPeriod] = useState('all');
  const [companyInfo, setCompanyInfo] = useState(null);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [showSummary, setShowSummary] = useState(false);
  const [overrideStatutoryChecks, setOverrideStatutoryChecks] = useState(true);
  const [salaryAdvances, setSalaryAdvances] = useState<any[]>([]);

  useEffect(() => {
    fetchPayslips();
    fetchCompanyInfo();
    fetchSalaryAdvances();
  }, []);

  const fetchSalaryAdvances = async () => {
    try {
      console.log('Fetching salary advances for payslip viewer...');

      const { data, error } = await supabase
        .from('salary_advance')
        .select('"Employee Number", "Amount Requested", payment_processed, status, payment_date')
        .eq('payment_processed', 'true')
        .eq('status', 'paid')
        .order('time_added', { ascending: false });

      if (error) {
        console.warn('Salary advances fetch error:', error.message);
        setSalaryAdvances([]);
        return;
      }

      console.log(`Loaded ${data?.length || 0} salary advances for payslip viewer`);
      setSalaryAdvances(data || []);

    } catch (error) {
      console.warn('Failed to load salary advances:', error.message);
      setSalaryAdvances([]);
    }
  };

  const fetchPayslips = async () => {
    try {
      setIsLoading(true);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) return;

      const { data: employeeData } = await supabase
        .from('employees')
        .select('"Employee Number"')
        .eq('"Work Email"', user.email)
        .single();

      if (!employeeData) return;

      // Try to get data from the current view first
      const { data: currentData, error: currentError } = await supabase
        .from('payroll_records_current')
        .select('*')
        .eq('"Employee ID"', employeeData["Employee Number"])
        .order('"Pay Period"', { ascending: false });

      let data = [];

      if (!currentError && currentData) {
        data = currentData;
      } else {
        // Fallback to payroll_records table
        const { data: recordsData, error: recordsError } = await supabase
          .from('payroll_records')
          .select('*')
          .eq('"Employee ID"', employeeData["Employee Number"])
          .order('"Pay Period"', { ascending: false });

        if (!recordsError && recordsData) {
          data = recordsData;
        } else {
          // Final fallback to payroll_data table
          const { data: payrollData, error: payrollError } = await supabase
            .from('payroll_data')
            .select('*')
            .eq('employee_id', employeeData["Employee Number"])
            .order('pay_period', { ascending: false });

          if (!payrollError && payrollData) {
            data = payrollData;
          } else {
            throw currentError || recordsError || payrollError;
          }
        }
      }

      setPayslips(data || []);
    } catch (error) {
      console.error('Error fetching payslips:', error);
      toast.error('Failed to load payslips');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchCompanyInfo = async () => {
    try {
      const { data, error } = await supabase
        .from('company_logo')
        .select('*')
        .order('id', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching company info:', error);
        return;
      }

      if (data) {
        setCompanyInfo(data);
      }
    } catch (err) {
      console.error('Error:', err);
    }
  };

  const handleViewPayslip = (payslip, index) => {
    setSelectedPayslip(payslip);
    setCurrentPayslipIndex(index);
  };

  const handleNavigatePayslip = (direction) => {
    if (currentPayslipIndex === null || !selectedPayslip) return;

    const newIndex = direction === 'prev' ? currentPayslipIndex - 1 : currentPayslipIndex + 1;

    if (newIndex >= 0 && newIndex < filteredPayslips.length) {
      setSelectedPayslip(filteredPayslips[newIndex]);
      setCurrentPayslipIndex(newIndex);
    }
  };

  const toggleRowExpand = (id, e) => {
    e.stopPropagation();
    setExpandedRows(prev => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(id)) {
        newExpanded.delete(id);
      } else {
        newExpanded.add(id);
      }
      return newExpanded;
    });
  };

  // Calculate summary totals including advance deductions
  const calculateSummaryTotals = () => {
    const totals = filteredPayslips.reduce((acc, payslip) => {
      const payPeriod = payslip["Pay Period"] || payslip.pay_period || null;
      const calculated = calculatePayrollValues(payslip, overrideStatutoryChecks, salaryAdvances, payPeriod);
      return {
        totalGrossPay: acc.totalGrossPay + calculated.grossPay,
        totalDeductions: acc.totalDeductions + calculated.totalDeductions,
        totalNetPay: acc.totalNetPay + calculated.netPay,
        totalPAYE: acc.totalPAYE + calculated.payeTax,
        totalNHIF: acc.totalNHIF + calculated.nhifDeduction,
        totalNSSF: acc.totalNSSF + calculated.nssfDeduction,
        totalHousingLevy: acc.totalHousingLevy + calculated.housingLevy,
        totalAdvanceDeductions: acc.totalAdvanceDeductions + calculated.advanceDeduction,
      };
    }, {
      totalGrossPay: 0,
      totalDeductions: 0,
      totalNetPay: 0,
      totalPAYE: 0,
      totalNHIF: 0,
      totalNSSF: 0,
      totalHousingLevy: 0,
      totalAdvanceDeductions: 0,
    });

    return totals;
  };

  // Filter payslips based on search and period
  const filteredPayslips = payslips.filter(payslip => {
    const employeeName = payslip["Employee Name"] || payslip.employee_name || '';
    const employeeId = payslip["Employee ID"] || payslip.employee_id || '';
    const payPeriod = payslip["Pay Period"] || payslip.pay_period || '';

    const matchesSearch = !searchTerm.trim() ||
      employeeName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      employeeId.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesPeriod = selectedPeriod === 'all' || payPeriod === selectedPeriod;

    return matchesSearch && matchesPeriod;
  });

  const getUniquePeriods = () => {
    const periods = [...new Set(payslips.map(p => p["Pay Period"] || p.pay_period).filter(Boolean))];
    return periods.sort((a, b) => new Date(b + '-01') - new Date(a + '-01'));
  };

  const summaryTotals = calculateSummaryTotals();

  if (isLoading) {
    return (
      <div className="p-8 flex justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-green-600"></div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 bg-gray-50 min-h-screen">
      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-1">My Payslips</h1>
            <p className="text-gray-600 text-xs">View and download your payroll payslips</p>
            {summaryTotals.totalAdvanceDeductions > 0 && (
              <p className="text-xs text-orange-600 mt-1">
                Total Salary Advance Deductions: KSh {summaryTotals.totalAdvanceDeductions.toLocaleString()}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2 w-full md:w-auto">
            {/* <GlowButton 
              icon={showSummary ? ChevronUp : ChevronDown} 
              size="sm" 
              onClick={() => setShowSummary(!showSummary)}
            >
              {showSummary ? 'Hide Summary' : 'Show Summary'}
            </GlowButton> */}
          </div>
        </div>
      </div>

      {/* System Info */}
      {/* <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-xs">
        <div className="flex items-center gap-2 mb-2">
          <Calculator className="w-4 h-4 text-green-600" />
          <span className="font-semibold text-green-800">Current System: HARDCODED FLAT RATE</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-green-700">
          <div><strong>NHIF Rate:</strong> 2.75%</div>
          <div><strong>SHIF Calculation:</strong> Taxable Gross × 2.75%</div>
          <div><strong>Statutory Override:</strong> {overrideStatutoryChecks ? 'Enabled' : 'Disabled'}</div>
          <div><strong>Welfare Deduction:</strong> KSh 300</div>
        </div>
      </div> */}

      {/* Summary Cards - Updated with advance deductions */}
      {showSummary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard
            label="Total Gross Pay"
            value={summaryTotals.totalGrossPay}
            icon={DollarSign}
            color="emerald"
          />
          <SummaryCard
            label="Total Deductions"
            value={summaryTotals.totalDeductions}
            icon={Box}
            color="red"
          />
          <SummaryCard
            label="Total Net Pay"
            value={summaryTotals.totalNetPay}
            icon={Calculator}
            color="blue"
          />
          <SummaryCard
            label="Advance Deductions"
            value={summaryTotals.totalAdvanceDeductions}
            icon={AlertTriangle}
            color="orange"
          />
        </div>
      )}

      {/* Statutory Summary */}
      {showSummary && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Statutory Deductions Summary</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatutoryCard label="Total PAYE Tax" value={summaryTotals.totalPAYE} icon={FileText} color="red" rate="Progressive rates" />
            <StatutoryCard label="Total NSSF" value={summaryTotals.totalNSSF} icon={Calculator} color="blue" rate="6% (Tiered)" />
            <StatutoryCard label="Total SHIF" value={summaryTotals.totalNHIF} icon={TrendingUp} color="purple" rate="2.75%" />
            <StatutoryCard label="Housing Levy" value={summaryTotals.totalHousingLevy} icon={DollarSign} color="yellow" rate="1.5%" />
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                placeholder="Search payslips..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">Pay Period</label>
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="w-full px-4 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
            >
              <option value="all">All Periods</option>
              {getUniquePeriods().map(period => (
                <option key={period} value={period}>
                  {new Date(period + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">Total Records</label>
            <div className="px-4 py-2 text-xs bg-gray-50 rounded-lg border border-gray-300">
              {filteredPayslips.length} payslip{filteredPayslips.length !== 1 ? 's' : ''} found
            </div>
          </div>
        </div>
      </div>

      {/* Payslips Table - Updated with advance deduction column */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-4 md:p-6 border-b border-gray-200">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Payslip History</h2>
              <p className="text-gray-600 text-xs">{filteredPayslips.length} records found</p>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="sticky left-0 z-10 bg-gray-50 px-4 py-3 text-left text-gray-700 font-semibold">Pay Period</th>
                <th className="px-4 py-3 text-left text-gray-700 font-semibold">Employee</th>
                <th className="px-4 py-3 text-right text-gray-700 font-semibold">Gross Pay</th>
                <th className="px-4 py-3 text-right text-gray-700 font-semibold">Per Diem</th>
                <th className="px-4 py-3 text-right text-gray-700 font-semibold">PAYE</th>
                <th className="px-4 py-3 text-right text-gray-700 font-semibold">SHIF</th>
                <th className="px-4 py-3 text-right text-gray-700 font-semibold">NSSF</th>
                <th className="px-4 py-3 text-right text-gray-700 font-semibold">AHL</th>
                <th className="px-4 py-3 text-right text-gray-700 font-semibold">Advance</th>
                <th className="px-4 py-3 text-right text-gray-700 font-semibold">Total Deductions</th>
                <th className="px-4 py-3 text-right text-gray-700 font-semibold">Net Pay</th>
                <th className="sticky right-0 z-10 bg-gray-50 px-4 py-3 text-center text-gray-700 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredPayslips.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-gray-500">
                    No payslips found. {payslips.length === 0 ? 'You have no payslip records yet.' : 'Try adjusting your search filters.'}
                  </td>
                </tr>
              ) : (
                filteredPayslips.map((payslip, index) => {
                  const isExpanded = expandedRows.has(payslip.id);
                  const payPeriod = payslip["Pay Period"] || payslip.pay_period || null;
                  const calculated = calculatePayrollValues(payslip, overrideStatutoryChecks, salaryAdvances, payPeriod);

                  return (
                    <React.Fragment key={payslip.id}>
                      <tr className="border-b border-gray-200 hover:bg-gray-50">
                        <td className="sticky left-0 z-10 bg-white px-4 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <button
                              onClick={(e) => toggleRowExpand(payslip.id, e)}
                              className="mr-2 text-gray-500 hover:text-gray-700"
                            >
                              {isExpanded ? (
                                <ChevronUp className="w-4 h-4" />
                              ) : (
                                <ChevronDown className="w-4 h-4" />
                              )}
                            </button>
                            <div>
                              <div className="font-medium text-gray-900">
                                {payslip["Pay Period"] || payslip.pay_period ?
                                  (() => {
                                    const period = payslip["Pay Period"] || payslip.pay_period;
                                    const [year, month] = period.split('-').map(Number);

                                    // Calculate previous month
                                    let prevMonth = month - 1;
                                    let prevYear = year;

                                    if (prevMonth === 0) {
                                      prevMonth = 12;
                                      prevYear = year - 1;
                                    }

                                    const prevMonthDate = new Date(prevYear, prevMonth - 1, 1);

                                    // Show both period and previous month
                                    const currentMonth = new Date(year, month - 1, 1).toLocaleDateString('en-US', {
                                      month: 'long',
                                      year: 'numeric'
                                    });

                                    return `${prevMonthDate.toLocaleDateString('en-US', {
                                      month: 'long',
                                      year: 'numeric'
                                    })} `;
                                  })() : 'N/A'}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div>
                            <div className="font-medium text-gray-900">{payslip["Employee Name"] || payslip.employee_name || 'N/A'}</div>
                            <div className="text-gray-500 text-xs">{payslip["Employee ID"] || payslip.employee_id || 'N/A'}</div>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-right font-bold text-green-600">
                          KSh {calculated.grossPay.toLocaleString()}
                        </td>
                        <td className="px-4 py-4 text-right font-bold text-yellow-600">
                          KSh {calculated.perDiem.toLocaleString()}
                        </td>
                        <td className="px-4 py-4 text-right text-red-600">
                          KSh {Math.round(calculated.payeTax).toLocaleString()}
                        </td>
                        <td className="px-4 py-4 text-right text-purple-600">
                          KSh {calculated.nhifDeduction.toLocaleString()}
                        </td>
                        <td className="px-4 py-4 text-right text-blue-600">
                          KSh {calculated.nssfDeduction.toLocaleString()}
                        </td>
                        <td className="px-4 py-4 text-right text-yellow-600">
                          KSh {calculated.housingLevy.toLocaleString()}
                        </td>
                        <td className="px-4 py-4 text-right text-orange-600">
                          KSh {calculated.advanceDeduction.toLocaleString()}
                        </td>
                        <td className="px-4 py-4 text-right font-bold text-red-600">
                          KSh {calculated.totalDeductions.toLocaleString()}
                        </td>
                        <td className="px-4 py-4 text-right font-bold text-green-700">
                          KSh {Math.round(calculated.netPay).toLocaleString()}
                        </td>
                        <td className="sticky right-0 z-10 bg-white px-4 py-4 text-center">
                          <GlowButton
                            variant="primary"
                            icon={Eye}
                            size="sm"
                            onClick={() => handleViewPayslip(payslip, index)}
                          >
                            View
                          </GlowButton>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-gray-50">
                          <td colSpan={12} className="px-4 py-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                              <div className="space-y-2">
                                <h4 className="font-medium text-gray-900">Earnings</h4>
                                <div className="flex justify-between">
                                  <span>Basic Salary:</span>
                                  <span>KSh {calculated.basicSalary.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span>House Allowance:</span>
                                  <span>KSh {calculated.houseAllowance.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span>Transport Allowance:</span>
                                  <span>KSh {calculated.transportAllowance.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span>Overtime Pay:</span>
                                  <span>KSh {calculated.overtimePay.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between font-bold bg-yellow-50 p-1">
                                  <span>Per Diem:</span>
                                  <span>KSh {calculated.perDiem.toLocaleString()}</span>
                                </div>
                              </div>

                              <div className="space-y-2">
                                <h4 className="font-medium text-gray-900">Statutory Deductions</h4>
                                <div className="flex justify-between">
                                  <span>PAYE:</span>
                                  <span className="text-red-600">KSh {Math.round(calculated.payeTax).toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span>SHIF:</span>
                                  <span className="text-red-600">KSh {calculated.nhifDeduction.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span>NSSF:</span>
                                  <span className="text-red-600">KSh {calculated.nssfDeduction.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span>Housing Levy:</span>
                                  <span className="text-red-600">KSh {calculated.housingLevy.toLocaleString()}</span>
                                </div>
                              </div>

                              <div className="space-y-2">
                                <h4 className="font-medium text-gray-900">Other Deductions</h4>
                                <div className="flex justify-between">
                                  <span>Advance Deduction:</span>
                                  <span className="text-red-600">KSh {calculated.advanceDeduction.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span>Welfare:</span>
                                  <span className="text-red-600">KSh {calculated.welfareDeduction.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between text-green-600">
                                  <span>Tax Relief:</span>
                                  <span>KSh -{calculated.taxRelief.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between font-medium">
                                  <span>Total Deductions:</span>
                                  <span className="text-red-600">KSh {calculated.totalDeductions.toLocaleString()}</span>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payslip Modal */}
      {selectedPayslip && (
        <PayslipModal
          record={selectedPayslip}
          onClose={() => setSelectedPayslip(null)}
          onPrevious={currentPayslipIndex !== null && currentPayslipIndex > 0 ?
            () => handleNavigatePayslip('prev') : undefined}
          onNext={currentPayslipIndex !== null && currentPayslipIndex < filteredPayslips.length - 1 ?
            () => handleNavigatePayslip('next') : undefined}
          companyInfo={companyInfo}
          overrideStatutoryChecks={overrideStatutoryChecks}
          salaryAdvances={salaryAdvances}
        />
      )}
    </div>
  );
};

export default PayslipViewer;