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
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

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
  nssfLowerLimit: 9000,
  nssfUpperLimit: 108000,
  nssfRate: 0.06,
  nssfMaximum: 6480,
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
              * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Calibri', 'Helvetica', sans-serif; }
              body { background: white; color: black; padding: 40px; font-size: 11px; }
              .payslip-container { max-width: 800px; margin: 0 auto; background: white; }
              .flex { display: flex; }
              .justify-between { justify-content: space-between; }
              .items-center { align-items: center; }
              .items-end { align-items: flex-end; }
              .grid { display: grid; }
              .grid-cols-2 { grid-template-columns: 1fr 1fr; }
              .gap-6 { gap: 1.5rem; }
              .gap-8 { gap: 2rem; }
              .mb-1 { margin-bottom: 0.25rem; }
              .mb-2 { margin-bottom: 0.5rem; }
              .mb-3 { margin-bottom: 0.75rem; }
              .mb-4 { margin-bottom: 1rem; }
              .mb-6 { margin-bottom: 1.5rem; }
              .mb-8 { margin-bottom: 2rem; }
              .mt-1 { margin-top: 0.25rem; }
              .mt-2 { margin-top: 0.5rem; }
              .mt-6 { margin-top: 1.5rem; }
              .border { border: 1px solid #9ca3af; }
              .border-b { border-bottom: 1px solid #d1d5db; }
              .border-b-3 { border-bottom: 3px solid #6b7280; }
              .border-t { border-top: 1px solid #9ca3af; }
              .border-gray-300 { border-color: #d1d5db; }
              .border-gray-400 { border-color: #9ca3af; }
              .border-gray-500 { border-color: #6b7280; }
              .border-double { border-style: double; }
              .p-1 { padding: 0.25rem; }
              .p-2 { padding: 0.5rem; }
              .p-3 { padding: 0.75rem; }
              .p-4 { padding: 1rem; }
              .p-6 { padding: 1.5rem; }
              .pb-2 { padding-bottom: 0.5rem; }
              .pt-1 { padding-top: 0.25rem; }
              .pt-2 { padding-top: 0.5rem; }
              .pt-4 { padding-top: 1rem; }
              .pt-8 { padding-top: 2rem; }
              .px-6 { padding-left: 1.5rem; padding-right: 1.5rem; }
              .font-bold { font-weight: 700; }
              .font-semibold { font-weight: 600; }
              .text-right { text-align: right; }
              .text-center { text-align: center; }
              .text-sm { font-size: 0.875rem; }
              .text-lg { font-size: 1.125rem; }
              .text-xl { font-size: 1.25rem; }
              .text-2xl { font-size: 1.5rem; }
              .text-3xl { font-size: 1.875rem; }
              .uppercase { text-transform: uppercase; }
              .bg-white { background-color: white; }
              .bg-gray-50 { background-color: #f9fafb; border: 1px solid #e5e7eb; }
              .bg-gray-100 { background-color: #f3f4f6; }
              .text-black { color: #000; }
              .text-gray-500 { color: #6b7280; }
              .text-gray-600 { color: #4b5563; }
              .text-gray-800 { color: #1f2937; }
              .text-gray-900 { color: #111827; }
              .space-y-1 > * + * { margin-top: 0.25rem; }
              .space-y-1\.5 > * + * { margin-top: 0.375rem; }
              .space-y-2 > * + * { margin-top: 0.5rem; }
              .mr-4 { margin-right: 1rem; }
              .h-16 { height: 4rem; }
              .w-16 { width: 4rem; }
              .object-contain { object-fit: contain; }
              .mx-auto { margin-left: auto; margin-right: auto; }
              .leading-tight { line-height: 1.25; }
              @media print {
                body { padding: 0; }
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
          <div id="payslip-content" className="bg-white border text-black border-gray-300 text-xs leading-tight mx-auto" style={{ maxWidth: '800px', boxShadow: '0 4px 15px rgba(0, 0, 0, 0.05)', fontFamily: 'Calibri, Helvetica, sans-serif' }}>
            <div className="bg-white text-black p-6 flex justify-between items-end border-b-[3px] border-double border-gray-300">
              <div className="flex items-center">
                {companyInfo?.image_url && (
                  <img src={companyInfo.image_url} alt="Company Logo" className="h-16 w-16 mr-4 object-contain" />
                )}
                <div>
                  <h1 className="text-2xl font-bold uppercase text-gray-900">{companyInfo?.company_name || 'Your Company Name'}</h1>
                  <div className="text-gray-600 text-sm font-semibold mt-1">{companyInfo?.company_tagline || 'Excellence in service'}</div>
                </div>
              </div>
              <div className="text-right">
                <h2 className="text-3xl font-bold uppercase text-gray-900 mb-1">PAYSLIP</h2>
                <div className="text-gray-600 font-semibold text-sm">
                  {payPeriod ? (() => {
                    const [year, month] = String(payPeriod).split('-').map(Number);
                    let prevMonth = month - 1;
                    let prevYear = year;
                    if (prevMonth === 0) { prevMonth = 12; prevYear = year - 1; }
                    return new Date(prevYear, prevMonth - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                  })() : 'N/A'}
                </div>
              </div>
            </div>

            <div className="p-6">
              <div className="grid grid-cols-2 gap-6 mb-6">
                <div className="border border-gray-300 p-4">
                  <h3 className="font-bold border-b border-gray-300 pb-2 mb-3 text-gray-900 text-sm">Employee information</h3>
                  <div className="space-y-1.5 text-black">
                    <div className="flex justify-between"><span className="font-semibold text-gray-600">Full name:</span><span className="font-bold text-right">{record["Employee Name"] || record.employee_name || 'N/A'}</span></div>
                    <div className="flex justify-between"><span className="font-semibold text-gray-600">Employee no:</span><span className="font-bold text-right">{record["Employee ID"] || record.employee_id || 'N/A'}</span></div>
                    <div className="flex justify-between"><span className="font-semibold text-gray-600">Position:</span><span className="font-bold text-right">{record["Position"] || record.position || 'N/A'}</span></div>
                    <div className="flex justify-between"><span className="font-semibold text-gray-600">Dept:</span><span className="font-bold text-right">Operations</span></div>
                    <div className="flex justify-between"><span className="font-semibold text-gray-600">Region:</span><span className="font-bold text-right">{record["Branch"] || record.branch || 'N/A'}</span></div>
                  </div>
                </div>

                <div className="border border-gray-300 p-4">
                  <h3 className="font-bold border-b border-gray-300 pb-2 mb-3 text-gray-900 text-sm">Payment details</h3>
                  <div className="space-y-1.5 text-black">
                    <div className="flex justify-between"><span className="font-semibold text-gray-600">Method:</span><span className="font-bold text-right">{record["Payment Method"] || record.payment_method || 'M-Pesa'}</span></div>
                    {(record["Payment Method"] || record.payment_method) === 'Bank Transfer' && (
                      <>
                        <div className="flex justify-between"><span className="font-semibold text-gray-600">Bank:</span><span className="font-bold text-right">{record["Bank Name"] || record.bank_name || 'N/A'}</span></div>
                        <div className="flex justify-between"><span className="font-semibold text-gray-600">Account:</span><span className="font-bold text-right">{record["Account Number"] || record.account_number || 'N/A'}</span></div>
                      </>
                    )}
                    {(record["Payment Method"] || record.payment_method) === 'M-Pesa' && (
                      <div className="flex justify-between"><span className="font-semibold text-gray-600">M-Pesa no:</span><span className="font-bold text-right">{record["Phone Number"] || record.employeeNu || 'N/A'}</span></div>
                    )}
                    <div className="flex justify-between"><span className="font-semibold text-gray-600">Job group:</span><span className="font-bold text-right">{record["Job Group"] || record.jobGroup || 'N/A'}</span></div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6 mb-6">
                <div className="border border-gray-300">
                  <div className="bg-gray-100 border-b border-gray-300 font-bold p-3 text-gray-900">Earnings</div>
                  <div className="p-3 space-y-2 text-black">
                    <div className="flex justify-between"><span>Basic</span><span className="font-semibold">KSh {calculated.basicSalary.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>House</span><span className="font-semibold">KSh {calculated.houseAllowance.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Transport</span><span className="font-semibold">KSh {calculated.transportAllowance.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Medical</span><span className="font-semibold">KSh {calculated.medicalAllowance.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Other</span><span className="font-semibold">KSh {calculated.otherAllowances.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Overtime</span><span className="font-semibold">KSh {calculated.overtimePay.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Commission</span><span className="font-semibold">KSh {calculated.commission.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Bonus</span><span className="font-semibold">KSh {calculated.bonus.toLocaleString()}</span></div>
                    <div className="flex justify-between bg-gray-50 p-1 border border-gray-200 mt-2"><span>Per diem</span><span className="font-bold">KSh {calculated.perDiem.toLocaleString()}</span></div>
                  </div>
                </div>

                <div className="border border-gray-300">
                  <div className="bg-gray-100 border-b border-gray-300 font-bold p-3 text-gray-900">Deductions</div>
                  <div className="p-3 space-y-2 text-black">
                    <div className="flex justify-between"><span>PAYE</span><span className="font-semibold">KSh {Math.round(calculated.payeTax).toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>SHIF</span><span className="font-semibold">KSh {calculated.nhifDeduction.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>NSSF</span><span className="font-semibold">KSh {calculated.nssfDeduction.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>AHL</span><span className="font-semibold">KSh {calculated.housingLevy.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Loan</span><span className="font-semibold">KSh {calculated.loanDeduction.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Advance</span><span className="font-semibold">KSh {calculated.advanceDeduction.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Welfare</span><span className="font-semibold">KSh {calculated.welfareDeduction.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span>Other</span><span className="font-semibold">KSh {calculated.otherDeductions.toLocaleString()}</span></div>
                    <div className="flex justify-between text-gray-600 mt-2 border-t border-gray-200 pt-1"><span>Tax relief:</span><span className="font-semibold">KSh -2400</span></div>
                  </div>
                </div>
              </div>

              <div className="border border-gray-300 p-4 mb-8 bg-gray-50">
                <div className="flex justify-between border-b border-gray-300 pb-2 mb-2 text-sm text-black">
                  <span className="font-bold">Gross pay</span>
                  <span className="font-bold">KSh {calculated.grossPay.toLocaleString()}</span>
                </div>
                <div className="flex justify-between border-b border-gray-300 pb-2 mb-3 text-sm text-black">
                  <span className="font-bold">Total deductions</span>
                  <span className="font-bold">KSh {calculated.totalDeductions.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center text-lg text-black mt-2">
                  <span className="font-bold">Net pay</span>
                  <span className="font-bold border-b-[3px] border-gray-400 border-double pb-0.5">KSh {Math.round(calculated.netPay).toLocaleString()}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-8 mb-4 text-center text-xs">
                <div className="p-2 pt-8">
                  <div className="border-t border-gray-300 pt-2 font-bold text-gray-800">Employee signature</div>
                  <div className="text-gray-500 mt-1">Date: ________________________</div>
                </div>
                <div className="p-2 pt-8">
                  <div className="border-t border-gray-300 pt-2 font-bold text-gray-800">Authorized signatory</div>
                  <div className="text-gray-500 mt-1">Date: ________________________</div>
                </div>
              </div>

              <div className="text-center text-gray-500 text-xs border-t border-gray-300 pt-4 mt-6">
                Generated on {new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })} {new Date().toLocaleTimeString()} &bull; {companyInfo?.company_name || 'Company'} &bull; Strictly confidential
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
  const [selectedPeriod, setSelectedPeriod] = useState<Date | null>(null);
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

      const { data: employeeData, error: empError } = await supabase
        .from('employees')
        .select('"Employee Number"')
        .eq('"Work Email"', user.email)
        .single();

      if (empError || !employeeData) {
        throw new Error("Could not find employee record.");
      }

      const empId = employeeData["Employee Number"];

      // 1. Fetch from the new Salary History table
      const { data: historyData, error: historyError } = await supabase
        .from('salary_history')
        .select('*')
        .eq('employee_id', empId)
        .order('pay_period', { ascending: false });

      if (historyError) {
        console.error("Salary history fetch error:", historyError);
      }

      let data = [];

      if (historyData && historyData.length > 0) {
        // Map history to the format expected by the frontend
        data = historyData.map(h => ({
          ...h,
          "Employee ID": h.employee_id,
          "Employee Name": h.employee_name,
          "Pay Period": h.pay_period,
          "Basic Salary": h.basic_salary,
          "Net Pay": h.net_pay,
          "Total Deductions": h.total_deductions
        }));
      } else {
        // Fallbacks for users who haven't saved to history yet
        const { data: currentData } = await supabase
          .from('payroll_records_current')
          .select('*')
          .eq('"Employee ID"', empId)
          .order('"Pay Period"', { ascending: false });

        if (currentData && currentData.length > 0) {
          data = currentData;
        } else {
          const { data: recordsData } = await supabase
            .from('payroll_records')
            .select('*')
            .eq('"Employee ID"', empId)
            .order('"Pay Period"', { ascending: false });

          if (recordsData && recordsData.length > 0) {
            data = recordsData;
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

    let matchesPeriod = true;
    if (selectedPeriod) {
      const formattedSelected = `${selectedPeriod.getFullYear()}-${String(selectedPeriod.getMonth() + 1).padStart(2, '0')}`;
      matchesPeriod = payPeriod === formattedSelected;
    }

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
            <DatePicker
              selected={selectedPeriod}
              onChange={(date) => setSelectedPeriod(date)}
              dateFormat="MM/yyyy"
              showMonthYearPicker
              isClearable
              placeholderText="All Periods"
              className="w-full px-4 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
              wrapperClassName="w-full"
            />
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