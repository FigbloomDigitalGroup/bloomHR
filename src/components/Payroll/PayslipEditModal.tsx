import { useEffect, useMemo, useState } from "react";
import { History, Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import toast from "react-hot-toast";
import Modal from "../UI/Modal";
import {
  EDITABLE_FIELDS,
  SUMMARY_LINES,
  applyPayslipOverride,
  fieldValue,
  normaliseOverride,
  payslipChanges,
  type EditableField,
  type PayslipChange,
  type PayslipOverride,
  type StatutoryContext,
} from "../../lib/payslipOverrides";
import { loadPayslipHistory, removePayslipEdits, savePayslipEdit, type PayslipEditRecord } from "../../lib/payslipOverridesDb";
import { runErrorMessage, type PayrollRunStatus } from "../../lib/payrollRuns";

// Editing one payslip while its month's run is a draft (FIG-883): the edit window, the Edit button with why it is
// unavailable, and the payslip's edit history. The sums are in lib/payslipOverrides.

type Payslip = Record<string, any>;

const ksh = (n: unknown) => `KSh ${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString()}`;

/** Why a payslip can't be edited now, or null when it can. */
export const editBlockedReason = (status: PayrollRunStatus | null | undefined): string | null =>
  status === "draft"
    ? null
    : status === "approved"
      ? "Reopen the run to edit"
      : status === "paid"
        ? "This month is paid, so its payslips can't change. Put corrections on next month's payslip as a one-off adjustment."
        : "Start this month's payroll to edit payslips";

interface OneOffRow {
  label: string;
  amount: string;
  taxable: boolean;
}

export interface PayslipEditInput {
  override: PayslipOverride;
  changes: PayslipChange[];
  reason: string;
  /** the payslip with the edits applied */
  after: Payslip;
}

export interface PayslipEditModalProps {
  /** the payslip as it is now (saved, with any earlier edits) */
  record: Payslip;
  /** the payslip as calculated, without edits */
  base: Payslip;
  override: PayslipOverride | null;
  context: StatutoryContext;
  runStatus: PayrollRunStatus | null;
  onClose: () => void;
  onSave: (input: PayslipEditInput) => Promise<void>;
  onRemove: (input: Omit<PayslipEditInput, "override">) => Promise<void>;
}

const amountText = (n: number | undefined) => (n === undefined ? "" : String(n));

export function PayslipEditModal({ record, base, override, context, runStatus, onClose, onSave, onRemove }: PayslipEditModalProps) {
  const blocked = editBlockedReason(runStatus);
  const current = normaliseOverride(override) ?? {};

  const [fields, setFields] = useState<Record<EditableField, string>>(
    () =>
      Object.fromEntries(
        EDITABLE_FIELDS.map((f) => [f.key, amountText(current.fields?.[f.key] ?? fieldValue(base, f.key))]),
      ) as Record<EditableField, string>,
  );
  const baseEarnings: { name: string; amount: number; taxable: boolean }[] = useMemo(() => {
    const seen = new Map<string, { name: string; amount: number; taxable: boolean }>();
    for (const i of Array.isArray(base.earning_items) ? base.earning_items : []) {
      if (!seen.has(i.name)) seen.set(i.name, { name: i.name, amount: Number(i.amount) || 0, taxable: i.taxable !== false });
    }
    return [...seen.values()];
  }, [base]);
  const [earningAmounts, setEarningAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(baseEarnings.map((e) => [e.name, amountText(current.earning_amounts?.[e.name] ?? e.amount)])),
  );
  const [earnings, setEarnings] = useState<OneOffRow[]>(() =>
    (current.one_off_earnings ?? []).map((e) => ({ label: e.label, amount: String(e.amount), taxable: e.taxable })),
  );
  const [deductions, setDeductions] = useState<OneOffRow[]>(() =>
    (current.one_off_deductions ?? []).map((d) => ({ label: d.label, amount: String(d.amount), taxable: false })),
  );
  const [note, setNote] = useState(current.note ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // the override the form describes: only what differs from the calculated payslip
  const draft = useMemo<PayslipOverride | null>(() => {
    const changedFields: Partial<Record<EditableField, number>> = {};
    for (const f of EDITABLE_FIELDS) {
      const raw = fields[f.key].trim();
      if (raw === "") continue;
      const value = Number(raw);
      if (Number.isFinite(value) && value !== fieldValue(base, f.key)) changedFields[f.key] = value;
    }
    const changedEarnings: Record<string, number> = {};
    for (const e of baseEarnings) {
      const raw = (earningAmounts[e.name] ?? "").trim();
      const value = Number(raw);
      if (raw !== "" && Number.isFinite(value) && value !== e.amount) changedEarnings[e.name] = value;
    }
    return normaliseOverride({
      fields: changedFields,
      earning_amounts: changedEarnings,
      one_off_earnings: earnings.map((e) => ({ label: e.label, amount: Number(e.amount), taxable: e.taxable })),
      one_off_deductions: deductions.map((d) => ({ label: d.label, amount: Number(d.amount) })),
      note,
    });
  }, [fields, earningAmounts, earnings, deductions, note, base, baseEarnings]);

  const after = useMemo(() => applyPayslipOverride(base, draft, context), [base, draft, context]);
  const changes = useMemo(() => payslipChanges(record, after), [record, after]);

  const invalid =
    EDITABLE_FIELDS.some((f) => fields[f.key].trim() !== "" && !(Number(fields[f.key]) >= 0)) ||
    Object.values(earningAmounts).some((v) => v.trim() !== "" && !(Number(v) >= 0)) ||
    [...earnings, ...deductions].some((r) => !r.label.trim() || !(Number(r.amount) > 0));

  const submit = async (remove: boolean) => {
    if (blocked) return;
    if (!reason.trim()) {
      setError(remove ? "Say why the edits are being removed." : "Say why the payslip is being changed.");
      return;
    }
    if (!remove && invalid) {
      setError("Each amount should be a number (0 or more), and each one-off line needs a name and an amount above 0.");
      return;
    }
    if (!remove && !draft && !override) {
      setError("Nothing has been changed yet.");
      return;
    }
    if (!remove && changes.length === 0) {
      setError("Nothing has been changed yet.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (remove || !draft) {
        await onRemove({ changes: payslipChanges(record, base), reason: reason.trim(), after: base });
      } else {
        await onSave({ override: draft, changes, reason: reason.trim(), after });
      }
      onClose();
    } catch (err) {
      setError(runErrorMessage(err, "The payslip was not saved. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const input = "w-full rounded-lg border border-border px-2 py-1.5 text-xs text-ink disabled:bg-gray-50";
  const rowEditor = (rows: OneOffRow[], set: (rows: OneOffRow[]) => void, kind: "earning" | "deduction") => (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <input
            aria-label={`One-off ${kind} ${i + 1} name`}
            placeholder={kind === "earning" ? "e.g. Bonus, Arrears" : "e.g. Damaged equipment"}
            className={`${input} flex-1 min-w-[8rem]`}
            value={row.label}
            disabled={!!blocked}
            onChange={(e) => set(rows.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))}
          />
          <input
            aria-label={`One-off ${kind} ${i + 1} amount`}
            inputMode="decimal"
            className={`${input} w-28`}
            value={row.amount}
            disabled={!!blocked}
            onChange={(e) => set(rows.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)))}
          />
          {kind === "earning" && (
            <label className="flex items-center gap-1 text-xs text-ink">
              <input
                type="checkbox"
                checked={row.taxable}
                disabled={!!blocked}
                onChange={(e) => set(rows.map((r, j) => (j === i ? { ...r, taxable: e.target.checked } : r)))}
              />
              Taxed
            </label>
          )}
          <button
            type="button"
            aria-label={`Remove one-off ${kind} ${i + 1}`}
            className="p-1 text-red-600 disabled:opacity-50"
            disabled={!!blocked}
            onClick={() => set(rows.filter((_, j) => j !== i))}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs font-semibold text-brand-dark disabled:opacity-50"
        disabled={!!blocked}
        onClick={() => set([...rows, { label: "", amount: "", taxable: true }])}
      >
        <Plus className="w-3.5 h-3.5" /> Add {kind === "earning" ? "an earning" : "a deduction"}
      </button>
    </div>
  );

  return (
    <Modal open onClose={busy ? () => undefined : onClose} title={`Edit payslip: ${record.employee_name || record.employee_id}`} size="3xl" closeOnBackdrop={false}>
      {blocked && (
        <p role="status" className="mb-4 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
          {blocked}
        </p>
      )}
      <p className="mb-4 text-xs text-muted-foreground">
        Changes are for this month only and are kept when the run is recalculated. PAYE, NSSF, SHIF, the housing levy and
        net pay are worked out from the earnings; they can't be typed in.
      </p>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-5">
          <section>
            <h3 className="text-xs font-bold uppercase text-subtle mb-2">Earnings this month</h3>
            <div className="grid grid-cols-2 gap-2">
              {EDITABLE_FIELDS.map((f) => (
                <label key={f.key} className="text-xs text-ink">
                  {f.label}
                  <input
                    aria-label={f.label}
                    inputMode="decimal"
                    className={input}
                    value={fields[f.key]}
                    disabled={!!blocked}
                    onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })}
                  />
                </label>
              ))}
              {baseEarnings.map((e) => (
                <label key={e.name} className="text-xs text-ink">
                  {e.name}
                  {!e.taxable && <span className="text-subtle"> (not taxed)</span>}
                  <input
                    aria-label={e.name}
                    inputMode="decimal"
                    className={input}
                    value={earningAmounts[e.name] ?? ""}
                    disabled={!!blocked}
                    onChange={(ev) => setEarningAmounts({ ...earningAmounts, [e.name]: ev.target.value })}
                  />
                </label>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-xs font-bold uppercase text-subtle mb-2">One-off earnings</h3>
            {rowEditor(earnings, setEarnings, "earning")}
          </section>

          <section>
            <h3 className="text-xs font-bold uppercase text-subtle mb-2">One-off deductions</h3>
            {rowEditor(deductions, setDeductions, "deduction")}
          </section>

          <label className="block text-xs text-ink">
            Note on the payslip
            <textarea className={input} rows={2} value={note} disabled={!!blocked} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>

        <div className="space-y-4">
          <section aria-label="Preview">
            <h3 className="text-xs font-bold uppercase text-subtle mb-2">Before → after</h3>
            <table className="w-full text-xs">
              <tbody>
                {SUMMARY_LINES.map((s) => {
                  const b = Number(record[s.key]) || 0;
                  const a = Number(after[s.key]) || 0;
                  const changed = Math.abs(a - b) >= 0.005;
                  return (
                    <tr key={s.key} data-testid={`preview-${s.key}`} className={`border-b border-border ${s.key === "net_pay" ? "font-bold" : ""}`}>
                      <td className="py-1.5 pr-2 text-ink">{s.label}</td>
                      <td className="py-1.5 pr-2 text-right text-muted-foreground whitespace-nowrap">{ksh(b)}</td>
                      <td className="py-1.5 text-center text-subtle">→</td>
                      <td className={`py-1.5 pl-2 text-right whitespace-nowrap ${changed ? "text-brand-dark font-semibold" : "text-ink"}`}>{ksh(a)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {changes.length > 0 && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {changes.length} line{changes.length === 1 ? "" : "s"} change.
              </p>
            )}
          </section>

          <label className="block text-xs text-ink font-semibold">
            Reason (required)
            <textarea
              aria-label="Reason"
              className={input}
              rows={3}
              placeholder="e.g. Arrears from September agreed with the manager"
              value={reason}
              disabled={!!blocked}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>

          {error && (
            <p role="alert" className="text-xs text-red-700">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-2 justify-end">
            {override && (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-50"
                disabled={!!blocked || busy}
                onClick={() => submit(true)}
              >
                <Undo2 className="w-3.5 h-3.5" /> Remove edits
              </button>
            )}
            <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-ink" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="rounded-lg bg-brand-dark px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              disabled={!!blocked || busy}
              onClick={() => submit(false)}
            >
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

const fmtChange = (v: number | string | null) => (v === null ? "—" : typeof v === "number" ? ksh(v) : `"${v}"`);

/** A payslip's edit history, newest first. */
export function PayslipEditHistory({ payPeriod, employeeId, version }: { payPeriod: string; employeeId: string; version: number }) {
  const [rows, setRows] = useState<PayslipEditRecord[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    setRows(null);
    loadPayslipHistory(payPeriod, employeeId).then(
      (r) => !cancelled && setRows(r),
      () => !cancelled && setRows([]),
    );
    return () => {
      cancelled = true;
    };
  }, [payPeriod, employeeId, version]);

  if (!rows || rows.length === 0) return null;
  return (
    <details className="mt-2 text-xs text-ink">
      <summary className="cursor-pointer inline-flex items-center gap-1 font-semibold">
        <History className="w-3.5 h-3.5" /> Edit history ({rows.length})
      </summary>
      <ol className="mt-2 space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="rounded-lg border border-border p-2">
            <div className="font-semibold">
              {r.action === "removed" ? "Edits removed" : "Edited"} by {r.edited_by_name || "someone"} on{" "}
              {new Date(r.edited_at).toLocaleString("en-KE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </div>
            <div className="text-muted-foreground">Reason: {r.reason}</div>
            {Array.isArray(r.changes) && r.changes.length > 0 && (
              <ul className="mt-1 list-disc pl-4">
                {r.changes.map((c, i) => (
                  <li key={i}>
                    {c.field}: {fmtChange(c.before)} → {fmtChange(c.after)}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

/** What the payslip window needs to offer editing (the payroll page passes it to payroll users once the month has a run). */
export interface PayslipEditing {
  run: { id: string; status: PayrollRunStatus; pay_period: string };
  /** the payslip as calculated this month, without edits; null when the employee is no longer in the calculation */
  base: Payslip | null;
  override: PayslipOverride | null;
  context: StatutoryContext;
  /** after a save or removal: reload the run */
  onSaved: () => void;
}

/** The bar in the payslip window: the Edited badge, the Edit button (or why it is unavailable) and the history. */
export function PayslipEditBar({ record, edit }: { record: Payslip; edit: PayslipEditing }) {
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const blocked = editBlockedReason(edit.run.status) ?? (edit.base ? null : "This employee is not in this month's calculation any more, so their payslip can't be edited.");
  const edited = !!edit.override;

  const done = (message: string) => {
    toast.success(message);
    setVersion((v) => v + 1);
    edit.onSaved();
  };

  return (
    <div className="px-4 py-2 border-b border-gray-200 bg-white">
      <div className="flex flex-wrap items-center gap-2">
        {edited && <span className="rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-[10px] font-bold uppercase">Edited</span>}
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg border border-primary bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={!!blocked}
          title={blocked ?? undefined}
          onClick={() => setOpen(true)}
        >
          <Pencil className="w-3.5 h-3.5" /> Edit payslip
        </button>
        {blocked && <span className="text-xs text-muted-foreground">{blocked}</span>}
      </div>
      <PayslipEditHistory payPeriod={edit.run.pay_period} employeeId={record.employee_id} version={version} />
      {open && edit.base && (
        <PayslipEditModal
          record={record}
          base={edit.base}
          override={edit.override}
          context={edit.context}
          runStatus={edit.run.status}
          onClose={() => setOpen(false)}
          onSave={async ({ override, changes, reason, after }) => {
            await savePayslipEdit({ runId: edit.run.id, employeeId: record.employee_id, override, changes, reason, payslip: after });
            done("Payslip updated.");
          }}
          onRemove={async ({ changes, reason, after }) => {
            await removePayslipEdits({ runId: edit.run.id, employeeId: record.employee_id, changes, reason, payslip: after });
            done("Edits removed: the payslip is back to the calculated one.");
          }}
        />
      )}
    </div>
  );
}
