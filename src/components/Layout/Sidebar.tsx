import { useState } from 'react';
import {
  Users,
  Calendar,
  BarChart3,
  Settings,
  Bot,
  Menu,
  Siren,
  LayoutDashboard,
  Wallet,
  Blocks,
  MessageSquareMore,
  Slack,
  KeyRound,
  Box,
  PhoneCall,
  UserPlus,
  FileText,
  HandCoins,
  UserCog,
  GraduationCap,
  Smartphone,
  Mail,
  Shield,
  LogOut
} from 'lucide-react';
import { motion, AnimatePresence, Variants } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import solo from '../../../public/solo.png';
import { usePermissions } from '../../hooks/usePermissions';

// Grouping structure
const menuGroups = [
  {
    title: "Overview",
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard', permission: 'dashboard' },
      { id: 'ai-assistant', label: 'AI Assistant', icon: Bot, path: '/ai-assistant', permission: 'ai-assistant' },
    ]
  },
  {
    title: "Workspace",
    items: [
      { id: 'task-manager', label: 'Task Manager', icon: Blocks, path: '/tasks', permission: 'task-manager' },
      { id: 'teams', label: 'Teams', icon: Slack, path: '/teams', permission: 'teams' },
      { id: 'messages', label: 'SMS Center', icon: MessageSquareMore, path: '/sms', permission: 'sms' },
      { id: 'email-portal', label: 'Email Portal', icon: Mail, path: '/email-portal', permission: 'email-portal' },
    ]
  },
  {
    title: "Team",
    items: [
      { id: 'employees', label: 'Employees', icon: Users, path: '/employees', permission: 'employees' },
      { id: 'recruitment', label: 'Recruitment', icon: UserPlus, path: '/recruitment', permission: 'recruitment' },
      { id: 'leaves', label: 'Time Off', icon: Calendar, path: '/leaves', permission: 'leaves' },
      { id: 'performance', label: 'Performance', icon: BarChart3, path: '/performance', permission: 'performance' },
      { id: 'training', label: 'Training', icon: GraduationCap, path: '/training', permission: 'training' },
      { id: 'assign-managers', label: 'Assign Managers', icon: UserCog, path: '/assign-managers', permission: 'assign-managers' },
      { id: 'staffcheck', label: 'Disciplinary', icon: Siren, path: '/staffcheck', permission: 'staffcheck' },
    ]
  },
  {
    title: "Finance",
    items: [
      { id: 'payroll', label: 'Payroll', icon: Wallet, path: '/payroll', permission: 'payroll' },
      { id: 'expense', label: 'Expenses', icon: HandCoins, path: '/expenses', permission: 'expenses' },
      { id: 'advanced', label: 'Salary Advance', icon: Wallet, path: '/salaryadmin', permission: 'salaryadmin' },
      { id: 'asset', label: 'Assets', icon: Box, path: '/asset', permission: 'asset' },
      { id: 'mpesa-zap', label: 'Mpesa Zap', icon: Smartphone, path: '/mpesa-zap', permission: 'mpesa-zap' },
    ]
  },
  {
    title: "System",
    items: [
      { id: 'reports', label: 'Reports', icon: FileText, path: '/reports', permission: 'reports' },
      { id: 'phone-approvals', label: 'Approvals', icon: PhoneCall, path: '/phone-approvals', permission: 'phone-approvals' },
      { id: 'email admin', label: 'Email Admin', icon: KeyRound, path: '/adminconfirm', permission: 'adminconfirm' },
      { id: 'incident-reports', label: 'Incidents', icon: Siren, path: '/incident-reports', permission: 'incident-reports' },
      { id: 'settings', label: 'Settings', icon: Settings, path: '/settings', permission: 'settings' },
      { id: 'role-permissions', label: 'Role Permissions', icon: Shield, path: '/role-permissions', permission: 'role-permissions' },
    ]
  }
];


interface SidebarProps {
  user?: { email: string; role: string } | null;
  isCollapsed: boolean;
  onToggle: (collapsed: boolean) => void;
}

export default function Sidebar({ user, isCollapsed, onToggle }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname;
  const [isHovered, setIsHovered] = useState(false);

  // Use permissions hook for dynamic access control
  const { hasPermission, loading: permissionsLoading } = usePermissions();

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

  const isExpanded = isHovered || !isCollapsed;
  const userRole = user?.role || 'Admin';
  const userInitial = user?.email?.[0]?.toUpperCase() || 'A';

  return (
    <div className="fixed left-0 top-0 h-screen z-50 flex flex-col select-none">
      <motion.div
        initial="expanded"
        animate={isExpanded ? "expanded" : "collapsed"}
        variants={sidebarVariants}
        className={`
          relative flex flex-col h-full shadow-2xl overflow-hidden
          bg-white/70 backdrop-blur-3xl
          border-r border-white/50
        `}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Living Aurora Background - Subtle Moving Gradients */}
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
          <motion.div
            className="absolute -top-[20%] -left-[20%] w-[150%] h-[50%] bg-indigo-500/10 blur-[100px] rounded-full"
            animate={{
              rotate: [0, 360],
              scale: [1, 1.2, 1],
              x: [0, 50, 0]
            }}
            transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          />
          <motion.div
            className="absolute top-[40%] -right-[20%] w-[150%] h-[50%] bg-purple-500/10 blur-[100px] rounded-full"
            animate={{
              rotate: [360, 0],
              scale: [1, 1.3, 1],
              y: [0, -50, 0]
            }}
            transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
          />
          <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white/80 to-transparent" />
        </div>

        {/* Toggle Button Container - Removed Absolute Position */}

        {/* Brand Section */}
        <div className={`relative z-10 px-6 pt-8 pb-8 flex items-center transition-all duration-300 ${isExpanded ? 'justify-between' : 'flex-col justify-center gap-6'}`}>
          <div className="flex items-center gap-4">
            <motion.div
              layout
              className="relative w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-700 flex items-center justify-center shadow-xl shadow-indigo-200 group cursor-pointer ring-4 ring-white"
              whileHover={{ rotate: 10, scale: 1.05 }}
              onClick={() => !isExpanded && onToggle(false)}
            >
              <img src={solo} alt="Logo" className="w-5 h-5 object-contain brightness-0 invert" />
            </motion.div>

            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="flex flex-col"
                >
                  <div className="flex items-center gap-1">
                    <h1 className="font-['Outfit'] font-bold text-2xl text-gray-900 tracking-tight">
                      Zira<span className="text-indigo-600">Pro</span>
                    </h1>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <p className="text-[11px] text-gray-500 font-medium tracking-wide">System Online</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Hamburger Toggle */}
          <motion.button
            onClick={() => onToggle(!isCollapsed)}
            className={`p-2 rounded-xl hover:bg-white/50 transition-colors group ${!isExpanded ? 'bg-white shadow-sm border border-indigo-50' : ''}`}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Menu className={`w-5 h-5 transition-colors ${isExpanded ? 'text-gray-400 group-hover:text-indigo-600' : 'text-indigo-600'}`} />
          </motion.button>
        </div>

        {/* Scrollable Navigation - Staggered Entry */}
        <motion.div
          className="relative z-10 flex-1 overflow-y-auto px-4 pb-4 sidebar-scroll hover:overflow-y-auto overflow-hidden"
          initial="hidden"
          animate="visible"
          variants={{
            visible: { transition: { staggerChildren: 0.05 } }
          }}
        >
          <div className="space-y-8">
            {menuGroups.map((group) => (
              <motion.div
                key={group.title}
                variants={{
                  hidden: { opacity: 0, y: 10 },
                  visible: { opacity: 1, y: 0 }
                }}
              >
                {/* Section Header */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="px-4 mb-3 flex items-center gap-2"
                    >
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] font-['Poppins']">
                        {group.title}
                      </span>
                      <div className="h-px flex-1 bg-gradient-to-r from-gray-200 to-transparent" />
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Items */}
                <div className="space-y-1.5">
                  {group.items.map((item) => {
                    const isActive = currentPath.startsWith(item.path);

                    if (permissionsLoading) {
                      return <div key={item.id} className="h-11 mx-2 bg-gray-100 rounded-2xl animate-pulse mb-2" />;
                    }

                    if (item.permission && !hasPermission(item.permission)) return null;

                    return (
                      <motion.button
                        key={item.id}
                        onClick={() => navigate(item.path)}
                        className={`relative w-full flex items-center px-4 py-3 rounded-2xl transition-all duration-300 group overflow-hidden ${!isExpanded && 'justify-center px-0'
                          }`}
                        whileTap={{ scale: 0.98 }}
                        whileHover={{ scale: 1.02 }}
                      >
                        {/* Prismatic Active Glass Effect */}
                        {isActive && (
                          <motion.div
                            layoutId="activeSidebarItem"
                            className="absolute inset-0 bg-white shadow-[0_4px_20px_-2px_rgba(99,102,241,0.25)] border border-indigo-100/50 rounded-2xl z-0"
                            initial={false}
                            transition={{ type: "spring", stiffness: 300, damping: 30 }}
                          >
                            {/* Subtle Scanline Shimmer */}
                            <motion.div
                              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/60 to-transparent skew-x-12 opacity-50"
                              initial={{ x: '-150%' }}
                              animate={{ x: '150%' }}
                              transition={{ repeat: Infinity, duration: 3, delay: 0.5, repeatDelay: 2.5, ease: "easeInOut" }}
                            />
                          </motion.div>
                        )}

                        {/* Hover Effect for non-active */}
                        {!isActive && (
                          <div className="absolute inset-0 bg-transparent group-hover:bg-white/40 rounded-2xl transition-colors duration-300 border border-transparent group-hover:border-white/40" />
                        )}

                        {/* Icon with Bobbing Animation */}
                        <motion.div
                          className="relative z-10 flex items-center justify-center p-0.5"
                          whileHover={{ y: -2, rotate: -5, scale: 1.1 }}
                          transition={{ type: "spring", stiffness: 400, damping: 10 }}
                        >
                          <item.icon
                            className={`w-5 h-5 transition-all duration-300 ${isActive
                              ? 'text-indigo-600 drop-shadow-sm'
                              : 'text-gray-400 group-hover:text-indigo-500'
                              }`}
                            strokeWidth={isActive ? 2.5 : 2}
                          />
                        </motion.div>

                        {/* Label */}
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.span
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: -10 }}
                              className={`ml-4 text-xs truncate font-['Poppins'] relative z-10 tracking-wide transition-all duration-300 ${isActive ? 'font-bold text-gray-900' : 'font-medium text-gray-500 group-hover:text-gray-800'
                                }`}
                            >
                              {item.label}
                            </motion.span>
                          )}
                        </AnimatePresence>

                        {/* Active Indicator Bar (Left) */}
                        {isActive && (
                          <motion.div
                            layoutId="activeBar"
                            className="absolute left-0 w-1 h-6 bg-indigo-600 rounded-r-full z-20"
                          />
                        )}

                        {/* Tooltip (Collapsed) */}
                        {!isExpanded && !isHovered && (
                          <div className="absolute left-full ml-6 px-3 py-2 bg-indigo-900 text-white text-xs font-semibold rounded-xl opacity-0 group-hover:opacity-100 pointer-events-none transition-all z-50 whitespace-nowrap shadow-xl shadow-indigo-900/20 translate-x-2 group-hover:translate-x-0">
                            {item.label}
                            {/* Little arrow */}
                            <div className="absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 w-2 h-2 bg-indigo-900 rotate-45" />
                          </div>
                        )}
                      </motion.button>
                    );
                  })}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* User Profile - Creative Glass Card */}
        <div className="relative z-10 p-4 mt-auto">
          <motion.div
            className={`
              relative overflow-hidden rounded-3xl border border-white bg-white/50 backdrop-blur-md
              hover:bg-white/90 transition-all cursor-pointer group p-1 shadow-sm
            `}
            whileHover={{ y: -4, boxShadow: "0 15px 30px -10px rgba(79, 70, 229, 0.1)" }}
          >
            <div className="flex items-center gap-3 p-2 relative z-10">
              <div className="relative">
                <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-gray-100 to-white p-[2px] shadow-inner border border-gray-200">
                  <div className="w-full h-full rounded-full bg-white flex items-center justify-center overflow-hidden">
                    <span className="font-bold text-indigo-900 text-sm">{userInitial}</span>
                  </div>
                </div>
                <div className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-white rounded-full animate-pulse" />
                <div className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 rounded-full animate-ping opacity-75" />
              </div>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 'auto' }}
                    exit={{ opacity: 0, width: 0 }}
                    className="flex-1 overflow-hidden"
                  >
                    <p className="text-xs font-bold text-gray-800 truncate font-['Poppins'] capitalize">
                      {userRole.toLowerCase()}
                    </p>
                    <p className="text-[10px] text-gray-500 truncate group-hover:text-indigo-600 transition-colors">Admin Workspace</p>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Mini Action Buttons Slide In */}
              {isExpanded && (
                <div className="flex items-center -space-x-2 opacity-0 group-hover:opacity-100 group-hover:space-x-1 transition-all duration-300 transform translate-x-4 group-hover:translate-x-0">
                  <button className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                    <Settings className="w-4 h-4" />
                  </button>
                  <button className="p-1.5 rounded-full hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            {/* Decorative Background Gradient on Hover */}
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/0 via-indigo-50/0 to-indigo-50/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}