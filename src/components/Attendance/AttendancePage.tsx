import { useEffect, useMemo, useState } from 'react';
import { PageHeader, TabBar, type TabBarItem } from '../UI';
import FigbloomLoader from '../UI/FigbloomLoader';
import { loadAttendanceAccess, type AttendanceAccess } from '../../lib/attendanceApi';
import AttendanceDays from './AttendanceDays';
import WorkSchedules from './WorkSchedules';
import Scanners from './Scanners';

type TabId = 'days' | 'schedule' | 'scanners';

/**
 * Attendance (migration 20261023300000): who clocked in, late, absent or on leave over a range of days, each person's
 * day by day with HR's corrections, a CSV, the work schedules the days are measured against, and the door scanners
 * that clock people in (migration 20261023600000). HR sees everyone; a manager their reports.
 */
export default function AttendancePage() {
  const [access, setAccess] = useState<AttendanceAccess | null>(null);
  const [tab, setTab] = useState<TabId>('days');

  useEffect(() => {
    let cancelled = false;
    void loadAttendanceAccess().then((a) => {
      if (!cancelled) setAccess(a);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const tabs = useMemo<TabBarItem[]>(() => {
    const list: TabBarItem[] = [{ id: 'days', label: 'Attendance' }];
    if (access?.schedules) list.push({ id: 'schedule', label: 'Work schedule' });
    if (access?.manages) list.push({ id: 'scanners', label: 'Scanners' });
    return list;
  }, [access]);

  if (!access) return <FigbloomLoader />;

  return (
    <div className="min-w-0 p-4 sm:p-6">
      <PageHeader title="Attendance" subtitle="Clock-ins measured against each person's work schedule" />
      {tabs.length > 1 && <TabBar items={tabs} activeId={tab} onChange={(id) => setTab(id as TabId)} className="mb-4" />}
      {tab === 'days' && <AttendanceDays access={access} />}
      {tab === 'schedule' && access.schedules && <WorkSchedules />}
      {tab === 'scanners' && access.manages && <Scanners />}
    </div>
  );
}
