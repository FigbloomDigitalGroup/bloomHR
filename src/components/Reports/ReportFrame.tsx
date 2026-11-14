import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Download, FileSearch } from 'lucide-react';
import { Button, Card, EmptyState, PageHeader, TableScroll } from '../UI';
import FigbloomLoader from '../UI/FigbloomLoader';
import { useBranches } from '../../hooks/useBranches';
import { useDepartments } from '../../hooks/useDepartments';

// The frame every report in Reports shares: back to the list, the title, the filters, the summary cards, then the
// tables; with a download and the same loading / problem / empty states, so the reports look and behave alike.

export const th = 'px-3 py-2 text-left text-[11px] font-bold text-muted-foreground whitespace-nowrap';
export const thNum = `${th} text-right`;
export const td = 'px-3 py-2 text-[12.5px] text-ink whitespace-nowrap';
export const tdNum = `${td} text-right tabular-nums`;

export function ReportFrame({
  title,
  subtitle,
  filters,
  onDownload,
  downloadLabel = 'Download Excel',
  loading,
  problems = [],
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  filters?: ReactNode;
  /** downloads what is shown (absent: no download button) */
  onDownload?: () => void;
  downloadLabel?: string;
  loading?: boolean;
  /** what couldn't be read (shown above the report, which still shows the rest) */
  problems?: string[];
  children: ReactNode;
}) {
  return (
    <div className="p-4 md:p-6 max-w-[1500px] mx-auto space-y-4">
      <Link to="/reports" className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand hover:underline">
        <ArrowLeft className="w-3.5 h-3.5" aria-hidden />
        All reports
      </Link>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          onDownload ? (
            <Button icon={<Download className="w-4 h-4" />} onClick={onDownload} disabled={loading}>
              {downloadLabel}
            </Button>
          ) : undefined
        }
      />
      {filters && (
        <Card className="flex flex-wrap items-end gap-3" padding="sm">
          {filters}
        </Card>
      )}
      {problems.length > 0 && (
        <div role="alert" className="flex items-start gap-2 rounded-tile border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-[12px] text-ink">
          <AlertTriangle className="w-4 h-4 shrink-0 text-status-warning mt-0.5" aria-hidden />
          <span>{problems.join(' ')}</span>
        </div>
      )}
      {loading ? (
        <div className="py-16 flex justify-center">
          <FigbloomLoader />
        </div>
      ) : (
        children
      )}
    </div>
  );
}

/** A labelled filter field. */
export function Filter({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] font-semibold text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

export const filterInput = 'rounded-tile border border-border bg-white px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-brand min-w-[9rem]';

/** A month picker ("2026-11"). */
export function MonthFilter({ label = 'Month', value, onChange, max }: { label?: string; value: string; onChange: (month: string) => void; max?: string }) {
  return (
    <Filter label={label}>
      <input type="month" className={filterInput} value={value} max={max} onChange={(e) => e.target.value && onChange(e.target.value)} />
    </Filter>
  );
}

/** The company's branches ("All branches" first). */
export function BranchFilter({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { branches } = useBranches();
  if (branches.length < 2) return null;
  return (
    <Filter label="Branch">
      <select className={filterInput} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All branches</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </Filter>
  );
}

/** The company's departments ("All departments" first). */
export function DepartmentFilter({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { departments } = useDepartments();
  if (departments.length === 0) return null;
  return (
    <Filter label="Department">
      <select className={filterInput} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All departments</option>
        {departments.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </Filter>
  );
}

/** A search box for names and employee numbers. */
export function SearchFilter({ value, onChange, placeholder = 'Name or employee number' }: { value: string; onChange: (q: string) => void; placeholder?: string }) {
  return (
    <Filter label="Search">
      <input type="search" className={`${filterInput} min-w-[14rem]`} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </Filter>
  );
}

/** A titled table card; `empty` when there are no rows. */
export function ReportTable({
  title,
  note,
  head,
  empty,
  emptyText = 'Nothing for this period',
  children,
  foot,
}: {
  title?: string;
  note?: ReactNode;
  head: ReactNode;
  empty?: boolean;
  emptyText?: string;
  children: ReactNode;
  foot?: ReactNode;
}) {
  return (
    <Card padding="none" className="overflow-hidden">
      {(title || note) && (
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 border-b border-border">
          {title && <h2 className="text-[13.5px] font-bold text-ink">{title}</h2>}
          {note && <span className="text-[11.5px] text-muted-foreground">{note}</span>}
        </div>
      )}
      {empty ? (
        <EmptyState icon={<FileSearch className="w-5 h-5" />} title={emptyText} />
      ) : (
        <TableScroll>
          <table className="w-full">
            <thead className="bg-secondary/60 border-b border-border">{head}</thead>
            <tbody className="divide-y divide-border">{children}</tbody>
            {foot && <tfoot className="border-t-2 border-border bg-secondary/40 font-bold">{foot}</tfoot>}
          </table>
        </TableScroll>
      )}
    </Card>
  );
}

/** A grid for the summary cards. */
export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{children}</div>;
}
