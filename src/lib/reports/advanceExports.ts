import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { saveAs } from 'file-saver';
import { downloadXlsx } from './reportKit';

// The Staff Salary Advance report's downloads: several employees' advances at once (CSV, Excel or PDF) and one
// employee's report printed. One row per advance, the same columns everywhere.

export interface AdvanceRecord {
  id?: string | number | null;
  employee_number?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  application_date?: string | null;
  amount_requested?: number | string | null;
  status?: string | null;
  mpesa_code?: string | null;
}

export const ADVANCE_HEADERS = ['Employee number', 'Name', 'Date', 'Amount (KES)', 'Status', 'M-Pesa reference'] as const;

const name = (a: AdvanceRecord) => [a.first_name, a.last_name].filter(Boolean).join(' ');
const day = (iso: string | null | undefined) => (iso ? String(iso).slice(0, 10) : '');
const amount = (v: AdvanceRecord['amount_requested']) => Number(v) || 0;

/** One row per advance, oldest first within each employee, employees in the order given. */
export function advanceRows(records: AdvanceRecord[]): string[][] {
  return [...records]
    .sort((a, b) => String(a.employee_number ?? '').localeCompare(String(b.employee_number ?? '')) || day(a.application_date).localeCompare(day(b.application_date)))
    .map((a) => [a.employee_number ?? '', name(a), day(a.application_date), amount(a.amount_requested).toFixed(2), a.status ?? '', a.mpesa_code ?? '']);
}

/** A CSV cell, quoted when it has a comma, quote or line break. */
export const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function advancesCsv(records: AdvanceRecord[]): string {
  return [ADVANCE_HEADERS.join(','), ...advanceRows(records).map((r) => r.map(csvCell).join(','))].join('\n');
}

export const totalAdvanced = (records: AdvanceRecord[]) => Math.round(records.reduce((s, a) => s + amount(a.amount_requested), 0) * 100) / 100;

/** Downloads the advances of several employees in one file. */
export function downloadAdvances(format: 'csv' | 'excel' | 'pdf', records: AdvanceRecord[], fileBase = 'salary-advances') {
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'csv') {
    saveAs(new Blob([advancesCsv(records)], { type: 'text/csv;charset=utf-8' }), `${fileBase}-${stamp}.csv`);
  } else if (format === 'excel') {
    downloadXlsx(`${fileBase}-${stamp}`, ADVANCE_HEADERS, advanceRows(records), 'Salary advances');
  } else {
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.setFontSize(14);
    doc.text('Staff salary advances', 14, 16);
    doc.setFontSize(9);
    doc.text(`${records.length} advance${records.length === 1 ? '' : 's'}, KES ${totalAdvanced(records).toLocaleString('en-KE', { minimumFractionDigits: 2 })} in all. Printed ${stamp}.`, 14, 22);
    autoTable(doc, { head: [[...ADVANCE_HEADERS]], body: advanceRows(records), startY: 27, styles: { fontSize: 8 }, headStyles: { fillColor: [46, 125, 50] } });
    doc.save(`${fileBase}-${stamp}.pdf`);
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The printable page for one employee's advances. */
export function advanceReportHtml(employee: { name: string; number: string }, records: AdvanceRecord[]): string {
  const rows = advanceRows(records)
    .map((r) => `<tr><td>${escapeHtml(r[2])}</td><td class="n">${escapeHtml(Number(r[3]).toLocaleString('en-KE', { minimumFractionDigits: 2 }))}</td><td>${escapeHtml(r[4])}</td><td>${escapeHtml(r[5])}</td></tr>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Salary advances: ${escapeHtml(employee.name)}</title>
<style>body{font-family:system-ui,sans-serif;margin:32px;color:#1a1a1a}h1{font-size:18px;margin:0 0 4px}p{margin:0 0 16px;color:#555;font-size:12px}
table{border-collapse:collapse;width:100%;font-size:12px}th,td{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left}th{background:#f3f4f6}
.n{text-align:right}tfoot td{font-weight:bold;border-top:2px solid #999}</style></head><body>
<h1>Salary advances: ${escapeHtml(employee.name)}</h1><p>Employee ${escapeHtml(employee.number)} · printed ${new Date().toLocaleDateString()}</p>
<table><thead><tr><th>Date</th><th class="n">Amount (KES)</th><th>Status</th><th>M-Pesa reference</th></tr></thead><tbody>${rows}</tbody>
<tfoot><tr><td>Total</td><td class="n">${totalAdvanced(records).toLocaleString('en-KE', { minimumFractionDigits: 2 })}</td><td colspan="2"></td></tr></tfoot></table>
</body></html>`;
}

/** Opens one employee's advances in a new window and prints it. Returns false when the browser blocked the window. */
export function printAdvanceReport(employee: { name: string; number: string }, records: AdvanceRecord[]): boolean {
  const w = window.open('', '_blank', 'noopener=no,width=900,height=700');
  if (!w) return false;
  w.document.open();
  w.document.write(advanceReportHtml(employee, records));
  w.document.close();
  w.focus();
  // once the written page has laid out (a document.write page doesn't reliably fire load)
  setTimeout(() => w.print(), 300);
  return true;
}
