import { useState, useEffect, useRef } from 'react';
import {
  UsersRound,
  CalendarRange,
  Target,
  Settings,
  Palette,
  Menu,
  ChevronLeft,
  ShieldAlert,
  HeartPulse,
  UserX,
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
  HandCoins,
  HardHat,
  Timer,
  Sprout,
  LogOut, CalendarDays, ClipboardCheck, Layers, Network as OrgChart, Building2, FileSignature, History, Sparkles, BriefcaseBusiness, MapPin, Video
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { motion, AnimatePresence, Variants } from 'framer-motion';
import { useMyPreferences } from '../../hooks/useMyPreferences';
import { useLocation, useNavigate } from 'react-router-dom';
import bloomMark from '../../../public/bloom-mark.png';
import { usePermissions } from '../../hooks/usePermissions';
import { inMenu } from '../../lib/routeModules';
import { SIDEBAR_MENU } from '../../lib/sidebarMenu';
import { supabase } from '../../lib/supabase';
import { IN_LIST_SIZE, chunks, fetchAll } from '../../lib/fetchAll';
import { SearchInput } from '../UI';
import { onOverlayEntry } from '../../hooks/useBackToClose';

// The menu, grouped (src/lib/sidebarMenu.ts, shared with the Roles screen's preview), with an icon per entry. Who
// sees each entry is decided by its path in routeModules.ts (the modules of the person's role, FIG-827), the same list
// the routes and the header search use.
const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutGrid,
  calendar: CalendarDays,
  'task-manager': Kanban,
  teams: Network,
  'video-calls': Video,
  messages: MessagesSquare,
  'email-portal': Mails,
  employees: UsersRound,
  organogram: OrgChart,
  onboarding: ClipboardCheck,
  recruitment: UserPlus2,
  offers: FileSignature,
  leaves: CalendarRange,
  'leave-discipline': UserX,
  performance: Target,
  training: Award,
  'assign-managers': UserCheck,
  staffcheck: ShieldAlert,
  'hr-lifecycle': HeartHandshake,
  payroll: Landmark,
  'casual-workers': HardHat,
  'piece-rate': Sprout,
  overtime: Timer,
  'job-groups': Layers,
  expense: Receipt,
  advanced: Landmark,
  loans: HandCoins,
  asset: Package,
  'mpesa-zap': Smartphone,
  reports: PieChart,
  'email admin': ShieldEllipsis,
  'incident-reports': ShieldAlert,
  'work-injuries': HeartPulse,
  settings: Settings,
  'setup-assistant': Sparkles,
  departments: Building2,
  branches: MapPin,
  'job-titles': BriefcaseBusiness,
  'audit-trail': History,
  'role-permissions': ShieldHalf,
  appearance: Palette,
};
const menuGroups = SIDEBAR_MENU.map((group) => ({
  title: group.title,
  items: group.items.map((item) => ({ ...item, icon: ICONS[item.id] ?? LayoutGrid })),
}));


interface SidebarProps {
  user?: { email: string; role: string } | null;
  isCollapsed: boolean;
  onToggle: (collapsed: boolean) => void;
  onLogout?: () => void;
  /** below md the sidebar is an off-canvas drawer: these say whether it's open and close it */
  isMobile?: boolean;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export default function Sidebar({ user, isCollapsed, onToggle, onLogout, isMobile = false, mobileOpen = false, onMobileClose }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname;
  const [searchQuery, setSearchQuery] = useState('');

  // Use permissions hook for dynamic access control
  const { hasPermission, roleName, loading: permissionsLoading } = usePermissions();
  // the final approvers (HR administration; administrators) count every pending request, others only their team's
  const seesAllLeave = !permissionsLoading && hasPermission('hr-admin');
  const { data: myPreferences } = useMyPreferences(user?.email);

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
        if (seesAllLeave) {
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

        // only the people I approve for, every page of them (one request is capped at 1000 rows)
        const reportsBy = (column: 'Leave Approver' | 'Alternate Approver') =>
          fetchAll((from, to) =>
            supabase
              .from('employee_directory')
              .select('"Employee Number"')
              .eq(column, myName)
              .order('"Employee Number"')
              .range(from, to)
          );
        const [approverOf, alternateOf] = await Promise.all([reportsBy('Leave Approver'), reportsBy('Alternate Approver')]);
        const myReportNumbers = [...new Set([...approverOf, ...alternateOf].map((e: any) => e["Employee Number"]))];

        if (myReportNumbers.length === 0) {
          setPendingLeaveCount(0);
          return;
        }

        // a chunk of employee numbers per count: thousands do not fit one filter
        let total = 0;
        for (const numbers of chunks(myReportNumbers, IN_LIST_SIZE)) {
          const { count } = await supabase
            .from('leave_application')
            .select('id', { count: 'exact', head: true })
            .ilike('status', 'pending')
            .is('recstatus', null)
            .in('"Employee Number"', numbers);
          total += count || 0;
        }

        setPendingLeaveCount(total);
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
  }, [user?.email, seesAllLeave]);

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

  // the phone drawer always shows the full menu; collapsing only applies to the docked sidebar
  const isExpanded = isMobile || !isCollapsed;
  const drawerOpen = isMobile && mobileOpen;
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // the drawer closes on Escape, and takes focus when it opens so keyboard users land inside it
  useEffect(() => {
    if (!drawerOpen) return;
    closeButtonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onMobileClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen, onMobileClose]);
  // the role as the company names it (their own role, FIG-827), else the role
  const userRole = roleName || user?.role || 'Admin';
  const avatarUrl = myPreferences?.avatarUrl ?? null;
  const userInitial = user?.email?.[0]?.toUpperCase() || 'A';

  return (
    <>
    {drawerOpen && (
      <div
        data-testid="sidebar-backdrop"
        className="fixed inset-0 z-40 bg-black/40 md:hidden"
        onClick={onMobileClose}
        aria-hidden="true"
      />
    )}
    {/* below md the sidebar slides off-screen (and out of the tab order) until the menu button opens it */}
    <div
      id="app-sidebar"
      aria-label="Main navigation"
      role={isMobile ? 'dialog' : undefined}
      aria-modal={drawerOpen ? true : undefined}
      className={`fixed left-0 top-0 h-screen z-50 flex flex-col select-none transition-[transform,visibility] duration-300 ${mobileOpen ? '' : 'max-md:-translate-x-full max-md:invisible'}`}
    >
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
              <img src={bloomMark} alt="Logo" className="relative w-10 h-10 object-contain shell-logo drop-shadow-md" />
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
            ref={closeButtonRef}
            onClick={() => (isMobile ? onMobileClose?.() : onToggle(!isCollapsed))}
            aria-label={isMobile ? 'Close menu' : isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
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
                    // while permissions load every entry shows (no blank sidebar flash), then only those the role gives
                    (permissionsLoading ? inMenu(item.path, () => true) : inMenu(item.path, hasPermission)) &&
                    item.label.toLowerCase().includes(searchQuery.toLowerCase())
                  ).map((item) => {
                    const isActive = currentPath.startsWith(item.path);

                    return (
                      <motion.button
                        key={item.id}
                        onClick={() => navigate(item.path, { replace: onOverlayEntry() })}
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
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover ring-1 ring-shell-fg/50" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shadow-inner ring-1 ring-shell-fg/50">
                    <span className="font-bold text-brand text-xs">{userInitial}</span>
                  </div>
                )}
              </div>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 'auto' }}
                    exit={{ opacity: 0, width: 0 }}
                    className="flex-1 overflow-hidden"
                  >
                    <p className={`text-xs font-bold text-shell-fg truncate font-lexend ${roleName ? '' : 'capitalize'}`}>
                      {roleName ? userRole : userRole.toLowerCase()}
                    </p>
                    <p className="text-[10px] text-shell-fg/40 truncate">Admin Workspace</p>
                  </motion.div>
                )}
              </AnimatePresence>

              {isExpanded && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  {!permissionsLoading && inMenu('/settings', hasPermission) && <button
                    type="button"
                    onClick={() => navigate('/settings', { replace: onOverlayEntry() })}
                    aria-label="Settings"
                    className="p-1.5 rounded-lg hover:bg-shell-fg/10 transition-colors"
                  >
                    <Settings className="w-3.5 h-3.5 text-shell-fg/40 hover:text-orange transition-colors" />
                  </button>}
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
    </>
  );
}
