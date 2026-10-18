import { payPeriodLabel } from '../../lib/payPeriod';
import React from "react";
import { Download, ArrowLeft, ArrowRight, X } from "lucide-react";
import html2pdf from "html2pdf.js";
import { payslipDeductionLines } from "../../lib/voluntaryDeductions";
import { payslipEarningLines } from "../../lib/earnings";
import { leaveLineLabel, leaveLineWorking, payslipLeaveLines } from "../../lib/leavePay";
import { PayslipEditBar, type PayslipEditing } from "./PayslipEditModal";
import { overtimeLineLabel, overtimeLineWorking, payslipOvertimeLines, payslipOvertimePay } from "../../lib/overtimePay";
import { PayslipSettlementBlock, WhtDeductionLine, WorkEarningLines, netPayLabel } from "./PayslipSettlement";
import { currencyOf, currencySymbol } from "../../lib/payroll/currency";
import { CountryDeductionLines } from "./CountryPayslipLines";
import { isKenyaPayslip } from "../../lib/payroll/payslipLines";

/** The payslip's currency symbol (FIG-905): KSh, TSh, USh. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a payroll row from PayrollDashboard
const cur = (record: any) => currencySymbol(currencyOf(record));

// One employee's payslip for the month (view, previous / next, PDF), moved from PayrollDashboard.

export const GlowButtonss = ({
  children,
  variant = "primary",
  icon: Icon,
  size = "md",
  onClick,
  disabled = false,
  className,
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "danger";
  icon?: any;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) => {
  const baseClasses =
    "inline-flex items-center gap-2 rounded-lg font-medium transition-all duration-300 border";
  const sizeClasses = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-xs",
    lg: "px-6 py-3 text-base",
  };
  const variantClasses = {
    primary:
      "bg-primary/10 border-primary text-primary hover:bg-primary/20 hover:border-primary hover:text-primary transition-all duration-300",
    secondary:
      "bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all duration-300",
    danger:
      "bg-red-50 border-red-500 text-red-600 hover:bg-red-100 hover:border-red-600 hover:text-red-700 transition-all duration-300",
  };

  return (
    <button
      className={`${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]} ${disabled ? "opacity-50 cursor-not-allowed" : ""} ${className || ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      {Icon && <Icon className="w-4 h-4" />}
      {children}
    </button>
  );
};

/**
 * The payslip itself: what the modal shows and its "Download PDF" saves, and the PDF emailed to the employee
 * (payslipPdf.tsx renders this same component off screen), so they are always the same.
 */
export const PayslipDocument = ({ record, companyInfo, id }: { record: any; companyInfo: any; id?: string }) => (
    <div
      id={id}
      className="bg-white border text-black border-gray-300 text-xs leading-tight mx-auto"
      style={{ maxWidth: '800px', boxShadow: '0 4px 15px rgba(0, 0, 0, 0.05)', fontFamily: 'Calibri, Helvetica, sans-serif' }}
    >
      <div className="bg-white text-black p-6 flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-end border-b-[3px] border-double border-gray-300">
        <div className="flex items-center min-w-0">
          {companyInfo?.image_url && (
            <img
              src={companyInfo.image_url}
              alt="Company Logo"
              className="h-16 w-16 mr-4 object-contain shrink-0"
            />
          )}
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold uppercase text-gray-900 break-words">
              {companyInfo?.company_name || "Your Company Name"}
            </h1>
            <div className="text-gray-600 text-sm font-semibold mt-1">
              {companyInfo?.company_tagline || "Excellence in service"}
            </div>
          </div>
        </div>
        <div className="sm:text-right">
          <h2 className="text-2xl sm:text-3xl font-bold uppercase text-gray-900 mb-1">PAYSLIP</h2>
          <div className="text-gray-600 font-semibold text-sm">
            {(() => {
              const now = new Date();
              const fallbackPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
              return payPeriodLabel(record.pay_period || record["Pay Period"] || fallbackPeriod);
            })()}
          </div>
        </div>
      </div>

      <div className="p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
          <div className="border border-gray-300 p-4">
            <h3 className="font-bold border-b border-gray-300 pb-2 mb-3 text-gray-900 text-sm">
              Employee information
            </h3>
            <div className="space-y-1.5 text-black">
              <div className="flex justify-between">
                <span className="font-semibold text-gray-600">Full name:</span>
                <span className="font-bold text-right">{record.employee_name || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold text-gray-600">Employee no:</span>
                <span className="font-bold text-right">{record.employee_id || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold text-gray-600">Position:</span>
                <span className="font-bold text-right">{record.department || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold text-gray-600">Dept:</span>
                <span className="font-bold text-right">Operations</span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold text-gray-600">Region:</span>
                <span className="font-bold text-right">{record.branch || 'N/A'}</span>
              </div>
            </div>
          </div>

          <div className="border border-gray-300 p-4">
            <h3 className="font-bold border-b border-gray-300 pb-2 mb-3 text-gray-900 text-sm">
              Payment details
            </h3>
            <div className="space-y-1.5 text-black">
              <div className="flex justify-between">
                <span className="font-semibold text-gray-600">Method:</span>
                <span className="font-bold text-right">{record.payment_method || 'M-Pesa'}</span>
              </div>
              {record.payment_method === "Bank Transfer" && (
                <>
                  <div className="flex justify-between">
                    <span className="font-semibold text-gray-600">Bank:</span>
                    <span className="font-bold text-right">{record.bank_name || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-semibold text-gray-600">Account:</span>
                    <span className="font-bold text-right">{record.account_number || 'N/A'}</span>
                  </div>
                </>
              )}
              {record.payment_method === "M-Pesa" && (
                <div className="flex justify-between">
                  <span className="font-semibold text-gray-600">M-Pesa no:</span>
                  <span className="font-bold text-right">{record.employeeNu || 'N/A'}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="font-semibold text-gray-600">Job group:</span>
                <span className="font-bold text-right">{record.jobGroup || 'N/A'}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
          <div className="border border-gray-300">
            <div className="bg-gray-100 border-b border-gray-300 font-bold p-3 text-gray-900">Earnings</div>
            <div className="p-3 space-y-2 text-black">
              <div className="flex justify-between">
                <span>Basic</span>
                <span className="font-semibold">{cur(record)} {(record.basic_salary || 0).toLocaleString()}</span>
              </div>
              {payslipLeaveLines(record).map((line, i) => (
                <div key={`leave-${line.name}-${i}`} className="flex justify-between gap-3">
                  <span>
                    {leaveLineLabel(line)}
                    <span className="block text-gray-500 text-xs">{leaveLineWorking(line)}</span>
                  </span>
                  <span className="font-semibold text-red-700 whitespace-nowrap">−{cur(record)} {line.amount.toLocaleString()}</span>
                </div>
              ))}
              <div className="flex justify-between">
                <span>House</span>
                <span className="font-semibold">{cur(record)} {(record.house_allowance || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Transport</span>
                <span className="font-semibold">{cur(record)} {(record.transport_allowance || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Medical</span>
                <span className="font-semibold">{cur(record)} {(record.medical_allowance || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Other</span>
                <span className="font-semibold">{cur(record)} {(record.other_allowances || 0).toLocaleString()}</span>
              </div>
              {payslipOvertimeLines(record).length > 0 ? (
                payslipOvertimeLines(record).map((line, i) => (
                  <div key={`overtime-${line.day_type}-${i}`} className="flex justify-between gap-3">
                    <span>
                      {overtimeLineLabel(line)}
                      <span className="block text-gray-500 text-xs">{overtimeLineWorking(line)}</span>
                    </span>
                    <span className="font-semibold whitespace-nowrap">{cur(record)} {line.amount.toLocaleString()}</span>
                  </div>
                ))
              ) : (
                <div className="flex justify-between">
                  <span>Overtime</span>
                  <span className="font-semibold">{cur(record)} {payslipOvertimePay(record).toLocaleString()}</span>
                </div>
              )}
              {payslipEarningLines(record).map((line, i) => (
                <div key={`${line.name}-${i}`} className="flex justify-between">
                  <span>
                    {line.name}
                    {!line.taxable && <span className="text-gray-500 text-xs"> (not taxed)</span>}
                  </span>
                  <span className="font-semibold">{cur(record)} {line.amount.toLocaleString()}</span>
                </div>
              ))}
              {/* the month's piece rate work and contract jobs (FIG-812) */}
              <WorkEarningLines record={record} />
              {isKenyaPayslip(record) && (
                <div className="flex justify-between bg-gray-50 p-1 border border-gray-200 mt-2">
                  <span>Per diem</span>
                  <span className="font-bold">{cur(record)} {(record.per_diem || 0).toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>

          <div className="border border-gray-300">
            <div className="bg-gray-100 border-b border-gray-300 font-bold p-3 text-gray-900">Deductions</div>
            <div className="p-3 space-y-2 text-black">
              {isKenyaPayslip(record) ? (
                <>
              <div className="flex justify-between">
                <span>PAYE</span>
                <span className="font-semibold">{cur(record)} {Math.round(record.paye_tax || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>SHIF / NHIF</span>
                <span className="font-semibold">{cur(record)} {(record.nhif_deduction || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>NSSF</span>
                <span className="font-semibold">{cur(record)} {(record.nssf_deduction || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>AHL</span>
                <span className="font-semibold">{cur(record)} {(record.housing_levy || 0).toLocaleString()}</span>
              </div>
                </>
              ) : (
                <CountryDeductionLines record={record} />
              )}
              <WhtDeductionLine record={record} />
              {Number(record.nita_levy) > 0 && (
                <div className="flex justify-between text-gray-500">
                  <span>NITA levy (paid by employer)</span>
                  <span>{cur(record)} {Number(record.nita_levy).toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Advance</span>
                <span className="font-semibold">{cur(record)} {(record.advance_deduction || 0).toLocaleString()}</span>
              </div>
              {payslipDeductionLines(record).map((line, i) => (
                <div key={`${line.name}-${i}`} className="flex justify-between">
                  <span>{line.name}</span>
                  <span className="font-semibold">{cur(record)} {line.amount.toLocaleString()}</span>
                </div>
              ))}
              {isKenyaPayslip(record) && (
                <div className="flex justify-between text-gray-600 mt-2 border-t border-gray-200 pt-1">
                  <span>Tax relief:</span>
                  <span className="font-semibold">{cur(record)} -2400</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <PayslipSettlementBlock record={record} />

        <div className="border border-gray-300 p-4 mb-8 bg-gray-50">
          <div className="flex justify-between border-b border-gray-300 pb-2 mb-2 text-sm text-black">
            <span className="font-bold">Gross pay</span>
            <span className="font-bold">{cur(record)} {(record.gross_pay || 0).toLocaleString()}</span>
          </div>
          <div className="flex justify-between border-b border-gray-300 pb-2 mb-3 text-sm text-black">
            <span className="font-bold">Total deductions</span>
            <span className="font-bold">{cur(record)} {(record.total_deductions || 0).toLocaleString()}</span>
          </div>
          <div className="flex justify-between items-center text-lg text-black mt-2">
            <span className="font-bold">{netPayLabel(record)}</span>
            <span className="font-bold border-b-[3px] border-gray-400 border-double pb-0.5">{cur(record)} {Math.round(record.net_pay || 0).toLocaleString()}</span>
          </div>
        </div>

        {record.payslip_note && (
          <div className="border border-gray-300 p-3 mb-6 text-black">
            <span className="font-bold">Note: </span>
            <span className="whitespace-pre-line">{record.payslip_note}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 mb-4 text-center text-xs">
          <div className="p-2 pt-8">
            <div className="border-t border-gray-300 pt-2 font-bold text-gray-800">
              Employee signature
            </div>
            <div className="text-gray-500 mt-1">Date: ________________________</div>
          </div>
          <div className="p-2 pt-8">
            <div className="border-t border-gray-300 pt-2 font-bold text-gray-800">
              Authorized signatory
            </div>
            <div className="text-gray-500 mt-1">Date: ________________________</div>
          </div>
        </div>

        <div className="text-center text-gray-500 text-xs border-t border-gray-300 pt-4 mt-6">
          Generated on {new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })} {new Date().toLocaleTimeString()} &bull; {companyInfo?.company_name || 'Company'} &bull; Strictly confidential
        </div>
      </div>
    </div>
);

export const PayslipModal = ({
  record,
  onClose,
  onPrevious,
  onNext,
  companyInfo,
  edit,
}: {
  record: any;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  companyInfo: any;
  /** payroll users, once the month has a run: edit this payslip while the run is a draft (FIG-883) */
  edit?: PayslipEditing;
}) => {

  const handleDownloadPDF = () => {
    const element = document.getElementById("payslip-content");
    const opt = {
      margin: 0.5,
      filename: `payslip_${record.employee_id}_${record.pay_period}.pdf`,
      image: { type: "jpeg", quality: 0.98 },
      // windowWidth lays the copy out as on a desktop screen, so a PDF downloaded on a phone keeps the desktop layout
      html2canvas: { scale: 2, useCORS: true, windowWidth: 1280 },
      jsPDF: { unit: "in", format: "a4", orientation: "portrait" },
    };

    html2pdf().from(element!).set(opt).save();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-6xl max-h-[90vh] overflow-auto">
        <div className="sticky top-0 bg-white p-4 border-b border-gray-200 flex flex-wrap gap-2 justify-between items-center z-10">
          <h2 className="text-lg sm:text-xl font-semibold text-gray-900">
            Modern Payslip
          </h2>
          <div className="flex flex-wrap gap-2">
            <GlowButtonss
              variant="secondary"
              icon={Download}
              size="sm"
              onClick={handleDownloadPDF}
            >
              Download PDF
            </GlowButtonss>
            <GlowButtonss variant="danger" icon={X} size="sm" onClick={onClose}>
              Close
            </GlowButtonss>
          </div>
        </div>

        {edit && <PayslipEditBar key={record.employee_id} record={record} edit={edit} />}

        <div className="p-2 bg-gray-50 payslip-container print:p-0 print:w-[210mm] print:h-[297mm]">
          <PayslipDocument record={record} companyInfo={companyInfo} id="payslip-content" />
        </div>

        {(!!onPrevious || !!onNext) && (
          <div className="sticky bottom-0 bg-white p-4 border-t border-gray-200 flex justify-between">
            {onPrevious && (
              <GlowButtonss icon={ArrowLeft} onClick={onPrevious}>
                Previous
              </GlowButtonss>
            )}
            {onNext && (
              <GlowButtonss
                icon={ArrowRight}
                onClick={onNext}
                className="ml-auto"
              >
                Next
              </GlowButtonss>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
