import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, CheckCircle, Loader, Mail, RotateCcw } from "lucide-react";
import { Card } from "../UI";
import type { PayrollRun } from "../../lib/payrollRuns";
import { runErrorMessage } from "../../lib/payrollRuns";
import { confirmDialog } from "../../lib/confirmDialog";
import {
  listPayslipEmails,
  loadPayslipEmailSettings,
  markPayslipPdfsUploaded,
  pdfPassword,
  progressLabel,
  queuePayslipEmails,
  stillSending,
  summarizePayslipEmails,
  uploadPayslipPdf,
  type PayslipEmailRow,
  type PayslipEmailSettings,
} from "../../lib/payslipEmails";
import { renderPayslipPdf } from "./payslipPdf";

// "Email payslips" on an approved (or paid) month (FIG-732): each employee gets their payslip as a PDF attachment.
// This browser makes the PDFs (the same as "Download PDF"), uploads them to the private payslip-pdfs bucket, and the
// send-notification-emails Edge Function sends them (lib/payslipEmails). Shows how far it has got ("Sent 34 of 40"),
// who was skipped and why, and what failed; pressing the button again retries the failed and skipped ones.
// Payroll (the 'payroll' module) and admins only. With the company's "email automatically" setting on, it starts by
// itself right after the month is approved (autoStart changes).

/* eslint-disable @typescript-eslint/no-explicit-any -- payroll rows are the untyped records PayrollDashboard builds */
type MakePdf = (record: any, companyInfo: any, password: string | null) => Promise<Blob>;

interface EmailPayslipsPanelProps {
  run: PayrollRun | null;
  periodLabel: string;
  /** the month's payslips, as the payslip modal shows them */
  records: any[];
  companyInfo: any;
  /** an employee's ID number (the PDF password) */
  idNumberFor: (employeeNumber: string) => unknown;
  /** payroll access */
  canEmail: boolean;
  /** changed right after this person approves the month: starts emailing when the company emails automatically */
  autoStart?: number;
  /** how a PDF is made (tests pass their own) */
  makePdf?: MakePdf;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const POLL_MS = 5000;
const UPLOAD_BATCH = 5;
const button =
  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-tile text-[11.5px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

export default function EmailPayslipsPanel({
  run,
  periodLabel,
  records,
  companyInfo,
  idNumberFor,
  canEmail,
  autoStart = 0,
  makePdf = renderPayslipPdf,
}: EmailPayslipsPanelProps) {
  const approved = !!run && (run.status === "approved" || run.status === "paid");
  const [rows, setRows] = useState<PayslipEmailRow[] | null>(null);
  const [settings, setSettings] = useState<PayslipEmailSettings | null>(null);
  const [preparing, setPreparing] = useState<{ done: number; of: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const handledAutoStart = useRef(autoStart);
  const runId = run?.id;

  const reload = useCallback(async () => {
    if (!runId) return;
    try {
      setRows(await listPayslipEmails(runId));
    } catch {
      setRows((r) => r ?? []);
    }
  }, [runId]);

  useEffect(() => {
    setRows(null);
    if (approved && canEmail) void reload();
  }, [approved, canEmail, reload]);

  useEffect(() => {
    if (!canEmail) return;
    let live = true;
    loadPayslipEmailSettings()
      .then((s) => live && setSettings(s))
      .catch(() => live && setSettings(null));
    return () => {
      live = false;
    };
  }, [canEmail]);

  const summary = summarizePayslipEmails(rows ?? []);
  // while the server is sending, look again every few seconds
  useEffect(() => {
    if (!rows || preparing || summary.queued === 0) return;
    const t = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(t);
  }, [rows, preparing, summary.queued, reload]);

  /** Makes and uploads the PDFs still waiting, then hands them to the server. */
  const prepare = useCallback(
    async (all: PayslipEmailRow[]) => {
      const waiting = all.filter((r) => r.status === "waiting_pdf");
      if (!waiting.length) return;
      const byNumber = new Map(records.map((r) => [String(r.employee_id ?? ""), r]));
      setPreparing({ done: 0, of: waiting.length });
      let ready: number[] = [];
      let problems = 0;
      for (let i = 0; i < waiting.length; i++) {
        const row = waiting[i];
        try {
          const record = byNumber.get(row.employee_number);
          if (!record) throw new Error("payslip not on this page");
          const password = row.password_protected ? pdfPassword(idNumberFor(row.employee_number)) : null;
          if (row.password_protected && !password) throw new Error("no ID number for the password");
          await uploadPayslipPdf(row.pdf_path, await makePdf(record, companyInfo, password));
          ready.push(row.id);
          if (ready.length >= UPLOAD_BATCH) {
            await markPayslipPdfsUploaded(ready);
            ready = [];
          }
        } catch (err) {
          problems++;
          console.error(`Payslip PDF for ${row.employee_number}:`, err);
        }
        setPreparing({ done: i + 1, of: waiting.length });
      }
      try {
        await markPayslipPdfsUploaded(ready);
      } catch (err) {
        toast.error(runErrorMessage(err, "Could not hand the payslips over for sending."));
      }
      setPreparing(null);
      if (problems) toast.error(`${problems} payslip PDF${problems === 1 ? "" : "s"} could not be made. Press "Continue" to try again.`);
    },
    [records, idNumberFor, makePdf, companyInfo],
  );

  const start = useCallback(
    async (ask: boolean) => {
      if (!runId || busy) return;
      if (ask) {
        const ok = await confirmDialog({
          title: `Email ${periodLabel} payslips?`,
          message: (
            <>
              <span className="block">Each employee gets their payslip as a PDF attached to an email to their work email.</span>
              <span className="block mt-1">
                {settings?.password !== false
                  ? "Each PDF is protected with the employee's ID number; the email tells them so but never contains it."
                  : "The PDFs are not password protected (Rates tab > Payslip emails)."}
              </span>
              <span className="block mt-1">Keep this page open while the PDFs are made.</span>
            </>
          ),
          confirmLabel: "Email payslips",
        });
        if (!ok) return;
      }
      setBusy(true);
      try {
        await queuePayslipEmails(runId);
        const fresh = await listPayslipEmails(runId);
        setRows(fresh);
        await prepare(fresh);
        await reload();
      } catch (err) {
        toast.error(runErrorMessage(err, "Could not email the payslips."));
      } finally {
        setBusy(false);
      }
    },
    [runId, busy, periodLabel, settings, prepare, reload],
  );

  const resume = useCallback(async () => {
    if (!rows || busy) return;
    setBusy(true);
    try {
      await prepare(rows);
      await reload();
    } finally {
      setBusy(false);
    }
  }, [rows, busy, prepare, reload]);

  // right after approving, when the company emails payslips automatically
  useEffect(() => {
    if (autoStart === handledAutoStart.current || !settings || !approved || !canEmail) return;
    handledAutoStart.current = autoStart;
    if (settings.auto) void start(false);
  }, [autoStart, settings, approved, canEmail, start]);

  if (!approved || !canEmail) return null;

  const failedRows = (rows ?? []).filter((r) => r.status === "failed");
  const skippedRows = (rows ?? []).filter((r) => r.status === "skipped");
  const started = summary.total > 0;
  const working = busy || !!preparing;

  return (
    <Card padding="sm" className="!rounded-xl" data-testid="email-payslips">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Mail className="w-4 h-4 text-brand shrink-0" />
        <div className="flex-1 min-w-0 basis-48 text-ink">
          <span className="font-semibold">Payslip emails</span>
          <span className="text-muted-foreground">
            {" · "}
            {rows === null
              ? "Loading…"
              : preparing
                ? `Preparing PDFs ${preparing.done} of ${preparing.of}…`
                : started
                  ? progressLabel(summary)
                  : `Email each employee their ${periodLabel} payslip as a PDF.`}
          </span>
          {started && !preparing && summary.waiting > 0 && !working && (
            <span className="block text-[11px] text-orange-text-alt">
              {summary.waiting} PDF{summary.waiting === 1 ? " is" : "s are"} still to be made on this page.
            </span>
          )}
          {started && !preparing && summary.queued > 0 && (
            <span className="block text-[11px] text-muted-foreground">Sending… this updates by itself.</span>
          )}
          {started && !stillSending(summary) && summary.sent > 0 && summary.failed === 0 && (
            <span className="inline-flex items-center gap-1 ml-2 text-status-success">
              <CheckCircle className="w-3 h-3" /> Done
            </span>
          )}
        </div>
        {working && <Loader className="w-3.5 h-3.5 animate-spin text-subtle" aria-label="Working" />}
        {!started && rows !== null && (
          <button type="button" className={`${button} bg-brand text-white hover:bg-brand-dark`} onClick={() => void start(true)} disabled={working}>
            <Mail className="w-3.5 h-3.5" />
            Email payslips
          </button>
        )}
        {started && summary.waiting > 0 && !working && (
          <button type="button" className={`${button} bg-brand text-white hover:bg-brand-dark`} onClick={() => void resume()}>
            Continue
          </button>
        )}
        {started && (summary.failed > 0 || summary.skipped > 0) && (
          <button
            type="button"
            className={`${button} border border-border bg-white text-ink hover:bg-secondary`}
            onClick={() => void start(false)}
            disabled={working}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Retry failed and skipped
          </button>
        )}
      </div>

      {failedRows.length > 0 && (
        <div className="mt-2 rounded-tile bg-orange-tint-alt px-3 py-2 text-[11.5px] text-orange-text-alt" role="alert">
          <div className="font-semibold flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" /> {failedRows.length} not sent
          </div>
          <ul className="mt-1 space-y-0.5">
            {failedRows.map((r) => (
              <li key={r.id}>
                {r.employee_name || r.employee_number}: {r.error || "could not be sent"}
              </li>
            ))}
          </ul>
        </div>
      )}
      {skippedRows.length > 0 && (
        <details className="mt-2 text-[11.5px] text-muted-foreground">
          <summary className="cursor-pointer font-semibold text-ink">
            {skippedRows.length} skipped (no email address or ID number)
          </summary>
          <ul className="mt-1 space-y-0.5" aria-label="Skipped payslips">
            {skippedRows.map((r) => (
              <li key={r.id}>
                {r.employee_name || r.employee_number} ({r.employee_number}): {(r.error || "skipped").replace(/^Not emailed: /, "")}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
