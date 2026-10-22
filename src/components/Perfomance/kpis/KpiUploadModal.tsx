import { useEffect, useMemo, useState, type ReactNode } from 'react';
import * as XLSX from 'xlsx';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { Button, Modal, StatusPill } from '../../UI';
import { defaultPeriodId } from '../../../lib/kpis';
import {
  addCheckin,
  assignKpi,
  loadAssignments,
  loadKpis,
  saveKpi,
  type Kpi,
  type KpiAssignment,
  type KpiPeriod,
  type KpiPerson,
} from '../../../lib/kpiApi';
import type { Department } from '../../../lib/orgStructure';
import {
  applyKpiUpload,
  kpiTemplateWorkbook,
  planKpiUpload,
  readKpiSheets,
  rowsToSave,
  type KpiSheets,
  type KpiUploadResult,
  type RowIssue,
} from '../../../lib/kpiSheet';
import { PeriodSelect } from './shared';

// Upload a KPI spreadsheet (FIG-987): download the template, fill in any of its KPIs, Assignments and Results sheets,
// upload it, check the preview (what will be added, changed or assigned, and the rows refused with why), then save.
// The reading and checking live in lib/kpiSheet; the database still decides who may assign or score.

interface Props {
  open: boolean;
  onClose: () => void;
  kpis: Kpi[];
  periods: KpiPeriod[];
  people: KpiPerson[];
  departments: Department[];
  /** after saving: reload what the page shows */
  onDone: () => void;
}

const API = { saveKpi, loadKpis, assignKpi, loadAssignments, addCheckin };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (!count) return null;
  return (
    <div className="rounded-tile border border-border">
      <div className="px-3 py-2 border-b border-border text-[12.5px] font-bold text-ink">
        {title} <span className="font-normal text-muted-foreground">({count})</span>
      </div>
      <ul className="divide-y divide-border max-h-56 overflow-y-auto">{children}</ul>
    </div>
  );
}

const RowNo = ({ row }: { row: number }) => <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">Row {row}</span>;

function IssueList({ title, issues }: { title: string; issues: RowIssue[] }) {
  if (!issues.length) return null;
  return (
    <div className="rounded-tile border border-border" role="alert">
      <div className="px-3 py-2 border-b border-border text-[12.5px] font-bold text-status-danger">
        {title} <span className="font-normal">({issues.length})</span>
      </div>
      <ul className="divide-y divide-border max-h-56 overflow-y-auto">
        {issues.map((r) => (
          <li key={`${r.sheet}-${r.row}`} className="px-3 py-2 text-[12px] text-ink">
            <span className="font-semibold">{r.sheet}, row {r.row}:</span> {r.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function KpiUploadModal({ open, onClose, kpis, periods, people, departments, onDone }: Props) {
  const [periodId, setPeriodId] = useState(() => defaultPeriodId(periods));
  const [file, setFile] = useState<{ name: string; sheets: KpiSheets } | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<KpiAssignment[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<KpiUploadResult | null>(null);

  useEffect(() => {
    if (!periodId && periods.length) setPeriodId(defaultPeriodId(periods));
  }, [periods, periodId]);

  // the period's assignments, to tell which results belong to a KPI the person has
  useEffect(() => {
    if (!file?.sheets.results.length || !periodId) return setAssignments([]);
    let live = true;
    setAssignments(null);
    loadAssignments(periodId)
      .then((a) => live && setAssignments(a))
      .catch((e) => {
        if (!live) return;
        setReadError((e as Error).message);
        setAssignments([]);
      });
    return () => {
      live = false;
    };
  }, [file, periodId]);

  const period = periods.find((p) => p.id === periodId) ?? null;
  const plan = useMemo(
    () => (file && assignments ? planKpiUpload(file.sheets, { kpis, people, departments, period, assignments }) : null),
    [file, assignments, kpis, people, departments, period]
  );
  const toSave = plan ? rowsToSave(plan) : 0;

  const reset = () => {
    setFile(null);
    setReadError(null);
    setResult(null);
  };
  const close = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const read = async (f: File) => {
    reset();
    try {
      const sheets = readKpiSheets(await f.arrayBuffer());
      const rows = sheets.kpis.length + sheets.assignments.length + sheets.results.length;
      if (!rows && !sheets.problems.length) return setReadError('The file has no rows to upload. Fill in the template below its headings.');
      setFile({ name: f.name, sheets });
    } catch {
      setReadError('That file could not be read. Upload an .xlsx or .csv file, such as the template.');
    }
  };

  const save = async () => {
    if (!plan || !toSave) return;
    setSaving(true);
    try {
      setResult(await applyKpiUpload(plan, periodId, API));
      onDone();
    } finally {
      setSaving(false);
    }
  };

  const changes = plan?.kpis.filter((k) => k.action !== 'unchanged') ?? [];
  const unchanged = (plan?.kpis.length ?? 0) - changes.length;

  return (
    <Modal open={open} onClose={close} title="Upload a KPI spreadsheet" size="3xl" closeOnBackdrop={!saving}>
      <div className="space-y-4 text-ink">
        {result ? (
          <div role="status" className="space-y-3">
            <div className="rounded-tile border border-border p-3 text-[12.5px] space-y-1">
              <p className="font-semibold">Saved</p>
              <ul className="list-disc pl-4 text-muted-foreground space-y-0.5">
                <li>{plural(result.kpisAdded, 'KPI')} added, {plural(result.kpisUpdated, 'KPI')} changed</li>
                <li>{plural(result.assigned, 'assignment')}, setting KPIs for {plural(result.peopleAssigned, 'person', 'people')}</li>
                <li>{plural(result.resultsSaved, 'result')} saved as final scores</li>
              </ul>
            </div>
            <IssueList title="Not saved" issues={result.failed} />
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={reset}>Upload another file</Button>
              <Button onClick={close}>Done</Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-[12.5px] text-muted-foreground">
              Download the template and fill in any of its sheets: <strong>KPIs</strong> (add or change KPIs),{' '}
              <strong>Assignments</strong> (who gets which KPI) and <strong>Results</strong> (the actual each person reached).
              You'll see what will change before anything is saved.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
              <PeriodSelect periods={periods} value={periodId} onChange={setPeriodId} id="upload-period" label="Review period (for assignments and results)" />
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" icon={<Download size={14} />} onClick={() => XLSX.writeFile(kpiTemplateWorkbook(), 'kpi-upload-template.xlsx')}>
                  Download the template
                </Button>
                <label className={`inline-flex items-center gap-[7px] px-3.5 py-2 rounded-tile text-[12.5px] font-semibold bg-brand text-white cursor-pointer ${saving ? 'opacity-50 pointer-events-none' : ''}`}>
                  <Upload size={14} />
                  {file ? 'Choose another file' : 'Choose a file'}
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="sr-only"
                    aria-label="KPI spreadsheet"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) void read(f);
                    }}
                  />
                </label>
              </div>
            </div>

            {readError && <p role="alert" className="text-[12.5px] text-status-danger">{readError}</p>}

            {file && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-[12.5px] font-semibold">
                  <FileSpreadsheet size={14} className="shrink-0 text-muted-foreground" />
                  <span className="truncate">{file.name}</span>
                </div>
                {file.sheets.problems.map((p) => (
                  <p key={p} role="alert" className="text-[12.5px] text-status-danger">{p}</p>
                ))}
                {!plan ? (
                  <p className="text-[12.5px] text-muted-foreground">Checking the rows…</p>
                ) : (
                  <>
                    <Section title="KPIs to add or change" count={changes.length}>
                      {changes.map((k) => (
                        <li key={`${k.sheet}-${k.row}`} className="flex flex-wrap items-start gap-2 px-3 py-2 text-[12.5px]">
                          <RowNo row={k.row} />
                          <span className="font-semibold min-w-0">{k.name}</span>
                          <StatusPill label={k.action === 'add' ? 'New' : 'Changed'} tone={k.action === 'add' ? 'success' : 'info'} />
                          {k.action === 'update' && <span className="text-[11.5px] text-muted-foreground">{k.changes.join(', ')}</span>}
                          {k.archived && <span className="text-[11.5px] text-muted-foreground">(stays archived)</span>}
                        </li>
                      ))}
                    </Section>
                    {unchanged > 0 && (
                      <p className="text-[12px] text-muted-foreground">{plural(unchanged, 'KPI row')} match the library already and change nothing.</p>
                    )}
                    <Section title={`Assignments in ${period?.name ?? 'the period'}`} count={plan.assignments.length}>
                      {plan.assignments.map((a) => (
                        <li key={`${a.sheet}-${a.row}`} className="flex flex-wrap items-start gap-2 px-3 py-2 text-[12.5px]">
                          <RowNo row={a.row} />
                          <span className="min-w-0">
                            <span className="font-semibold">{a.kpiName}</span> to {a.who}
                            {a.scope !== 'person' && <span className="text-muted-foreground"> ({plural(a.people.length, 'person', 'people')})</span>}
                          </span>
                          <span className="text-[11.5px] text-muted-foreground">Target {a.targetText} · weight {a.weightText}</span>
                        </li>
                      ))}
                    </Section>
                    <Section title={`Results for ${period?.name ?? 'the period'}`} count={plan.results.length}>
                      {plan.results.map((r) => (
                        <li key={`${r.sheet}-${r.row}`} className="flex flex-wrap items-start gap-2 px-3 py-2 text-[12.5px]">
                          <RowNo row={r.row} />
                          <span className="min-w-0">
                            {r.employeeName} ({r.employeeNumber}): <span className="font-semibold">{r.kpiName}</span> {r.valueText}
                          </span>
                          {r.viaUpload && <span className="text-[11.5px] text-muted-foreground">assigned by this upload</span>}
                          {r.comment && <span className="w-full text-[11.5px] text-muted-foreground whitespace-pre-wrap">{r.comment}</span>}
                        </li>
                      ))}
                    </Section>
                    <IssueList title="Rows that will not be saved" issues={plan.refused} />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[12px] text-muted-foreground">
                        {toSave ? 'Saved in order: KPIs, then assignments, then results.' : 'Nothing to save: fix the rows above and upload again.'}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="secondary" onClick={close} disabled={saving}>Cancel</Button>
                        <Button disabled={saving || !toSave} onClick={save}>
                          {saving ? 'Saving…' : `Save ${plural(toSave, 'row')}`}
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
