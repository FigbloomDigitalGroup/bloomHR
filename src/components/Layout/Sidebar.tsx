import { useState } from 'react';
import {
  Users,
  Calendar,
  BarChart3,
  Settings,
  Bot,
  ChevronLeft,
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
  Shield
} from 'lucide-react';
import { motion, AnimatePresence, Variants } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import solo from '../../../public/solo.png';
import { usePermissions } from '../../hooks/usePermissions';

// Grouping structure for a "Silicon Valley" modern app feel
// Now using permission IDs instead of hard-coded roles
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
    title: "People & HR",
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
    title: "Finance & Assets",
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
}

export default function Sidebar({ user }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname;
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // Use permissions hook for dynamic access control
  const { hasPermission, loading: permissionsLoading } = usePermissions();

  const sidebarVariants: Variants = {
    expanded: {
      width: 260,
      transition: { type: "spring", stiffness: 300, damping: 30 }
    },
    collapsed: {
      width: 68,
      transition: { type: "spring", stiffness: 300, damping: 30 }
    }
  };

  const isExpanded = isHovered || !isCollapsed;
  const userRole = user?.role || 'Admin';
  const userEmail = user?.email || 'admin@zirahr.com';
  const userInitial = userEmail[0]?.toUpperCase() || 'A';

  return (
    <div className="relative py-4 ml-4 min-h-screen flex items-start">
      <motion.div
        initial="expanded"
        animate={isExpanded ? "expanded" : "collapsed"}
        variants={sidebarVariants}
        className="relative flex flex-col z-20 bg-white/80 backdrop-blur-2xl shadow-xl border border-white/50 h-fit min-h-[80vh] rounded-[32px]"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Modern Toggle Button */}
        <motion.button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="absolute -right-3 top-8 z-50 p-1.5 rounded-full bg-white shadow-lg border border-gray-100 text-gray-500 hover:text-gray-800 hover:scale-110 transition-all"
        >
          <ChevronLeft className={`w-3.5 h-3.5 transition-transform duration-300 ${isCollapsed ? 'rotate-180' : ''}`} />
        </motion.button>

        {/* Logo Section */}
        <div className="px-5 pt-8 pb-6 flex items-center flex-shrink-0">
          <motion.div
            className="w-9 h-9 rounded-xl bg-[#202020] flex items-center justify-center shadow-lg border border-gray-700"
            layout
          >
            <img src={solo} alt="Logo" className="w-5 h-5 object-contain" />
          </motion.div>

          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="ml-3"
              >
                <h1 className="font-bold text-lg text-gray-800 tracking-tight leading-none">
                  Zira<span className="text-indigo-600 font-medium">HR</span>
                </h1>
                <p className="text-[10px] text-gray-400 font-medium tracking-wide mt-0.5">Smiles Start Here</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Navigation Area - Grows freely */}
        <div className="flex-1 px-3 pb-4 space-y-6">
          {menuGroups.map((group) => (
            <div key={group.title}>
              {/* Group Title */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.h3
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ delay: 0.1 }}
                    className="px-3 mb-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest"
                  >
                    {group.title}
                  </motion.h3>
                )}
              </AnimatePresence>

              {/* Group Items */}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive = currentPath === item.path;

                  const NavItem = (
                    <motion.button
                      onClick={() => navigate(item.path)}
                      className={`relative w-full flex items-center p-2 rounded-xl transition-all duration-300 group ${isActive
                        ? 'bg-indigo-50/80 text-indigo-600'
                        : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                        }`}
                      whileTap={{ scale: 0.98 }}
                    >
                      {/* Active Indicator Dot */}
                      {isActive && (
                        <motion.div
                          layoutId="activeDot"
                          className="absolute left-0 w-1 h-6 bg-indigo-500 rounded-r-full"
                          style={{ left: '-12px' }}
                          transition={{ type: "spring", stiffness: 300, damping: 30 }}
                        />
                      )}

                      <div className="relative flex items-center justify-center min-w-[24px]">
                        <item.icon
                          className={`w-[18px] h-[18px] transition-colors duration-300 ${isActive ? 'text-indigo-600' : 'text-gray-400 group-hover:text-gray-600'
                            }`}
                          strokeWidth={isActive ? 2.5 : 2}
                        />
                      </div>

                      <AnimatePresence>
                        {isExpanded && (
                          <motion.span
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -10 }}
                            className={`ml-3 text-[13px] font-medium truncate ${isActive ? 'font-semibold' : ''
                              }`}
                          >
                            {item.label}
                          </motion.span>
                        )}
                      </AnimatePresence>

                      {/* Hover Tooltip for collapsed state */}
                      {!isExpanded && !isHovered && (
                        <div className="absolute left-full ml-4 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap">
                          {item.label}
                        </div>
                      )}
                    </motion.button>
                  );

                  // Only render if user has permission (or no permission required)
                  if (item.permission && !hasPermission(item.permission)) {
                    return null;
                  }

                  return <div key={item.id}>{NavItem}</div>;
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Profile / Bottom Section */}
        <div className="p-4 border-t border-gray-100 mt-auto">
          <div className={`flex items-center gap-3 p-2 rounded-xl transition-colors hover:bg-gray-50 cursor-pointer ${!isExpanded ? 'justify-center' : ''}`}>
            <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-100 shadow-sm flex items-center justify-center overflow-hidden flex-shrink-0 text-indigo-600 font-bold text-xs ring-2 ring-white">
              {userInitial}
            </div>

            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                  className="flex-1 overflow-hidden"
                >
                  <p className="text-sm font-semibold text-gray-700 truncate capitalize">{userRole.toLowerCase()}</p>
                  <p className="text-[10px] text-gray-400 truncate">{userEmail}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </div>
  );
}