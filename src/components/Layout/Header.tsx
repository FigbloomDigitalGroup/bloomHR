import { useEffect, useState, useRef } from 'react';
import { AccessibilityButton } from '../Accessibility/AccessibilityModal';
import { Bell, X, Trash2, CheckCircle, MapPin, ChevronDown, AlertTriangle, Clock, HelpCircle, Menu } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { toast } from 'react-hot-toast';
import {
  useHRNotifications,
  fetchAdminHRNotifications,
  markAdminNotificationsRead,
  clearAdminNotifications,
  type HRNotification,
} from '../../hooks/useHRNotifications';
import { usePermissions } from '../../hooks/usePermissions';
import { adminNotificationTarget } from '../../lib/notificationLinks';
import ScreenSearch from './ScreenSearch';
import CompanySwitcher from '../Company/CompanySwitcher';
import { useOnlinePeople } from '../chat/lib/presence';
import { useMyCompanies } from '../../hooks/useMyCompanies';
import { OPEN_COMPANY_PROFILE, COMPANY_PROFILE_SAVED } from '../Dashboard/GetStarted';
import { loadCompanyIdentity, type CompanyIdentity } from '../../lib/companyProfile';
import { onOverlayEntry, useBackToClose, useExitGuard } from '../../hooks/useBackToClose';
import PhoneBackButton from './PhoneBackButton';

interface HeaderProps {
  user?: { email: string; role: string };
  onLogout?: () => void;
  selectedTown?: string;
  onTownChange?: (town: string) => void;
  selectedRegion?: string;
  onRegionChange?: (regionName: string) => void;
  towns?: string[];
  regions?: string[];
  allTowns?: string[];
  /** opens the sidebar drawer on phones; the button only shows below md */
  onOpenMenu?: () => void;
  menuOpen?: boolean;
}

// The bell holds the notifications stored for the company (hr_notifications) that the person can see. Read and
// cleared are each person's own (hr_notification_reads), so they stay that way across reloads and other admins
// still see theirs. New leave applications and staff sign-ups are counted on their sidebar items instead.
interface NotificationItem {
  id: string;
  type: 'hr';
  title: string;
  message: string;
  timestamp: Date;
  isRead: boolean;
  hrId?: number;
  /** what it is (type and title), for the screen it opens (lib/notificationLinks) */
  hr?: Pick<HRNotification, 'notification_type' | 'title' | 'message'>;
}

interface NotificationState {
  lastUpdated: Date | null;
  items: NotificationItem[];
}

// Custom Premium Dropdown for Header - Defined outside to prevent re-creation and flickering
const HeaderDropdown = ({ value, options, onChange, placeholder, icon: Icon }: {
  value: string,
  options: { label: string, value: string }[],
  onChange: (val: string) => void,
  placeholder: string,
  icon?: any
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const selected = options.find(o => o.value === value);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all duration-200 hover:bg-white hover:shadow-sm ${isOpen ? 'bg-white shadow-sm' : 'bg-transparent'}`}
      >
        <div className="flex items-center gap-2 max-w-[120px]">
          {Icon && <Icon className={`w-3.5 h-3.5 ${isOpen ? 'text-brand' : 'text-gray-400'}`} />}
          <span className={`text-xs font-bold truncate ${selected ? 'text-gray-900' : 'text-gray-400'}`}>
            {selected ? selected.label : placeholder}
          </span>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute top-full left-0 mt-2 min-w-[160px] bg-white border border-gray-100 rounded-xl shadow-[0_15px_30px_-5px_rgba(0,0,0,0.1)] overflow-hidden z-[100] ring-1 ring-black/5"
          >
            <div className="py-1 max-h-60 overflow-y-auto thin-scrollbar">
              {options.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                  }}
                  className={`w-full text-left px-4 py-2 text-xs transition-colors hover:bg-green-tint/50 hover:text-brand flex items-center justify-between group ${value === opt.value ? 'bg-green-tint text-brand font-bold' : 'text-gray-600'}`}
                >
                  <span>{opt.label}</span>
                  {value === opt.value && <CheckCircle className="w-3.5 h-3.5 text-brand" />}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
// ...
export default function Header({ selectedTown, onTownChange, selectedRegion, onRegionChange, towns, regions, onOpenMenu, menuOpen }: HeaderProps) {
  // the company the person is working in: its name stands in until a company profile has been set up
  const { data: myCompanies } = useMyCompanies();
  const currentCompanyName = myCompanies?.find((c) => c.is_current)?.name;
  // shows this person as online in Teams on every page, not only while the chat is open
  useOnlinePeople();
  const [notifications, setNotifications] = useState<NotificationState>({
    lastUpdated: null,
    items: []
  });
  const { checkAndNotify } = useHRNotifications();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const locationRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!locationOpen) return;
    const close = (e: MouseEvent) => {
      if (locationRef.current && !locationRef.current.contains(e.target as Node)) setLocationOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [locationOpen]);
  const [companyProfile, setCompanyProfile] = useState<CompanyIdentity | null>(null);
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  // phones: Back closes the notifications panel first; "‹ Back" in the header away from the dashboard; and in the
  // installed app, Back on the dashboard asks before leaving
  const { pathname } = useLocation();
  const atHome = pathname === '/' || pathname === '/dashboard';
  const goHome = () => navigate('/dashboard', { replace: true });
  useBackToClose(sidebarOpen, () => setSidebarOpen(false));
  useExitGuard(atHome, goHome);

  // the person's bell: what they haven't cleared, newest first, with their own read state
  const fetchNotificationCounts = async () => {
    try {
      const hrNotifs = await fetchAdminHRNotifications();
      const items: NotificationItem[] = hrNotifs.map((n: HRNotification) => ({
        id: `hr-${n.id}`,
        type: 'hr' as const,
        title: n.title,
        message: n.message,
        timestamp: new Date(n.created_at),
        isRead: n.is_read === true,
        hrId: n.id,
        hr: { notification_type: n.notification_type, title: n.title, message: n.message },
      }));
      setNotifications({ lastUpdated: new Date(), items });
    } catch (error) {
      console.error('Error fetching notification counts:', error);
    }
  };

  // the company's name and logo, from its profile (Settings > Company profile)
  const fetchCompanyProfile = async () => {
    try {
      setCompanyProfile(await loadCompanyIdentity());
    } catch (error) {
      console.error('Error fetching company profile:', error);
    }
  };

  // Setup real-time subscriptions for notifications
  useEffect(() => {
    // a new notification for the company: the bell reloads (what the person may see is the database's to say)
    const bellChannel = supabase
      .channel('hr_notifications_bell')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hr_notifications' }, () => {
        void fetchNotificationCounts();
      })
      .subscribe();

    const staffChannel = supabase
      .channel('staff_signup_notifications')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'staff_signup_requests' }, () => {
        toast.success('New staff signup request received');
      })
      .subscribe();

    const leaveChannel = supabase
      .channel('leave_application_notifications')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leave_application' }, () => {
        toast.success('New leave application received');
      })
      .subscribe();

    // Initial fetches
    fetchCompanyProfile();
    fetchNotificationCounts();
    checkAndNotify(); // Check for expiring contracts/probations

    // Setup polling as fallback (every 5 minutes)
    const interval = setInterval(fetchNotificationCounts, 300000);

    return () => {
      supabase.removeChannel(bellChannel);
      supabase.removeChannel(staffChannel);
      supabase.removeChannel(leaveChannel);
      clearInterval(interval);
    };
  }, [checkAndNotify]);

  // "Get started" on the dashboard asks for the company profile; it is read again once saved
  useEffect(() => {
    const open = () => navigate('/settings/company');
    const saved = () => void fetchCompanyProfile();
    window.addEventListener(OPEN_COMPANY_PROFILE, open);
    window.addEventListener(COMPANY_PROFILE_SAVED, saved);
    return () => {
      window.removeEventListener(OPEN_COMPANY_PROFILE, open);
      window.removeEventListener(COMPANY_PROFILE_SAVED, saved);
    };
  }, [navigate]);

  const handleBellClick = () => {
    setSidebarOpen(true);
  };

  const handleNotificationClick = (notification: NotificationItem) => {
    // read, for this person
    setNotifications(prev => ({
      ...prev,
      items: prev.items.map(item =>
        item.id === notification.id ? { ...item, isRead: true } : item
      )
    }));
    if (notification.hrId && !notification.isRead) void markAdminNotificationsRead([notification.hrId]);

    // the screen it is about (one they may open), or their own staff portal section; else it is only marked read
    // (in place of the panel's history entry, so Back does not land on the closed panel)
    const replace = onOverlayEntry();
    const target = notification.hr ? adminNotificationTarget(notification.hr, hasPermission) : null;
    if (target) navigate(target, { replace });

    setSidebarOpen(false);
  };

  const idsOf = (items: NotificationItem[]) => items.map((i) => i.hrId).filter((id): id is number => typeof id === 'number');

  const handleMarkAllRead = () => {
    const unread = notifications.items.filter((item) => !item.isRead);
    setNotifications(prev => ({ ...prev, items: prev.items.map(item => ({ ...item, isRead: true })) }));
    void markAdminNotificationsRead(idsOf(unread));
    toast.success('All notifications marked as read');
  };

  const handleClearAll = () => {
    const all = notifications.items;
    setNotifications(prev => ({ ...prev, items: [] }));
    void clearAdminNotifications(idsOf(all));
    toast.success('All notifications cleared');
  };

  const handleRemoveNotification = (notificationId: string) => {
    const item = notifications.items.find((i) => i.id === notificationId);
    setNotifications(prev => ({ ...prev, items: prev.items.filter(i => i.id !== notificationId) }));
    if (item) void clearAdminNotifications(idsOf([item]));
  };

  const unreadItems = notifications.items.filter(item => !item.isRead);
  const totalNotifications = unreadItems.length;

  return (
    <>
      {/* Header: company switcher, centered search, region/town filters, utilities */}
      <motion.header
        className="z-40 relative font-sans h-[60px] px-3 sm:px-5 bg-white border-b border-border flex items-center gap-3 lg:gap-5 box-border"
        initial={{ y: -12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        {onOpenMenu && (
          <button
            type="button"
            onClick={onOpenMenu}
            aria-label="Open menu"
            aria-expanded={!!menuOpen}
            aria-controls="app-sidebar"
            className="md:hidden -ml-1 w-9 h-9 flex-shrink-0 rounded-pill flex items-center justify-center text-muted-foreground hover:bg-secondary transition-colors"
          >
            <Menu className="w-5 h-5 stroke-[1.8px]" />
          </button>
        )}
        <PhoneBackButton atHome={atHome} onHome={goHome} compact className="md:hidden -ml-2" />

        {/* Company menu: switch company, company profile, new company */}
        <div className="flex items-center min-w-0 flex-shrink max-w-[38%] sm:max-w-[240px]">
          <CompanySwitcher
            name={companyProfile?.company_name || currentCompanyName || 'Figbloom HR'}
            logoUrl={companyProfile?.image_url}
            onOpenProfile={() => navigate('/settings/company')}
          />
        </div>

        {/* Search: takes the room left between the two sides, up to 460px; hidden on phones */}
        <div className="flex-1 min-w-0 hidden sm:flex justify-center">
          <div className="w-full max-w-[460px]">
            <ScreenSearch />
          </div>
        </div>

        {/* Right utilities */}
        <div className="flex items-center justify-end gap-1 flex-shrink-0 ml-auto">
          {(regions && onRegionChange) && (
            <>
              {/* wide screens: both filters in the bar */}
              <div className="hidden xl:flex items-center gap-0.5">
                <HeaderDropdown
                  value={selectedRegion || ''}
                  options={regions.map(r => ({ label: r, value: r }))}
                  onChange={onRegionChange}
                  placeholder="Region"
                  icon={MapPin}
                />
                <HeaderDropdown
                  value={selectedTown || ''}
                  options={[
                    { label: 'All Towns', value: '' },
                    ...(towns?.map(t => ({ label: t, value: t })) || [])
                  ]}
                  onChange={(val) => onTownChange && onTownChange(val)}
                  placeholder="Town"
                  icon={MapPin}
                />
              </div>
              {/* narrower screens: one location button that opens both filters */}
              <div className="relative xl:hidden" ref={locationRef}>
                <motion.button
                  type="button"
                  aria-label="Region and town"
                  aria-expanded={locationOpen}
                  onClick={() => setLocationOpen(o => !o)}
                  className={`relative w-[30px] h-[30px] rounded-pill flex items-center justify-center transition-colors hover:bg-secondary ${selectedRegion || selectedTown ? 'text-brand' : 'text-muted-foreground'}`}
                  whileTap={{ scale: 0.95 }}
                >
                  <MapPin className="w-[15px] h-[15px] stroke-[1.8px]" />
                  {(selectedRegion || selectedTown) && <span className="absolute top-[5px] right-[5px] w-1.5 h-1.5 rounded-full bg-brand" />}
                </motion.button>
                {locationOpen && (
                  <div className="absolute right-0 top-full mt-2 w-[240px] max-w-[calc(100vw-24px)] bg-white border border-border rounded-card shadow-lg z-50 p-2 space-y-1">
                    <p className="px-2 pt-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Region</p>
                    <HeaderDropdown
                      value={selectedRegion || ''}
                      options={regions.map(r => ({ label: r, value: r }))}
                      onChange={onRegionChange}
                      placeholder="Region"
                      icon={MapPin}
                    />
                    <p className="px-2 pt-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Town</p>
                    <HeaderDropdown
                      value={selectedTown || ''}
                      options={[
                        { label: 'All Towns', value: '' },
                        ...(towns?.map(t => ({ label: t, value: t })) || [])
                      ]}
                      onChange={(val) => onTownChange && onTownChange(val)}
                      placeholder="Town"
                      icon={MapPin}
                    />
                  </div>
                )}
              </div>
              <div className="w-px h-[18px] bg-border mx-1 hidden sm:block"></div>
            </>
          )}

          <AccessibilityButton className="w-[30px] h-[30px] rounded-pill flex items-center justify-center text-muted-foreground hover:bg-secondary transition-colors" />

          <motion.button
            type="button"
            aria-label="Help"
            className="w-[30px] h-[30px] rounded-pill flex items-center justify-center text-muted-foreground hover:bg-secondary transition-colors"
            whileTap={{ scale: 0.95 }}
          >
            <HelpCircle className="w-[15px] h-[15px] stroke-[1.8px]" />
          </motion.button>

          <motion.button
            type="button"
            aria-label="Notifications"
            className="relative w-[30px] h-[30px] rounded-pill flex items-center justify-center text-muted-foreground hover:bg-secondary transition-colors"
            whileTap={{ scale: 0.95 }}
            onClick={handleBellClick}
          >
            <Bell className="w-[15px] h-[15px] stroke-[1.8px]" />
            {totalNotifications > 0 && (
              <span className="absolute top-[5px] right-[6px] w-1.5 h-1.5 rounded-full bg-orange border-[1.5px] border-white"></span>
            )}
          </motion.button>
        </div>
      </motion.header>

      {/* Notification Sidebar - Updated with curved design */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
              className="fixed inset-0 bg-black bg-opacity-50 z-40"
            />

            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.3 }}
              className="fixed right-4 top-4 h-[95vh] w-[calc(100vw-2rem)] sm:w-96 bg-white z-50 flex flex-col rounded-2xl"
              style={{
                boxShadow: '0 20px 40px rgba(0, 0, 0, 0.15)',
                border: '1px solid rgba(255, 255, 255, 0.2)'
              }}
            >
              {/* Header */}
              <div className="p-4 border-b border-gray-200 bg-gray-50 rounded-t-2xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Bell className="w-5 h-5 text-gray-700" />
                    <h2 className="text-lg font-semibold text-gray-900" style={{ fontFamily: "'Poppins', sans-serif" }}>Notifications</h2>
                    {totalNotifications > 0 && (
                      <span className="bg-red-100 text-red-800 text-xs px-2 py-1 rounded-full">
                        {totalNotifications}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center space-x-2">
                    {unreadItems.length > 0 && (
                      <button
                        onClick={handleMarkAllRead}
                        className="text-gray-500 hover:text-brand transition-colors rounded-lg p-1 hover:bg-gray-100"
                        title="Mark all as read"
                        aria-label="Mark all as read"
                      >
                        <CheckCircle className="w-4 h-4" />
                      </button>
                    )}
                    {notifications.items.length > 0 && (
                      <button
                        onClick={handleClearAll}
                        className="text-gray-500 hover:text-red-500 transition-colors rounded-lg p-1 hover:bg-gray-100"
                        title="Clear all notifications"
                        aria-label="Clear all notifications"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => setSidebarOpen(false)}
                      className="text-gray-500 hover:text-gray-700 transition-colors rounded-lg p-1 hover:bg-gray-100"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Notifications List */}
              <div className="flex-1 overflow-y-auto">
                {notifications.items.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-gray-500">
                    <Bell className="w-12 h-12 mb-4 opacity-50" />
                    <p className="text-lg font-medium" style={{ fontFamily: "'Poppins', sans-serif" }}>No notifications</p>
                    <p className="text-xs" style={{ fontFamily: "'Poppins', sans-serif" }}>You're all caught up!</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-200">
                    {notifications.items.map((notification) => (
                      <motion.div
                        key={notification.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`p-4 hover:bg-gray-50 cursor-pointer transition-colors relative ${!notification.isRead ? 'bg-amber-50 border-l-4 border-l-amber-500' : ''}`}
                        onClick={() => handleNotificationClick(notification)}
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveNotification(notification.id);
                          }}
                          aria-label="Clear this notification"
                          title="Clear"
                          className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 transition-colors rounded-lg p-1 hover:bg-gray-100"
                        >
                          <X className="w-4 h-4" />
                        </button>

                        <div className="flex items-start space-x-3">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-amber-100 text-amber-600">
                            <Clock className="w-4 h-4" />
                          </div>

                          <div className="flex-1 min-w-0">
                            <h3 className="text-xs font-medium text-gray-900 truncate" style={{ fontFamily: "'Poppins', sans-serif" }}>
                              {notification.title}
                            </h3>
                            <p className="text-xs text-gray-600 mt-1 line-clamp-2" style={{ fontFamily: "'Poppins', sans-serif" }}>
                              {notification.message}
                            </p>
                            {notification.hr && (
                              <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-medium text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">
                                <AlertTriangle className="w-2.5 h-2.5" /> HR Lifecycle
                              </span>
                            )}
                            <p className="text-xs text-gray-500 mt-1" style={{ fontFamily: "'Poppins', sans-serif" }}>
                              {notification.timestamp.toLocaleDateString()} {notification.timestamp.toLocaleTimeString()}
                            </p>
                          </div>

                          {!notification.isRead && (
                            <div className="w-2 h-2 rounded-full flex-shrink-0 mt-2 bg-amber-500"></div>
                          )}
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>

              {/* Footer */}
              {notifications.items.length > 0 && (
                <div className="p-4 border-t border-gray-200 bg-gray-50 rounded-b-2xl">
                  <p className="text-xs text-gray-500 text-center" style={{ fontFamily: "'Poppins', sans-serif" }}>
                    {unreadItems.length} unread of {notifications.items.length} total
                  </p>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}