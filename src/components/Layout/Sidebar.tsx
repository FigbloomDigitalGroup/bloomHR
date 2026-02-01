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
        className="relative flex flex-col h-full border-r border-white/50 shadow-2xl overflow-hidden bg-white/60 backdrop-blur-2xl"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Glowy Background: Blue & Green */}
        <div className="absolute inset-0 bg-white/70 z-[-2] backdrop-blur-2xl" />
        <div className="absolute top-0 left-0 w-96 h-96 bg-blue-500/10 rounded-full blur-[100px] mix-blend-multiply pointer-events-none z-[-1]" />
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-green-500/10 rounded-full blur-[100px] mix-blend-multiply pointer-events-none z-[-1]" />

        {/* Brand Section */}
        {/* Brand Section */}
        <div className={`relative z-10 px-5 pt-8 pb-6 flex items-center transition-all duration-300 ${isExpanded ? 'justify-between' : 'flex-col justify-center gap-6'}`}>
          <div className="flex items-center gap-3">
            <motion.div
              layout
              className="relative w-11 h-11 rounded-xl bg-gradient-to-br from-blue-600 to-[#03c04a] flex items-center justify-center shadow-[0_0_20px_-5px_rgba(3,192,74,0.5)] ring-2 ring-white/20 group cursor-pointer"
              whileHover={{ rotate: 5, scale: 1.05 }}
              onClick={() => !isExpanded && onToggle(false)}
            >
              <div className="absolute inset-0 bg-white/20 rounded-xl blur-sm" />
              <img src={solo} alt="Logo" className="relative w-6 h-6 object-contain brightness-0 invert drop-shadow-md" />
            </motion.div>

            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="flex flex-col"
                >
                  <h1 className="font-['Poppins'] font-bold text-xl text-slate-800 tracking-tight flex items-center">
                    Zira<span className="bg-gradient-to-r from-blue-600 to-[#03c04a] bg-clip-text text-transparent ml-0.5">Pro</span>
                  </h1>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Hamburger Toggle */}
          <motion.button
            onClick={() => onToggle(!isCollapsed)}
            className={`p-2 rounded-xl hover:bg-white/60 transition-all duration-300 group border border-transparent hover:border-white/40 hover:shadow-sm ${!isExpanded ? 'bg-white/40' : ''}`}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Menu className={`w-4 h-4 transition-colors ${isExpanded ? 'text-slate-400 group-hover:text-[#03c04a]' : 'text-[#03c04a]'}`} />
          </motion.button>
        </div>

        {/* Scrollable Navigation */}
        <motion.div
          className="relative z-10 flex-1 overflow-y-auto px-3 pb-4 sidebar-scroll hover:overflow-y-auto overflow-hidden"
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
                      className="px-3 mb-2"
                    >
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-['Poppins'] pl-1">
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
                      return <div key={item.id} className="h-9 mx-2 bg-slate-200/50 rounded-xl animate-pulse mb-2" />;
                    }

                    if (item.permission && !hasPermission(item.permission)) return null;

                    return (
                      <motion.button
                        key={item.id}
                        onClick={() => navigate(item.path)}
                        className={`relative w-full flex items-center px-3 py-2.5 rounded-xl transition-all duration-300 group overflow-hidden ${!isExpanded && 'justify-center px-0'
                          } ${isActive
                            ? 'bg-[#03c04a] text-white shadow-[0_0_20px_-5px_rgba(3,192,74,0.6)] ring-1 ring-[#03c04a]/50'
                            : 'text-slate-600 hover:bg-white/60 hover:text-[#03c04a] hover:shadow-sm'}`}
                        whileTap={{ scale: 0.98 }}
                      >

                        {/* Icon */}
                        <div className="relative z-10 flex items-center justify-center">
                          <item.icon
                            className={`w-4 h-4 transition-all duration-300 ${isActive
                              ? 'text-white'
                              : 'text-slate-500 group-hover:text-[#03c04a] group-hover:scale-110'
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
                              className={`ml-3 text-xs truncate font-['Poppins'] relative z-10 tracking-wide font-medium ${isActive ? 'text-white' : ''}`}
                            >
                              {item.label}
                            </motion.span>
                          )}
                        </AnimatePresence>

                        {/* Tooltip (Collapsed) */}
                        {!isExpanded && !isHovered && (
                          <div className="absolute left-full ml-5 px-2.5 py-1.5 bg-slate-800 text-white text-[10px] font-semibold rounded-md opacity-0 group-hover:opacity-100 pointer-events-none transition-all z-50 whitespace-nowrap shadow-xl translate-x-2 group-hover:translate-x-0">
                            {item.label}
                            <div className="absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 w-2 h-2 bg-slate-800 rotate-45" />
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
        <div className="relative z-10 p-3 mt-auto border-t border-white/20">
          <div
            className={`
              relative overflow-hidden rounded-xl bg-white/40
              hover:bg-white/80 border border-white/40
              transition-all duration-300 cursor-pointer group p-2.5 backdrop-blur-sm
            `}
          >
            <div className="flex items-center gap-3 relative z-10">
              <div className="relative">
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-100 to-green-100 flex items-center justify-center shadow-inner ring-1 ring-white">
                  <span className="font-bold text-primary text-xs">{userInitial}</span>
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
                    <p className="text-xs font-bold text-slate-800 truncate font-['Poppins'] capitalize">
                      {userRole.toLowerCase()}
                    </p>
                    <p className="text-[10px] text-slate-500 truncate">Admin Workspace</p>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Settings Icon */}
              {isExpanded && (
                <Settings className="w-3.5 h-3.5 text-slate-400 group-hover:text-primary transition-colors" />
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}