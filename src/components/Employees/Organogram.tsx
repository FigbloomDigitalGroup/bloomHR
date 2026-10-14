import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, ChevronDown, ChevronRight, ListTree, Minus, Network, Plus, Printer, RotateCcw, Users } from 'lucide-react';
import { Button, Card, EmptyState, PageHeader, SearchInput } from '../UI';
import FigbloomLoader from '../UI/FigbloomLoader';
import { useEmployeeDirectory } from '../../hooks/useEmployeeDirectory';
import { useDepartments } from '../../hooks/useDepartments';
import { usePermissions } from '../../hooks/usePermissions';
import type { DirectoryEmployee } from '../../lib/employeeDirectory';
import {
  Department,
  TreeNode,
  countBelow,
  departmentTree,
  filterTree,
  flatten,
  isCurrentEmployee,
  reportingTree,
} from '../../lib/orgStructure';

type View = 'people' | 'departments';
type Layout = 'chart' | 'list';

/** What one box of the chart shows, for either view. */
interface Box {
  id: string;
  title: string;
  subtitle: string;
  detail: string;
  photo?: string;
  initials: string;
  department?: boolean;
  link?: string;
}

const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 1.6;
// open on the first levels only: a company of thousands would otherwise draw everyone at once
const OPEN_DEPTH = 2;

const isWide = () => {
  try {
    return window.matchMedia('(min-width: 768px)').matches;
  } catch {
    return true;
  }
};

function Avatar({ box, size = 36 }: { box: Box; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (box.department) {
    return (
      <div className="shrink-0 rounded-tile bg-green-tint text-brand flex items-center justify-center" style={{ width: size, height: size }}>
        <Building2 className="w-4 h-4" strokeWidth={1.8} />
      </div>
    );
  }
  if (box.photo && !broken) {
    return <img src={box.photo} alt="" onError={() => setBroken(true)} className="shrink-0 rounded-full object-cover border border-border" style={{ width: size, height: size }} />;
  }
  return (
    <div className="shrink-0 rounded-full bg-brand text-white flex items-center justify-center text-[11px] font-bold" style={{ width: size, height: size }}>
      {box.initials}
    </div>
  );
}

function BoxText({ box }: { box: Box }) {
  const title = box.link ? (
    <Link to={box.link} className="text-ink hover:underline">{box.title}</Link>
  ) : box.title;
  return (
    <div className="min-w-0">
      <div className="text-[12.5px] font-bold text-ink truncate">{title}</div>
      {box.subtitle && <div className="text-[11px] text-muted-foreground truncate">{box.subtitle}</div>}
      {box.detail && <div className="text-[10.5px] text-subtle truncate">{box.detail}</div>}
    </div>
  );
}

interface TreeProps {
  forest: TreeNode<Box>[];
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
}

/** The chart: boxes with their reports below, joined by lines. */
function ChartLevel({ forest, isOpen, toggle }: TreeProps) {
  return (
    <div className="flex items-start justify-center">
      {forest.map((node, i) => {
        const open = isOpen(node.item.id);
        const below = node.children.length;
        return (
          <div key={node.item.id} className="relative flex flex-col items-center px-2 pt-5 break-inside-avoid">
            {/* the lines up to the parent: a stub, and the rail joining the siblings */}
            <span aria-hidden className="absolute top-0 left-1/2 h-5 w-px bg-border" />
            {forest.length > 1 && (
              <span aria-hidden className="absolute top-0 h-px bg-border" style={{ left: i === 0 ? '50%' : 0, right: i === forest.length - 1 ? '50%' : 0 }} />
            )}
            <div data-testid="org-box" className="w-[200px] rounded-card border border-border bg-white shadow-sm px-3 py-2.5 flex items-center gap-2.5 text-left">
              <Avatar box={node.item} />
              <BoxText box={node.item} />
            </div>
            {below > 0 && (
              <button
                type="button"
                onClick={() => toggle(node.item.id)}
                aria-expanded={open}
                aria-label={`${open ? 'Hide' : 'Show'} ${below} under ${node.item.title}`}
                className="relative z-10 -mt-2 rounded-pill border border-border bg-white px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground hover:text-ink print:hidden"
              >
                {open ? '−' : `+${countBelow(node)}`}
              </button>
            )}
            {below > 0 && open && (
              <div className="relative pt-3">
                <span aria-hidden className="absolute top-0 left-1/2 h-3 w-px bg-border" />
                <ChartLevel forest={node.children} isOpen={isOpen} toggle={toggle} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The list: an indented, collapsible outline (phones, and anyone who prefers it). */
function ListLevel({ forest, isOpen, toggle }: TreeProps) {
  return (
    <ul className="m-0 p-0 list-none" role="group">
      {forest.map((node) => {
        const open = isOpen(node.item.id);
        const below = node.children.length;
        return (
          <li key={node.item.id} role="treeitem" aria-expanded={below ? open : undefined} className="break-inside-avoid">
            <div className="flex items-center gap-2 py-2 pr-2 border-b border-border" style={{ paddingLeft: 8 + Math.min(node.depth, 8) * 18 }}>
              {below > 0 ? (
                <button type="button" onClick={() => toggle(node.item.id)} aria-label={`${open ? 'Hide' : 'Show'} ${below} under ${node.item.title}`} className="p-1 rounded text-subtle hover:text-ink print:hidden">
                  {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>
              ) : (
                <span className="w-[22px] shrink-0 print:hidden" />
              )}
              <Avatar box={node.item} size={30} />
              <div data-testid="org-box" className="min-w-0 flex-1">
                <BoxText box={node.item} />
              </div>
              {below > 0 && <span className="text-[11px] text-subtle shrink-0">{countBelow(node)}</span>}
            </div>
            {below > 0 && open && <ListLevel forest={node.children} isOpen={isOpen} toggle={toggle} />}
          </li>
        );
      })}
    </ul>
  );
}

const mapTree = <T, U>(forest: TreeNode<T>[], f: (t: T) => U): TreeNode<U>[] =>
  forest.map((n) => ({ item: f(n.item), depth: n.depth, children: mapTree(n.children, f) }));

/**
 * The organogram: who reports to whom (people, with photo, name and title), or the departments with their heads and
 * people. Search shows the matches where they sit; boxes open and close; the chart zooms and pans (drag it); phones
 * get the list; Print prints what is open.
 */
export default function Organogram() {
  const { employees, loading: peopleLoading, error: peopleError } = useEmployeeDirectory();
  const { departments, loading: deptLoading } = useDepartments();
  const { hasPermission } = usePermissions();
  const canOpenRecords = hasPermission('employees');

  const [view, setView] = useState<View>('people');
  const [layout, setLayout] = useState<Layout>(() => (isWide() ? 'chart' : 'list'));
  const [query, setQuery] = useState('');
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [openAll, setOpenAll] = useState(false);
  const [zoom, setZoom] = useState(1);

  const staff = useMemo(() => employees.filter((e) => e.id && isCurrentEmployee(e)), [employees]);
  const deptName = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments]);

  const personBox = (e: DirectoryEmployee): Box => ({
    id: e.id,
    title: e.fullName,
    subtitle: e.jobTitle,
    detail: (e.departmentId && deptName.get(e.departmentId)) || e.department,
    photo: e.photo,
    initials: initialsOf(e.fullName),
    link: canOpenRecords ? `/view-employee/${encodeURIComponent(e.employeeNumber)}` : undefined,
  });

  const forest = useMemo<TreeNode<Box>[]>(() => {
    if (view === 'people') return mapTree(reportingTree(staff), personBox);
    // departments, each with its people (the head first) under any sub-departments
    const byId = new Map(staff.map((e) => [e.id, e]));
    const members = new Map<string, DirectoryEmployee[]>();
    for (const e of staff) if (e.departmentId) members.set(e.departmentId, [...(members.get(e.departmentId) || []), e]);
    const deptBox = (d: Department): Box => {
      const head = d.head_employee_id ? byId.get(d.head_employee_id) : undefined;
      const n = members.get(d.id)?.length || 0;
      return {
        id: `dept:${d.id}`,
        title: d.name,
        subtitle: head ? `Head: ${head.fullName}` : '',
        detail: `${n} ${n === 1 ? 'person' : 'people'}`,
        initials: '',
        department: true,
      };
    };
    const withPeople = (nodes: TreeNode<Department>[]): TreeNode<Box>[] =>
      nodes.map((n) => {
        const people = [...(members.get(n.item.id) || [])].sort((a, b) =>
          a.id === n.item.head_employee_id ? -1 : b.id === n.item.head_employee_id ? 1 : a.fullName.localeCompare(b.fullName));
        return {
          item: deptBox(n.item),
          depth: n.depth,
          children: [
            ...withPeople(n.children),
            ...people.map((p) => ({ item: personBox(p), depth: n.depth + 1, children: [] })),
          ],
        };
      });
    const tree = withPeople(departmentTree(departments.filter((d) => d.active || members.has(d.id))));
    const unplaced = staff.filter((e) => !e.departmentId || !deptName.has(e.departmentId));
    if (unplaced.length) {
      tree.push({
        item: { id: 'dept:none', title: 'No department', subtitle: '', detail: `${unplaced.length} ${unplaced.length === 1 ? 'person' : 'people'}`, initials: '', department: true },
        depth: 0,
        children: unplaced.sort((a, b) => a.fullName.localeCompare(b.fullName)).map((p) => ({ item: personBox(p), depth: 1, children: [] })),
      });
    }
    return tree;
    // personBox only reads deptName and canOpenRecords
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, staff, departments, deptName, canOpenRecords]);

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () => (q ? filterTree(forest, (b) => [b.title, b.subtitle, b.detail].join(' ').toLowerCase().includes(q)) : forest),
    [forest, q]
  );

  const depthOf = useMemo(() => new Map(flatten(forest).map((n) => [n.item.id, n.depth])), [forest]);
  // open: the first levels, everything while searching or printing, flipped by a click
  const isOpen = (id: string) => {
    if (openAll || q) return !toggled.has(id);
    const node = depthOf.get(id);
    return (node !== undefined && node < OPEN_DEPTH - 1) !== toggled.has(id);
  };
  const toggle = (id: string) =>
    setToggled((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  useEffect(() => setToggled(new Set()), [view, q, openAll]);

  const print = () => {
    setOpenAll(true);
    setTimeout(() => window.print(), 50);
  };

  // drag to pan the chart
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, a') || !scroller.current) return;
    drag.current = { x: e.clientX, y: e.clientY, left: scroller.current.scrollLeft, top: scroller.current.scrollTop };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !scroller.current) return;
    scroller.current.scrollLeft = drag.current.left - (e.clientX - drag.current.x);
    scroller.current.scrollTop = drag.current.top - (e.clientY - drag.current.y);
  };
  const endDrag = () => {
    drag.current = null;
  };

  const loading = peopleLoading || deptLoading;
  const people = staff.length;
  const toggleButton = (active: boolean, onClick: () => void, icon: ReactNode, label: string) => (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-tile text-[12px] font-semibold ${active ? 'bg-white text-ink shadow-sm' : 'text-muted-foreground hover:text-ink'}`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="max-w-[1400px] mx-auto">
      <PageHeader
        title="Organogram"
        subtitle={loading ? 'Loading...' : `${people} ${people === 1 ? 'person' : 'people'} · ${departments.filter((d) => d.active).length} departments`}
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            {canOpenRecords && (
              <Link to="/departments">
                <Button variant="secondary" icon={<Building2 className="w-3.5 h-3.5" strokeWidth={2} />}>Departments</Button>
              </Link>
            )}
            <Button variant="secondary" onClick={print} icon={<Printer className="w-3.5 h-3.5" strokeWidth={2} />}>Print</Button>
          </div>
        }
      />

      <div className="flex flex-col lg:flex-row lg:items-center gap-2.5 mb-3 print:hidden">
        <div role="group" aria-label="View by" className="inline-flex rounded-tile bg-secondary p-0.5 self-start">
          {toggleButton(view === 'people', () => setView('people'), <Users className="w-3.5 h-3.5" />, 'People')}
          {toggleButton(view === 'departments', () => setView('departments'), <Building2 className="w-3.5 h-3.5" />, 'Departments')}
        </div>
        <div role="group" aria-label="Layout" className="inline-flex rounded-tile bg-secondary p-0.5 self-start">
          {toggleButton(layout === 'chart', () => setLayout('chart'), <Network className="w-3.5 h-3.5" />, 'Chart')}
          {toggleButton(layout === 'list', () => setLayout('list'), <ListTree className="w-3.5 h-3.5" />, 'List')}
        </div>
        <div className="flex-1">
          <SearchInput placeholder="Search by name, title or department..." value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search the organogram" />
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="secondary" onClick={() => setOpenAll((v) => !v)}>{openAll ? 'Collapse' : 'Expand all'}</Button>
          {layout === 'chart' && (
            <>
              <Button variant="secondary" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(MIN_ZOOM, +(z - 0.1).toFixed(2)))} icon={<Minus className="w-3.5 h-3.5" />}>{''}</Button>
              <span className="w-10 text-center text-[11.5px] text-muted-foreground" aria-live="polite">{Math.round(zoom * 100)}%</span>
              <Button variant="secondary" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, +(z + 0.1).toFixed(2)))} icon={<Plus className="w-3.5 h-3.5" />}>{''}</Button>
              <Button variant="ghost" aria-label="Reset zoom" onClick={() => setZoom(1)} icon={<RotateCcw className="w-3.5 h-3.5" />}>{''}</Button>
            </>
          )}
        </div>
      </div>

      <Card className="!p-0 overflow-hidden print:border-0 print:shadow-none">
        {loading ? (
          <div className="flex justify-center p-8"><FigbloomLoader label="Loading the organogram" /></div>
        ) : peopleError ? (
          <p className="m-0 p-4 text-[12.5px] text-status-danger" role="alert">Could not load employees: {peopleError}</p>
        ) : shown.length === 0 ? (
          <EmptyState icon={<Network className="w-5 h-5" />} title={q ? 'Nobody matches' : 'Nobody here yet'} description={q ? undefined : 'Add employees and who they report to.'} />
        ) : layout === 'list' ? (
          <div role="tree" aria-label="Organogram">
            <ListLevel forest={shown} isOpen={isOpen} toggle={toggle} />
          </div>
        ) : (
          <div
            ref={scroller}
            className="overflow-auto max-h-[75vh] cursor-grab active:cursor-grabbing select-none print:max-h-none print:overflow-visible"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
          >
            <div role="tree" aria-label="Organogram" className="inline-block min-w-full p-4 origin-top-left print:!transform-none" style={{ transform: `scale(${zoom})` }}>
              <ChartLevel forest={shown} isOpen={isOpen} toggle={toggle} />
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
