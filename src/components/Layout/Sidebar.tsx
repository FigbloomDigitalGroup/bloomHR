import { useState, useEffect } from 'react';
import {
  UsersRound,
  CalendarRange,
  Target,
  Settings,
  Palette,
  Wand2,
  Menu,
  ChevronLeft,
  ShieldAlert,
  LayoutGrid,
  Landmark,
  Kanban,
  MessagesSquare,
  Network,
  ShieldEllipsis,
  Package,
  UserPlus2,
  PieChart,
  Receipt,
  UserCheck,
  Award,
  Smartphone,
  Mails,
  ShieldHalf,
  HeartHandshake,
  LogOut,
} from 'lucide-react';
import { motion, AnimatePresence, Variants } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import solo from '../../../public/solo.png';
import { usePermissions } from '../../hooks/usePermissions';
import { supabase } from '../../lib/supabase';
import { SearchInput } from '../UI';

// Grouping structure
const menuGroups = [
  {
    title: "Overview",
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutGrid, path: '/dashboard', permission: 'dashboard' },
      { id: 'ai-assistant', label: 'AI Assistant', icon: Wand2, path: '/ai-assistant', permission: 'ai-assistant' },
    ]
  },
  {
    title: "Workspace",
    items: [
      { id: 'task-manager', label: 'Task Manager', icon: Kanban, path: '/tasks', permission: 'task-manager' },
      { id: 'teams', label: 'Teams', icon: Network, path: '/teams', permission: 'teams' },
      { id: 'messages', label: 'SMS Center', icon: MessagesSquare, path: '/sms', permission: 'sms' },
      { id: 'email-portal', label: 'Email Portal', icon: Mails, path: '/email-portal', permission: 'email-portal' },
    ]
  },
  {
    title: "Team",
    items: [
      { id: 'employees', label: 'Employees', icon: UsersRound, path: '/employees', permission: 'employees' },
      { id: 'recruitment', label: 'Recruitment', icon: UserPlus2, path: '/recruitment', permission: 'recruitment' },
      { id: 'leaves', label: 'Time Off', icon: CalendarRange, path: '/leaves', permission: 'leaves' },
      { id: 'performance', label: 'Performance', icon: Target, path: '/performance', permission: 'performance' },
      { id: 'training', label: 'Training', icon: Award, path: '/training', permission: 'training' },
      { id: 'assign-managers', label: 'Assign Managers', icon: UserCheck, path: '/assign-managers', permission: 'assign-managers' },
      { id: 'staffcheck', label: 'Disciplinary', icon: ShieldAlert, path: '/staffcheck', permission: 'staffcheck' },
      { id: 'hr-lifecycle', label: 'HR Lifecycle', icon: HeartHandshake, path: '/hr-lifecycle', permission: 'hr-lifecycle' },
    ]
  },
  {
    title: "Finance",
    items: [
      { id: 'payroll', label: 'Payroll', icon: Landmark, path: '/payroll', permission: 'payroll' },
      { id: 'expense', label: 'Expenses', icon: Receipt, path: '/expenses', permission: 'expenses' },
      { id: 'advanced', label: 'Salary Advance', icon: Landmark, path: '/salaryadmin', permission: 'salaryadmin' },
      { id: 'asset', label: 'Assets', icon: Package, path: '/asset', permission: 'asset' },
      { id: 'mpesa-zap', label: 'Mpesa Zap', icon: Smartphone, path: '/mpesa-zap', permission: 'mpesa-zap' },
    ]
  },
  {
    title: "System",
    items: [
      { id: 'reports', label: 'Reports', icon: PieChart, path: '/reports', permission: 'reports' },
      { id: 'email admin', label: 'Email Admin', icon: ShieldEllipsis, path: '/adminconfirm', permission: 'adminconfirm' },
      { id: 'incident-reports', label: 'Incidents', icon: ShieldAlert, path: '/incident-reports', permission: 'incident-reports' },
      { id: 'settings', label: 'Settings', icon: Settings, path: '/settings', permission: 'settings' },
      { id: 'role-permissions', label: 'Role Permissions', icon: ShieldHalf, path: '/role-permissions', permission: 'role-permissions' },
      { id: 'appearance', label: 'Appearance', icon: Palette, path: '/appearance' },
    ]
  }
];


interface SidebarProps {
  user?: { email: string; role: string } | null;
  isCollapsed: boolean;
  onToggle: (collapsed: boolean) => void;
  onLogout?: () => void;
}

export default function Sidebar({ user, isCollapsed, onToggle, onLogout }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname;
  const [searchQuery, setSearchQuery] = useState('');

  // Use permissions hook for dynamic access control
  const { hasPermission, loading: permissionsLoading } = usePermissions();

  // Badge on "Time Off" (FIG-575): count of pending leave applications that
  // need action from the logged-in user specifically - not a global count,
  // which would be noise for anyone who isn't ADMIN/HR. ADMIN/HR see every
  // pending application (they're the final approver for all of them);
  // everyone else only sees applications where they're the assigned
  // Leave Approver/Alternate Approver (FIG-573) and it hasn't been
  // recommended yet - i.e. genuinely waiting on them.
  const [pendingLeaveCount, setPendingLeaveCount] = useState(0);

  useEffect(() => {
    if (!user?.email) {
      setPendingLeaveCount(0);
      return;
    }

    const fetchPendingLeaveCount = async () => {
      try {
        if (user.role === 'ADMIN' || user.role === 'HR') {
          // `status` is stored with inconsistent casing across rows
          // ('Pending' from older/Staff-Portal-submitted rows, 'approved'
          // etc. from LeaveManagement's own writes) - match case-insensitively.
          const { count } = await supabase
            .from('leave_application')
            .select('id', { count: 'exact', head: true })
            .ilike('status', 'pending');
          setPendingLeaveCount(count || 0);
          return;
        }

        const { data: me } = await supabase
          .from('employees')
          .select('"First Name", "Last Name"')
          .eq('"Work Email"', user.email)
          .single();

        if (!me) {
          setPendingLeaveCount(0);
          return;
        }
        const myName = `${me["First Name"]} ${me["Last Name"]}`;

        const { data: allEmployees } = await supabase
          .from('employee_directory')
          .select('"Employee Number", "Leave Approver", "Alternate Approver"');

        const myReportNumbers = (allEmployees || [])
          .filter((e: any) => e["Leave Approver"] === myName || e["Alternate Approver"] === myName)
          .map((e: any) => e["Employee Number"]);

        if (myReportNumbers.length === 0) {
          setPendingLeaveCount(0);
          return;
        }

        const { count } = await supabase
          .from('leave_application')
          .select('id', { count: 'exact', head: true })
          .ilike('status', 'pending')
          .is('recstatus', null)
          .in('"Employee Number"', myReportNumbers);

        setPendingLeaveCount(count || 0);
      } catch (err) {
        console.error('Error fetching pending leave count:', err);
      }
    };

    fetchPendingLeaveCount();

    // Live updates: a new submission, a recommendation, or a decision can
    // all change this count without the sidebar otherwise re-rendering.
    const channel = supabase
      .channel('sidebar_pending_leave_count')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_application' }, () => {
        fetchPendingLeaveCount();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.email, user?.role]);

  const sidebarVariants: Variants = {
    expanded: {
      width: 280,
      transition: { type: "spring", stiffness: 400, damping: 30 }
    },
    collapsed: {
      width: 88,
      transition: { type: "spring", stiffness: 400, damping: 30 }
    }
  };

  const isExpanded = !isCollapsed;
  const userRole = user?.role || 'Admin';
  const userInitial = user?.email?.[0]?.toUpperCase() || 'A';

  return (
    <div className="fixed left-0 top-0 h-screen z-50 flex flex-col select-none">
      <motion.div
        initial="expanded"
        animate={isExpanded ? "expanded" : "collapsed"}
        variants={sidebarVariants}
        className="relative flex flex-col h-full border-r border-shell-fg/5 shadow-2xl overflow-hidden bg-shell"
      >
        {/* Brand Section */}
        {/* Brand Section */}
        <div className={`relative z-10 px-5 pt-4 pb-6 flex items-center transition-all duration-300 ${isExpanded ? 'justify-between' : 'flex-col justify-center gap-6'}`}>
          <div className="flex items-center gap-3">
            <motion.div
              layout
              className="relative flex items-center justify-center group cursor-pointer"
              whileHover={{ rotate: 5, scale: 1.05 }}
              onClick={() => !isExpanded && onToggle(false)}
            >
              <img src={solo} alt="Logo" className="relative w-10 h-10 object-contain shell-logo drop-shadow-md" />
            </motion.div>

            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="flex flex-col"
                >
                  <h1 className="font-bold text-xl text-shell-fg tracking-tight flex items-center">
                    Figbloom<span className="text-shell-fg/70 font-normal ml-0.5">HR</span>
                  </h1>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Collapse/Expand Toggle: chevron when open, hamburger when collapsed */}
          <motion.button
            onClick={() => onToggle(!isCollapsed)}
            aria-label={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
            className={`p-2 rounded-xl hover:bg-shell-fg/10 transition-all duration-300 group border border-transparent hover:border-shell-fg/10 hover:shadow-sm ${!isExpanded ? 'bg-shell-fg/5' : ''}`}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            {isExpanded ? (
              <ChevronLeft className="w-4 h-4 transition-colors text-shell-fg/50 group-hover:text-orange" />
            ) : (
              <Menu className="w-4 h-4 transition-colors text-orange" />
            )}
          </motion.button>
        </div>

        {/* Search Bar */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="px-5 mb-4 overflow-hidden"
            >
              <SearchInput
                variant="dark"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Scrollable Navigation */}
        <div className="relative z-10 flex-1 overflow-y-auto px-3 pb-4 sidebar-scroll hover:overflow-y-auto overflow-hidden">
          <div className="space-y-6">
            {menuGroups.map((group) => (
              <div key={group.title}>
                {/* Section Header */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="px-3 mb-2"
                    >
                      <span className="text-[9.5px] font-semibold text-shell-fg/40 uppercase tracking-[0.08em] pl-1">
                        {group.title}
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Items */}
                <div className="space-y-1">
                  {group.items.filter(item =>
                    item.label.toLowerCase().includes(searchQuery.toLowerCase())
                  ).map((item) => {
                    const isActive = currentPath.startsWith(item.path);

                    // While permissions are loading, show all items (avoid blank sidebar flash)
                    // Once loaded, hide items the user doesn't have access to
                    if (!permissionsLoading && item.permission && !hasPermission(item.permission)) return null;

                    return (
                      <motion.button
                        key={item.id}
                        onClick={() => navigate(item.path)}
                        className={`relative w-full flex items-center min-h-9 px-3 rounded-[9px] transition-all duration-300 group overflow-hidden ${!isExpanded && 'justify-center px-0'
                          } ${isActive
                            ? 'bg-shell-active text-shell-active-fg font-semibold shadow-sm'
                            : 'text-shell-fg/80 hover:bg-shell-fg/10 hover:text-shell-fg'}`}
                        whileTap={{ scale: 0.98 }}
                      >

                        {/* Icon */}
                        <div className="relative z-10 flex items-center justify-center">
                          <item.icon
                            className={`w-[15px] h-[15px] transition-all duration-300 ${isActive
                              ? 'text-shell-active-fg'
                              : 'text-shell-fg/80 group-hover:text-shell-fg group-hover:scale-110'
                              }`}
                            strokeWidth={isActive ? 2.2 : 1.8}
                          />
                          {item.id === 'leaves' && pendingLeaveCount > 0 && !isExpanded && (
                            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-orange border border-shell"></span>
                          )}
                        </div>

                        {/* Label */}
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.span
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: -10 }}
                              className={`ml-[9px] text-[12.5px] truncate relative z-10 flex-1 flex items-center ${isActive ? 'text-shell-active-fg font-semibold' : 'text-shell-fg/80 font-normal'}`}
                            >
                              {item.label}
                              {item.id === 'leaves' && pendingLeaveCount > 0 && (
                                <span className={`ml-auto min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full text-[10px] font-bold ${isActive ? 'bg-brand text-white' : 'bg-orange text-white'
                                  }`}>
                                  {pendingLeaveCount > 99 ? '99+' : pendingLeaveCount}
                                </span>
                              )}
                            </motion.span>
                          )}
                        </AnimatePresence>

                        {/* Tooltip (Collapsed) */}
                        {!isExpanded && (
                          <div className="absolute left-full ml-5 px-2.5 py-1.5 bg-slate-800 text-white text-[10px] font-semibold rounded-md opacity-0 group-hover:opacity-100 pointer-events-none transition-all z-50 whitespace-nowrap shadow-xl translate-x-2 group-hover:translate-x-0">
                            {item.label}
                            {item.id === 'leaves' && pendingLeaveCount > 0 && ` (${pendingLeaveCount})`}
                            <div className="absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 w-2 h-2 bg-slate-800 rotate-45" />
                          </div>
                        )}
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* User Profile */}
        <div className="relative z-10 p-3 mt-auto border-t border-shell-fg/10">
          <div className="relative overflow-hidden rounded-xl bg-shell-fg/5 border border-shell-fg/10 p-2.5 backdrop-blur-sm">
            <div className="flex items-center gap-3 relative z-10">
              <div className="relative flex-shrink-0">
                <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shadow-inner ring-1 ring-shell-fg/50">
                  <span className="font-bold text-brand text-xs">{userInitial}</span>
                </div>
              </div>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 'auto' }}
                    exit={{ opacity: 0, width: 0 }}
                    className="flex-1 overflow-hidden"
                  >
                    <p className="text-xs font-bold text-shell-fg truncate font-lexend capitalize">
                      {userRole.toLowerCase()}
                    </p>
                    <p className="text-[10px] text-shell-fg/40 truncate">Admin Workspace</p>
                  </motion.div>
                )}
              </AnimatePresence>

              {isExpanded && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => navigate('/settings')}
                    aria-label="Settings"
                    className="p-1.5 rounded-lg hover:bg-shell-fg/10 transition-colors"
                  >
                    <Settings className="w-3.5 h-3.5 text-shell-fg/40 hover:text-orange transition-colors" />
                  </button>
                  {onLogout && (
                    <button
                      type="button"
                      onClick={onLogout}
                      aria-label="Log out"
                      className="p-1.5 rounded-lg hover:bg-shell-fg/10 transition-colors"
                    >
                      <LogOut className="w-3.5 h-3.5 text-shell-fg/40 hover:text-orange transition-colors" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}