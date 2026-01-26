import { ChevronDown, LockKeyhole, LogOut, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import toast from "react-hot-toast";


const UserProfileDropdown = ({
  onPasswordReset,
  loginStatus,
  userName,
  setActiveTab
}: {
  onPasswordReset: () => void,
  loginStatus: { isLoggedIn: boolean; lastLogin: string | null },
  userName: string,
  setActiveTab?: (tab: string) => void
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);


  const getCurrentPosition = (): Promise<GeolocationPosition> => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported by this browser'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: position.timestamp
          });
        },
        (error) => {
          reject(error);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      );
    });
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const handleButtonClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOpen(!isOpen);
  };

  const handleSignOut = async () => {
    try {
      setIsOpen(false);
      // Log logout time with geolocation
      await logLogoutTime();

      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      toast.success('Signed out successfully');
      navigate('/login');
    } catch (error) {
      toast.error('Error signing out');
      console.error('Sign out error:', error);
    }
  };

  const handlePasswordReset = () => {
    setIsOpen(false);
    onPasswordReset();
  };

  const logLogoutTime = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get employee number from user email
      const { data: employeeData } = await supabase
        .from('employees')
        .select('"Employee Number"')
        .eq('"Work Email"', user.email)
        .single();

      if (!employeeData) return;

      // Get current login session
      const { data: activeLog } = await supabase
        .from('attendance_logs')
        .select('id')
        .eq('employee_number', employeeData["Employee Number"])
        .is('logout_time', null)
        .order('login_time', { ascending: false })
        .limit(1)
        .single();

      if (activeLog) {
        const position = await getCurrentPosition();

        await supabase
          .from('attendance_logs')
          .update({
            logout_time: new Date().toISOString(),
            geolocation: position ? {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy,
              timestamp: position.timestamp
            } : null,
            status: 'logged_out'
          })
          .eq('id', activeLog.id);
      }
    } catch (error) {
      console.error('Error logging logout time:', error);
    }
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        className="flex items-center w-full p-3 text-left rounded-lg hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-green-500"
        onClick={handleButtonClick}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <div className="h-8 w-8 rounded-full bg-green-100 flex items-center justify-center mr-3">
          <User className="h-4 w-4 text-green-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-900 truncate">{userName}</p>
          <p className="text-xs text-gray-500 truncate">
            {loginStatus.isLoggedIn ?
              `Logged in at ${loginStatus.lastLogin ? new Date(loginStatus.lastLogin).toLocaleTimeString() : 'recently'}` :
              'Not logged in'}
          </p>
        </div>
        <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown positioned above the button since it's at bottom of sidebar */}
      {isOpen && (
        <div
          ref={dropdownRef}
          className=" bg-white rounded-lg shadow-xl border border-gray-200  min-w-full"
        >

          {setActiveTab && (
            <button
              onClick={() => {
                setActiveTab('details');
                setIsOpen(false);
              }}
              className="w-full text-left px-4 py-3 text-xs text-gray-700 hover:bg-gray-50 flex items-center transition-colors border-b border-gray-100"
            >
              <User className="h-4 w-4 mr-3 text-gray-500" />
              My Profile
            </button>
          )}
          <button
            onClick={handlePasswordReset}
            className="w-full text-left px-4 py-3 text-xs text-gray-700 hover:bg-gray-50 flex items-center transition-colors border-b border-gray-100"
          >
            <LockKeyhole className="h-4 w-4 mr-3 text-gray-500" />
            Reset Password
          </button>
          <button
            onClick={handleSignOut}
            className="w-full text-left px-4 py-3 text-xs text-gray-700 hover:bg-gray-50 flex items-center transition-colors"
          >
            <LogOut className="h-4 w-4 mr-3 text-gray-500" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}; export default UserProfileDropdown