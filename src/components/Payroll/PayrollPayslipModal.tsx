import React from "react";
import { Download, ArrowLeft, ArrowRight, X } from "lucide-react";
import html2pdf from "html2pdf.js";
import { PayslipEditBar, type PayslipEditing } from "./PayslipEditModal";
import { isUsdPayslip } from "../../lib/payroll/usdPay";
import { PayslipDocument } from "./PayslipDocument";
import { usePayslipExtras } from "./usePayslipExtras";

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
 * The payslip itself (PayslipDocument.tsx, FIG-814): what the modal shows and its "Download PDF" saves, the staff
 * portal's payslip, and the PDF emailed to the employee (payslipPdf.tsx renders this same component off screen).
 */
export { PayslipDocument };

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
  // the employer block, employee numbers, year to date, run and the company's payslip design (FIG-814)
  const extras = usePayslipExtras(record, companyInfo);

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

        {edit && !isUsdPayslip(record) && <PayslipEditBar key={record.employee_id} record={record} edit={edit} />}
        {edit && isUsdPayslip(record) && (
          <p className="px-4 py-2 text-xs text-gray-600 border-b border-gray-200" data-testid="usd-no-edit">
            USD payslips aren’t edited by hand: change the salary or earnings (in USD) or the month’s USD rate, then recalculate.
          </p>
        )}

        <div className="p-2 bg-gray-50 payslip-container print:p-0 print:w-[210mm] print:h-[297mm]">
          <PayslipDocument record={record} companyInfo={companyInfo} extras={extras} id="payslip-content" />
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
