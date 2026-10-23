import { ReactNode } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CheckCircle2, Clock3, XCircle, CircleDashed } from 'lucide-react';
import type { MonthPoint } from '../../lib/dashboardStats';
import { monthLabel } from '../../lib/dashboardStats';
import useChartColors from './useChartColors';

// The dashboard's charts, drawn as one system: one data colour (the theme accent), thin marks with rounded data ends,
// solid hairline gridlines, text in the page's text colours (never the data colour), and every value also readable
// without hovering (direct labels, or a screen-reader table beside each chart).

const compact = (n: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

/** A chart card's heading: what it shows, and an optional line under it. */
export function ChartHeading({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-3">
      <div className="min-w-0">
        <h2 className="text-[13px] font-bold text-ink">{title}</h2>
        {subtitle && <p className="text-[11.5px] text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** A screen-reader twin of a chart: the same values as a table. */
function ChartTable({ caption, columns, rows }: { caption: string; columns: string[]; rows: (string | number)[][] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>{columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={String(r[0])}>{r.map((v, i) => (i === 0 ? <th key={i} scope="row">{v}</th> : <td key={i}>{v}</td>))}</tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * A small trend line for a stat tile: the history in a quiet grey, this month's point in the accent colour. Scaled to
 * its own range, so it shows the shape; the tile's figure carries the number.
 */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const colors = useChartColors();
  if (values.length < 2) return null;
  const w = 120;
  const h = 28;
  const pad = 4;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (w - pad * 2)) / (values.length - 1);
  const y = (v: number) => (max === min ? h / 2 : pad + (h - pad * 2) * (1 - (v - min) / span));
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values.length - 1;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-7" preserveAspectRatio="none" role="img" aria-label={label}>
      <polyline points={points} fill="none" stroke={colors.muted} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(last)} cy={y(values[last])} r={4} fill={colors.accent} stroke={colors.surface} strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * Horizontal bars for comparing a handful of named groups (towns, countries): one colour, the name on the left, the
 * value at the bar's tip. Long names wrap to a fixed column instead of crowding the bars.
 */
export function BarList({ rows, caption, unit = ['person', 'people'], format, max: fixedMax }: {
  rows: { name: string; value: number }[];
  caption: string;
  unit?: [string, string];
  /** how a value reads at the bar's tip ("86%"); the number by default */
  format?: (value: number) => string;
  /** the value a full bar stands for (100 for a percentage); the largest value by default */
  max?: number;
}) {
  const colors = useChartColors();
  const max = fixedMax ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2" aria-label={caption}>
      {rows.map((r) => (
        <li key={r.name} className="grid grid-cols-[minmax(0,7.5rem)_1fr_auto] sm:grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3">
          <span className="text-[12px] text-gray-700 truncate" title={r.name}>{r.name}</span>
          <span className="h-3 rounded-r bg-gray-100 overflow-hidden" aria-hidden="true">
            <span
              className="block h-full rounded-r"
              style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, backgroundColor: colors.accent }}
            />
          </span>
          <span className="text-[12px] font-semibold text-ink tabular-nums text-right min-w-[2ch]">
            {format ? format(r.value) : r.value.toLocaleString()}
            {!format && <span className="sr-only"> {r.value === 1 ? unit[0] : unit[1]}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Status colours: they mean approved / waiting / turned down, and always come with an icon and the word. */
const STATUS_STYLE: Record<string, { color: string; Icon: typeof CheckCircle2 }> = {
  Approved: { color: '#2E7D4F', Icon: CheckCircle2 },
  Pending: { color: '#E3A008', Icon: Clock3 },
  Rejected: { color: '#C0392B', Icon: XCircle },
  Declined: { color: '#C0392B', Icon: XCircle },
};
const OTHER_STATUS = { color: '#9CA3A0', Icon: CircleDashed };

/**
 * A whole split into its parts (leave requests by status): one bar cut into segments with a 2px gap, and a legend
 * under it with each part's icon, name, count and share, so nothing depends on telling colours apart.
 */
export function ShareBar({ rows, caption }: { rows: { name: string; value: number }[]; caption: string }) {
  const total = rows.reduce((t, r) => t + r.value, 0);
  if (total === 0) return null;
  const pct = (v: number) => Math.round((v / total) * 100);
  return (
    <div>
      <div className="flex h-3 w-full gap-[2px]" aria-hidden="true">
        {rows.map((r) => (
          <span
            key={r.name}
            className="h-full first:rounded-l last:rounded-r"
            style={{ flexGrow: r.value, flexBasis: 0, minWidth: 4, backgroundColor: (STATUS_STYLE[r.name] ?? OTHER_STATUS).color }}
            title={`${r.name}: ${r.value.toLocaleString()} (${pct(r.value)}%)`}
          />
        ))}
      </div>
      <ul className="mt-4 divide-y divide-gray-100" aria-label={caption}>
        {rows.map((r) => {
          const { color, Icon } = STATUS_STYLE[r.name] ?? OTHER_STATUS;
          return (
            <li key={r.name} className="flex items-center gap-2.5 py-2">
              <Icon className="w-4 h-4 shrink-0" style={{ color }} aria-hidden="true" />
              <span className="text-[12.5px] text-gray-700 flex-1 min-w-0 truncate">{r.name}</span>
              <span className="text-[12.5px] font-semibold text-ink tabular-nums">{r.value.toLocaleString()}</span>
              <span className="text-[11.5px] text-muted-foreground tabular-nums w-10 text-right">{pct(r.value)}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface TipPayload {
  name?: string;
  value?: number;
  color?: string;
  payload?: MonthPoint;
}

/** The hover card on the monthly charts: the month, then each series with its colour key. */
function MonthTooltip({ active, payload }: { active?: boolean; payload?: TipPayload[] }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-tile border border-border bg-white px-3 py-2 shadow-md text-[12px]">
      <div className="font-semibold text-ink mb-1">{point ? monthLabel(point.month, true) : ''}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: p.color }} aria-hidden="true" />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto pl-3 font-semibold text-ink tabular-nums">{(p.value ?? 0).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

const axisTick = (fill: string) => ({ fontSize: 11, fill });

/** Headcount at each month's end over the last year: one line with a light wash under it, the latest value labelled. */
export function HeadcountTrend({ points }: { points: MonthPoint[] }) {
  const colors = useChartColors();
  const latest = points[points.length - 1];
  const first = points[0];
  return (
    <div>
      {latest && first && (
        <p className="text-[12px] text-muted-foreground mb-2">
          <span className="text-2xl font-bold text-ink mr-1.5">{latest.headcount.toLocaleString()}</span>
          on staff at the end of {monthLabel(latest.month, true)}, from {first.headcount.toLocaleString()} in {monthLabel(first.month, true)}
        </p>
      )}
      <div aria-hidden="true">
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={points} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid stroke={colors.grid} vertical={false} />
            <XAxis dataKey="label" tick={axisTick(colors.axis)} tickLine={false} axisLine={{ stroke: colors.grid }} interval="preserveStartEnd" minTickGap={12} />
            <YAxis allowDecimals={false} tick={axisTick(colors.axis)} tickLine={false} axisLine={false} tickFormatter={compact} width={44} />
            <Tooltip content={<MonthTooltip />} cursor={{ stroke: colors.grid, strokeWidth: 1 }} />
            <Area
              type="monotone"
              dataKey="headcount"
              name="On staff"
              stroke={colors.accent}
              strokeWidth={2}
              fill={colors.accent}
              fillOpacity={0.1}
              dot={false}
              activeDot={{ r: 4, fill: colors.accent, stroke: colors.surface, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <ChartTable
        caption="People on staff at the end of each month"
        columns={['Month', 'On staff']}
        rows={points.map((p) => [monthLabel(p.month, true), p.headcount])}
      />
    </div>
  );
}

/** Joiners and leavers each month: two thin columns per month on one scale, with a legend above. */
export function JoinersLeavers({ points }: { points: MonthPoint[] }) {
  const colors = useChartColors();
  const joined = points.reduce((t, p) => t + p.joiners, 0);
  const left = points.reduce((t, p) => t + p.leavers, 0);
  const legend = [
    { name: 'Joined', color: colors.accent, total: joined },
    { name: 'Left', color: colors.second, total: left },
  ];
  return (
    <div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 mb-2" aria-label="Legend">
        {legend.map((l) => (
          <li key={l.name} className="flex items-center gap-1.5 text-[12px] text-gray-700">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: l.color }} aria-hidden="true" />
            {l.name}
            <span className="font-semibold text-ink tabular-nums">{l.total.toLocaleString()}</span>
          </li>
        ))}
      </ul>
      <div aria-hidden="true">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={points} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barGap={2} barCategoryGap="28%">
            <CartesianGrid stroke={colors.grid} vertical={false} />
            <XAxis dataKey="label" tick={axisTick(colors.axis)} tickLine={false} axisLine={{ stroke: colors.grid }} interval="preserveStartEnd" minTickGap={12} />
            <YAxis allowDecimals={false} tick={axisTick(colors.axis)} tickLine={false} axisLine={false} tickFormatter={compact} width={44} />
            <Tooltip content={<MonthTooltip />} cursor={{ fill: colors.grid, fillOpacity: 0.4 }} />
            <Bar dataKey="joiners" name="Joined" fill={colors.accent} radius={[4, 4, 0, 0]} maxBarSize={12} isAnimationActive={false} />
            <Bar dataKey="leavers" name="Left" fill={colors.second} radius={[4, 4, 0, 0]} maxBarSize={12} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartTable
        caption="People who joined and left each month"
        columns={['Month', 'Joined', 'Left']}
        rows={points.map((p) => [monthLabel(p.month, true), p.joiners, p.leavers])}
      />
    </div>
  );
}

/** "▲ 4% on September" / "▼ 2% on September" / "Same as September": a change in words, in text colours. */
export function ChangeNote({ change, against }: { change: number | null; against: string }) {
  if (change === null) return null;
  if (change === 0) return <span>Same as {against}</span>;
  const up = change > 0;
  return (
    <span>
      <span aria-hidden="true">{up ? '▲' : '▼'} </span>
      <span className="font-semibold text-gray-700">{up ? '+' : '−'}{Math.abs(change)}%</span> on {against}
    </span>
  );
}
