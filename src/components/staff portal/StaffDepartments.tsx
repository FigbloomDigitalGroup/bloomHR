import { useMemo } from 'react';
import { Building2, User } from 'lucide-react';
import { Card, EmptyState } from '../UI';
import FigbloomLoader from '../UI/FigbloomLoader';
import { useDepartments } from '../../hooks/useDepartments';
import { useCompanyDirectory } from '../../hooks/useCompanyDirectory';
import { TreeNode, departmentTree, flatten, type Department } from '../../lib/orgStructure';

/**
 * The company's departments for staff, read-only: nested as HR set them up, each with its head and how many people
 * are in it (sub-departments counted separately). People come from company_directory (safe columns only).
 */
export default function StaffDepartments() {
  const { departments, loading: deptLoading, error: deptError } = useDepartments();
  const { employees, loading: peopleLoading, error: peopleError } = useCompanyDirectory();

  const byId = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const headcount = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of employees) if (e.departmentId) m.set(e.departmentId, (m.get(e.departmentId) || 0) + 1);
    return m;
  }, [employees]);
  const rows = useMemo<TreeNode<Department>[]>(
    () => flatten(departmentTree(departments.filter((d) => d.active || headcount.has(d.id)))),
    [departments, headcount]
  );
  const unplaced = useMemo(
    () => employees.filter((e) => !e.departmentId || !departments.some((d) => d.id === e.departmentId)).length,
    [employees, departments]
  );

  if (deptLoading || peopleLoading) {
    return <div className="flex justify-center p-8"><FigbloomLoader label="Loading departments" /></div>;
  }
  const error = deptError || peopleError;
  if (error) {
    return <p className="m-0 p-4 text-[12.5px] text-status-danger" role="alert">Could not load departments: {error}</p>;
  }

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="m-0 text-[15px] font-bold text-ink">Departments</h2>
        <p className="m-0 mt-0.5 text-[12px] text-muted-foreground">
          {rows.length} {rows.length === 1 ? 'department' : 'departments'} · {employees.length} {employees.length === 1 ? 'person' : 'people'}
        </p>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<Building2 className="w-5 h-5" />} title="No departments yet" description="HR sets up the company's departments." />
      ) : (
        <ul className="m-0 p-0 list-none" aria-label="Departments">
          {rows.map((n) => {
            const head = n.item.head_employee_id ? byId.get(n.item.head_employee_id) : undefined;
            const count = headcount.get(n.item.id) || 0;
            return (
              <li
                key={n.item.id}
                data-testid="department-row"
                className="flex items-center gap-3 py-2.5 pr-4 border-b border-border last:border-b-0"
                style={{ paddingLeft: 16 + Math.min(n.depth, 6) * 18 }}
              >
                <span className="w-8 h-8 shrink-0 rounded-tile bg-green-tint text-brand flex items-center justify-center">
                  <Building2 className="w-4 h-4" strokeWidth={1.8} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-[13px] font-semibold text-ink truncate">{n.item.name}</p>
                  <p className="m-0 text-[11.5px] text-muted-foreground truncate flex items-center gap-1">
                    <User className="w-3 h-3 shrink-0" />
                    {head ? `Head: ${head.fullName}${head.jobTitle ? `, ${head.jobTitle}` : ''}` : 'No head set'}
                  </p>
                </div>
                <span className="shrink-0 text-[11.5px] font-semibold text-muted-foreground whitespace-nowrap">
                  {count} {count === 1 ? 'person' : 'people'}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {unplaced > 0 && rows.length > 0 && (
        <p className="m-0 px-4 py-2.5 border-t border-border text-[11.5px] text-muted-foreground">
          {unplaced} {unplaced === 1 ? 'person is' : 'people are'} not in a department yet.
        </p>
      )}
    </Card>
  );
}
