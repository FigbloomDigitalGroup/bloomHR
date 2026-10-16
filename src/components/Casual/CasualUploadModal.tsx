import { useState } from 'react';
import { saveAs } from 'file-saver';
import { Download, Upload } from 'lucide-react';
import { Button, Modal } from '../UI';
import { readEmployeeRows } from '../../lib/employeeSheet';
import { XLSX_TYPE, toXlsx } from '../../lib/xlsxExport';
import { registerCasuals, uploadDays } from '../../lib/casualApi';
import {
  CASUAL_SHEET_HEADERS, DAYS_SHEET_HEADERS, casualRowsFromSheet, daysFromSheet, type CasualWorker,
} from '../../lib/casualPay';

// A spreadsheet of casuals to register, or of days worked: download the template, fill it in, upload it. Each row is
// added on its own; the rows that could not be are listed with why.

interface Props {
  open: boolean;
  kind: 'casuals' | 'days';
  casuals: CasualWorker[];
  onClose: () => void;
  onDone: () => void;
}

export default function CasualUploadModal({ open, kind, casuals, onClose, onDone }: Props) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ added: number; problems: string[] } | null>(null);

  const template = () => {
    const headers = kind === 'casuals' ? CASUAL_SHEET_HEADERS : DAYS_SHEET_HEADERS;
    const example = kind === 'casuals'
      ? [['Wanjiku', 'Mwangi', '23456789', '0712345678', '800', '2026-10-16', 'supervisor@company.co.ke', 'M-Pesa', '', '', '', '']]
      : casuals.slice(0, 3).map((c) => [c.employee_number, new Date().toISOString().slice(0, 10), 'Full']);
    saveAs(new Blob([toXlsx(headers, example, kind === 'casuals' ? 'Casual workers' : 'Days worked')], { type: XLSX_TYPE }),
      kind === 'casuals' ? 'casual-workers-template.xlsx' : 'casual-days-template.xlsx');
  };

  const upload = async (file: File) => {
    setBusy(true);
    setResult(null);
    try {
      const rows = readEmployeeRows(await file.arrayBuffer());
      if (kind === 'casuals') {
        const input = casualRowsFromSheet(rows);
        if (!input.length) {
          setResult({ added: 0, problems: ['The sheet has no rows to add.'] });
          return;
        }
        const out = await registerCasuals(input);
        setResult({
          added: out.filter((r) => r.employee_number).length,
          problems: out.filter((r) => r.error).map((r) => `Row ${r.row + 1}: ${r.error}`),
        });
      } else {
        const parsed = daysFromSheet(rows, casuals);
        const refused = await uploadDays(parsed.days);
        setResult({
          added: parsed.days.length - refused.length,
          problems: [
            ...parsed.problems.map((p) => `Row ${p.row}: ${p.problem}`),
            ...refused.map((r) => `${r.day.employee_number} on ${r.day.work_date}: ${r.problem}`),
          ],
        });
      }
      onDone();
    } catch (err) {
      setResult({ added: 0, problems: [(err as Error).message] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={kind === 'casuals' ? 'Upload casual workers' : 'Upload days worked'} size="lg" closeOnBackdrop={!busy}>
      <div className="space-y-3 text-xs text-ink">
        <p className="text-muted-foreground">
          {kind === 'casuals'
            ? 'One row per person: name, ID number, phone, daily rate and start date. Add bank details only for people paid by bank.'
            : 'One row per person per day: their employee number, the date (2026-10-16) and Full, Half or Absent.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={<Download className="w-3.5 h-3.5" />} onClick={template}>Download the template</Button>
          <label className={`inline-flex items-center gap-[7px] px-3.5 py-2 rounded-tile text-[12.5px] font-semibold bg-brand text-white cursor-pointer ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
            <Upload className="w-3.5 h-3.5" />
            {busy ? 'Uploading...' : 'Choose a file'}
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="sr-only"
              aria-label="Spreadsheet"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void upload(f);
              }}
            />
          </label>
        </div>
        {result && (
          <div role="status" className="rounded-tile border border-border p-3 space-y-1">
            <p className="font-semibold">
              {result.added} {kind === 'casuals' ? (result.added === 1 ? 'person' : 'people') : result.added === 1 ? 'day' : 'days'} added.
            </p>
            {result.problems.length > 0 && (
              <ul className="list-disc pl-4 text-status-danger space-y-0.5 max-h-48 overflow-y-auto">
                {result.problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            )}
          </div>
        )}
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}
