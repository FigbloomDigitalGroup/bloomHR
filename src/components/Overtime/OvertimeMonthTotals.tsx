import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Clock } from 'lucide-react';
import { Card, EmptyState, TableScroll } from '../UI';
import {
  loadOvertime, loadOvertimeMonth, loadPayBasis, setOvertimeRate, type OvertimePerson,
} from '../../lib/overtimeApi';
import {
  DEFAULT_OVERTIME_SETTINGS, formatKsh, hoursByType, overtimePayFor, round2,
  type OvertimeMonthRow, type OvertimeSettings,
} from '../../lib/overtimePay';
import { LoaderBlock } from '../UI/FigbloomLoader';

// The month's approved overtime per employee: hours by kind of day and, for payroll, what it pays (what the month's
// payslips will add to gross pay). Payroll can give someone their own hourly rate here.

interface Props {
  people: OvertimePerson[];
  /** payroll or work records: the month's figures as payroll gets them (after the cap) */
  canManage: boolean;
  /** payroll: amounts and hourly rates */
  canSeePay: boolean;
  version: number;
}

const thisMonth = () => new Date().toISOString().slice(0, 7);
const monthEnd = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

function RateCell({ employeeNumber, ownRate, rate, onSaved }: { employeeNumber: string; ownRate: number | null; rate: number; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(ownRate ? String(ownRate) : '');
  const save = async () => {
    const n = value.trim() === '' ? null : Number(value);
    if (n !== null && !(n > 0)) {
      toast.error('An hourly rate is more than 0 (leave it empty to work it out from the basic salary)');
      return;
    }
    try {
      await setOvertimeRate(employeeNumber, n);
      setEditing(false);
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };
  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input aria-label={`Own hourly rate for ${employeeNumber}`} inputMode="decimal" className="w-20 rounded-md border border-border px-1 py-0.5 text-[11px]"
          value={value} placeholder="From basic" onChange={(e) => setValue(e.target.value)} />
        <button type="button" className="text-brand font-semibold" onClick={() => void save()}>Save</button>
      </span>
    );
  }
  return (
    <button type="button" className="text-right" title="Set this employee's own hourly rate" onClick={() => setEditing(true)}>
      {formatKsh(rate)}
      <span className="block text-[10px] text-subtle">{ownRate ? 'own rate' : 'from basic'}</span>
    </button>
  );
}

export default function OvertimeMonthTotals({ people, canManage, canSeePay, version }: Props) {
  const [period, setPeriod] = useState(thisMonth);
  const [rows, setRows] = useState<OvertimeMonthRow[]>([]);
  const [settings, setSettings] = useState<OvertimeSettings>(DEFAULT_OVERTIME_SETTINGS);
  const [pay, setPay] = useState<Map<string, { basic: number; ownRate: number | null }>>(new Map());
  const [loading, setLoading] = useState(true);
  const [rateVersion, setRateVersion] = useState(0);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      if (canManage) {
        const month = await loadOvertimeMonth(period);
        setRows([...month.rows.values()]);
        setSettings(month.settings);
      } else {
        // a supervisor: their team's approved hours (payroll applies any cap)
        const entries = (await loadOvertime(`${period}-01`, monthEnd(period))).filter((e) => e.status === 'approved');
        const byEmployee = new Map<string, typeof entries>();
        for (const e of entries) byEmployee.set(e.employee_number, [...(byEmployee.get(e.employee_number) ?? []), e]);
        setRows([...byEmployee.entries()].map(([employee_number, list]) => {
          const h = hoursByType(list);
          return { employee_number, normal_hours: h.normal, rest_hours: h.rest, holiday_hours: h.holiday, over_cap_hours: 0, entries: [] };
        }));
      }
      if (canSeePay) setPay(await loadPayBasis());
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [period, canManage, canSeePay]);

  useEffect(() => {
    void reload();
  }, [reload, version, rateVersion]);

  const names = useMemo(() => new Map(people.map((p) => [p.employee_number, p.name || p.employee_number])), [people]);
  const figures = rows.map((r) => {
    const basis = pay.get(r.employee_number);
    const amounts = overtimePayFor(r, basis?.basic ?? 0, basis?.ownRate, settings);
    return { row: r, basis, amounts };
  });
  const total = round2(figures.reduce((s, f) => s + f.amounts.total, 0));
  const totalHours = round2(rows.reduce((s, r) => s + Number(r.normal_hours) + Number(r.rest_hours) + Number(r.holiday_hours), 0));

  return (
    <Card padding="none">
      <div className="flex flex-wrap items-center gap-3 p-3 border-b border-border text-xs text-ink">
        <label className="inline-flex items-center gap-2">
          <span className="font-semibold">Month</span>
          <input type="month" aria-label="Month" className="rounded-lg border border-border px-2 py-1" value={period}
            onChange={(e) => e.target.value && setPeriod(e.target.value)} />
        </label>
        <span className="text-muted-foreground">
          {totalHours} approved {totalHours === 1 ? 'hour' : 'hours'}{canSeePay ? `, ${formatKsh(total)}` : ''}
        </span>
        {canManage && !settings.enabled && <span className="text-status-danger font-semibold">Overtime is turned off in the payroll settings</span>}
      </div>
      {rows.length === 0 ? (
        loading ? <LoaderBlock label="Loading" compact /> : <EmptyState icon={<Clock className="w-5 h-5" />} title="No approved overtime this month" />
      ) : (
        <TableScroll>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] text-muted-foreground border-b border-border">
                <th className="px-3 py-2 font-semibold">Employee</th>
                <th className="px-3 py-2 font-semibold text-right">Working days ({settings.normalMultiplier}×)</th>
                <th className="px-3 py-2 font-semibold text-right">Rest days ({settings.restMultiplier}×)</th>
                <th className="px-3 py-2 font-semibold text-right">Public holidays ({settings.holidayMultiplier}×)</th>
                {canManage && <th className="px-3 py-2 font-semibold text-right">Over the cap</th>}
                {canSeePay && <th className="px-3 py-2 font-semibold text-right">An hour&apos;s pay</th>}
                {canSeePay && <th className="px-3 py-2 font-semibold text-right">Overtime pay</th>}
              </tr>
            </thead>
            <tbody>
              {figures.map(({ row, basis, amounts }) => (
                <tr key={row.employee_number} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <div className="font-semibold text-ink">{names.get(row.employee_number) ?? row.employee_number}</div>
                    <div className="text-[10.5px] text-subtle">{row.employee_number}</div>
                  </td>
                  <td className="px-3 py-2 text-right">{Number(row.normal_hours)} h</td>
                  <td className="px-3 py-2 text-right">{Number(row.rest_hours)} h</td>
                  <td className="px-3 py-2 text-right">{Number(row.holiday_hours)} h</td>
                  {canManage && <td className="px-3 py-2 text-right text-muted-foreground">{Number(row.over_cap_hours) > 0 ? `${Number(row.over_cap_hours)} h unpaid` : ''}</td>}
                  {canSeePay && (
                    <td className="px-3 py-2 text-right">
                      <RateCell employeeNumber={row.employee_number} ownRate={basis?.ownRate ?? null} rate={amounts.hourlyRate}
                        onSaved={() => setRateVersion((v) => v + 1)} />
                    </td>
                  )}
                  {canSeePay && <td className="px-3 py-2 text-right font-semibold text-ink">{formatKsh(amounts.total)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      <p className="px-3 py-2 text-[11px] text-muted-foreground border-t border-border">
        {canSeePay
          ? `Hours × an hour's pay × the multiplier. An hour's pay is basic salary ÷ ${settings.monthlyHours} unless the employee has their own rate (click it to change). Payroll adds this to the month's payslips when it is worked out.`
          : 'Approved hours this month. Payroll works out the pay.'}
      </p>
    </Card>
  );
}
