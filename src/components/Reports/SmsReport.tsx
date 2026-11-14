import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, MessageSquare, Wallet } from 'lucide-react';
import { StatCard, StatusPill, type StatusTone } from '../UI';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../../lib/fetchAll';
import { money } from '../../lib/payroll/currency';
import { type Row, downloadXlsx, plural } from '../../lib/reports/reportKit';
import {
  SMS_SHEET_HEADERS,
  dayRange,
  filterSms,
  shortMessage,
  smsByDay,
  smsByType,
  smsFailures,
  smsOptions,
  smsOutcome,
  smsRecent,
  smsSheet,
  smsStatusLabel,
  smsSummary,
  smsTypeLabel,
} from '../../lib/reports/operationsReports';
import { Filter, ReportFrame, ReportTable, StatGrid, filterInput, td, tdNum, th, thNum } from './ReportFrame';

// The SMS report: what the company sent in a period, what failed and what it cost, from sms_logs.

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const when = (createdAt: unknown) => {
  const d = new Date(String(createdAt ?? ''));
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const dayLabel = (day: string) =>
  new Date(`${day}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

const TONES: Record<ReturnType<typeof smsOutcome>, StatusTone> = { delivered: 'success', failed: 'danger', pending: 'warning' };

export default function SmsReport() {
  const today = localDay(new Date());
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [logs, setLogs] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [problems, setProblems] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const [start, end] = dayRange(from <= to ? from : to, from <= to ? to : from);
    fetchAll<Row>((a, b) =>
      supabase
        .from('sms_logs')
        .select('id, message, recipient_phone, status, error_message, message_id, sender_id, sms_type, cost, created_at')
        .gte('created_at', start)
        .lt('created_at', end)
        .order('created_at')
        .order('id')
        .range(a, b)
    )
      .then((rows) => {
        if (cancelled) return;
        setLogs(rows);
        setProblems([]);
      })
      .catch(() => {
        if (cancelled) return;
        setLogs([]);
        setProblems(["The SMS log couldn't be read. You may not have access to SMS."]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  // the chosen status / type stays on offer when a new period has none of it
  const options = useMemo(() => {
    const o = smsOptions(logs);
    const keep = (list: string[], v: string) => (v && !list.includes(v) ? [...list, v].sort() : list);
    return { statuses: keep(o.statuses, status), types: keep(o.types, type) };
  }, [logs, status, type]);
  const shown = useMemo(() => filterSms(logs, { status, type }), [logs, status, type]);
  const summary = useMemo(() => smsSummary(shown), [shown]);
  const byDay = useMemo(() => smsByDay(shown), [shown]);
  const byType = useMemo(() => smsByType(shown), [shown]);
  const failures = useMemo(() => smsFailures(shown), [shown]);
  const recent = useMemo(() => smsRecent(shown, 50), [shown]);

  const download = () => downloadXlsx(`SMS report ${from} to ${to}`, SMS_SHEET_HEADERS, smsSheet(shown), 'SMS');

  const filters = (
    <>
      <Filter label="From">
        <input type="date" className={filterInput} value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
      </Filter>
      <Filter label="To">
        <input type="date" className={filterInput} value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
      </Filter>
      <Filter label="Status">
        <select className={filterInput} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {options.statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Filter>
      <Filter label="Type">
        <select className={filterInput} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {options.types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Filter>
    </>
  );

  return (
    <ReportFrame
      title="SMS report"
      subtitle="Messages sent, what failed and what it cost."
      filters={filters}
      onDownload={shown.length ? download : undefined}
      loading={loading}
      problems={problems}
    >
      <div className="space-y-4">
        <StatGrid>
          <StatCard label="Messages sent" value={summary.total.toLocaleString()} icon={<MessageSquare className="w-[18px] h-[18px]" strokeWidth={1.8} />} tint="info" />
          <StatCard
            label="Delivered or accepted"
            value={summary.delivered.toLocaleString()}
            icon={<CheckCircle2 className="w-[18px] h-[18px]" strokeWidth={1.8} />}
            tint="green"
            note={summary.pending ? `${plural(summary.pending, 'message')} waiting` : undefined}
          />
          <StatCard
            label="Failed"
            value={summary.failed.toLocaleString()}
            icon={<AlertTriangle className="w-[18px] h-[18px]" strokeWidth={1.8} />}
            tint="danger"
            note={summary.failedShare !== null ? `${summary.failedShare}% of messages` : undefined}
          />
          {summary.cost !== null && (
            <StatCard label="Total cost" value={money(summary.cost, 'KES')} icon={<Wallet className="w-[18px] h-[18px]" strokeWidth={1.8} />} tint="purple" />
          )}
        </StatGrid>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ReportTable
            title="By day"
            empty={byDay.length === 0}
            emptyText="No messages in this period"
            head={
              <tr>
                <th className={th}>Date</th>
                <th className={thNum}>Sent</th>
                <th className={thNum}>Failed</th>
              </tr>
            }
          >
            {byDay.map((r) => (
              <tr key={r.day}>
                <td className={td}>{dayLabel(r.day)}</td>
                <td className={tdNum}>{r.sent.toLocaleString()}</td>
                <td className={tdNum}>{r.failed.toLocaleString()}</td>
              </tr>
            ))}
          </ReportTable>

          <ReportTable
            title="By type"
            empty={byType.length === 0}
            emptyText="No messages in this period"
            head={
              <tr>
                <th className={th}>Type</th>
                <th className={thNum}>Messages</th>
                <th className={thNum}>Failed</th>
                <th className={thNum}>Cost</th>
              </tr>
            }
          >
            {byType.map((r) => (
              <tr key={r.type}>
                <td className={td}>{r.type}</td>
                <td className={tdNum}>{r.count.toLocaleString()}</td>
                <td className={tdNum}>{r.failed.toLocaleString()}</td>
                <td className={tdNum}>{r.cost === null ? '—' : money(r.cost, 'KES')}</td>
              </tr>
            ))}
          </ReportTable>
        </div>

        <ReportTable
          title="Failures"
          note={failures.length ? plural(failures.length, 'failed message') : undefined}
          empty={failures.length === 0}
          emptyText="No failed messages in this period"
          head={
            <tr>
              <th className={th}>When</th>
              <th className={th}>Recipient</th>
              <th className={th}>Type</th>
              <th className={th}>Error</th>
            </tr>
          }
        >
          {failures.map((l) => (
            <tr key={l.id}>
              <td className={td}>{when(l.created_at)}</td>
              <td className={td}>{l.recipient_phone || '—'}</td>
              <td className={td}>{smsTypeLabel(l.sms_type)}</td>
              <td className={`${td} whitespace-normal`}>{l.error_message || 'No reason given'}</td>
            </tr>
          ))}
        </ReportTable>

        <ReportTable
          title="Recent messages"
          note={shown.length > recent.length ? `Latest ${recent.length} of ${shown.length.toLocaleString()}` : undefined}
          empty={recent.length === 0}
          emptyText="No messages in this period"
          head={
            <tr>
              <th className={th}>When</th>
              <th className={th}>Recipient</th>
              <th className={th}>Type</th>
              <th className={th}>Status</th>
              <th className={th}>Message</th>
            </tr>
          }
        >
          {recent.map((l) => (
            <tr key={l.id}>
              <td className={td}>{when(l.created_at)}</td>
              <td className={td}>{l.recipient_phone || '—'}</td>
              <td className={td}>{smsTypeLabel(l.sms_type)}</td>
              <td className={td}>
                <StatusPill label={smsStatusLabel(l.status)} tone={TONES[smsOutcome(l)]} />
              </td>
              <td className={`${td} whitespace-normal min-w-[16rem]`} title={l.message ?? undefined}>
                {shortMessage(l.message, 80)}
              </td>
            </tr>
          ))}
        </ReportTable>
      </div>
    </ReportFrame>
  );
}
