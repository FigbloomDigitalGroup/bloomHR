import { useState } from 'react';
import { TabBar } from '../UI';
import type { AttendanceAccess } from '../../lib/attendanceApi';
import AttendanceToday from './AttendanceToday';
import AttendanceDays from './AttendanceDays';

type View = 'today' | 'range';

/** The Attendance tab: one day at a glance (the default), or the summary over a range of dates one click away. */
export default function AttendanceViews({ access }: { access: AttendanceAccess }) {
  const [view, setView] = useState<View>('today');
  return (
    <div className="space-y-3">
      <TabBar
        variant="pill"
        items={[{ id: 'today', label: 'Today' }, { id: 'range', label: 'Date range' }]}
        activeId={view}
        onChange={(id) => setView(id as View)}
      />
      {view === 'today' ? <AttendanceToday access={access} /> : <AttendanceDays access={access} />}
    </div>
  );
}
