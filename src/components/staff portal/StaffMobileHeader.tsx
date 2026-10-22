import { Bell, Menu } from 'lucide-react';
import bloomMark from '../../../public/bloom-mark.png';
import UserProfileDropdown from './UserProfile';
import PhoneBackButton from '../Layout/PhoneBackButton';
import type { SetStaffTab } from './useStaffPortalTab';

interface StaffMobileHeaderProps {
  userName: string;
  hasUnread: boolean;
  onOpenNotifications: () => void;
  onOpenMenu: () => void;
  onPasswordReset: () => void;
  setActiveTab: SetStaffTab;
  /** on home there is no Back button */
  atHome?: boolean;
}

// The staff portal's header below md. The desktop header's notifications bell and account menu
// (profile, password reset, sign out) live here too, so phones can reach them. Away from home, "‹ Back" goes to
// the previous section (or home, when the portal was opened on this section from a link).
export default function StaffMobileHeader({
  userName,
  hasUnread,
  onOpenNotifications,
  onOpenMenu,
  onPasswordReset,
  setActiveTab,
  atHome = true,
}: StaffMobileHeaderProps) {
  return (
    <div className="md:hidden flex items-center justify-between gap-2 p-4 bg-white/80 backdrop-blur-md border-b border-gray-200 sticky top-0 z-40">
      <div className="flex items-center space-x-3 min-w-0">
        <PhoneBackButton atHome={atHome} onHome={() => setActiveTab('home', { replace: true })} />
        <div className="relative w-8 h-8 shrink-0 rounded-lg bg-brand flex items-center justify-center shadow-lg shadow-brand/20">
          <img src={bloomMark} alt="Logo" className="w-5 h-5 object-contain brightness-0 invert" />
        </div>
        <span className="font-sans font-bold text-gray-900 tracking-tight truncate">Staff Portal</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onOpenNotifications}
          aria-label="Notifications"
          className="relative p-2 text-gray-500 hover:text-brand rounded-full"
        >
          <Bell className="w-5 h-5 stroke-[1.5px]" />
          {hasUnread && (
            <span data-testid="unread-dot" className="absolute top-1.5 right-1.5 w-2 h-2 bg-status-danger rounded-full ring-2 ring-white"></span>
          )}
        </button>
        <UserProfileDropdown
          compact
          onPasswordReset={onPasswordReset}
          userName={userName}
          setActiveTab={setActiveTab}
        />
        <button type="button" onClick={onOpenMenu} aria-label="Open menu" className="p-2 text-gray-500 hover:text-brand">
          <Menu className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
}
