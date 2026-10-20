import React, { useState, useEffect, useRef } from "react";
import { Users, CalendarDays, Calendar, Wallet, NotepadText, Phone, AlertCircle, MapPin, RefreshCw, Cake, ChevronRight, PartyPopper, Plane, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase"
import { fetchAllResult } from "../../lib/fetchAll";
import { TownProps } from '../../types/supabase';
import { motion, AnimatePresence } from 'framer-motion';
import { PageHeader, StatCard, Card, TabBar, EmptyState, Button } from '../UI';
import GetStarted, { SHOW_SETUP_GUIDE } from './GetStarted';
import GroupOverview from './GroupOverview';
import WibaCoverBanner from '../WorkInjury/WibaCoverBanner';
import { money } from '../../lib/payroll/currency';
import { TodaysBirthdayWishes } from '../Celebrations/BirthdayWishes';
import { usePermissions } from '../../hooks/usePermissions';
import { canOpenScreen } from '../../lib/routeModules';
import { addDays, dayKey, inDaysLabel, shortDay, startOfDay, type EventRow, type HolidayRow } from '../../lib/upcoming';
import { loadBirthdayPeople, loadCompanyEvents } from '../../lib/upcomingApi';
import { upcomingBirthdays, type UpcomingItem } from '../../lib/celebrations';
import { WEEK_DAYS, withinDays } from '../../lib/staffHome';
import { adminWeekItems, holidaysForCompany, type AdminWeekItem } from '../../lib/adminWeek';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import FigbloomLoader from "../UI/FigbloomLoader";

const LEAVE_STATUS_COLORS: Record<string, string> = {
  Pending: '#F26A1B',
  Approved: '#17402A',
  Rejected: '#C0392B',
};

interface AreaTownMapping {
  [area: string]: string[];
}

/** The company's active branches (the `branches` table, FIG-905) and their countries; null when it can't be read. */
async function loadActiveBranches(): Promise<{ count: number; countries: string[] } | null> {
  try {
    const { data, error } = await supabase.from('branches').select('id, country, active');
    if (error || !data) return null;
    const active = (data as { country: string | null; active: boolean | null }[]).filter((b) => b.active !== false);
    return { count: active.length, countries: active.map((b) => b.country || '').filter(Boolean) };
  } catch {
    return null;
  }
}

/** How many people have approved leave starting from today to 6 days ahead; 0 when it can't be read. */
async function countLeaveStartingThisWeek(today: Date): Promise<number> {
  const from = startOfDay(today);
  const to = addDays(from, WEEK_DAYS);
  try {
    const { data, error } = await supabase
      .from('leave_application')
      .select('"Employee Number", "Start Date", status')
      .gte('"Start Date"', dayKey(from))
      .lte('"Start Date"', dayKey(to));
    if (error || !data) return 0;
    const people = new Set<string>();
    (data as Record<string, string | null>[]).forEach((l, i) => {
      if ((l.status || '').trim().toLowerCase() !== 'approved') return;
      people.add(l['Employee Number'] || `row-${i}`);
    });
    return people.size;
  } catch {
    return 0;
  }
}

interface ActivityItem {
  id: string;
  type: 'leave' | 'advance' | 'expense';
  title: string;
  subtitle: string;
  status: string;
  date: string;
  amount?: number;
  /** the amount's currency (the employee's branch's); KES when not known */
  currency?: string;
}

export default function DashboardMain({ selectedTown, onTownChange }: TownProps) {
  const [activeTab, setActiveTab] = useState("overview");
  const [showSupportPopup] = useState(false);
  const [showUnauthorizedPopup] = useState(false);
  const [stats, setStats] = useState({
    employees: 0,
    leaveRequests: 0,
    activeBranches: 0
  });
  const [isLoading, setIsLoading] = useState(true);
  const [, setDebugInfo] = useState<string>("Initializing...");
  const [currentTown, setCurrentTown] = useState<string>(selectedTown || '');
  const [areaTownMapping, setAreaTownMapping] = useState<AreaTownMapping>({});
  const [isArea, setIsArea] = useState<boolean>(false);
  const [townsInArea, setTownsInArea] = useState<string[]>([]);
  const [weekItems, setWeekItems] = useState<AdminWeekItem[]>([]);
  const [leaveStartingThisWeek, setLeaveStartingThisWeek] = useState(0);
  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([]);
  const [isNewsLoading, setIsNewsLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [leaveByStatus, setLeaveByStatus] = useState<{ name: string; value: number }[]>([]);
  const [employeesByTown, setEmployeesByTown] = useState<{ town: string; count: number }[]>([]);

  const navigate = useNavigate();
  const { hasPermission, hasAllPermissions, loading: permissionsLoading } = usePermissions();
  const canManageBranches = !permissionsLoading && canOpenScreen('/settings/branches', hasPermission);
  // whoever handles work injuries is warned when the company's WIBA insurance is missing or expired
  const handlesWorkInjuries = !permissionsLoading && canOpenScreen('/work-injuries', hasPermission);
  // the "Get <company> set up" checklist is for whoever holds Settings and Invite people (GetStarted.tsx)
  const setsUpCompany = !permissionsLoading && hasAllPermissions(['settings', 'invite-people']);

  // The company's next 7 days (today plus 6), as the staff home's "This week": public holidays (every country's, tagged
  // when the company is in more than one), company events, birthdays (name only) and how many start leave
  const fetchWeekNews = async () => {
    setIsNewsLoading(true);
    try {
      const today = new Date();
      const [ev, hol, people, branches, leaveCount] = await Promise.allSettled([
        loadCompanyEvents(),
        supabase.from('holidays').select('name, date, recurring, country'),
        loadBirthdayPeople(),
        loadActiveBranches(),
        countLeaveStartingThisWeek(today),
      ]);
      const events: EventRow[] = ev.status === 'fulfilled' ? ev.value : [];
      const allHolidays: HolidayRow[] =
        hol.status === 'fulfilled' && !hol.value.error ? ((hol.value.data ?? []) as HolidayRow[]) : [];
      const countries = branches.status === 'fulfilled' && branches.value ? branches.value.countries : [];
      const birthdays: UpcomingItem[] =
        people.status === 'fulfilled' ? withinDays(upcomingBirthdays(people.value, today, WEEK_DAYS), WEEK_DAYS) : [];
      setWeekItems(adminWeekItems({ events, holidays: holidaysForCompany(allHolidays, countries), birthdays }, today));
      setLeaveStartingThisWeek(leaveCount.status === 'fulfilled' ? leaveCount.value : 0);
    } catch (error) {
      console.error('Error loading this week for the dashboard:', error);
    } finally {
      setIsNewsLoading(false);
    }
  };

  // Fetch recent activity data
  const fetchRecentActivity = async (branchFilter?: string) => {
    try {
      let leaveQuery = supabase.from('leave_application').select('*').order('time_added', { ascending: false }).limit(8);

      if (branchFilter && branchFilter !== 'ADMIN_ALL') {
        leaveQuery = leaveQuery.ilike('Office Branch', `%${branchFilter}%`);
      }

      const [
        { data: leaves }
      ] = await Promise.all([leaveQuery]);

      const activities: ActivityItem[] = [];

      (leaves || []).forEach((l: any) => {
        activities.push({
          id: `leave-${l.id}`,
          type: 'leave',
          title: `Leave: ${l['Leave Type'] || 'General'}`,
          subtitle: l.name || `Emp #${l['Employee Number']}`,
          status: l.status || 'Pending',
          date: l.time_added || l['Start Date'] || new Date().toISOString()
        });
      });

      // Sort by date desc and take top 8
      activities.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setRecentActivity(activities.slice(0, 8));
    } catch (err) {
      console.error("Error fetching recent activity:", err);
    }
  };

  // Load area-town mapping and saved town from localStorage on component mount
  useEffect(() => {
    const loadMappings = async () => {
      try {
        // Fetch the area-town mapping from the database
        const { data: employeesData, error: employeesError } = await fetchAllResult((from, to) =>
          supabase.from('employees').select('Branch, Town').order('"Employee Number"').order('id').range(from, to)
        );

        if (employeesError) {
          console.error("Error loading area-town mapping:", employeesError);
          return;
        }

        // Convert the data to a mapping object
        const mapping: AreaTownMapping = {};
        employeesData?.forEach(item => {
          if (item.Branch && item.Town) {
            if (!mapping[item.Branch]) {
              mapping[item.Branch] = [];
            }
            mapping[item.Branch].push(item.Town);
          }
        });

        setAreaTownMapping(mapping);
        setDebugInfo("Mappings loaded successfully");
      } catch (error) {
        console.error("Error in loadMappings:", error);
        setDebugInfo(`Error loading mappings: ${error.message}`);
      }
    };

    loadMappings();

    const savedTown = localStorage.getItem('selectedTown');
    if (savedTown && (!selectedTown || selectedTown === 'ADMIN_ALL')) {
      setCurrentTown(savedTown);
      if (onTownChange) {
        onTownChange(savedTown);
      }
      setDebugInfo(`Loaded saved town from storage: "${savedTown}"`);
    } else if (selectedTown) {
      setCurrentTown(selectedTown);
      localStorage.setItem('selectedTown', selectedTown);
      setDebugInfo(`Using town from props: "${selectedTown}"`);
    }
  }, [selectedTown, onTownChange]);

  // Check if current selection is an area and get its towns
  useEffect(() => {
    if (currentTown && areaTownMapping[currentTown]) {
      setIsArea(true);
      setTownsInArea(areaTownMapping[currentTown]);
      setDebugInfo(`"${currentTown}" is an area containing towns: ${areaTownMapping[currentTown].join(', ')}`);
    } else {
      setIsArea(false);
      setTownsInArea([]);
    }
  }, [currentTown, areaTownMapping]);

  const fetchIdRef = useRef(0);

  // Fetch data from Supabase with town/area filtering
  useEffect(() => {
    const currentFetchId = ++fetchIdRef.current;

    // Slight debounce so we don't fetch intermediate states
    const timer = setTimeout(() => {
      if (currentFetchId === fetchIdRef.current) {
        fetchDashboardData(currentFetchId);
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [currentTown, townsInArea, isArea]);

  // Load news when component mounts
  useEffect(() => {
    fetchWeekNews();
  }, []);

  // Lazily fetch analytics data the first time the Analytics tab is opened
  useEffect(() => {
    if (activeTab !== 'analytics' || !analyticsLoading) return;

    const fetchAnalytics = async () => {
      try {
        // every row, a page at a time (one request is capped at 1000 rows)
        const [{ data: leaveRows }, { data: employeeRows }] = await Promise.all([
          fetchAllResult((from, to) => supabase.from('leave_application').select('status').order('id').range(from, to)),
          fetchAllResult((from, to) =>
            supabase.from('employees').select('Town').order('"Employee Number"').order('id').range(from, to)
          ),
        ]);

        const statusCounts: Record<string, number> = {};
        (leaveRows || []).forEach((row: any) => {
          const status = row.status ? row.status.charAt(0).toUpperCase() + row.status.slice(1).toLowerCase() : 'Pending';
          statusCounts[status] = (statusCounts[status] || 0) + 1;
        });
        setLeaveByStatus(Object.entries(statusCounts).map(([name, value]) => ({ name, value })));

        const townCounts: Record<string, number> = {};
        (employeeRows || []).forEach((row: any) => {
          const town = row.Town || 'Unassigned';
          townCounts[town] = (townCounts[town] || 0) + 1;
        });
        const sortedTowns = Object.entries(townCounts)
          .map(([town, count]) => ({ town, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 8);
        setEmployeesByTown(sortedTowns);
      } catch (error) {
        console.error('Error fetching analytics data:', error);
      } finally {
        setAnalyticsLoading(false);
      }
    };

    fetchAnalytics();
  }, [activeTab, analyticsLoading]);

  // Fetch ALL data for dashboard
  const fetchDashboardData = async (fetchId: number) => {
    setIsLoading(true);
    console.log('🔍 Fetching data for:', currentTown);

    try {
      // If ADMIN_ALL or no town selected, fetch all data
      if (currentTown === 'ADMIN_ALL' || !currentTown) {
        await fetchAllData(fetchId);
      } else if (isArea && townsInArea.length > 0) {
        await fetchDataForArea(fetchId);
      } else if (!isArea) {
        await fetchDataForTown(fetchId);
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      setDebugInfo(`Error: ${error.message}`);
    } finally {
      if (fetchId === fetchIdRef.current) {
        setIsLoading(false);
      }
    }
  };

  // Fetch all data (admin view)
  const fetchAllData = async (fetchId: number) => {
    try {
      // Fetch all counts
      const [
        { count: employeesCount },
        { count: leaveRequestsCount },
        activeBranches
      ] = await Promise.all([
        supabase.from('employees').select('*', { count: 'exact', head: true }),
        supabase.from('leave_application').select('*', { count: 'exact', head: true }),
        loadActiveBranches()
      ]);
      // the company's own branches; the old towns list only when they can't be read
      let branchesCount = activeBranches?.count ?? null;
      if (branchesCount === null) {
        const { count } = await supabase.from('kenya_branches').select('*', { count: 'exact', head: true });
        branchesCount = count || 0;
      }

      if (fetchId !== fetchIdRef.current) return;

      setStats({
        employees: employeesCount || 0,
        leaveRequests: leaveRequestsCount || 0,
        activeBranches: branchesCount || 0
      });

      setDebugInfo(`Showing ALL data | Employees: ${employeesCount} | Leaves: ${leaveRequestsCount} | Branches: ${branchesCount}`);

      await fetchRecentActivity('ADMIN_ALL');
    } catch (error) {
      console.error('Error fetching all data:', error);
      throw error;
    }
  };

  // Fetch data for specific town
  const fetchDataForTown = async (fetchId: number) => {
    try {
      console.log('Fetching data for town:', currentTown);

      // Try multiple approaches to filter data
      let employeesCount = 0;
      let leaveRequestsCount = 0;

      // 1. Try exact match in Town column
      const { count: townEmployees, error: townError } = await supabase
        .from('employees')
        .select('*', { count: 'exact', head: true })
        .eq('Town', currentTown);

      if (!townError && (townEmployees || 0) > 0) {
        console.log('Found employees by Town column:', townEmployees);
        employeesCount = townEmployees || 0;

        // Try to find branch for this town
        const { data: branchData } = await supabase
          .from('kenya_branches')
          .select('"Branch Office"')
          .ilike('Area', `%${currentTown}%`)
          .limit(1);

        const branch = branchData?.[0]?.['Branch Office'];

        if (branch) {
          console.log('Using branch for filtering:', branch);

          const [{ count: leaves }] = await Promise.all([
            supabase.from('leave_application').select('*', { count: 'exact', head: true }).eq('Office Branch', branch)
          ]);

          leaveRequestsCount = leaves || 0;
        }
      }
      // 2. Try Branch column if Town didn't work
      else {
        console.log('Trying Branch column...');
        const { count: branchEmployees, error: branchError } = await supabase
          .from('employees')
          .select('*', { count: 'exact', head: true })
          .eq('Branch', currentTown);

        if (!branchError && (branchEmployees || 0) > 0) {
          console.log('Found employees by Branch column:', branchEmployees);
          employeesCount = branchEmployees || 0;

          const [{ count: leaves }] = await Promise.all([
            supabase.from('leave_application').select('*', { count: 'exact', head: true }).ilike('Office Branch', `%${currentTown}%`)
          ]);

          leaveRequestsCount = leaves || 0;
        }
        // 3. Try partial match as last resort
        else {
          console.log('Trying partial match...');
          const { count: partialEmployees, error: partialError } = await supabase
            .from('employees')
            .select('*', { count: 'exact', head: true })
            .ilike('Town', `%${currentTown}%`);

          if (!partialError) {
            employeesCount = partialEmployees || 0;

            const [{ count: leaves }] = await Promise.all([
              supabase.from('leave_application').select('*', { count: 'exact', head: true }).ilike('Office Branch', `%${currentTown}%`)
            ]);

            leaveRequestsCount = leaves || 0;
          }
        }
      }

      // If everything is 0, fetch all data
      if (employeesCount === 0 && leaveRequestsCount === 0) {
        console.log('No data found for town, fetching all data...');
        await fetchAllData(fetchId);
        return;
      }

      if (fetchId !== fetchIdRef.current) return;

      setStats({
        employees: employeesCount || 0,
        leaveRequests: leaveRequestsCount || 0,
        activeBranches: 1
      });

      setDebugInfo(`Town: "${currentTown}" | Employees: ${employeesCount} | Leaves: ${leaveRequestsCount}`);

      await fetchRecentActivity(currentTown);

    } catch (error) {
      console.error('Error in fetchDataForTown:', error);
      // On error, try to fetch all data
      await fetchAllData(fetchId);
    }
  };

  // Fetch data for area
  const fetchDataForArea = async (fetchId: number) => {
    try {
      console.log('Fetching data for area:', currentTown, 'Towns:', townsInArea);

      if (!townsInArea.length) {
        await fetchAllData(fetchId);
        return;
      }

      // Fetch employees for all towns in area
      const { count: employeesCount } = await supabase
        .from('employees')
        .select('*', { count: 'exact', head: true })
        .in('Town', townsInArea);

      // For other tables, we need to find branches for these towns
      const { data: branchesData } = await supabase
        .from('kenya_branches')
        .select('"Branch Office"')
        .in('Area', townsInArea);

      const branches = branchesData?.map(b => b['Branch Office']).filter(Boolean) || [];

      let leaveRequestsCount = 0;

      if (branches.length > 0) {
        const [{ count: leaves }] = await Promise.all([
          supabase.from('leave_application').select('*', { count: 'exact', head: true }).in('Office Branch', branches)
        ]);

        leaveRequestsCount = leaves || 0;
      }

      if (fetchId !== fetchIdRef.current) return;

      setStats({
        employees: employeesCount || 0,
        leaveRequests: leaveRequestsCount || 0,
        activeBranches: branches.length || townsInArea.length || 0
      });

      setDebugInfo(`Area: "${currentTown}" (${townsInArea.length} towns) | Employees: ${employeesCount} | Leaves: ${leaveRequestsCount}`);

      await fetchRecentActivity(currentTown);

    } catch (error) {
      console.error('Error in fetchDataForArea:', error);
      await fetchAllData(fetchId);
    }
  };

  const handleRefresh = () => {
    const currentFetchId = ++fetchIdRef.current;
    fetchDashboardData(currentFetchId);
    fetchWeekNews();
  };

  // Get town/area display name
  const getDisplayName = () => {
    if (!currentTown) return "All Towns";
    if (currentTown === 'ADMIN_ALL') return "All Towns";

    if (isArea) {
      return `${currentTown} Region`;
    }

    return currentTown;
  };

  return (
    <div className="min-h-screen p-6 md:p-8 font-sans bg-transparent">
      {/* Popup Messages */}
      <AnimatePresence>
        {showUnauthorizedPopup && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: 100 }}
            animate={{ opacity: 1, y: 0, x: 0 }}
            exit={{ opacity: 0, y: -20, x: 100 }}
            className="fixed top-5 right-5 max-w-[calc(100vw-2rem)] p-4 rounded-xl text-white z-[1000] shadow-2xl bg-red-500 flex items-center"
          >
            <AlertCircle className="w-4 h-4 mr-2" />
            <span className="text-sm font-medium">Unauthorized access</span>
          </motion.div>
        )}

        {showSupportPopup && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: 100 }}
            animate={{ opacity: 1, y: 0, x: 0 }}
            exit={{ opacity: 0, y: -20, x: 100 }}
            className="fixed top-5 right-5 max-w-[calc(100vw-2rem)] p-4 rounded-xl text-white z-[1000] shadow-2xl bg-primary flex items-center"
          >
            <Phone className="w-4 h-4 mr-2" />
            <span className="text-sm font-medium">Support: 0700594586</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="max-w-7xl mx-auto space-y-[18px]">
        <PageHeader
          title="Dashboard Overview"
          subtitle={
            <>
              <MapPin className="w-3 h-3" />
              {getDisplayName()}
              <span className="opacity-50">&middot;</span>
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </>
          }
          className="!mb-0"
          actions={
            <>
              {setsUpCompany && (
                <Button variant="ghost" onClick={() => window.dispatchEvent(new Event(SHOW_SETUP_GUIDE))} icon={<Sparkles className="w-3.5 h-3.5" />}>
                  Setup guide
                </Button>
              )}
              <Button variant="secondary" onClick={handleRefresh} disabled={isLoading} icon={<RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />}>
                Refresh Data
              </Button>
            </>
          }
        />

        <GetStarted />
        {handlesWorkInjuries && <WibaCoverBanner />}
        <TodaysBirthdayWishes className="mb-4" />

        {/* Filters & Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabBar
            items={[{ id: 'overview', label: 'Overview' }, { id: 'analytics', label: 'Analytics' }]}
            activeId={activeTab}
            onChange={(id) => setActiveTab(id)}
          />
          <div className="text-[11px] text-muted-foreground">
            Last updated: {new Date().toLocaleTimeString()}
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center items-center h-64">
            <FigbloomLoader label="Loading the dashboard" />
          </div>
        ) : (
          /* Main Content */
          <div className="space-y-4">

            {/* Stat Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatCard label="Total Employees" value={stats.employees} icon={<Users className="w-[18px] h-[18px]" strokeWidth={1.8} />} tint="green" />
              <StatCard label="Leave Requests" value={stats.leaveRequests} icon={<CalendarDays className="w-[18px] h-[18px]" strokeWidth={1.8} />} tint="orange" />
              {canManageBranches ? (
                <button
                  type="button"
                  onClick={() => navigate('/settings/branches')}
                  aria-label={`Active Branches: ${stats.activeBranches}. Open Settings, Branches`}
                  className="block w-full text-left rounded-card transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <StatCard label="Active Branches" value={stats.activeBranches} icon={<MapPin className="w-[18px] h-[18px]" strokeWidth={1.8} />} tint="green" />
                </button>
              ) : (
                <StatCard label="Active Branches" value={stats.activeBranches} icon={<MapPin className="w-[18px] h-[18px]" strokeWidth={1.8} />} tint="green" />
              )}
            </div>

            {/* the group view: headcount by country and payroll money per currency (FIG-905) */}
            <GroupOverview />

            {activeTab === 'analytics' ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                <Card>
                  <h2 className="text-[13px] font-bold text-ink mb-3">Leave Requests by Status</h2>
                  {analyticsLoading ? (
                    <div className="h-64 flex items-center justify-center"><FigbloomLoader label="Loading" compact /></div>
                  ) : leaveByStatus.length === 0 ? (
                    <EmptyState icon={<CalendarDays className="w-[18px] h-[18px]" strokeWidth={2} />} title="No leave data" description="Leave requests will appear here once submitted." />
                  ) : (
                    <ResponsiveContainer width="100%" height={260}>
                      <PieChart>
                        <Pie data={leaveByStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2}>
                          {leaveByStatus.map((entry) => (
                            <Cell key={entry.name} fill={LEAVE_STATUS_COLORS[entry.name] || '#9CA3A0'} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </Card>

                <Card>
                  <h2 className="text-[13px] font-bold text-ink mb-3">Employees by Town</h2>
                  {analyticsLoading ? (
                    <div className="h-64 flex items-center justify-center"><FigbloomLoader label="Loading" compact /></div>
                  ) : employeesByTown.length === 0 ? (
                    <EmptyState icon={<Users className="w-[18px] h-[18px]" strokeWidth={2} />} title="No employee data" description="Employee counts by town will appear here." />
                  ) : (
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={employeesByTown} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E6E2" vertical={false} />
                        <XAxis dataKey="town" tick={{ fontSize: 10.5, fill: '#5F6B62' }} interval={0} angle={-20} textAnchor="end" height={50} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 10.5, fill: '#5F6B62' }} />
                        <Tooltip />
                        <Bar dataKey="count" fill="#17402A" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </Card>
              </div>
            ) : (
            <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4 items-start">
              {/* Recent Activity - Live Data Feed */}
              <Card className="flex flex-col h-full">
                <div className="flex items-center justify-between mb-1">
                  <div>
                    <h2 className="text-[13px] font-bold text-ink">Recent Activity</h2>
                    <p className="text-[11.5px] text-muted-foreground mt-0.5">Live updates from the system</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/leaves')}
                    aria-label="View all leave activity"
                    className="text-subtle hover:text-brand transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-3 flex-1 mt-4">
                  {recentActivity.length > 0 ? recentActivity.map((activity, _index) => (
                    <div
                      key={activity.id}
                      className="group flex items-center gap-4 p-3 rounded-lg hover:bg-gray-50 hover:shadow-sm transition-all border border-transparent hover:border-gray-100"
                    >
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm
                        ${activity.type === 'leave' ? 'bg-orange-50 text-orange-600' :
                          activity.type === 'advance' ? 'bg-red-50 text-red-600' :
                            'bg-emerald-50 text-emerald-600'}
                      `}>
                        {activity.type === 'leave' && <CalendarDays className="w-4 h-4" />}
                        {activity.type === 'advance' && <Wallet className="w-4 h-4" />}
                        {activity.type === 'expense' && <NotepadText className="w-4 h-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start mb-0.5">
                          <h3 className="font-semibold text-gray-900 text-sm truncate pr-4">{activity.title}</h3>
                          <span className="text-[10px] text-gray-400 whitespace-nowrap">
                            {new Date(activity.date).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="flex justify-between items-end">
                          <p className="text-xs text-gray-500 truncate">{activity.subtitle}</p>
                          <div className="flex items-center gap-2">
                            {activity.amount && (
                              <span className="text-xs font-semibold text-gray-900 bg-gray-50 border border-gray-100 px-1.5 py-0.5 rounded shadow-sm">
                                {money(activity.amount, activity.currency)}
                              </span>
                            )}
                            <span className={`text-[10px] font-medium px-2 py-0.5 rounded border
                              ${activity.status.toLowerCase() === 'approved' || activity.status.toLowerCase() === 'paid' ? 'bg-green-50 text-green-700 border-green-100' :
                                activity.status.toLowerCase() === 'rejected' ? 'bg-red-50 text-red-700 border-red-100' :
                                  'bg-amber-50 text-amber-700 border-amber-100'}
                            `}>
                              {activity.status}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )) : (
                    <EmptyState
                      icon={<RefreshCw className="w-[18px] h-[18px]" strokeWidth={2} />}
                      title="No recent activity"
                      description="Recent updates will appear here automatically."
                    />
                  )}
                </div>
              </Card>

              {/* Company Updates: the next 7 days, as the staff home's "This week" */}
              <Card className="flex flex-col h-full">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-[13px] font-bold text-ink">Company Updates</h3>
                    <p className="text-[11.5px] text-muted-foreground mt-0.5">The next 7 days</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/calendar')}
                    className="text-[12px] font-semibold text-brand hover:underline whitespace-nowrap"
                  >
                    View calendar →
                  </button>
                </div>

                <div className="space-y-2.5 flex-1">
                  {isNewsLoading ? (
                    <div className="flex justify-center py-8"><FigbloomLoader label="Loading" compact /></div>
                  ) : weekItems.length === 0 && leaveStartingThisWeek === 0 ? (
                    <EmptyState
                      icon={<Calendar className="w-4 h-4" />}
                      title="Nothing on the calendar this week"
                      description="Public holidays, company events and birthdays in the next 7 days appear here."
                    />
                  ) : (
                    <>
                      {leaveStartingThisWeek > 0 && (
                        <button
                          type="button"
                          onClick={() => navigate('/leaves')}
                          className="w-full flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-left text-xs font-medium text-gray-700 hover:bg-gray-100 transition-colors"
                        >
                          <Plane className="w-4 h-4 text-brand flex-shrink-0" />
                          {leaveStartingThisWeek === 1 ? '1 person starts leave this week' : `${leaveStartingThisWeek} people start leave this week`}
                        </button>
                      )}
                      <ul className="divide-y divide-gray-100">
                        {weekItems.slice(0, SHOW_WEEK).map((item) => <WeekRow key={item.key} item={item} />)}
                        {weekItems.length > SHOW_WEEK && (
                          <li className="pt-2">
                            <button type="button" onClick={() => navigate('/calendar')} className="text-xs text-gray-500 hover:text-brand">
                              and {weekItems.length - SHOW_WEEK} more
                            </button>
                          </li>
                        )}
                      </ul>
                    </>
                  )}
                </div>
              </Card>
            </div>
            )}

          </div>
        )}
      </div>
    </div >
  );
}

const SHOW_WEEK = 6;

/** One day's holiday, event or birthday: what, and when ("Tue 20 Oct", "Tomorrow"). */
function WeekRow({ item }: { item: AdminWeekItem }) {
  const isToday = item.daysAway <= 0;
  const icon =
    item.kind === 'birthday' ? <Cake className="w-4 h-4" />
      : item.kind === 'holiday' ? <CalendarDays className="w-4 h-4" />
        : <PartyPopper className="w-4 h-4" />;
  const what = item.kind === 'holiday' ? 'Public holiday' : item.kind === 'birthday' ? 'Birthday' : item.detail || 'Company event';
  return (
    <li className="flex items-start gap-3 py-2">
      <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isToday ? 'bg-brand text-white' : 'bg-green-tint text-brand'}`}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-bold text-ink truncate">{item.title}</p>
        <p className="text-[11.5px] text-muted-foreground truncate">{what}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-xs font-semibold text-gray-700 whitespace-nowrap">{shortDay(item.date)}</p>
        {item.daysAway <= 1 && (
          <p className={`text-[11px] font-semibold ${isToday ? 'text-brand' : 'text-gray-500'}`}>{inDaysLabel(item.daysAway)}</p>
        )}
      </div>
    </li>
  );
}
