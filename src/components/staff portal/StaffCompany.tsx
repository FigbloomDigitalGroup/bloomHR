import CompanyCalendar from '../Calendar/CompanyCalendar';
import { OrganogramView } from '../Employees/Organogram';
import { TabBar } from '../UI';
import { useCompanyDirectory } from '../../hooks/useCompanyDirectory';
import MyApprovalChain from './MyApprovalChain';
import StaffDepartments from './StaffDepartments';
import { COMPANY_SECTIONS, CompanySection, isCompanySection } from '../../lib/staffCompany';

function StaffOrganogram() {
  const { employees, loading, error } = useCompanyDirectory();
  return <OrganogramView employees={employees} loading={loading} error={error} readOnly />;
}

/**
 * The staff portal's Company area, read-only for everyone: the company calendar (holidays, events, birthdays and the
 * employee's own leave), the organogram, the departments, and who approves the employee's leave. The tabs at the top
 * switch between them (handy on phones, where the sidebar is tucked away).
 */
export default function StaffCompany({
  section,
  onSectionChange,
  employeeNumber,
  onOpenTask,
}: {
  section: CompanySection;
  onSectionChange: (section: CompanySection) => void;
  /** the signed-in employee's number, for their own leave and tasks on the calendar ('' until known) */
  employeeNumber: string;
  /** opens one of the employee's tasks in the portal's Tasks */
  onOpenTask?: (taskId: string) => void;
}) {
  return (
    <div className="pt-2 md:pt-0">
      <div className="mb-4">
        <h1 className="m-0 text-xl md:text-2xl font-semibold text-gray-800">Company</h1>
        <p className="m-0 mt-1 text-xs text-gray-500">Your company’s calendar, structure and who approves your leave.</p>
      </div>
      <TabBar
        variant="pill"
        className="mb-4"
        items={COMPANY_SECTIONS.map((s) => ({ id: s.id, label: s.label }))}
        activeId={section}
        onChange={(id) => isCompanySection(id) && onSectionChange(id)}
      />
      {section === 'company-calendar' && <CompanyCalendar readOnly myEmployeeNumber={employeeNumber || null} onOpenTask={onOpenTask} />}
      {section === 'company-organogram' && <StaffOrganogram />}
      {section === 'company-departments' && <StaffDepartments />}
      {section === 'company-approvers' && <MyApprovalChain />}
    </div>
  );
}
