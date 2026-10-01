import React, { useState, useEffect, useRef } from "react";
import { Users, CalendarDays, Wallet, NotepadText, Phone, AlertCircle, MapPin, RefreshCw, Cake, Video, BookOpen, FileText, TrendingUp, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase"
import { TownProps } from '../../types/supabase';
import { motion, AnimatePresence } from 'framer-motion';
import { PageHeader, StatCard, Card, TabBar, EmptyState, Button } from '../UI';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const LEAVE_STATUS_COLORS: Record<string, string> = {
  Pending: '#F26A1B',
  Approved: '#17402A',
  Rejected: '#C0392B',
};

interface AreaTownMapping {
  [area: string]: string[];
}

interface NewsItem {
  id: number;
  type: 'birthday' | 'conference' | 'training' | 'payslip' | 'report';
  title: string;
  description?: string;
  date: string;
  time?: string;
  participants?: string;
  people?: { name: string; date?: string }[];
}

interface ActivityItem {
  id: string;
  type: 'leave' | 'advance' | 'expense';
  title: string;
  subtitle: string;
  status: string;
  date: string;
  amount?: number;
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
  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([]);
  const [isNewsLoading, setIsNewsLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [leaveByStatus, setLeaveByStatus] = useState<{ name: string; value: number }[]>([]);
  const [employeesByTown, setEmployeesByTown] = useState<{ town: string; count: number }[]>([]);

  const navigate = useNavigate();

  // Fetch birthday news from employees table
  const fetchBirthdayNews = async () => {
    setIsNewsLoading(true);
    try {
      const today = new Date();
      const currentMonth = today.getMonth() + 1;
      const currentDay = today.getDate();

      const { data: employees, error } = await supabase
        .from('employees')
        .select('"First Name", "Last Name", "Mobile Number", "Date of Birth", Town, Branch');

      if (error) {
        console.error('Error fetching employees for birthdays:', error);
        return;
      }

      // Filter employees with birthdays today
      const todaysBirthdays = employees?.filter(employee => {
        if (!employee['Date of Birth']) return false;

        try {
          const birthDate = new Date(employee['Date of Birth']);
          const birthMonth = birthDate.getMonth() + 1;
          const birthDay = birthDate.getDate();

          return birthMonth === currentMonth && birthDay === currentDay;
        } catch {
          return false;
        }
      }) || [];

      // Create birthday news item
      const birthdayNewsItem: NewsItem = {
        id: 1,
        type: 'birthday',
        title: 'Today\'s Birthdays',
        description: todaysBirthdays.length > 0
          ? `${todaysBirthdays.slice(0, 3).map(emp => `${emp['First Name']} ${emp['Last Name']}`).join(', ')}${todaysBirthdays.length > 3 ? ` and ${todaysBirthdays.length - 3} others` : ''}`
          : 'No birthdays today',
        date: 'Today',
        time: 'All day',
        people: todaysBirthdays.map(emp => ({ name: `${emp['First Name']} ${emp['Last Name']}`.trim() }))
      };

      // Check for upcoming birthdays (next 7 days)
      const upcomingBirthdays = (employees || [])
        .map(employee => {
          if (!employee['Date of Birth']) return null;
          try {
            const birthDate = new Date(employee['Date of Birth']);
            const nextWeek = new Date();
            nextWeek.setDate(today.getDate() + 7);
            const birthDateThisYear = new Date(today.getFullYear(), birthDate.getMonth(), birthDate.getDate());

            if (birthDateThisYear > today && birthDateThisYear <= nextWeek) {
              return { employee, birthDateThisYear };
            }
            return null;
          } catch {
            return null;
          }
        })
        .filter((entry): entry is { employee: typeof employees[number]; birthDateThisYear: Date } => entry !== null)
        .sort((a, b) => a.birthDateThisYear.getTime() - b.birthDateThisYear.getTime());

      const upcomingNewsItem: NewsItem = {
        id: 2,
        type: 'birthday',
        title: 'Upcoming Birthdays',
        description: upcomingBirthdays.length > 0
          ? `${upcomingBirthdays.slice(0, 3).map(({ employee }) => `${employee['First Name']} ${employee['Last Name']}`).join(', ')}${upcomingBirthdays.length > 3 ? ` and ${upcomingBirthdays.length - 3} others` : ''}`
          : 'No upcoming birthdays',
        date: 'Next 7 days',
        people: upcomingBirthdays.map(({ employee, birthDateThisYear }) => ({
          name: `${employee['First Name']} ${employee['Last Name']}`.trim(),
          date: birthDateThisYear.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        }))
      };

      setNewsItems([birthdayNewsItem, upcomingNewsItem]);

    } catch (error) {
      console.error('Error in fetchBirthdayNews:', error);
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
        const { data: employeesData, error: employeesError } = await supabase
          .from('employees')
          .select('Branch, Town');

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
    fetchBirthdayNews();
  }, []);

  // Lazily fetch analytics data the first time the Analytics tab is opened
  useEffect(() => {
    if (activeTab !== 'analytics' || !analyticsLoading) return;

    const fetchAnalytics = async () => {
      try {
        const [{ data: leaveRows }, { data: employeeRows }] = await Promise.all([
          supabase.from('leave_application').select('status'),
          supabase.from('employees').select('Town'),
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
        { count: branchesCount }
      ] = await Promise.all([
        supabase.from('employees').select('*', { count: 'exact', head: true }),
        supabase.from('leave_application').select('*', { count: 'exact', head: true }),
        supabase.from('kenya_branches').select('*', { count: 'exact', head: true })
      ]);

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
    fetchBirthdayNews();
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

  // Get icon for news type
  const getNewsIcon = (type: NewsItem['type']) => {
    switch (type) {
      case 'birthday': return <Cake className="w-4 h-4" />;
      case 'conference': return <Video className="w-4 h-4" />;
      case 'training': return <BookOpen className="w-4 h-4" />;
      case 'payslip': return <FileText className="w-4 h-4" />;
      case 'report': return <TrendingUp className="w-4 h-4" />;
      default: return <FileText className="w-4 h-4" />;
    }
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
            className="fixed top-5 right-5 p-4 rounded-xl text-white z-[1000] shadow-2xl bg-red-500 flex items-center"
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
            className="fixed top-5 right-5 p-4 rounded-xl text-white z-[1000] shadow-2xl bg-primary flex items-center"
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
            <Button variant="secondary" onClick={handleRefresh} disabled={isLoading} icon={<RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />}>
              Refresh Data
            </Button>
          }
        />

        {/* Filters & Tabs */}
        <div className="flex items-center justify-between">
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
            <div className="relative w-16 h-16">
              <div className="absolute top-0 left-0 w-full h-full border-4 border-primary/20 rounded-full opacity-20"></div>
              <div className="absolute top-0 left-0 w-full h-full border-4 border-primary rounded-full border-t-transparent animate-spin"></div>
            </div>
          </div>
        ) : (
          /* Main Content */
          <div className="space-y-4">

            {/* Stat Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatCard label="Total Employees" value={stats.employees} icon={<Users className="w-[18px] h-[18px]" strokeWidth={1.8} />} tint="green" />
              <StatCard label="Leave Requests" value={stats.leaveRequests} icon={<CalendarDays className="w-[18px] h-[18px]" strokeWidth={1.8} />} tint="orange" />
              <StatCard label="Active Branches" value={stats.activeBranches} icon={<MapPin className="w-[18px] h-[18px]" strokeWidth={1.8} />} tint="green" />
            </div>

            {activeTab === 'analytics' ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                <Card>
                  <h2 className="text-[13px] font-bold text-ink mb-3">Leave Requests by Status</h2>
                  {analyticsLoading ? (
                    <div className="h-64 animate-pulse bg-gray-100 rounded-lg" />
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
                    <div className="h-64 animate-pulse bg-gray-100 rounded-lg" />
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
                                KSh {activity.amount.toLocaleString()}
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

              {/* Company Updates */}
              <Card className="flex flex-col h-full">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[13px] font-bold text-ink">Company Updates</h3>
                  <button
                    type="button"
                    onClick={() => navigate('/calendar')}
                    aria-label="View company calendar"
                    className="text-subtle hover:text-brand transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-2.5 flex-1">
                  {isNewsLoading ? (
                    <div className="animate-pulse space-y-4">
                      {[1, 2, 3].map(i => (
                        <div key={i} className="flex gap-4">
                          <div className="w-10 h-10 bg-gray-100 rounded-lg" />
                          <div className="flex-1">
                            <div className="h-4 bg-gray-100 rounded w-3/4 mb-2" />
                            <div className="h-3 bg-gray-50 rounded w-1/2" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    newsItems.slice(0, 4).map((news) => (
                      <div key={news.id} className="flex gap-2.5 items-start">
                        <div className="w-[34px] h-[34px] rounded-tile bg-orange-tint text-orange flex items-center justify-center flex-shrink-0">
                          {getNewsIcon(news.type)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[12.5px] font-bold text-ink truncate">{news.title}</div>
                          {news.people && news.people.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              {news.people.map((person, idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() => navigate(`/employees?q=${encodeURIComponent(person.name)}`)}
                                  className="inline-flex items-center gap-1 text-[11px] font-medium text-brand bg-green-tint hover:bg-green-tint/70 px-2 py-0.5 rounded-full transition-colors"
                                  title={`View ${person.name} in Employees`}
                                >
                                  {person.name}{person.date ? ` · ${person.date}` : ''}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <div className="text-[11.5px] text-muted-foreground line-clamp-2">{news.description}</div>
                          )}
                        </div>
                      </div>
                    ))
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