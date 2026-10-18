import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import html2pdf from "html2pdf.js";
import { PayslipDocument } from "./PayrollPayslipModal";
import { loadPayslipExtras, type PayslipExtras } from "../../lib/payslipExtras";

// A payslip as a PDF file (FIG-732), made the same way as the payslip's "Download PDF" button (html2pdf of the
// PayslipDocument component), so the PDF emailed to an employee is the one payroll and staff already know.
// Optionally protected with a password (jsPDF's PDF encryption): the employee's ID number.

/* eslint-disable @typescript-eslint/no-explicit-any -- payroll rows are the untyped records PayrollDashboard builds */

/** A random owner password, so only the user password (the ID number) opens the file, and it can't be edited. */
const randomOwnerPassword = () => {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

/** html2pdf's options for a payslip; with a password, the PDF is encrypted (opening needs it; printing is allowed). */
export function payslipPdfOptions(record: any, password?: string | null) {
  return {
    margin: 0.5,
    filename: `payslip_${record?.employee_id ?? ""}_${record?.pay_period ?? ""}.pdf`,
    image: { type: "jpeg", quality: 0.98 },
    // windowWidth lays the copy out as on a desktop screen, so a PDF downloaded on a phone keeps the desktop layout
    html2canvas: { scale: 2, useCORS: true, windowWidth: 1280 },
    jsPDF: {
      unit: "in" as const,
      format: "a4",
      orientation: "portrait" as const,
      ...(password ? { encryption: { userPassword: password, ownerPassword: randomOwnerPassword(), userPermissions: ["print" as const] } } : {}),
    },
  };
}

/** Waits for the images in an element (the company logo) to load, or fail, so they are in the PDF. */
const imagesLoaded = (el: HTMLElement) =>
  Promise.all(
    Array.from(el.querySelectorAll("img")).map((img) =>
      img.complete ? Promise.resolve() : new Promise<void>((resolve) => { img.onload = img.onerror = () => resolve(); }),
    ),
  );

/**
 * One payslip as a PDF Blob, rendered off screen: the same PayslipDocument as on screen, with its employer block,
 * employee numbers, year to date, run and the company's design (FIG-814; loaded here unless given).
 */
export async function renderPayslipPdf(record: any, companyInfo: any, password?: string | null, extras?: PayslipExtras | null): Promise<Blob> {
  const details = extras === undefined ? await loadPayslipExtras(record, companyInfo).catch(() => null) : extras;
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, { position: "fixed", left: "-10000px", top: "0", width: "800px", pointerEvents: "none" });
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(<PayslipDocument record={record} companyInfo={companyInfo} extras={details} />));
    const el = host.firstElementChild as HTMLElement;
    await imagesLoaded(el);
    const blob: Blob = await html2pdf().set(payslipPdfOptions(record, password)).from(el).outputPdf("blob");
    return blob;
  } finally {
    root.unmount();
    host.remove();
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
