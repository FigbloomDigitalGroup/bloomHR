import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import { Routes, Route, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { Session } from '@supabase/supabase-js';
import toast, { Toaster } from 'react-hot-toast';
import Sidebar from './components/Layout/Sidebar';
import Header from './components/Layout/Header';
import Footer from './components/Layout/Footer';
import Login from './pages/Login';
import AuthRoute from './components/ProtectedRoutes/AuthRoute';
import NotFound from './components/NOT FOUND/NotFound';
import UpdatePasswordPage from './pages/UpdatePassword';

import AuthCallback from './pages/AuthCallback';
import React from 'react';
import { UserProvider } from '../src/components/ProtectedRoutes/UserContext';
import MFAVerification from './pages/MFAverification';
import { landingTarget, useCompanyProfile, withProfileRole } from './hooks/useCompanyProfile';
import { syncThemeWithAccount } from './lib/preferences';
import CompanyGate from './components/Company/CompanyGate';
import FigbloomLoader from './components/UI/FigbloomLoader';
import { useCompanySwitching } from './hooks/useMyCompanies';
import { useMobileNav } from './components/Layout/useMobileNav';
import { isStaleChunkError, reloadOnceForStaleChunk } from './lib/staleChunk';
import { welcomeMessage } from './lib/welcome';
import { IDLE_WARNING_MS, idleState, lastActivity, markActivity } from './lib/idleLogout';
import { isHiddenModule } from './lib/hiddenModules';
import { usesStaffPortal } from './lib/routeModules';

// Route-level code splitting: each page is fetched when first visited.
const AdminVideoUpload = lazy(() => import('./components/training/Training'));
const Dashboard = lazy(() => import('./components/Dashboard/Dashboard'));
const ExpenseModule = lazy(() => import('./components/Epense/Expense'));
const EmployeeList = lazy(() => import('./components/Employees/EmployeeList'));
const LoanRequestsAdmin = lazy(() => import('./components/Settings/StaffLoan'));
const PayrollDashboard = lazy(() => import('./components/Payroll/PayrollDashboard'));
const PayslipDesignPage = lazy(() => import('./components/Payroll/PayslipDesignPage'));
const PlatformRatesPage = lazy(() => import('./components/Payroll/PlatformRatesPage'));
const StaffSignupRequests = lazy(() => import('./pages/admin'));
const StaffPortalLanding = lazy(() => import('./components/staff portal/StaffPortal'));
const RecruitmentDashboard = lazy(() => import('./components/Recruitment/RecruitmentDashboard'));
const LeaveManagementSystem = lazy(() => import('./components/Leave/LeaveManagement'));
const PerformanceDashboard = lazy(() => import('./components/Perfomance/KpiPerformancePage'));
const AddEmployeePage = lazy(() => import('./components/Add Form/AddEmployeePage'));
const ViewEmployeePage = lazy(() => import('./components/view_form/EmployeeDetails'));
const ManagerAssignment = lazy(() => import('./components/Employees/ManagerAssignment'));
const Organogram = lazy(() => import('./components/Employees/Organogram'));
const Departments = lazy(() => import('./components/Settings/Departments'));
const SuccessPage = lazy(() => import('./components/Add Form/SuccessPage'));
const EmployeeDataTable = lazy(() => import('./components/Payroll/fog'));
const EditEmployeePage = lazy(() => import('./components/Add Form/EditEmployee'));
const OnboardingReview = lazy(() => import('./components/Onboarding/OnboardingReview'));
const OnboardingPrint = lazy(() => import('./components/Onboarding/OnboardingPrint'));
const UserRolesSettings = lazy(() => import('./components/Settings/UserRole'));
const CompanyProfilePage = lazy(() => import('./components/Settings/CompanyProfile'));
const JobGroupsPage = lazy(() => import('./components/Settings/JobGroups'));
const JobTitlesPage = lazy(() => import('./components/Settings/JobTitles'));
const BranchesPage = lazy(() => import('./components/Settings/Branches'));
const AuditTrailPage = lazy(() => import('./components/Settings/AuditTrail'));
const SalaryAdvanceAdmin = lazy(() => import('./components/Settings/SalaryAdmin'));
const LoansAdmin = lazy(() => import('./components/Loans/LoansAdmin'));
const CasualWorkers = lazy(() => import('./components/Casual/CasualWorkers'));
const LeaveDisciplinePage = lazy(() => import('./components/LeaveDiscipline/LeaveDisciplinePage'));
const OvertimePage = lazy(() => import('./components/Overtime/OvertimePage'));
const PieceRatePage = lazy(() => import('./components/PieceRate/PieceRatePage'));
const IncidentReportsManagement = lazy(() => import('./components/Settings/IncidentReportsManagement'));
const WorkInjuries = lazy(() => import('./components/WorkInjury/WorkInjuries'));
const WarningModule = lazy(() => import('./components/Warning/StaffCheck'));
const BaseReport = lazy(() => import('./components/Reports/BaseReport'));
const ReportsList = lazy(() => import('./components/Reports/ReportLists'));
const StaffLoansReport = lazy(() => import('./components/Reports/staffloans'));
const StatutoryDeductionsReport = lazy(() => import('./components/Reports/statutory'));
const GroupReport = lazy(() => import('./components/Reports/GroupReport'));
const AssetManagement = lazy(() => import('./components/Asset/Asset'));
const QRScanner = lazy(() => import('./components/Asset/scan'));
const MpesaZapPortal = lazy(() => import('./components/Settings/MpesaZapPortal'));
const RolePermissions = lazy(() => import('./components/Settings/RolePermissions'));
const EmailPortal = lazy(() => import('./components/Email/EmailPortal'));
const HRLifecycleDashboard = lazy(() => import('./components/HR/HRLifecycleDashboard'));
const CompanyCalendar = lazy(() => import('./components/Calendar/CompanyCalendar'));
const AIAssistantWidget = lazy(() => import('./components/AI/AIAssistantWidget'));
const AIAssistantPage = lazy(() => import('./components/AI/AIAssistantPage').then((m) => ({ default: m.AIAssistantPage })));
const SetupAssistant = lazy(() => import('./components/AI/SetupAssistant'));
const TaskManager = lazy(() => import('./components/Task Manager/TaskManager'));
const SMSCenter = lazy(() => import('./components/SMS/Sms').then((m) => ({ default: m.SMSCenter })));
const JoinCompany = lazy(() => import('./pages/JoinCompany'));
const OfferPage = lazy(() => import('./pages/OfferPage'));
const OffersPage = lazy(() => import('./components/AfterHiring/OffersPage'));
const CreateCompany = lazy(() => import('./pages/CreateCompany'));
const NoCompany = lazy(() => import('./pages/NoCompany'));
const Appearance = lazy(() => import('./components/Settings/Appearance'));
const InvitePeople = lazy(() => import('./components/Settings/InvitePeople'));
const ChatLayout = lazy(() => import('./components/chat/ChatLayout').then((m) => ({ default: m.ChatLayout })));
// the staff portal's Video Conference, for admins, HR, managers... (rooms private to the company: lib/meetingRooms.ts)
const VideoCalls = lazy(() => import('./components/staff portal/VideoConf'));

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

// Pages a signed-in person may be on before two-step sign-in is done.
const MFA_OPEN_PATHS = ['/login', '/mfa', '/update-password', '/join', '/create-company'];

const Loader = () => <FigbloomLoader fullScreen />;
// while the person's company and workspace load
const WorkspaceLoader = () => <FigbloomLoader fullScreen label="Loading your workspace" />;

/** A screen of the admin app, opened by the modules of the person's role (src/lib/routeModules.ts). */
const gate = (path: string, element: React.ReactNode) => (
  <Route key={path} path={path} element={<AuthRoute screen={path}>{element}</AuthRoute>} />
);
// while a page's code arrives: in the content area, where the page's own loader then carries on
const PageLoader = () => (
  <div className="flex min-h-[60vh] items-center justify-center">
    <FigbloomLoader label="Loading" />
  </div>
);

class ErrorBoundaryClass extends React.Component<
  { children: React.ReactNode; resetKey?: string },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode; resetKey?: string }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  // going to another page clears the error: a slip while signing in (/login -> /mfa -> /dashboard) must not stay up
  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.hasError && prev.resetKey !== this.props.resetKey) this.setState({ hasError: false, error: null });
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('App Error:', error, errorInfo);
    // an old tab asking for page files a newer deploy replaced: a reload fetches the new ones
    if (isStaleChunkError(error)) reloadOnceForStaleChunk();
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-page px-4">
          <div className="text-center max-w-md">
            <h1 className="text-2xl font-bold text-ink mb-2">Something went wrong</h1>
            <p className="text-sm text-muted-foreground mb-5">Please refresh the page to continue.</p>
            {this.state.error?.message && (
              <p className="text-xs text-subtle mb-5 break-words">{this.state.error.message}</p>
            )}
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="px-5 py-2.5 rounded-tile bg-brand text-white text-xs font-bold hover:bg-brand-dark transition-colors"
            >
              Refresh page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const ErrorBoundary = ({ children }: { children: React.ReactNode }) => {
  const { pathname } = useLocation();
  return <ErrorBoundaryClass resetKey={pathname}>{children}</ErrorBoundaryClass>;
};

function App() {
  // All hooks at the top level
  const [authUser, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  // The role shown in the app comes from user_profiles (the company the person is working in), never from the
  // editable user_metadata; see useCompanyProfile.
  const companyState = useCompanyProfile(session?.user?.id);
  const user = useMemo(() => withProfileRole(authUser, companyState), [authUser, companyState]);
  // After signing in, where to go is decided by the role in the company profile, once it has loaded for this
  // login. The role in user_metadata is often missing (then treated as STAFF), which sent admins to the staff
  // portal; and two sign-in handlers raced to navigate with different roles.
  const [landingPending, setLandingPending] = useState(false);
  const goToLanding = useCallback(() => setLandingPending(true), []);
  // the colour theme saved on the account applies on every device the person signs in on
  useEffect(() => {
    if (session?.user?.id) void syncThemeWithAccount();
  }, [session?.user?.id]);
  const [selectedTown, setSelectedTown] = useState<string>('');
  const [selectedRegion, setSelectedRegion] = useState('All Regions');


  // Capture initial URL to detect auth params even if Supabase clears them
  const initialUrl = useRef(window.location.href);
  // The reset page with the link's query and hash: the live ones, or, once the sign-in client has read and
  // cleared them, the ones the page opened with, so /update-password still sees the link's tokens or error.
  const recoveryTarget = useCallback(() => {
    const live = window.location.search + window.location.hash;
    if (/(type=recovery|token_hash=|access_token=|error_code=|error_description=|[?&]code=)/.test(live)) return '/update-password' + live;
    try {
      const first = new URL(initialUrl.current);
      return '/update-password' + first.search + first.hash;
    } catch {
      return '/update-password';
    }
  }, []);
  const [branches, setBranches] = useState<string[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [filteredTowns, setFilteredTowns] = useState<string[]>([]);
  const [isFetchingBranches, setIsFetchingBranches] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);

  // When this tab last wrote its activity to the shared store (mouse moves come too fast to write each one)
  const lastActivityWriteRef = useRef(0);

  // Refs to track login state and prevent duplicate toasts
  const hasShownWelcomeToast = useRef(false);
  const lastAuthEvent = useRef<string>('');
  const navigationHandled = useRef(false);

  const location = useLocation();
  const navigate = useNavigate();

  // Two-step sign-in (FIG-834): the server decides whether this sign-in still needs a code. mfa_required() reads the
  // pass the server records after a right code, for this session only, so nothing kept in the browser can skip it.
  // Asked again on each page until it says no; then not again for this login. A failed check does not lock people out
  // (as before); the server-side check, mfa_satisfied(), is what policies rely on.
  const mfaClearedFor = useRef<string | null>(null);
  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) {
      mfaClearedFor.current = null;
      return;
    }
    if (mfaClearedFor.current === userId || MFA_OPEN_PATHS.includes(location.pathname)) return;
    let live = true;
    supabase.rpc('mfa_required').then(({ data, error }) => {
      if (!live || error) return;
      if (data) {
        sessionStorage.setItem('isMFAProcess', 'true');
        navigate('/mfa', { replace: true });
      } else {
        mfaClearedFor.current = userId;
      }
    });
    return () => {
      live = false;
    };
  }, [session?.user?.id, location.pathname, navigate]);

  // go to the landing page once the company profile of the login that just signed in is known
  useEffect(() => {
    if (!landingPending) return;
    const target = landingTarget(companyState, session?.user?.id);
    if (!target) return;
    setLandingPending(false);
    navigate(target, { replace: true });
  }, [landingPending, companyState, session?.user?.id, navigate]);
  const [searchParams] = useSearchParams();

  // Check if current route should be excluded from inactivity timer
  const shouldExcludeFromInactivityTimer = useCallback(() => {
    const excludedRoutes = ['/login', '/mfa', '/update-password', '/join', '/offer', '/create-company'];
    const isExcludedRoute = excludedRoutes.includes(location.pathname);
    const isAuthProcess = sessionStorage.getItem('isMFAProcess') === 'true';

    return isExcludedRoute || isAuthProcess || !session || !user;
  }, [location.pathname, session, user]);

  const clearAllTimers = useCallback(() => {
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
        // this browser only: being away from one device must not sign the person out on their others
        const { error } = await supabase.auth.signOut({ scope: 'local' });

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

  // Sign out after a spell away from every tab (see lib/idleLogout): activity in any tab is written to shared storage,
  // and each tab checks how long it has been since, so one idle tab no longer signs out someone working in another
  const watchIdle = !shouldExcludeFromInactivityTimer();
  // the session object changes on each token refresh; that must not restart the watch and count as activity
  const autoLogoutRef = useRef(handleAutoLogout);
  autoLogoutRef.current = handleAutoLogout;
  useEffect(() => {
    if (!watchIdle) {
      clearAllTimers();
      return;
    }

    const handleUserActivity = () => {
      const now = Date.now();
      if (now - lastActivityWriteRef.current < 5000) return;
      lastActivityWriteRef.current = now;
      markActivity(now);
    };
    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach(event => document.addEventListener(event, handleUserActivity, true));

    lastActivityWriteRef.current = Date.now();
    markActivity(lastActivityWriteRef.current);

    const check = () => {
      const state = idleState(Date.now(), lastActivity());
      if (state === 'expired') {
        autoLogoutRef.current();
      } else if (state === 'warn') {
        toast.error('You will be logged out due to inactivity in 1 minute.', {
          duration: IDLE_WARNING_MS,
          id: 'inactivity-warning'
        });
      } else {
        toast.dismiss('inactivity-warning');
      }
    };
    const interval = setInterval(check, 15_000);
    // a tab coming back into view (or a laptop waking up) checks straight away
    document.addEventListener('visibilitychange', check);

    return () => {
      events.forEach(event => document.removeEventListener(event, handleUserActivity, true));
      clearInterval(interval);
      document.removeEventListener('visibilitychange', check);
      clearAllTimers();
    };
  }, [watchIdle, clearAllTimers]);

  // Fetch the company's branches and regions once someone is signed in (signed out there are none to see), and again
  // when a different user signs in
  const signedInUserId = session?.user?.id;
  useEffect(() => {
    if (!signedInUserId) return;
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
        // no made-up towns: the filters stay empty rather than offer places the company doesn't have
        console.error('Error fetching branches:', error);
        setBranches([]);
        setRegions(['All Regions']);
        setFilteredTowns([]);
        toast.error('Failed to load branches and regions.');
      } finally {
        setIsFetchingBranches(false);
      }
    };

    fetchBranchesAndRegions();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isFetchingBranches only guards against overlapping loads
  }, [signedInUserId]);

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
      // this browser only: signing out on the phone must not sign the person out of their laptop too
      const { error } = await supabase.auth.signOut({ scope: 'local' });
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
    if (town && role !== 'HR') {
      handleTownChange(town);
    } else if (role === 'HR') {
      handleTownChange(''); // Default HR to All Towns
    }

    hasShownWelcomeToast.current = true;

    // Does the company ask this person for a code (two-step sign-in, FIG-834)? The database decides by role.
    try {
      const { data: mfaRequired } = await supabase.rpc('mfa_required');

      if (mfaRequired) {
        sessionStorage.setItem('isMFAProcess', 'true');
        navigate('/mfa', { replace: true });
        return;
      }
    } catch (e) {
      // as before, a failed check does not lock people out
      console.error('Failed to check MFA setting, skipping MFA:', e);
    }

    goToLanding();
  }, [handleTownChange, goToLanding]);

  // Handle email confirmation redirect
  useEffect(() => {
    const handleEmailConfirmation = async () => {
      // Parse initial URL to ensure we don't miss params due to Supabase clearing them
      let type: string | null = searchParams.get('type');
      let accessToken: string | null = searchParams.get('access_token');

      try {
        const urlObj = new URL(initialUrl.current);
        if (!type) type = urlObj.searchParams.get('type') || new URLSearchParams(urlObj.hash.substring(1)).get('type');
        if (!accessToken) accessToken = urlObj.searchParams.get('access_token') || new URLSearchParams(urlObj.hash.substring(1)).get('access_token');
      } catch (e) {
        console.error('Error parsing initial URL:', e);
      }

      // Handle password recovery - this runs AFTER Supabase auto-login
      if (type === 'recovery') {
        console.log('🔐 Password recovery detected in confirmation effect');
        sessionStorage.setItem('isPasswordRecovery', 'true');
        // The link's code or token is used on /update-password and nowhere else: each works only once, so
        // using it here too would make the reset page fail with "already used".
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
              toast.success('Email verified successfully! Welcome to Figbloom HR.');
              hasShownWelcomeToast.current = true;
            }

            setSession(session);
            setUser({
              email: session.user.email || '',
              role: userRole,
              town: userTown,
              branch: session.user.user_metadata?.branch || ''
            });

            if (userTown && userRole !== 'HR') {
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
            } else if (userRole === 'HR') {
              setSelectedTown('');
              localStorage.setItem('selectedTown', '');
            }

            const newUrl = window.location.pathname;
            window.history.replaceState({}, '', newUrl);

            goToLanding();
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
        // the recovery flag only holds while on the reset page: anywhere else (a typed address, a restored tab) it is a
        // leftover from a link that failed, and must not trap the tab on /update-password
        if (currentPath !== '/update-password' && !urlHasRecoveryToken) sessionStorage.removeItem('isPasswordRecovery');

        if (currentPath === '/update-password' || urlHasRecoveryToken) {
          console.log('🔐 Password recovery detected - allowing UpdatePassword page to handle auth');
          if (urlHasRecoveryToken) {
            sessionStorage.setItem('isPasswordRecovery', 'true');
            // a dashboard link lands on the site address (/): take it to the reset page, tokens and all
            if (currentPath !== '/update-password') navigate(recoveryTarget(), { replace: true });
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

          if (userData.role === 'HR') {
            setSelectedTown('');
          } else if (savedTown && branches.length > 0 && branches.includes(savedTown)) {
            setSelectedTown(savedTown);
          }

          const isEmailConfirmation = searchParams.has('type') && (searchParams.has('access_token') || searchParams.has('token'));

          // Normal navigation logic
          if ((currentPath === '/' || currentPath === '/login') && !isEmailConfirmation && !navigationHandled.current) {
            // whether a code is still needed is the server's call (see the two-step effect above)
            const mfaInProgress = sessionStorage.getItem('isMFAProcess') === 'true';

            if (mfaInProgress) {
              navigate('/mfa', { replace: true });
            } else {
              goToLanding();
            }
            navigationHandled.current = true;
          }
        } else {
          setUser(null);
          const currentPath = location.pathname;
          const publicPaths = ['/login', '/update-password', '/mfa', '/join', '/offer', '/create-company'];

          const urlHasRecoveryToken = window.location.href.includes('type=recovery') ||
            window.location.hash.includes('type=recovery');
          if (currentPath === '/update-password' || urlHasRecoveryToken) {
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

    // Never await supabase inside this callback: the client holds its auth lock until the callback returns, so a
    // query waited on here can stall every other supabase call (sign-in hangs). Lookups go in a setTimeout instead.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // FIRST: Check if we're in password recovery mode - if so, don't interfere
      const currentPath = location.pathname;
      const urlHasRecoveryToken = window.location.href.includes('type=recovery') ||
        window.location.hash.includes('type=recovery');
      if (currentPath === '/update-password' || urlHasRecoveryToken) {
        console.log('🔐 Auth state change ignored - in password recovery mode');
        if (urlHasRecoveryToken) {
          sessionStorage.setItem('isPasswordRecovery', 'true');
          if (currentPath !== '/update-password') navigate(recoveryTarget(), { replace: true });
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

        // Two-step sign-in in progress (whoever the company asks for a code)
        if (isMFAProcess) {
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
        if (userData.role === 'HR') {
          setSelectedTown('');
          localStorage.setItem('selectedTown', '');
          setSelectedRegion('All Regions');
        } else if (userData.town && branches.length > 0 && branches.includes(userData.town)) {
          setSelectedTown(userData.town);
          localStorage.setItem('selectedTown', userData.town);

          const town = userData.town;
          setTimeout(async () => {
            try {
              const { data } = await supabase
                .from('kenya_branches')
                .select('"Area"')
                .eq('"Branch Office"', town)
                .single();

              if (data) {
                setSelectedRegion(data.Area);
              }
            } catch (error) {
              console.error('Error finding region for town:', error);
            }
          }, 0);
        }

        // Only show welcome toast and navigate for actual sign-in events, not token refreshes
        if (event === 'SIGNED_IN' && !hasShownWelcomeToast.current) {
          hasShownWelcomeToast.current = true;

          const currentPath = location.pathname;
          const publicPaths = ['/login', '/update-password', '/mfa', '/join', '/offer', '/create-company'];

          // a two-step sign-in still due is caught by the two-step effect, which asks the server
          toast.success(welcomeMessage(session?.user?.id, userData.email));

          if (publicPaths.includes(currentPath)) {
            goToLanding();
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
  }, [navigate, location.pathname, location.search, location.hash, searchParams, branches, clearAllTimers, recoveryTarget]);

  // Reset navigation flag when location changes
  useEffect(() => {
    navigationHandled.current = false;
  }, [location.pathname]);

  // tablets start with the slim sidebar so the page keeps its room; phones get a drawer instead (below md)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1024);
  const mobileNav = useMobileNav();
  const switchingCompany = useCompanySwitching();

  if (!authChecked || isInitializing) {
    return <Loader />;
  }

  // Main render
  return (
    <UserProvider>
      <ErrorBoundary>
        <div className="min-h-screen bg-page overflow-x-hidden">
          {switchingCompany && <FigbloomLoader fullScreen label="Switching company" />}
          <Suspense fallback={<Loader />}>
          <Routes>
            <Route path="/login" element={<Login onLoginSuccess={handleLoginSuccess} />} />
            <Route
              path="/mfa"
              element={
                <MFAVerification />
              }
            />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/join" element={<JoinCompany />} />
            {/* a candidate's offer letter: the link's token opens that one offer, signed in or not */}
            <Route path="/offer" element={<OfferPage />} />
            <Route path="/create-company" element={<CreateCompany />} />
            <Route path="/update-password" element={<UpdatePasswordPage />} />
            <Route
              path="/staff"
              element={
                !session ? (
                  <Login onLoginSuccess={handleLoginSuccess} />
                ) : companyState.status === 'none' ? (
                  // someone who belongs to no company yet must set one up, not be shown a staff portal
                  <NoCompany email={session.user.email ?? ''} />
                ) : companyState.status === 'ready' ? (
                  <CompanyGate userId={session.user.id}><StaffPortalLanding /></CompanyGate>
                ) : companyState.status === 'error' ? (
                  <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-center px-4">
                    <p className="text-sm text-gray-700">We could not load your account: {companyState.message}</p>
                    <button type="button" className="px-4 py-2 rounded bg-gray-900 text-white text-sm font-semibold" onClick={() => window.location.reload()}>
                      Try again
                    </button>
                  </div>
                ) : (
                  <WorkspaceLoader />
                )
              }
            />

            {/* the printable onboarding form, without the app's sidebar and header; the database decides who may read it */}
            <Route
              path="/onboarding/:id/print"
              element={
                !session ? (
                  <Login onLoginSuccess={handleLoginSuccess} />
                ) : companyState.status === 'ready' ? (
                  <CompanyGate userId={session.user.id}><OnboardingPrint /></CompanyGate>
                ) : (
                  <WorkspaceLoader />
                )
              }
            />

            <Route
              path="/*"
              element={
                !session || !user ? (
                  <Login onLoginSuccess={handleLoginSuccess} />
                ) : companyState.status === 'none' ? (
                  <NoCompany email={user.email} />
                ) : companyState.status === 'error' ? (
                  <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-center px-4">
                    <p className="text-sm text-gray-700">We could not load your account: {companyState.message}</p>
                    <button type="button" className="px-4 py-2 rounded bg-brand text-white text-sm font-semibold" onClick={() => window.location.reload()}>
                      Try again
                    </button>
                  </div>
                ) : companyState.status === 'loading' ? (
                  <WorkspaceLoader />
                ) : usesStaffPortal(user.role) ? (
                  <CompanyGate userId={session.user.id}>
                    <StaffPortalLanding />
                  </CompanyGate>
                ) : (
                  <CompanyGate userId={session.user.id}>
                  <div className="flex flex-col min-h-screen bg-page">
                    <div className="relative flex flex-1 min-h-0 w-full overflow-x-hidden">
                      <Sidebar
                        user={user}
                        isCollapsed={isSidebarCollapsed}
                        onToggle={setIsSidebarCollapsed}
                        onLogout={handleLogout}
                        isMobile={mobileNav.isMobile}
                        mobileOpen={mobileNav.open}
                        onMobileClose={mobileNav.closeNav}
                      />
                      <div className={`flex-1 min-w-0 min-h-0 flex flex-col transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ml-0 ${isSidebarCollapsed ? 'md:ml-[88px]' : 'md:ml-[280px]'}`}>
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
                          onOpenMenu={mobileNav.openNav}
                          menuOpen={mobileNav.open}
                        />
                        {/* on phones the bottom padding lets the last controls scroll clear of the AI assistant button */}
                        <main className={location.pathname === '/teams' ? 'flex-1 min-h-0 overflow-hidden flex flex-col' : 'flex-1 overflow-x-hidden p-4 pb-20 sm:pb-4'}>
                          {/* the new page fades in; no exit animation, so there's no blank moment between pages */}
                            <div key={location.pathname} className="page-enter w-full h-full">
                              <Suspense fallback={<PageLoader />}>
                              <Routes>
                                {/* every screen opens by the modules of the person's role (routeModules.ts), never by its name */}
                                {gate('/', <Dashboard selectedTown={selectedTown} selectedRegion={selectedRegion} onTownChange={handleTownChange} onRegionChange={handleRegionChange} />)}
                                {gate('/dashboard', <Dashboard selectedTown={selectedTown} selectedRegion={selectedRegion} onTownChange={handleTownChange} onRegionChange={handleRegionChange} />)}
                                {gate('/calendar', <CompanyCalendar />)}
                                {gate('/employees', <EmployeeList selectedTown={selectedTown} selectedRegion={selectedRegion} onTownChange={handleTownChange} onRegionChange={handleRegionChange} />)}
                                {gate('/add-employee', <AddEmployeePage />)}
                                {gate('/onboarding', <OnboardingReview />)}
                                {gate('/offers', <OffersPage />)}
                                {gate('/view-employee/:id', <ViewEmployeePage />)}
                                {gate('/view-employee/:employeeId', <ViewEmployeePage />)}
                                {gate('/edit-employee/:id', <EditEmployeePage />)}
                                {gate('/assign-managers', <ManagerAssignment />)}
                                {gate('/organogram', <Organogram />)}
                                {gate('/departments', <Departments />)}
                                {gate('/invite-people', <InvitePeople callerRole={user.role} />)}
                                {gate('/employee-added', <SuccessPage />)}
                                {gate('/loanadmin', <LoanRequestsAdmin />)}
                                {gate('/asset', <AssetManagement />)}
                                {gate('/asset/scan', <QRScanner />)}
                                {!isHiddenModule('expenses') && gate('/expenses', <ExpenseModule selectedTown={selectedTown} selectedRegion={selectedRegion} onTownChange={handleTownChange} onRegionChange={handleRegionChange} />)}
                                {gate('/tasks', <TaskManager />)}
                                {gate('/sms', <SMSCenter />)}
                                {gate('/reports', <ReportsList />)}
                                {gate('/reports/group', <GroupReport />)}
                                {gate('/reports/base', <BaseReport
                                  selectedTown={selectedTown} selectedRegion={selectedRegion} onTownChange={handleTownChange} onRegionChange={handleRegionChange}
                                  reportTitle="Base Report"
                                  reportDescription="Base report view"
                                  onGenerateReport={async () => []}
                                  renderReportData={() => null}
                                />)}
                                {gate('/reports/staffloan', <StaffLoansReport
                                  selectedTown={selectedTown} selectedRegion={selectedRegion} onTownChange={handleTownChange} onRegionChange={handleRegionChange}
                                  reportTitle="Staff Loan Report"
                                  reportDescription="Staff loan details"
                                  onGenerateReport={async () => []}
                                  renderReportData={() => null}
                                />)}
                                {gate('/reports/statutory', <StatutoryDeductionsReport
                                  selectedTown={selectedTown} selectedRegion={selectedRegion} onTownChange={handleTownChange} onRegionChange={handleRegionChange}
                                  reportTitle="Statutory Deductions"
                                  reportDescription="Statutory deductions details"
                                  onGenerateReport={async () => []}
                                  renderReportData={() => null}
                                />)}
                                {gate('/teams', <ChatLayout />)}
                                {gate('/video-calls', <VideoCalls />)}
                                {gate('/staffcheck', <WarningModule />)}
                                {gate('/payroll', <PayrollDashboard />)}
                                {gate('/settings/payslip-design', <PayslipDesignPage />)}
                                {/* Figbloom platform admins only: the page checks, and the database refuses anyone else (FIG-813) */}
                                {gate('/platform/rates', <PlatformRatesPage />)}
                                {gate('/settings', <UserRolesSettings />)}
                                {/* everyone in the company reads it; Settings changes it */}
                                {gate('/settings/company', <CompanyProfilePage />)}
                                {gate('/settings/audit-trail', <AuditTrailPage />)}
                                {gate('/settings/job-groups', <JobGroupsPage />)}
                                {gate('/settings/branches', <BranchesPage />)}
                                {gate('/settings/job-titles', <JobTitlesPage />)}
                                {gate('/salaryadmin', <SalaryAdvanceAdmin selectedTown={selectedTown} selectedRegion={selectedRegion} allTowns={branches} regions={regions} onTownChange={handleTownChange} onRegionChange={handleRegionChange} />)}
                                {/* the database shows each person only what they may see on these */}
                                {gate('/casual-workers', <CasualWorkers />)}
                                {gate('/leave-discipline', <LeaveDisciplinePage />)}
                                {gate('/piece-rate', <PieceRatePage />)}
                                {gate('/overtime', <OvertimePage />)}
                                {gate('/loans', <LoansAdmin />)}
                                {gate('/incident-reports', <IncidentReportsManagement />)}
                                {gate('/work-injuries', <WorkInjuries />)}
                                {gate('/adminconfirm', <StaffSignupRequests />)}
                                {gate('/recruitment', <RecruitmentDashboard />)}
                                {gate('/performance', <PerformanceDashboard selectedTown={selectedTown} selectedRegion={selectedRegion} onTownChange={handleTownChange} onRegionChange={handleRegionChange} />)}
                                {gate('/leaves', <LeaveManagementSystem selectedTown={selectedTown} selectedRegion={selectedRegion} onTownChange={handleTownChange} onRegionChange={handleRegionChange} />)}
                                {gate('/training', <AdminVideoUpload />)}
                                {gate('/setup-assistant', <SetupAssistant />)}
                                {gate('/ai-assistant', <AIAssistantPage selectedTown={selectedTown} selectedRegion={selectedRegion} onTownChange={handleTownChange} onRegionChange={handleRegionChange} />)}
                                {gate('/fogs', <EmployeeDataTable selectedTown={selectedTown} selectedRegion={selectedRegion} onTownChange={handleTownChange} onRegionChange={handleRegionChange} />)}
                                {gate('/mpesa-zap', <MpesaZapPortal />)}
                                {gate('/email-portal', <EmailPortal />)}
                                {gate('/role-permissions', <RolePermissions />)}
                                {gate('/appearance', <Appearance />)}
                                {gate('/hr-lifecycle', <HRLifecycleDashboard />)}

                                <Route path="*" element={<NotFound />} />
                              </Routes>
                              </Suspense>
                            </div>
                        </main>
                        <Suspense fallback={null}>
                          <AIAssistantWidget selectedTown={selectedTown} selectedRegion={selectedRegion} onTownChange={handleTownChange} onRegionChange={handleRegionChange} />
                        </Suspense>
                        {location.pathname !== '/teams' && <Footer />}
                      </div>
                    </div>
                  </div>
                  </CompanyGate>
                )
              }
            />
          </Routes>
          </Suspense>
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