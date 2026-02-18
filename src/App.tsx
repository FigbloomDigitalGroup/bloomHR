import { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from './lib/supabase';
import { Session } from '@supabase/supabase-js';
import toast, { Toaster } from 'react-hot-toast';
import { CSSProperties } from 'react';
import { UpdateNotification } from '../src/components/Settings/update';
import Sidebar from './components/Layout/Sidebar';
import Header from './components/Layout/Header';
import AdminVideoUpload from './components/training/Training';
import Footer from './components/Layout/Footer';
import Login from './pages/Login';
import Dashboard from './components/Dashboard/Dashboard';
import ExpenseModule from './components/Epense/Expense';
import EmployeeList from './components/Employees/EmployeeList';
import LoanRequestsAdmin from './components/Settings/StaffLoan';
import PayrollDashboard from './components/Payroll/PayrollDashboard';
import StaffSignupRequests from './pages/admin';
import StaffPortalLanding from './components/staff portal/StaffPortal';
import RecruitmentDashboard from './components/Recruitment/RecruitmentDashboard';
import LeaveManagementSystem from './components/Leave/LeaveManagement';
import PerformanceDashboard from './components/Perfomance/PerfomanceDashboard';
import AddEmployeePage from './components/Add Form/AddEmployeePage';
import ViewEmployeePage from './components/view_form/EmployeeDetails';
import ManagerAssignment from './components/Employees/ManagerAssignment';
import SuccessPage from './components/Add Form/SuccessPage';
import EmployeeDataTable from './components/Payroll/fog';
import EditEmployeePage from './components/Add Form/EditEmployee';
import { AIAssistantPage } from './components/AI/AIAssistantPage';
import UserRolesSettings from './components/Settings/UserRole';
import AuthRoute from './components/ProtectedRoutes/AuthRoute';
import NotFound from './components/NOT FOUND/NotFound';
import UpdatePasswordPage from './pages/UpdatePassword';

import AuthCallback from './pages/AuthCallback';
import SalaryAdvanceAdmin from './components/Settings/SalaryAdmin';
import IncidentReportsManagement from './components/Settings/IncidentReportsManagement';
import PhoneNumberApprovals from './components/Settings/PhoneNumberApprovals';
import WarningModule from './components/Warning/StaffCheck'
import React from 'react';
import { UserProvider } from '../src/components/ProtectedRoutes/UserContext';
import MFAVerification from './pages/MFAverification';
import { MicrofinanceTodoList } from './components/Task Manager/TaskManager';
import { SMSCenter } from './components/SMS/Sms';
import { ChatLayout } from './components/chat/ChatLayout';
import BaseReport from './components/Reports/BaseReport';
import ReportsList from './components/Reports/ReportLists';
import StaffLoansReport from './components/Reports/staffloans';
import StatutoryDeductionsReport from './components/Reports/statutory';
import AssetManagement from './components/Asset/Asset';
import QRScanner from './components/Asset/scan';
import MpesaZapPortal from './components/Settings/MpesaZapPortal';
import RolePermissions from './components/Settings/RolePermissions';
import EmailPortal from './components/Email/EmailPortal';

interface User {
  email: string;
  role: string;
  town: string;
  branch: string;
}

interface Branch {
  id?: number;
  "Branch Office": string;
  "Area": string;
  created_at?: string;
}

const Loader = () => {
  const loaderStyle: CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  };

  const spinnerStyle: CSSProperties = {
    width: '50px',
    height: '50px',
    border: '5px solid rgba(16, 185, 129, 0.2)',
    borderTop: '5px solid #10b981',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  };

  return (
    <div style={loaderStyle}>
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
      <div style={spinnerStyle}></div>
    </div>
  );
};

class ErrorBoundaryClass extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('App Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-4">Something went wrong</h1>
            <p className="text-gray-600 mb-4">Please refresh the page to continue</p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const ErrorBoundary = ({ children }: { children: React.ReactNode }) => {
  return <ErrorBoundaryClass>{children}</ErrorBoundaryClass>;
};

function App() {
  // All hooks at the top level
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [selectedTown, setSelectedTown] = useState<string>('');
  const [selectedRegion, setSelectedRegion] = useState('All Regions');


  // Capture initial URL to detect auth params even if Supabase clears them
  const initialUrl = useRef(window.location.href);
  const [branches, setBranches] = useState<string[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [filteredTowns, setFilteredTowns] = useState<string[]>([]);
  const [isFetchingBranches, setIsFetchingBranches] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);

  // Inactivity timer refs (using refs instead of state for timers)
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const warningTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Refs to track login state and prevent duplicate toasts
  const hasShownWelcomeToast = useRef(false);
  const lastAuthEvent = useRef<string>('');
  const navigationHandled = useRef(false);

  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Inactivity timeout constants
  const INACTIVITY_TIMEOUT = 10 * 60 * 1000; // 10 minutes in milliseconds
  const WARNING_TIMEOUT = 60 * 1000; // 1 minute warning before logout

  // Check if current route should be excluded from inactivity timer
  const shouldExcludeFromInactivityTimer = useCallback(() => {
    const excludedRoutes = ['/login', '/mfa', '/update-password'];
    const isExcludedRoute = excludedRoutes.includes(location.pathname);
    const isAuthProcess = sessionStorage.getItem('isMFAProcess') === 'true';

    return isExcludedRoute || isAuthProcess || !session || !user;
  }, [location.pathname, session, user]);

  // Clear all timers function
  const clearAllTimers = useCallback(() => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
    if (warningTimerRef.current) {
      clearTimeout(warningTimerRef.current);
      warningTimerRef.current = null;
    }

    // Clear any inactivity warning toast
    toast.dismiss('inactivity-warning');
  }, []);

  // Auto logout function
  const handleAutoLogout = useCallback(async () => {
    if (session && user) {
      console.log('Auto-logging out due to inactivity');

      // Reset refs on auto logout
      hasShownWelcomeToast.current = false;
      lastAuthEvent.current = '';
      navigationHandled.current = false;

      // Clear all timers
      clearAllTimers();

      try {
        const { error } = await supabase.auth.signOut();

        if (error) {
          console.error('Error during auto-logout:', error);
        }

        toast.error('You have been logged out due to inactivity.');
        navigate('/login', { replace: true });
      } catch (err) {
        console.error('Logout error:', err);
        navigate('/login', { replace: true });
      }
    }
  }, [session, user, clearAllTimers, navigate]);

  // Reset inactivity timer
  const resetInactivityTimer = useCallback(() => {
    // Don't set timer if we're on excluded routes or during auth processes
    if (shouldExcludeFromInactivityTimer()) {
      clearAllTimers();
      return;
    }

    // Clear existing timers first
    clearAllTimers();

    // Only set timer if user is logged in and not in excluded routes
    if (session && user) {
      // Set warning timer (9 minutes)
      warningTimerRef.current = setTimeout(() => {
        toast.error('You will be logged out due to inactivity in 1 minute.', {
          duration: 60000,
          id: 'inactivity-warning'
        });
      }, INACTIVITY_TIMEOUT - WARNING_TIMEOUT);

      // Set logout timer (10 minutes)
      inactivityTimerRef.current = setTimeout(() => {
        handleAutoLogout();
      }, INACTIVITY_TIMEOUT);
    }
  }, [session, user, shouldExcludeFromInactivityTimer, clearAllTimers, handleAutoLogout, INACTIVITY_TIMEOUT, WARNING_TIMEOUT]);

  // Activity detection event handlers
  const handleUserActivity = useCallback(() => {
    if (session && user && !shouldExcludeFromInactivityTimer()) {
      resetInactivityTimer();
    }
  }, [session, user, resetInactivityTimer, shouldExcludeFromInactivityTimer]);

  // Set up activity event listeners - ONLY when user is properly authenticated
  useEffect(() => {
    // Only set up listeners if user is logged in and not in auth processes
    if (session && user && !shouldExcludeFromInactivityTimer()) {
      const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];

      events.forEach(event => {
        document.addEventListener(event, handleUserActivity, true);
      });

      // Initialize the timer
      resetInactivityTimer();

      return () => {
        events.forEach(event => {
          document.removeEventListener(event, handleUserActivity, true);
        });

        // Clear timers on cleanup
        clearAllTimers();
      };
    } else {
      // Clear timers if user is not properly authenticated or on excluded routes
      clearAllTimers();
    }
  }, [session, user, handleUserActivity, resetInactivityTimer, shouldExcludeFromInactivityTimer, clearAllTimers]);

  // Fetch branches and regions from Supabase
  useEffect(() => {
    const fetchBranchesAndRegions = async () => {
      if (isFetchingBranches) return;

      setIsFetchingBranches(true);
      try {
        const { data, error } = await supabase
          .from('kenya_branches')
          .select('"Branch Office", "Area"')
          .order('"Branch Office"', { ascending: true });

        if (error) throw error;

        // Extract unique towns
        const branchNames = data?.map((item: Branch) => item['Branch Office']).filter(Boolean) || [];
        setBranches(branchNames);

        // Extract unique regions from Area column
        const uniqueRegions = Array.from(
          new Set(data?.map((item: Branch) => item['Area']).filter(Boolean))
        ) as string[];

        // Add "All Regions" option
        setRegions(['All Regions', ...uniqueRegions.sort()]);
        setFilteredTowns(branchNames); // Initially show all towns

      } catch (error) {
        console.error('Error fetching branches:', error);
        const fallbackTowns = ['Nairobi', 'Mombasa', 'Kisumu', 'Nakuru', 'Eldoret', 'Thika'];
        const fallbackRegions = ['All Regions', 'HQ', 'Coastal', 'Western', 'Rift Valley'];

        setBranches(fallbackTowns);
        setRegions(fallbackRegions);
        setFilteredTowns(fallbackTowns);
        toast.error('Failed to load branch data. Using fallback data.');
      } finally {
        setIsFetchingBranches(false);
      }
    };

    fetchBranchesAndRegions();
  }, []);

  // Handler for region change
  const handleRegionChange = useCallback(async (regionName: string) => {
    setSelectedRegion(regionName);

    if (regionName === 'All Regions') {
      setFilteredTowns(branches);
      return;
    }

    try {
      // Fetch towns for the selected region
      const { data, error } = await supabase
        .from('kenya_branches')
        .select('"Branch Office"')
        .eq('"Area"', regionName)
        .order('"Branch Office"', { ascending: true });

      if (error) throw error;

      const townsInRegion = data?.map((item: { "Branch Office": string }) => item['Branch Office']).filter(Boolean) || [];
      setFilteredTowns(townsInRegion);

      // If current selected town is not in the new region, reset it
      if (selectedTown && !townsInRegion.includes(selectedTown)) {
        setSelectedTown('');
        localStorage.removeItem('selectedTown');

        // Also update user metadata if logged in
        if (session?.user) {
          await supabase.auth.updateUser({
            data: { town: '', branch: '' }
          });
        }
      }

    } catch (error) {
      console.error('Error filtering towns by region:', error);
      toast.error('Failed to filter towns by region');
    }
  }, [branches, selectedTown, session]);

  const handleTownChange = useCallback(async (town: string) => {
    if (town === selectedTown) return;

    setSelectedTown(town);
    localStorage.setItem('selectedTown', town);

    // If a specific town is selected, find its region
    if (town) {
      try {
        const { data, error } = await supabase
          .from('kenya_branches')
          .select('"Area"')
          .eq('"Branch Office"', town)
          .single();

        if (!error && data) {
          setSelectedRegion(data.Area);
        }
      } catch (error) {
        console.error('Error finding region for town:', error);
      }
    }

    if (session?.user) {
      supabase.auth.updateUser({
        data: { town }
      }).then(({ error }) => {
        if (error) {
          console.error('Error updating user metadata:', error);
          toast.error('Failed to update town preference');
        } else {
          toast.success(`Town updated to ${town}`);
        }
      });
    }
  }, [session, selectedTown]);

  const handleLogout = useCallback(async () => {
    try {
      // Clear all timers first
      clearAllTimers();

      // Reset refs on logout
      hasShownWelcomeToast.current = false;
      lastAuthEvent.current = '';
      navigationHandled.current = false;

      sessionStorage.removeItem('isMFAProcess');
      sessionStorage.removeItem('mfaCompleted');

      const loadingToast = toast.loading('Signing out...');
      const { error } = await supabase.auth.signOut();
      toast.dismiss(loadingToast);

      if (error) {
        console.error('Logout error:', error);
        toast.error('Error signing out: ' + error.message);
      } else {
        toast.success('Signed out successfully');
      }

      setUser(null);
      setSession(null);
      setSelectedTown('');
      setSelectedRegion('All Regions');
      localStorage.removeItem('selectedTown');
      navigate('/login', { replace: true });
    } catch (error) {
      console.error('Unexpected logout error:', error);
      setUser(null);
      setSession(null);
      setSelectedTown('');
      setSelectedRegion('All Regions');
      localStorage.removeItem('selectedTown');
      sessionStorage.removeItem('isMFAProcess');
      sessionStorage.removeItem('mfaCompleted');
      navigate('/login', { replace: true });
    }
  }, [navigate, clearAllTimers]);

  const handleLoginSuccess = useCallback(async (userData: any) => {
    const { town, role } = userData;
    if (town) {
      handleTownChange(town);
    }

    hasShownWelcomeToast.current = true;

    // Check if MFA is enabled in system settings before triggering MFA flow
    if (role === 'CHECKER' || role === 'ADMIN') {
      try {
        const { data: settingsData } = await supabase
          .from('system_settings')
          .select('mfa_enabled')
          .eq('id', 1)
          .single();

        const mfaEnabled = settingsData?.mfa_enabled ?? false;

        if (mfaEnabled) {
          // MFA is ON — redirect to verification page
          sessionStorage.setItem('isMFAProcess', 'true');
          const mfaData = {
            userId: userData.id,
            email: userData.email,
            userRole: role,
            branch: userData.branch || userData.town || ''
          };
          sessionStorage.setItem('mfaData', JSON.stringify(mfaData));
          navigate(`/mfa?email=${encodeURIComponent(userData.email)}&userId=${userData.id}&role=${role}`, { replace: true });
          return;
        }
        // MFA is OFF — fall through to normal navigation
      } catch (e) {
        console.error('Failed to check MFA setting, skipping MFA:', e);
        // On error, skip MFA to avoid locking users out
      }
    }

    setTimeout(() => {
      const targetPath = role === 'STAFF' ? '/staff' : '/dashboard';
      navigate(targetPath, { replace: true });
    }, 100);
  }, [navigate, handleTownChange]);



  // Handle email confirmation redirect
  useEffect(() => {
    const handleEmailConfirmation = async () => {
      // Parse initial URL to ensure we don't miss params due to Supabase clearing them
      let type: string | null = searchParams.get('type');
      let token: string | null = searchParams.get('token');
      let accessToken: string | null = searchParams.get('access_token');
      let code: string | null = searchParams.get('code');

      try {
        const urlObj = new URL(initialUrl.current);
        if (!type) type = urlObj.searchParams.get('type') || new URLSearchParams(urlObj.hash.substring(1)).get('type');
        if (!token) token = urlObj.searchParams.get('token');
        if (!accessToken) accessToken = urlObj.searchParams.get('access_token') || new URLSearchParams(urlObj.hash.substring(1)).get('access_token');
        if (!code) code = urlObj.searchParams.get('code');
      } catch (e) {
        console.error('Error parsing initial URL:', e);
      }

      // Handle password recovery - this runs AFTER Supabase auto-login
      if (type === 'recovery' && (token || accessToken || code)) {
        console.log('🔐 Password recovery detected in confirmation effect');
        sessionStorage.setItem('isPasswordRecovery', 'true');

        // Manual exchange for PKCE flow to ensure session is established
        if (code) {
          try {
            // First check if session was already established by auto-detection
            const { data: { session: existingSession } } = await supabase.auth.getSession();
            if (existingSession) {
              console.log('✅ Session already established via Auto-Exchange');
            } else {
              console.log('Testing manual exchange...');
              const { data, error } = await supabase.auth.exchangeCodeForSession(code);
              if (error) {
                console.error('Manual code exchange failed:', error);
              } else if (data.session) {
                console.log('✅ Manual code exchange successful');
              }
            }
          } catch (err) {
            console.error('Error during manual code exchange:', err);
          }
        }

        // We let onAuthStateChange handle the navigation to ensure session is fully established first
        return;
      }

      // Handle signup confirmation as before (keep your existing code)
      if (type === 'signup' && accessToken) {
        try {
          const { data: { session }, error } = await supabase.auth.getSession();

          if (error) {
            navigate('/login', { replace: true });
            return;
          }

          if (session?.user) {
            const userRole = session.user.user_metadata?.role || 'STAFF';
            const userTown = session.user.user_metadata?.town || '';

            // Show email verification toast only once
            if (!hasShownWelcomeToast.current) {
              toast.success('Email verified successfully! Welcome to Zira HR.');
              hasShownWelcomeToast.current = true;
            }

            setSession(session);
            setUser({
              email: session.user.email || '',
              role: userRole,
              town: userTown,
              branch: session.user.user_metadata?.branch || ''
            });

            if (userTown) {
              setSelectedTown(userTown);
              localStorage.setItem('selectedTown', userTown);

              // Find the region for this town
              try {
                const { data } = await supabase
                  .from('kenya_branches')
                  .select('"Area"')
                  .eq('"Branch Office"', userTown)
                  .single();

                if (data) {
                  setSelectedRegion(data.Area);
                }
              } catch (error) {
                console.error('Error finding region for town:', error);
              }
            }

            const newUrl = window.location.pathname;
            window.history.replaceState({}, '', newUrl);

            const targetPath = userRole === 'STAFF' ? '/staff' : '/dashboard';
            navigate(targetPath, { replace: true });
          } else {
            navigate('/login', { replace: true });
          }
        } catch (err) {
          console.error('Email confirmation error:', err);
          navigate('/login', { replace: true });
        }
      }
    };

    handleEmailConfirmation();
  }, [navigate, searchParams, location.pathname]);

  // Main auth state management
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const currentPath = location.pathname;

        // FIRST: Check if this is a password recovery - do this BEFORE any session checks
        const urlHasRecoveryToken = window.location.href.includes('type=recovery') ||
          window.location.hash.includes('type=recovery');
        const isRecoveryFlag = sessionStorage.getItem('isPasswordRecovery') === 'true';

        if (currentPath === '/update-password' || urlHasRecoveryToken || isRecoveryFlag) {
          console.log('🔐 Password recovery detected - allowing UpdatePassword page to handle auth');
          if (urlHasRecoveryToken) {
            sessionStorage.setItem('isPasswordRecovery', 'true');
          }
          setAuthChecked(true);
          setIsInitializing(false);
          return; // Exit early, let UpdatePassword page handle everything
        }

        // NOW do normal session checks
        const { data: { session }, error } = await supabase.auth.getSession();

        if (error) {
          setAuthChecked(true);
          setIsInitializing(false);
          return;
        }

        setSession(session);

        if (session?.user?.email) {
          const userData = {
            email: session.user.email,
            role: session.user.user_metadata?.role || 'STAFF',
            town: session.user.user_metadata?.town || '',
            branch: session.user.user_metadata?.branch || ''
          };

          setUser(userData);

          // ... rest of the branch detection and normal navigation logic ...
          const savedTown = localStorage.getItem('selectedTown') ||
            session.user.user_metadata?.town || '';
          if (savedTown && branches.length > 0 && branches.includes(savedTown)) {
            setSelectedTown(savedTown);
          }

          const isEmailConfirmation = searchParams.has('type') && (searchParams.has('access_token') || searchParams.has('token'));

          // Normal navigation logic
          if ((currentPath === '/' || currentPath === '/login') && !isEmailConfirmation && !navigationHandled.current) {
            const requiresMFA = userData.role === 'ADMIN' || userData.role === 'CHECKER';
            const mfaCompleted = sessionStorage.getItem('mfaCompleted') === 'true';
            const mfaInProgress = sessionStorage.getItem('isMFAProcess') === 'true';

            if (requiresMFA && !mfaCompleted && mfaInProgress) {
              navigate('/mfa', { replace: true });
            } else {
              const targetPath = userData.role === 'STAFF' ? '/staff' : '/dashboard';
              navigate(targetPath, { replace: true });
            }
            navigationHandled.current = true;
          }
        } else {
          setUser(null);
          const currentPath = location.pathname;
          const publicPaths = ['/login', '/update-password', '/mfa'];

          const urlHasRecoveryToken = window.location.href.includes('type=recovery') ||
            window.location.hash.includes('type=recovery');
          const isRecoveryFlag = sessionStorage.getItem('isPasswordRecovery') === 'true';

          if (currentPath === '/update-password' || urlHasRecoveryToken || isRecoveryFlag) {
            console.log('🔐 Recovery flow active - staying on update-password');
            // Don't redirect, let UpdatePassword page handle it
          } else if (!publicPaths.includes(currentPath) && currentPath !== '/') {
            navigate('/login', { replace: true });
          }
        }
      } catch (error) {
        console.error('Auth initialization error:', error);
      } finally {
        setAuthChecked(true);
        setIsInitializing(false);
      }
    };

    initializeAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      // FIRST: Check if we're in password recovery mode - if so, don't interfere
      const currentPath = location.pathname;
      const urlHasRecoveryToken = window.location.href.includes('type=recovery') ||
        window.location.hash.includes('type=recovery');
      const isRecoveryFlag = sessionStorage.getItem('isPasswordRecovery') === 'true';

      if (currentPath === '/update-password' || urlHasRecoveryToken || isRecoveryFlag) {
        console.log('🔐 Auth state change ignored - in password recovery mode');
        if (urlHasRecoveryToken) {
          sessionStorage.setItem('isPasswordRecovery', 'true');
        }

        if ((urlHasRecoveryToken || isRecoveryFlag) && currentPath !== '/update-password') {
          navigate('/update-password' + location.search + location.hash, { replace: true });
        }
        return; // Exit early, let UpdatePassword handle everything
      }

      const isMFAProcess = sessionStorage.getItem('isMFAProcess') === 'true';

      console.log('Auth state change:', event, 'Is MFA process:', isMFAProcess);

      if (event === 'PASSWORD_RECOVERY') {
        sessionStorage.setItem('isPasswordRecovery', 'true');
      }

      // Prevent duplicate handling of the same event
      if (lastAuthEvent.current === event && event !== 'TOKEN_REFRESHED') {
        return;
      }
      lastAuthEvent.current = event;

      setSession(session);
      setAuthChecked(true);

      if (session?.user?.email) {
        const userData = {
          email: session.user.email,
          role: session.user.user_metadata?.role || 'STAFF',
          town: session.user.user_metadata?.town || '',
          branch: session.user.user_metadata?.branch || ''
        };

        setUser(userData);

        // Handle MFA process for ADMIN and CHECKER roles
        if (isMFAProcess && (userData.role === 'CHECKER' || userData.role === 'ADMIN')) {
          console.log('MFA process detected for', userData.role, 'role');

          // Ensure mfaData is set in sessionStorage if missing
          if (!sessionStorage.getItem('mfaData')) {
            const mfaData = {
              userId: session.user.id,
              email: userData.email,
              userRole: userData.role,
              branch: userData.branch || userData.town || ''
            };
            sessionStorage.setItem('mfaData', JSON.stringify(mfaData));
          }

          // Navigate to MFA page if not already there
          if (location.pathname !== '/mfa') {
            navigate(`/mfa?email=${encodeURIComponent(userData.email)}&userId=${session.user.id}&role=${userData.role}`, { replace: true });
          }
          return; // Exit early, let MFA handle the rest
        }

        // Normal auth flow for regular logins (keep your existing code)...
        if (userData.town && branches.length > 0 && branches.includes(userData.town)) {
          setSelectedTown(userData.town);
          localStorage.setItem('selectedTown', userData.town);

          try {
            const { data } = await supabase
              .from('kenya_branches')
              .select('"Area"')
              .eq('"Branch Office"', userData.town)
              .single();

            if (data) {
              setSelectedRegion(data.Area);
            }
          } catch (error) {
            console.error('Error finding region for town:', error);
          }
        }

        // Only show welcome toast and navigate for actual sign-in events, not token refreshes
        if (event === 'SIGNED_IN' && !hasShownWelcomeToast.current) {
          hasShownWelcomeToast.current = true;

          const currentPath = location.pathname;
          const publicPaths = ['/login', '/update-password', '/mfa'];

          // Check if MFA is required for this user AND enabled in settings
          const roleRequiresMFA = userData.role === 'ADMIN' || userData.role === 'CHECKER';
          const mfaCompleted = sessionStorage.getItem('mfaCompleted') === 'true';

          if (roleRequiresMFA && !mfaCompleted) {
            // Check DB setting before redirecting
            try {
              const { data: settingsData } = await supabase
                .from('system_settings')
                .select('mfa_enabled')
                .eq('id', 1)
                .single();

              const mfaEnabled = settingsData?.mfa_enabled ?? false;

              if (mfaEnabled) {
                console.log('MFA required for', userData.role, '- redirecting to MFA');
                if (location.pathname !== '/mfa') {
                  navigate('/mfa', { replace: true });
                }
                return; // Exit early — no welcome toast, no dashboard
              }
            } catch (e) {
              console.error('Failed to check MFA setting in auth handler, skipping MFA:', e);
            }
          }

          // Show welcome toast only if not in MFA process
          toast.success(`Welcome back, ${userData.email}!`);

          if (publicPaths.includes(currentPath)) {
            const targetPath = userData.role === 'STAFF' ? '/staff' : '/dashboard';
            navigate(targetPath, { replace: true });
          }
        }

      } else {
        setUser(null);
        setSelectedTown('');
        setSelectedRegion('All Regions');
        localStorage.removeItem('selectedTown');

        if (event === 'SIGNED_OUT') {
          // Master Guard for recovery flow
          const urlHasRecoveryToken = window.location.href.includes('type=recovery') ||
            window.location.hash.includes('type=recovery');
          if (location.pathname === '/update-password' || urlHasRecoveryToken) {
            console.log('🛑 Master Guard: Ignoring sign-out during recovery');
            return;
          }

          hasShownWelcomeToast.current = false;
          lastAuthEvent.current = '';
          navigationHandled.current = false;

          sessionStorage.removeItem('isMFAProcess');
          clearAllTimers();
          navigate('/login', { replace: true });
        }
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [navigate, location.pathname, location.search, location.hash, searchParams, branches, clearAllTimers]);

  // Reset navigation flag when location changes
  useEffect(() => {
    navigationHandled.current = false;
  }, [location.pathname]);

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  if (!authChecked || isInitializing) {
    return <Loader />;
  }

  // Main render
  return (
    <UserProvider>
      <ErrorBoundary>
        <div className="min-h-screen bg-white overflow-x-hidden">
          <UpdateNotification />
          <Routes>
            <Route path="/login" element={<Login onLoginSuccess={handleLoginSuccess} />} />
            <Route
              path="/mfa"
              element={
                <MFAVerification />
              }
            />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/update-password" element={<UpdatePasswordPage />} />
            <Route path="/teams" element={<ChatLayout />} />
            <Route
              path="/staff"
              element={session ? <StaffPortalLanding /> : <Login onLoginSuccess={handleLoginSuccess} />}
            />

            <Route
              path="/*"
              element={
                !session || !user ? (
                  <Login onLoginSuccess={handleLoginSuccess} />
                ) : (
                  <div className="flex flex-col min-h-screen bg-gray-50/50">
                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-200/40 via-purple-100/20 to-transparent pointer-events-none"></div>
                    <div className="relative flex flex-1 w-full overflow-x-hidden">
                      <Sidebar
                        user={user}
                        isCollapsed={isSidebarCollapsed}
                        onToggle={setIsSidebarCollapsed}
                      />
                      <div className={`flex-1 min-w-0 flex flex-col transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${isSidebarCollapsed ? 'ml-[88px]' : 'ml-[280px]'}`}>
                        <Header
                          user={user}
                          onLogout={handleLogout}
                          selectedTown={selectedTown}
                          onTownChange={handleTownChange}
                          selectedRegion={selectedRegion}
                          onRegionChange={handleRegionChange}
                          towns={filteredTowns}
                          regions={regions}
                          allTowns={branches}
                        />
                        <main className="flex-1 overflow-x-hidden p-4">
                          <AnimatePresence mode="wait">
                            <motion.div
                              key={location.pathname}
                              initial={{ opacity: 0, x: 20 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: -20 }}
                              transition={{ duration: 0.3 }}
                              className="w-full h-full"
                            >
                              <Routes>
                                <Route
                                  path="/"
                                  element={
                                    user?.role === 'STAFF' ?
                                      <StaffPortalLanding /> :
                                      <AuthRoute allowedRoles={['ADMIN', 'MANAGER', 'HR', 'CHECKER']}>
                                        <Dashboard selectedTown={selectedTown} selectedRegion={selectedRegion} onTownChange={handleTownChange} onRegionChange={handleRegionChange} />
                                      </AuthRoute>
                                  }
                                />
                                <Route
                                  path="/dashboard"
                                  element={
                                    <AuthRoute allowedRoles={['ADMIN', 'MANAGER', 'HR', 'REGIONAL', 'OPERATIONS', 'CHECKER']}>
                                      <Dashboard selectedTown={selectedTown} selectedRegion={selectedRegion} onTownChange={handleTownChange} onRegionChange={handleRegionChange} />
                                    </AuthRoute>
                                  }
                                />
                                <Route path="/employees" element={<EmployeeList selectedTown={selectedTown} selectedRegion={selectedRegion} onTownChange={handleTownChange} onRegionChange={handleRegionChange} />} />
                                <Route path="/add-employee" element={<AddEmployeePage />} />
                                <Route path="/view-employee/:id" element={<ViewEmployeePage />} />
                                <Route path="/view-employee/:employeeId" element={<ViewEmployeePage />} />
                                <Route path="/edit-employee/:id" element={<EditEmployeePage />} />
                                <Route path="/assign-managers" element={<ManagerAssignment />} />
                                <Route path="/employee-added" element={<SuccessPage />} />
                                <Route path="/loanadmin" element={<LoanRequestsAdmin />} />
                                <Route path="/asset" element={<AssetManagement />} />
                                <Route path="/asset/scan" element={<QRScanner />} />
                                <Route path="/expenses" element={<ExpenseModule selectedTown={selectedTown} selectedRegion={selectedRegion} onTownChange={handleTownChange} onRegionChange={handleRegionChange} />} />
                                <Route path="/tasks" element={<MicrofinanceTodoList />} />
                                <Route path="/sms" element={<SMSCenter />} />
                                <Route path="/reports" element={<ReportsList />} />
                                <Route path="reports/base" element={<BaseReport
                                  selectedTown={selectedTown}
                                  selectedRegion={selectedRegion}
                                  onTownChange={handleTownChange}
                                  onRegionChange={handleRegionChange}
                                  reportTitle="Base Report"
                                  reportDescription="Base report view"
                                  onGenerateReport={async () => []}
                                  renderReportData={() => null}
                                />} />
                                <Route path="reports/staffloan" element={<StaffLoansReport
                                  selectedTown={selectedTown}
                                  selectedRegion={selectedRegion}
                                  onTownChange={handleTownChange}
                                  onRegionChange={handleRegionChange}
                                  reportTitle="Staff Loan Report"
                                  reportDescription="Staff loan details"
                                  onGenerateReport={async () => []}
                                  renderReportData={() => null}
                                />} />
                                <Route path="reports/statutory" element={<StatutoryDeductionsReport
                                  selectedTown={selectedTown}
                                  selectedRegion={selectedRegion}
                                  onTownChange={handleTownChange}
                                  onRegionChange={handleRegionChange}
                                  reportTitle="Statutory Deductions"
                                  reportDescription="Statutory deductions details"
                                  onGenerateReport={async () => []}
                                  renderReportData={() => null}
                                />} />
                                <Route path="/teams" element={<ChatLayout />} />
                                <Route path="/staffcheck" element={<WarningModule />} />
                                <Route
                                  path="/payroll"
                                  element={
                                    <AuthRoute allowedRoles={['ADMIN', 'CHECKER']}>
                                      <PayrollDashboard />
                                    </AuthRoute>
                                  }
                                />
                                <Route
                                  path="/settings"
                                  element={
                                    <AuthRoute allowedRoles={['ADMIN', 'CHECKER']}>
                                      <UserRolesSettings />
                                    </AuthRoute>
                                  }
                                />
                                <Route
                                  path="/salaryadmin"
                                  element={
                                    <AuthRoute allowedRoles={['ADMIN', 'CHECKER', 'MANAGER', 'REGIONAL']}>
                                      <SalaryAdvanceAdmin
                                        selectedTown={selectedTown}
                                        selectedRegion={selectedRegion}
                                        allTowns={branches}
                                        regions={regions}
                                        onTownChange={handleTownChange}
                                        onRegionChange={handleRegionChange}
                                      />
                                    </AuthRoute>
                                  }
                                />
                                <Route
                                  path="/incident-reports"
                                  element={
                                    <AuthRoute allowedRoles={['ADMIN', 'CHECKER', 'MANAGER']}>
                                      <IncidentReportsManagement />
                                    </AuthRoute>
                                  }
                                />
                                <Route
                                  path="/adminconfirm"
                                  element={
                                    <AuthRoute allowedRoles={['ADMIN', 'OPERATIONS', 'CHECKER', 'HR']}>
                                      <StaffSignupRequests />
                                    </AuthRoute>
                                  }
                                />
                                <Route
                                  path="/phone-approvals"
                                  element={
                                    <AuthRoute allowedRoles={['ADMIN', 'CHECKER', 'HR']}>
                                      <PhoneNumberApprovals />
                                    </AuthRoute>
                                  }
                                />
                                <Route path="/recruitment"
                                  element={
                                    <AuthRoute allowedRoles={['ADMIN', 'HR', 'OPERATIONS', 'CHECKER']}>
                                      <RecruitmentDashboard />
                                    </AuthRoute>} />
                                <Route path="/performance" element={
                                  <PerformanceDashboard
                                    selectedTown={selectedTown}
                                    selectedRegion={selectedRegion}
                                    onTownChange={handleTownChange}
                                    onRegionChange={handleRegionChange}
                                  />
                                } />
                                <Route path="/leaves" element={<LeaveManagementSystem selectedTown={selectedTown} selectedRegion={selectedRegion} onTownChange={handleTownChange} onRegionChange={handleRegionChange} />} />
                                <Route path="/training" element={<AdminVideoUpload />} />
                                <Route path="/ai-assistant" element={<AIAssistantPage selectedTown={selectedTown} selectedRegion={selectedRegion} onTownChange={handleTownChange} onRegionChange={handleRegionChange} />} />

                                <Route path="/fogs" element={<EmployeeDataTable selectedTown={selectedTown} selectedRegion={selectedRegion} onTownChange={handleTownChange} onRegionChange={handleRegionChange} />} />
                                <Route path="/mpesa-zap" element={<MpesaZapPortal />} />
                                <Route path="/teams" element={<ChatLayout />} />

                                <Route path="/email-portal" element={
                                  <AuthRoute allowedRoles={['ADMIN', 'HR', 'CHECKER', 'MANAGER', 'OPERATIONS']}>
                                    <EmailPortal />
                                  </AuthRoute>
                                } />

                                <Route path="/role-permissions" element={<RolePermissions />} />

                                <Route path="*" element={<NotFound />} />
                              </Routes>
                            </motion.div>
                          </AnimatePresence>
                        </main>
                        <Footer />
                      </div>
                    </div>
                  </div>
                )
              }
            />
          </Routes>
          <Toaster
            position="top-right"
            containerStyle={{
              top: 20,
              right: 20,
            }}
            reverseOrder={false}
            gutter={8}
            toastOptions={{
              duration: 4000,
              style: {
                background: '#1f2937',
                color: '#fff',
                border: '1px solid #374151',
                borderRadius: '8px',
                fontSize: '14px',
              },
              success: {
                iconTheme: {
                  primary: '#10b981',
                  secondary: '#fff',
                },
                duration: 3000,
              },
              error: {
                iconTheme: {
                  primary: '#ef4444',
                  secondary: '#fff',
                },
                duration: 5000,
              },
              loading: {
                iconTheme: {
                  primary: '#3b82f6',
                  secondary: '#fff',
                },
              },
            }}
          />
        </div>
      </ErrorBoundary>
    </UserProvider>
  );
}

export default App;