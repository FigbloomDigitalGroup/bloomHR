import { useEffect, useMemo, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { leaveYearLabel, leaveYearOf } from '../../lib/leaveAccrual';
import { forfeitCsv, forfeitWhy, summariseForfeits } from '../../lib/leaveForfeit';
import { ForfeitRow, loadForfeitReport } from '../../lib/leaveYearDb';

const download = (fileName: string, csv: string) => {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
};

const days = (n: number) => `${+Number(n).toFixed(2)} ${Number(n) === 1 ? 'day' : 'days'}`;
const kes = (n: number | null) =>
  n == null ? '' : `KSh ${Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Leave > Forfeited & paid out (FIG-877): days lost over the carry-forward cap at the yearly reset or when carried days
 * passed their deadline, and days over the cap paid out instead, per employee and leave type, for one leave year.
 */
export default function LeaveForfeitReport({ startMonth }: { startMonth: number }) {
  const today = new Date();
  const thisYear = leaveYearOf(new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())), startMonth);
  const [year, setYear] = useState<number | null>(thisYear);
  const [rows, setRows] = useState<ForfeitRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadForfeitReport(year)
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch((err) => {
        if (!cancelled) setError((err as { message?: string })?.message || 'Could not load the report.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [year]);

  const summary = useMemo(() => summariseForfeits(rows), [rows]);
  const years = [thisYear - 2, thisYear - 1, thisYear, thisYear + 1];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-base text-gray-900">Forfeited &amp; paid out</h3>
          <p className="text-xs text-gray-500 mt-1">
            Leave days lost over the carry-forward cap at the yearly reset, or because carried-over days weren't used by their deadline,
            and days over the cap paid out instead (each leave type's setting, under Leave Types).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={year ?? ''}
            onChange={(e) => setYear(e.target.value ? Number(e.target.value) : null)}
            className="border border-gray-300 rounded-md px-3 py-2 text-xs focus:ring-2 focus:ring-brand/20 focus:border-brand"
            aria-label="Leave year"
          >
            {years.map((y) => <option key={y} value={y}>{leaveYearLabel(y, startMonth)}</option>)}
            <option value="">All years</option>
          </select>
          <button
            onClick={() => download(`leave-forfeited-paid-out-${year ?? 'all'}.csv`, forfeitCsv(rows))}
            disabled={rows.length === 0}
            className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 hover:bg-gray-50 disabled:opacity-50 rounded-lg text-xs font-medium text-gray-700"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-gray-500">No leave was lost or paid out {year ? `in ${leaveYearLabel(year, startMonth)}` : 'yet'}.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            <div className="rounded-lg border border-gray-200 p-3"><p className="text-gray-500">Days lost</p><p className="text-lg text-gray-900">{+summary.lost.toFixed(2)}</p></div>
            <div className="rounded-lg border border-gray-200 p-3"><p className="text-gray-500">Days paid out</p><p className="text-lg text-gray-900">{+summary.paidOut.toFixed(2)}</p></div>
            <div className="rounded-lg border border-gray-200 p-3"><p className="text-gray-500">Employees</p><p className="text-lg text-gray-900">{new Set(rows.map((r) => r.employee_number)).size}</p></div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-2 pr-3 font-medium">Employee</th>
                  <th className="py-2 pr-3 font-medium">Leave type</th>
                  <th className="py-2 pr-3 font-medium text-right">Days lost</th>
                  <th className="py-2 pr-3 font-medium text-right">Days paid out</th>
                </tr>
              </thead>
              <tbody>
                {summary.byEmployee.map((s) => (
                  <tr key={`${s.employee_number}::${s.leave_type}`} className="border-b border-gray-100">
                    <td className="py-2 pr-3">{s.employee_name} <span className="text-gray-400">{s.employee_number}</span></td>
                    <td className="py-2 pr-3">{s.leave_type}</td>
                    <td className="py-2 pr-3 text-right">{s.lost ? +s.lost.toFixed(2) : ''}</td>
                    <td className="py-2 pr-3 text-right">{s.paid_out ? +s.paid_out.toFixed(2) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-800 mb-2">Every change</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-200">
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Employee</th>
                    <th className="py-2 pr-3 font-medium">Leave type</th>
                    <th className="py-2 pr-3 font-medium text-right">Days</th>
                    <th className="py-2 pr-3 font-medium">Why</th>
                    <th className="py-2 pr-3 font-medium">Payout</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b border-gray-100 align-top">
                      <td className="py-2 pr-3 whitespace-nowrap">{String(r.on_date).slice(0, 10)}</td>
                      <td className="py-2 pr-3">{r.employee_name}</td>
                      <td className="py-2 pr-3">{r.leave_type}</td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">{days(r.days)}</td>
                      <td className="py-2 pr-3">{forfeitWhy(r)}{r.note ? <span className="block text-gray-400">{r.note}</span> : null}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {r.kind === 'pay_out' ? (r.status === 'paid' ? `Paid ${r.pay_period ?? ''} ${kes(r.amount)}` : `Waiting for payroll (from ${r.pay_period ?? ''})`) : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
