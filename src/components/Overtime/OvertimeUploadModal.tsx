import { useState } from 'react';
import { saveAs } from 'file-saver';
import { Download, Upload } from 'lucide-react';
import { Button, Modal } from '../UI';
import { readEmployeeRows } from '../../lib/employeeSheet';
import { XLSX_TYPE, toXlsx } from '../../lib/xlsxExport';
import { uploadOvertime, type OvertimePerson } from '../../lib/overtimeApi';
import { OVERTIME_SHEET_HEADERS, overtimeFromSheet } from '../../lib/overtimePay';
import { today } from '../../lib/casualPay';

// A spreadsheet of overtime hours: download the template, fill it in, upload it. One row per person per day; a day
// already recorded is changed. Each row is saved on its own; the rows that could not be are listed with why.

interface Props {
  open: boolean;
  people: OvertimePerson[];
  onClose: () => void;
  onDone: () => void;
}

export default function OvertimeUploadModal({ open, people, onClose, onDone }: Props) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ added: number; problems: string[] } | null>(null);

  const template = () => {
    const example = people.slice(0, 3).map((p) => [p.employee_number, today(), '2', '']);
    saveAs(new Blob([toXlsx(OVERTIME_SHEET_HEADERS, example, 'Overtime')], { type: XLSX_TYPE }), 'overtime-template.xlsx');
  };

  const upload = async (file: File) => {
    setBusy(true);
    setResult(null);
    try {
      const parsed = overtimeFromSheet(readEmployeeRows(await file.arrayBuffer()), people);
      if (!parsed.entries.length && !parsed.problems.length) {
        setResult({ added: 0, problems: ['The sheet has no rows to add.'] });
        return;
      }
      const refused = await uploadOvertime(parsed.entries);
      setResult({
        added: parsed.entries.length - refused.length,
        problems: [
          ...parsed.problems.map((p) => `Row ${p.row}: ${p.problem}`),
          ...refused.map((r) => `${r.entry.employee_number} on ${r.entry.work_date}: ${r.problem}`),
        ],
      });
      onDone();
    } catch (err) {
      setResult({ added: 0, problems: [(err as Error).message] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Upload overtime" size="lg" closeOnBackdrop={!busy}>
      <div className="space-y-3 text-xs text-ink">
        <p className="text-muted-foreground">
          One row per person per day: their employee number, the date (2026-10-16), the overtime hours and an optional note.
          Uploaded overtime is approved. The kind of day (working day, rest day, public holiday) is worked out for you.
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
            <p className="font-semibold">{result.added} {result.added === 1 ? 'day' : 'days'} of overtime saved.</p>
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
