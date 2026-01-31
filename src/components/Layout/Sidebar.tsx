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
        className="relative flex flex-col h-full border-r border-dashed border-gray-200 overflow-hidden"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Iridescent Rainbow Background */}
        <div className="absolute inset-0 bg-white z-[-2]" />
        <div className="absolute inset-0 opacity-[0.4] bg-[linear-gradient(135deg,_rgba(255,255,255,1)_0%,_rgba(236,253,243,1)_20%,_rgba(238,242,255,1)_40%,_rgba(255,241,242,1)_60%,_rgba(255,251,235,1)_80%,_rgba(236,254,255,1)_100%)] z-[-1]" />


        {/* Brand Section */}
        <div className={`relative z-10 px-6 pt-8 pb-8 flex items-center transition-all duration-300 ${isExpanded ? 'justify-between' : 'flex-col justify-center gap-6'}`}>
          <div className="flex items-center gap-4">
            <motion.div
              layout
              className="relative w-10 h-10 rounded-xl bg-primary flex items-center justify-center shadow-lg shadow-indigo-200 group cursor-pointer"
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
                    <h1 className="font-['Poppins'] font-bold text-2xl text-gray-900 tracking-tight">
                      Zira<span className="text-primary">Pro</span>
                    </h1>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Hamburger Toggle */}
          <motion.button
            onClick={() => onToggle(!isCollapsed)}
            className={`p-2 rounded-xl hover:bg-gray-50 transition-colors group ${!isExpanded ? 'bg-gray-50' : ''}`}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Menu className={`w-5 h-5 transition-colors ${isExpanded ? 'text-gray-400 group-hover:text-primary' : 'text-primary'}`} />
          </motion.button>
        </div>

        {/* Scrollable Navigation */}
        <motion.div
          className="relative z-10 flex-1 overflow-y-auto px-4 pb-4 sidebar-scroll hover:overflow-y-auto overflow-hidden"
          initial="hidden"
          animate="visible"
          variants={{
            visible: { transition: { staggerChildren: 0.05 } }
          }}
        >
          <div className="space-y-6">
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
                      className="px-4 mb-2"
                    >
                      <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider font-['Poppins']">
                        {group.title}
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Items */}
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const isActive = currentPath.startsWith(item.path);

                    if (permissionsLoading) {
                      return <div key={item.id} className="h-11 mx-2 bg-gray-200 rounded-2xl animate-pulse mb-2" />;
                    }

                    if (item.permission && !hasPermission(item.permission)) return null;

                    return (
                      <motion.button
                        key={item.id}
                        onClick={() => navigate(item.path)}
                        className={`relative w-full flex items-center px-4 py-3 rounded-2xl transition-all duration-200 group overflow-hidden ${!isExpanded && 'justify-center px-0'
                          } ${isActive ? 'bg-primary text-white shadow-lg shadow-indigo-500/20' : 'text-gray-500 hover:bg-gray-50 hover:text-primary'}`}
                        whileTap={{ scale: 0.98 }}
                      >

                        {/* Icon */}
                        <div className="relative z-10 flex items-center justify-center">
                          <item.icon
                            className={`w-5 h-5 transition-all duration-200 ${isActive
                              ? 'text-white'
                              : 'text-gray-400 group-hover:text-primary'
                              }`}
                            strokeWidth={isActive ? 2.5 : 2}
                          />
                        </div>

                        {/* Label */}
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.span
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: -10 }}
                              className={`ml-3 text-[13px] truncate font-['Poppins'] relative z-10 tracking-wide font-medium ${isActive ? 'text-white' : ''}`}
                            >
                              {item.label}
                            </motion.span>
                          )}
                        </AnimatePresence>

                        {/* Tooltip (Collapsed) */}
                        {!isExpanded && !isHovered && (
                          <div className="absolute left-full ml-6 px-3 py-2 bg-gray-900 text-white text-xs font-semibold rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-all z-50 whitespace-nowrap shadow-xl translate-x-2 group-hover:translate-x-0">
                            {item.label}
                            <div className="absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 w-2 h-2 bg-gray-900 rotate-45" />
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

        {/* User Profile */}
        <div className="relative z-10 p-4 mt-auto border-t border-gray-100">
          <div
            className={`
              relative overflow-hidden rounded-2xl bg-gray-50
              hover:bg-white border border-transparent hover:border-gray-100
              transition-all cursor-pointer group p-3
            `}
          >
            <div className="flex items-center gap-3 relative z-10">
              <div className="relative">
                <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center shadow-sm border border-gray-100">
                  <span className="font-bold text-primary text-sm">{userInitial}</span>
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
                    <p className="text-xs font-bold text-gray-800 truncate font-['Poppins'] capitalize">
                      {userRole.toLowerCase()}
                    </p>
                    <p className="text-[10px] text-gray-500 truncate">Admin Workspace</p>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Settings Icon */}
              {isExpanded && (
                <Settings className="w-4 h-4 text-gray-400 group-hover:text-primary transition-colors" />
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}