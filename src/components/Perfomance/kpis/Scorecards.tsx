import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, ClipboardList, Download } from 'lucide-react';
import { Button, Card, EmptyState, Modal, SearchInput, TableScroll } from '../../UI';
import { checkWeights, defaultPeriodId, formatPercent, formatValue, parseNumber } from '../../../lib/kpis';
import {
  addCheckin,
  buildScorecards,
  downloadCsv,
  loadAssignments,
  scorecardsCsv,
  type Kpi,
  type KpiAccess,
  type KpiAssignment,
  type KpiPeriod,
  type KpiPerson,
  type Scorecard,
} from '../../../lib/kpiApi';
import type { Department } from '../../../lib/orgStructure';
import { BandPill, PeriodSelect, ScoreText, SourceNote, inputClass, labelClass, tdClass, thClass } from './shared';

interface Props {
  kpis: Kpi[];
  periods: KpiPeriod[];
  people: KpiPerson[];
  departments: Department[];
  access: KpiAccess;
  /** the staff portal's My team: just the supervisor's reports, so no department filter */
  teamMode?: boolean;
}

export default function Scorecards({ kpis, periods, people, departments, access, teamMode = false }: Props) {
  const [periodId, setPeriodId] = useState(() => defaultPeriodId(periods));
  const [assignments, setAssignments] = useState<KpiAssignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [department, setDepartment] = useState('');
  const [search, setSearch] = useState('');
  const [openEmp, setOpenEmp] = useState<string | null>(null);

  useEffect(() => {
    if (!periodId && periods.length) setPeriodId(defaultPeriodId(periods));
  }, [periods, periodId]);

  const reload = useCallback(async () => {
    if (!periodId) return setAssignments([]);
    setLoading(true);
    try {
      setAssignments(await loadAssignments(periodId));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [periodId]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const period = periods.find((p) => p.id === periodId);
  const cards = useMemo(() => {
    // My team shows the supervisor's reports only, even to someone who can see more
    const team = new Set(people.map((p) => p.employeeNumber));
    return buildScorecards(teamMode ? assignments.filter((a) => team.has(a.employee_number)) : assignments, kpis, people);
  }, [assignments, kpis, people, teamMode]);
  const deptOf = useMemo(() => new Map(people.map((p) => [p.employeeNumber, p.departmentId])), [people]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cards.filter(
      (c) =>
        (!department || deptOf.get(c.employeeNumber) === department) &&
        (!q || c.name.toLowerCase().includes(q) || c.employeeNumber.toLowerCase().includes(q))
    );
  }, [cards, department, search, deptOf]);
  const current = cards.find((c) => c.employeeNumber === openEmp) ?? null;
  const offWeights = useMemo(() => shown.filter((c) => !checkWeights(c.lines.map((l) => l.assignment.weight)).ok), [shown]);
  const usedDepartments = departments.filter((d) => cards.some((c) => deptOf.get(c.employeeNumber) === d.id));

  const exportCsv = () => {
    if (shown.length === 0) return toast.error('Nothing to export');
    downloadCsv(`KPI-scorecards-${(period?.name ?? 'period').replace(/\s+/g, '-')}.csv`, scorecardsCsv(shown));
  };

  if (periods.length === 0) {
    return (
      <Card>
        <EmptyState icon={<ClipboardList size={20} />} title="No review periods yet" description="Add a review period and assign KPIs to see scorecards." />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card padding="sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <PeriodSelect periods={periods} value={periodId} onChange={setPeriodId} id="scorecard-period" />
          {!teamMode && (
            <div className="min-w-0">
              <label htmlFor="scorecard-department" className={labelClass}>Department</label>
              <select id="scorecard-department" className={inputClass} value={department} onChange={(e) => setDepartment(e.target.value)}>
                <option value="">All departments</option>
                {usedDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          )}
          <div className="min-w-0">
            <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people" aria-label="Search people" />
          </div>
          <div className="flex sm:justify-end">
            <Button variant="secondary" icon={<Download size={14} />} onClick={exportCsv}>Export CSV</Button>
          </div>
        </div>
      </Card>

      {offWeights.length > 0 && (
        <div role="alert" className="flex items-start gap-2 rounded-tile px-3 py-2 text-[12px] text-orange-text-alt bg-orange-tint-alt">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            {offWeights.length === 1 ? `${offWeights[0].name}'s KPI weights don't` : `${offWeights.length} people's KPI weights don't`} total 100%
            {offWeights.length > 1 && offWeights.length <= 5 ? ` (${offWeights.map((c) => c.name).join(', ')})` : ''}. Their overall scores may
            not reflect what matters most until the weights are adjusted.
          </span>
        </div>
      )}

      {!access.manages && !teamMode && <p className="text-[12px] text-muted-foreground">Showing the people who report to you.</p>}

      {shown.length === 0 ? (
        <Card>
          <EmptyState icon={<ClipboardList size={20} />} title={loading ? 'Loading…' : 'No scorecards'} description={loading ? undefined : 'Nobody here has KPIs in this period yet.'} />
        </Card>
      ) : (
        <Card padding="none">
          <TableScroll>
            <table className="w-full min-w-[640px]">
              <thead className="border-b border-border bg-secondary/50">
                <tr>
                  <th className={thClass}>Employee</th>
                  <th className={thClass}>Department</th>
                  <th className={thClass}>KPIs scored</th>
                  <th className={thClass}>Weights</th>
                  <th className={thClass}>Overall</th>
                  <th className={thClass}>Band</th>
                  <th className={thClass}><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => {
                  const w = checkWeights(c.lines.map((l) => l.assignment.weight));
                  return (
                    <tr key={c.employeeNumber} className="border-b border-border last:border-0">
                      <td className={tdClass}>
                        <div className="font-semibold">{c.name}</div>
                        <div className="text-[11px] text-muted-foreground">{c.employeeNumber}</div>
                      </td>
                      <td className={tdClass}>{c.department || '—'}</td>
                      <td className={tdClass}>{c.scored} / {c.lines.length}</td>
                      <td className={tdClass}>
                        <span className={w.ok ? '' : 'text-orange-text-alt font-semibold inline-flex items-center gap-1'} title={w.warning ?? undefined}>
                          {!w.ok && <AlertTriangle size={12} />}{w.total}%
                        </span>
                      </td>
                      <td className={tdClass}><ScoreText score={c.score} /></td>
                      <td className={tdClass}><BandPill score={c.score} /></td>
                      <td className={`${tdClass} text-right`}>
                        <Button variant="secondary" aria-label={`Open scorecard for ${c.name}`} onClick={() => setOpenEmp(c.employeeNumber)}>Open</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      )}

      <Modal open={!!current} onClose={() => setOpenEmp(null)} title={current ? `Scorecard: ${current.name}` : 'Scorecard'} size="4xl">
        {current && (
          <ScorecardDetail
            card={current}
            canScore={period?.status === 'open' && current.employeeNumber !== access.employeeNumber && (access.manages || access.team.includes(current.employeeNumber))}
            periodStatus={period?.status ?? 'draft'}
            onScored={reload}
          />
        )}
      </Modal>
    </div>
  );
}

export function ScorecardDetail({
  card,
  canScore,
  periodStatus,
  onScored,
}: {
  card: Scorecard;
  canScore: boolean;
  periodStatus: string;
  onScored: () => void | Promise<void>;
}) {
  const [scoring, setScoring] = useState<string | null>(null);
  const weights = checkWeights(card.lines.map((l) => l.assignment.weight));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-[13px]">Overall: <ScoreText score={card.score} /></div>
        <BandPill score={card.score} />
        <div className="text-[12px] text-muted-foreground">{card.scored} of {card.lines.length} KPIs scored</div>
      </div>
      {weights.warning && (
        <div role="alert" className="flex items-start gap-2 rounded-tile px-3 py-2 text-[12px] text-orange-text-alt bg-orange-tint-alt">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {weights.warning}
        </div>
      )}
      {!canScore && periodStatus !== 'open' && (
        <p className="text-[12px] text-muted-foreground">Scores can be entered while the period is open.</p>
      )}
      <TableScroll>
        <table className="w-full min-w-[720px]">
          <thead className="border-b border-border">
            <tr>
              <th className={thClass}>KPI</th>
              <th className={thClass}>Target</th>
              <th className={thClass}>Weight</th>
              <th className={thClass}>Self-assessment</th>
              <th className={thClass}>Actual (final)</th>
              <th className={thClass}>Achievement</th>
              {canScore && <th className={thClass}><span className="sr-only">Score</span></th>}
            </tr>
          </thead>
          <tbody>
            {card.lines.map((l) => {
              const unit = l.kpi?.unit ?? 'number';
              const a = l.assignment;
              return (
                <tr key={a.id} className="border-b border-border last:border-0">
                  <td className={tdClass}>
                    <div className="font-semibold">{l.kpi?.name ?? 'Unknown KPI'}</div>
                    {l.kpi?.category && <div className="text-[11px] text-muted-foreground">{l.kpi.category}</div>}
                    <SourceNote a={a} />
                  </td>
                  <td className={tdClass}>{unit === 'rating_1_5' ? '—' : formatValue(unit, a.target)}</td>
                  <td className={tdClass}>{a.weight}%</td>
                  <td className={tdClass}>
                    {formatValue(unit, a.self_value)}
                    {a.self_comment && <div className="text-[11px] text-muted-foreground whitespace-pre-wrap">{a.self_comment}</div>}
                  </td>
                  <td className={tdClass}>
                    {formatValue(unit, a.actual_value)}
                    {a.manager_comment && <div className="text-[11px] text-muted-foreground whitespace-pre-wrap">{a.manager_comment}</div>}
                  </td>
                  <td className={tdClass}><span className="font-semibold tabular-nums">{formatPercent(l.achievement)}</span></td>
                  {canScore && (
                    <td className={`${tdClass} text-right`}>
                      <Button variant="secondary" aria-label={`Enter score for ${l.kpi?.name ?? 'KPI'}`} onClick={() => setScoring(a.id)}>
                        {a.actual_value === null ? 'Enter score' : 'Update'}
                      </Button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
      {scoring && (() => {
        const line = card.lines.find((l) => l.assignment.id === scoring);
        if (!line) return null;
        return (
          <CheckinForm
            kind="final"
            unit={line.kpi?.unit ?? 'number'}
            title={`Final score: ${line.kpi?.name ?? ''}`}
            initial={line.assignment.actual_value ?? line.assignment.self_value}
            onCancel={() => setScoring(null)}
            onSave={async (value, comment) => {
              await addCheckin(line.assignment.id, 'final', value, comment);
              toast.success('Score saved');
              setScoring(null);
              await onScored();
            }}
          />
        );
      })()}
    </div>
  );
}

/** Value + comment for a check-in; a yes/no KPI gets Yes/No, a rating 1 to 5. */
export function CheckinForm({
  kind,
  unit,
  title,
  initial,
  onCancel,
  onSave,
}: {
  kind: 'self' | 'final';
  unit: Kpi['unit'];
  title: string;
  initial: number | null;
  onCancel: () => void;
  onSave: (value: number | null, comment: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initial === null ? '' : String(initial));
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const parsed = parseNumber(value);
  const problem =
    value.trim() === '' && !comment.trim()
      ? 'Enter a value or a comment'
      : value.trim() && parsed === null
        ? 'The value must be a number'
        : unit === 'rating_1_5' && parsed !== null && (parsed < 1 || parsed > 5)
          ? 'A rating is from 1 to 5'
          : unit === 'percent' && parsed !== null && parsed < 0
            ? 'A percentage can’t be negative'
            : null;
  const id = `checkin-${kind}`;
  const save = async () => {
    if (problem) return;
    setBusy(true);
    try {
      await onSave(parsed, comment);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card padding="sm" className="bg-secondary/40">
      <div className="text-[12.5px] font-bold text-ink mb-2">{title}</div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="min-w-0">
          <label htmlFor={`${id}-value`} className={labelClass}>{kind === 'self' ? 'Your value' : 'Actual'}</label>
          {unit === 'yes_no' ? (
            <select id={`${id}-value`} className={inputClass} value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">Choose…</option>
              <option value="1">Yes</option>
              <option value="0">No</option>
            </select>
          ) : unit === 'rating_1_5' ? (
            <select id={`${id}-value`} className={inputClass} value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">Choose…</option>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={String(n)}>{n}</option>)}
            </select>
          ) : (
            <input id={`${id}-value`} className={inputClass} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
          )}
        </div>
        <div className="min-w-0 sm:col-span-2">
          <label htmlFor={`${id}-comment`} className={labelClass}>Comment</label>
          <textarea id={`${id}-comment`} className={inputClass} rows={2} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
      </div>
      {problem && <p className="text-[12px] text-status-danger mt-2">{problem}</p>}
      <div className="flex flex-wrap justify-end gap-2 mt-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button onClick={save} disabled={busy || !!problem}>Save</Button>
      </div>
    </Card>
  );
}
