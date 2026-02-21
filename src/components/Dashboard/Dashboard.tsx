import React, { useState, useEffect } from "react";
import { Users, CalendarDays, Wallet, NotepadText, Phone, AlertCircle, Settings, HelpCircle, MapPin, RefreshCw, Cake, Video, BookOpen, FileText, TrendingUp, ChevronRight, Crown, Send } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase"
import { TownProps } from '../../types/supabase';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';

interface AreaTownMapping {
  [area: string]: string[];
}

interface BranchAreaMapping {
  [branch: string]: string;
}

interface NewsItem {
  id: number;
  type: 'birthday' | 'conference' | 'training' | 'payslip' | 'report';
  title: string;
  description?: string;
  date: string;
  time?: string;
  participants?: string;
}

interface TopPerformer {
  id: number;
  name: string;
  position: string;
  branch: string;
  performance: number;
  avatar?: string;
  isOverall?: boolean;
}

export default function DashboardMain({ selectedTown, onTownChange, selectedRegion }: TownProps) {
  const [activeTab, setActiveTab] = useState("overview");
  const [showSupportPopup, setShowSupportPopup] = useState(false);
  const [showUnauthorizedPopup, setShowUnauthorizedPopup] = useState(false);
  const [stats, setStats] = useState({
    employees: 0,
    leaveRequests: 0,
    salaryAdvances: 0,
    jobApplications: 0
  });
  const [isLoading, setIsLoading] = useState(true);
  const [debugInfo, setDebugInfo] = useState<string>("Initializing...");
  const [currentTown, setCurrentTown] = useState<string>(selectedTown || '');
  const [areaTownMapping, setAreaTownMapping] = useState<AreaTownMapping>({});
  const [branchAreaMapping, setBranchAreaMapping] = useState<BranchAreaMapping>({});
  const [isArea, setIsArea] = useState<boolean>(false);
  const [townsInArea, setTownsInArea] = useState<string[]>([]);
  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  const [topPerformers, setTopPerformers] = useState<TopPerformer[]>([]);
  const [isNewsLoading, setIsNewsLoading] = useState(true);
  const [isSendingBirthdaySMS, setIsSendingBirthdaySMS] = useState(false);

  const navigate = useNavigate();

  // Phone formatting function for SMS
  const formatPhoneNumberForSMS = (phone: string): string => {
    if (!phone) return '';

    let cleaned = phone.replace(/\D/g, '');

    if (cleaned.startsWith('0') && cleaned.length === 10) {
      cleaned = '254' + cleaned.substring(1);
    } else if (cleaned.startsWith('7') && cleaned.length === 9) {
      cleaned = '254' + cleaned;
    } else if (cleaned.startsWith('254') && cleaned.length === 12) {
      // Keep as is
    } else if (cleaned.startsWith('+254') && cleaned.length === 13) {
      cleaned = cleaned.substring(1);
    }

    if (cleaned.length === 12 && cleaned.startsWith('254')) {
      return cleaned;
    }

    return '';
  };

  // Send birthday SMS function
  const sendBirthdaySMS = async (employeeName: string, phoneNumber: string) => {
    try {
      const formattedPhone = formatPhoneNumberForSMS(phoneNumber);

      if (!formattedPhone) {
        throw new Error(`Invalid phone number: ${phoneNumber}`);
      }

      const birthdayMessage = `Happy Birthday ${employeeName}! 🎉 Wishing you a fantastic year ahead from Mular Credit Team`;
      const apiKey = '***REMOVED***';
      const partnerID = '928';
      const shortcode = 'MularCredit';
      const encodedMessage = encodeURIComponent(birthdayMessage);

      const url = `https://isms.celcomafrica.com/api/services/sendsms/?apikey=${apiKey}&partnerID=${partnerID}&message=${encodedMessage}&shortcode=${shortcode}&mobile=${formattedPhone}`;

      console.log('Sending birthday SMS to:', formattedPhone);

      await fetch(url, {
        method: 'GET',
        mode: 'no-cors'
      });

      // Log to database
      await supabase.from('sms_logs').insert({
        recipient_phone: formattedPhone,
        message: birthdayMessage,
        status: 'sent',
        sender_id: shortcode,
        created_at: new Date().toISOString()
      });

      return { success: true, message: 'SMS sent successfully' };

    } catch (error) {
      console.error('SMS Error:', error);
      return { success: false, error: error.message };
    }
  };

  // Send birthday SMS to all today's birthdays
  const sendAllBirthdaySMS = async () => {
    setIsSendingBirthdaySMS(true);

    try {
      // Find birthday employees
      const { data: employees } = await supabase
        .from('employees')
        .select('"First Name", "Last Name", "Mobile Number", "Personal Mobile", "Work Mobile", "Date of Birth"')
        .not('Date of Birth', 'is', null);

      const today = new Date();
      const currentMonth = today.getMonth() + 1;
      const currentDay = today.getDate();

      const birthdayEmployees = employees?.filter(emp => {
        if (!emp['Date of Birth']) return false;
        try {
          const birthDate = new Date(emp['Date of Birth']);
          return birthDate.getMonth() + 1 === currentMonth &&
            birthDate.getDate() === currentDay;
        } catch (e) {
          return false;
        }
      }).map(emp => {
        const rawPhone = emp['Mobile Number'] || emp['Personal Mobile'] || emp['Work Mobile'] || '';
        const phone = formatPhoneNumberForSMS(rawPhone);
        const fullName = `${emp['First Name'] || ''} ${emp['Last Name'] || ''}`.trim();

        return { name: fullName, phone: phone };
      }).filter(emp => emp.phone && emp.phone.length === 12 && emp.phone.startsWith('254'));

      if (!birthdayEmployees || birthdayEmployees.length === 0) {
        toast.error('No birthdays with valid phone numbers today');
        setIsSendingBirthdaySMS(false);
        return;
      }

      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < birthdayEmployees.length; i++) {
        const employee = birthdayEmployees[i];

        try {
          const result = await sendBirthdaySMS(employee.name, employee.phone);

          if (result.success) {
            successCount++;
            toast.success(`Sent to ${employee.name}`, { duration: 1500 });
          } else {
            failCount++;
          }

          // Wait between SMS
          if (i < birthdayEmployees.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } catch (error) {
          failCount++;
        }
      }

      if (successCount > 0) {
        toast.success(`🎉 Sent ${successCount} birthday SMS successfully!`);
      }
      if (failCount > 0) {
        toast.error(`Failed to send ${failCount} SMS`);
      }

    } catch (error) {
      toast.error('Error sending birthday SMS');
      console.error(error);
    } finally {
      setIsSendingBirthdaySMS(false);
      // Refresh news
      fetchBirthdayNews();
    }
  };

  // Fetch birthday news from employees table
  const fetchBirthdayNews = async () => {
    setIsNewsLoading(true);
    try {
      const today = new Date();
      const currentMonth = today.getMonth() + 1;
      const currentDay = today.getDate();

      const { data: employees, error } = await supabase
        .from('employees')
        .select('"First Name", "Last Name", "Mobile Number", "Date of Birth", Town, Branch');

      if (error) {
        console.error('Error fetching employees for birthdays:', error);
        return;
      }

      // Filter employees with birthdays today
      const todaysBirthdays = employees?.filter(employee => {
        if (!employee['Date of Birth']) return false;

        try {
          const birthDate = new Date(employee['Date of Birth']);
          const birthMonth = birthDate.getMonth() + 1;
          const birthDay = birthDate.getDate();

          return birthMonth === currentMonth && birthDay === currentDay;
        } catch (e) {
          return false;
        }
      }) || [];

      // Create birthday news item
      const birthdayNewsItem: NewsItem = {
        id: 1,
        type: 'birthday',
        title: 'Today\'s Birthdays',
        description: todaysBirthdays.length > 0
          ? `${todaysBirthdays.slice(0, 3).map(emp => `${emp['First Name']} ${emp['Last Name']}`).join(', ')}${todaysBirthdays.length > 3 ? ` and ${todaysBirthdays.length - 3} others` : ''}`
          : 'No birthdays today',
        date: 'Today',
        time: 'All day'
      };

      // Check for upcoming birthdays (next 7 days)
      const upcomingBirthdays = employees?.filter(employee => {
        if (!employee['Date of Birth']) return false;

        try {
          const birthDate = new Date(employee['Date of Birth']);
          const nextWeek = new Date();
          nextWeek.setDate(today.getDate() + 7);

          const birthDateThisYear = new Date(today.getFullYear(), birthDate.getMonth(), birthDate.getDate());

          return birthDateThisYear > today && birthDateThisYear <= nextWeek;
        } catch (e) {
          return false;
        }
      }) || [];

      const upcomingNewsItem: NewsItem = {
        id: 2,
        type: 'birthday',
        title: 'Upcoming Birthdays',
        description: upcomingBirthdays.length > 0
          ? `${upcomingBirthdays.length} employees have birthdays next week`
          : 'No upcoming birthdays',
        date: 'Next week'
      };

      // Other static news items
      const otherNewsItems: NewsItem[] = [
        {
          id: 3,
          type: 'conference',
          title: 'Quarterly Review Meeting',
          description: 'All managers required to attend the virtual conference',
          date: 'Tomorrow',
          time: '10:00 AM'
        },
        {
          id: 4,
          type: 'training',
          title: 'New Safety Training',
          description: 'Mandatory training session for all employees',
          date: 'Next Monday',
          time: '2:00 PM'
        },
        {
          id: 5,
          type: 'payslip',
          title: 'Payslips Available',
          description: 'March payroll processed and available for download',
          date: 'Available now'
        }
      ];

      setNewsItems([birthdayNewsItem, upcomingNewsItem, ...otherNewsItems]);

    } catch (error) {
      console.error('Error in fetchBirthdayNews:', error);
    } finally {
      setIsNewsLoading(false);
    }
  };

  // Mock top performers data
  useEffect(() => {
    const mockTopPerformers: TopPerformer[] = [
      {
        id: 1,
        name: "Sarah Wanjiku",
        position: "Relationship Officer",
        branch: "Nairobi",
        performance: 98,
        isOverall: true
      },
      {
        id: 2,
        name: "Michael Wanyama",
        position: "Relationship Officer",
        branch: "Mombasa",
        performance: 95
      },
      {
        id: 3,
        name: "Grace Wanjiku",
        position: "Relationship Officer",
        branch: "Kisumu",
        performance: 92
      },
      {
        id: 4,
        name: "David Omondi",
        position: "Relationship Officer",
        branch: "Nairobi",
        performance: 90
      },
      {
        id: 5,
        name: "Emily Chebet",
        position: "Relationship Officer",
        branch: "Eldoret",
        performance: 88
      }
    ];
    setTopPerformers(mockTopPerformers);
  }, []);

  // Load area-town mapping and saved town from localStorage on component mount
  useEffect(() => {
    const loadMappings = async () => {
      try {
        // Fetch the area-town mapping from the database
        const { data: employeesData, error: employeesError } = await supabase
          .from('employees')
          .select('Branch, Town');

        if (employeesError) {
          console.error("Error loading area-town mapping:", employeesError);
          return;
        }

        // Convert the data to a mapping object
        const mapping: AreaTownMapping = {};
        employeesData?.forEach(item => {
          if (item.Branch && item.Town) {
            if (!mapping[item.Branch]) {
              mapping[item.Branch] = [];
            }
            mapping[item.Branch].push(item.Town);
          }
        });

        setAreaTownMapping(mapping);
        setDebugInfo("Mappings loaded successfully");
      } catch (error) {
        console.error("Error in loadMappings:", error);
        setDebugInfo(`Error loading mappings: ${error.message}`);
      }
    };

    loadMappings();

    const savedTown = localStorage.getItem('selectedTown');
    if (savedTown && (!selectedTown || selectedTown === 'ADMIN_ALL')) {
      setCurrentTown(savedTown);
      if (onTownChange) {
        onTownChange(savedTown);
      }
      setDebugInfo(`Loaded saved town from storage: "${savedTown}"`);
    } else if (selectedTown) {
      setCurrentTown(selectedTown);
      localStorage.setItem('selectedTown', selectedTown);
      setDebugInfo(`Using town from props: "${selectedTown}"`);
    }
  }, [selectedTown, onTownChange]);

  // Check if current selection is an area and get its towns
  useEffect(() => {
    if (currentTown && areaTownMapping[currentTown]) {
      setIsArea(true);
      setTownsInArea(areaTownMapping[currentTown]);
      setDebugInfo(`"${currentTown}" is an area containing towns: ${areaTownMapping[currentTown].join(', ')}`);
    } else {
      setIsArea(false);
      setTownsInArea([]);
    }
  }, [currentTown, areaTownMapping]);

  // Fetch data from Supabase with town/area filtering
  useEffect(() => {
    if (currentTown) {
      fetchDashboardData();
    } else {
      setDebugInfo("No town selected");
      setIsLoading(false);
    }
  }, [currentTown, townsInArea, isArea]);

  // Load news when component mounts
  useEffect(() => {
    fetchBirthdayNews();
  }, []);

  // Fetch ALL data for dashboard
  const fetchDashboardData = async () => {
    setIsLoading(true);
    console.log('🔍 Fetching data for:', currentTown);

    try {
      // If ADMIN_ALL or no town selected, fetch all data
      if (currentTown === 'ADMIN_ALL' || !currentTown) {
        await fetchAllData();
      } else if (isArea && townsInArea.length > 0) {
        await fetchDataForArea();
      } else {
        await fetchDataForTown();
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      setDebugInfo(`Error: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch all data (admin view)
  const fetchAllData = async () => {
    try {
      // Fetch all counts
      const [
        { count: employeesCount },
        { count: leaveRequestsCount },
        { count: salaryAdvancesCount },
        { count: expensesCount }
      ] = await Promise.all([
        supabase.from('employees').select('*', { count: 'exact', head: true }),
        supabase.from('leave_application').select('*', { count: 'exact', head: true }),
        supabase.from('salary_advance').select('*', { count: 'exact', head: true }),
        supabase.from('expenses').select('*', { count: 'exact', head: true })
      ]);

      setStats({
        employees: employeesCount || 0,
        leaveRequests: leaveRequestsCount || 0,
        salaryAdvances: salaryAdvancesCount || 0,
        jobApplications: expensesCount || 0
      });

      setDebugInfo(`Showing ALL data | Employees: ${employeesCount} | Leaves: ${leaveRequestsCount} | Advances: ${salaryAdvancesCount} | Expenses: ${expensesCount}`);
    } catch (error) {
      console.error('Error fetching all data:', error);
      throw error;
    }
  };

  // Fetch data for specific town
  const fetchDataForTown = async () => {
    try {
      console.log('Fetching data for town:', currentTown);

      // Try multiple approaches to filter data
      let employeesCount = 0;
      let leaveRequestsCount = 0;
      let salaryAdvancesCount = 0;
      let expensesCount = 0;

      // 1. Try exact match in Town column
      let { count: townEmployees, error: townError } = await supabase
        .from('employees')
        .select('*', { count: 'exact', head: true })
        .eq('Town', currentTown);

      if (!townError && (townEmployees || 0) > 0) {
        console.log('Found employees by Town column:', townEmployees);
        employeesCount = townEmployees || 0;

        // Try to find branch for this town
        const { data: branchData } = await supabase
          .from('kenya_branches')
          .select('"Branch Office"')
          .ilike('Area', `%${currentTown}%`)
          .limit(1);

        const branch = branchData?.[0]?.['Branch Office'];

        if (branch) {
          console.log('Using branch for filtering:', branch);

          const [
            { count: leaves },
            { count: advances },
            { count: exp }
          ] = await Promise.all([
            supabase.from('leave_application').select('*', { count: 'exact', head: true }).eq('Office Branch', branch),
            supabase.from('salary_advance').select('*', { count: 'exact', head: true }).eq('Office Branch', branch),
            supabase.from('expenses').select('*', { count: 'exact', head: true }).eq('branch', branch)
          ]);

          leaveRequestsCount = leaves || 0;
          salaryAdvancesCount = advances || 0;
          expensesCount = exp || 0;
        }
      }
      // 2. Try Branch column if Town didn't work
      else {
        console.log('Trying Branch column...');
        const { count: branchEmployees, error: branchError } = await supabase
          .from('employees')
          .select('*', { count: 'exact', head: true })
          .eq('Branch', currentTown);

        if (!branchError && (branchEmployees || 0) > 0) {
          console.log('Found employees by Branch column:', branchEmployees);
          employeesCount = branchEmployees || 0;

          const [
            { count: leaves },
            { count: advances },
            { count: exp }
          ] = await Promise.all([
            supabase.from('leave_application').select('*', { count: 'exact', head: true }).ilike('Office Branch', `%${currentTown}%`),
            supabase.from('salary_advance').select('*', { count: 'exact', head: true }).ilike('Office Branch', `%${currentTown}%`),
            supabase.from('expenses').select('*', { count: 'exact', head: true }).ilike('branch', `%${currentTown}%`)
          ]);

          leaveRequestsCount = leaves || 0;
          salaryAdvancesCount = advances || 0;
          expensesCount = exp || 0;
        }
        // 3. Try partial match as last resort
        else {
          console.log('Trying partial match...');
          const { count: partialEmployees, error: partialError } = await supabase
            .from('employees')
            .select('*', { count: 'exact', head: true })
            .ilike('Town', `%${currentTown}%`);

          if (!partialError) {
            employeesCount = partialEmployees || 0;

            const [
              { count: leaves },
              { count: advances },
              { count: exp }
            ] = await Promise.all([
              supabase.from('leave_application').select('*', { count: 'exact', head: true }).ilike('Office Branch', `%${currentTown}%`),
              supabase.from('salary_advance').select('*', { count: 'exact', head: true }).ilike('Office Branch', `%${currentTown}%`),
              supabase.from('expenses').select('*', { count: 'exact', head: true }).ilike('branch', `%${currentTown}%`)
            ]);

            leaveRequestsCount = leaves || 0;
            salaryAdvancesCount = advances || 0;
            expensesCount = exp || 0;
          }
        }
      }

      // If everything is 0, fetch all data
      if (employeesCount === 0 && leaveRequestsCount === 0 && salaryAdvancesCount === 0 && expensesCount === 0) {
        console.log('No data found for town, fetching all data...');
        await fetchAllData();
        return;
      }

      setStats({
        employees: employeesCount,
        leaveRequests: leaveRequestsCount,
        salaryAdvances: salaryAdvancesCount,
        jobApplications: expensesCount
      });

      setDebugInfo(`Town: "${currentTown}" | Employees: ${employeesCount} | Leaves: ${leaveRequestsCount} | Advances: ${salaryAdvancesCount} | Expenses: ${expensesCount}`);

    } catch (error) {
      console.error('Error in fetchDataForTown:', error);
      // On error, try to fetch all data
      await fetchAllData();
    }
  };

  // Fetch data for area
  const fetchDataForArea = async () => {
    try {
      console.log('Fetching data for area:', currentTown, 'Towns:', townsInArea);

      if (!townsInArea.length) {
        await fetchAllData();
        return;
      }

      // Fetch employees for all towns in area
      const { count: employeesCount } = await supabase
        .from('employees')
        .select('*', { count: 'exact', head: true })
        .in('Town', townsInArea);

      // For other tables, we need to find branches for these towns
      const { data: branchesData } = await supabase
        .from('kenya_branches')
        .select('"Branch Office"')
        .in('Area', townsInArea);

      const branches = branchesData?.map(b => b['Branch Office']).filter(Boolean) || [];

      let leaveRequestsCount = 0;
      let salaryAdvancesCount = 0;
      let expensesCount = 0;

      if (branches.length > 0) {
        const [
          { count: leaves },
          { count: advances },
          { count: exp }
        ] = await Promise.all([
          supabase.from('leave_application').select('*', { count: 'exact', head: true }).in('Office Branch', branches),
          supabase.from('salary_advance').select('*', { count: 'exact', head: true }).in('Office Branch', branches),
          supabase.from('expenses').select('*', { count: 'exact', head: true }).in('branch', branches)
        ]);

        leaveRequestsCount = leaves || 0;
        salaryAdvancesCount = advances || 0;
        expensesCount = exp || 0;
      }

      setStats({
        employees: employeesCount || 0,
        leaveRequests: leaveRequestsCount,
        salaryAdvances: salaryAdvancesCount,
        jobApplications: expensesCount
      });

      setDebugInfo(`Area: "${currentTown}" (${townsInArea.length} towns) | Employees: ${employeesCount} | Leaves: ${leaveRequestsCount} | Advances: ${salaryAdvancesCount} | Expenses: ${expensesCount}`);

    } catch (error) {
      console.error('Error in fetchDataForArea:', error);
      await fetchAllData();
    }
  };



  const handleRefresh = () => {
    fetchDashboardData();
    fetchBirthdayNews();
  };

  // Get town/area display name
  const getDisplayName = () => {
    if (!currentTown) return "All Towns";
    if (currentTown === 'ADMIN_ALL') return "All Towns";

    if (isArea) {
      return `${currentTown} Region`;
    }

    return currentTown;
  };

  // Get icon for news type
  const getNewsIcon = (type: NewsItem['type']) => {
    switch (type) {
      case 'birthday': return <Cake className="w-4 h-4" />;
      case 'conference': return <Video className="w-4 h-4" />;
      case 'training': return <BookOpen className="w-4 h-4" />;
      case 'payslip': return <FileText className="w-4 h-4" />;
      case 'report': return <TrendingUp className="w-4 h-4" />;
      default: return <FileText className="w-4 h-4" />;
    }
  };

  // Get background color for news type
  const getNewsBgColor = (type: NewsItem['type']) => {
    switch (type) {
      case 'birthday': return 'bg-pink-50';
      case 'conference': return 'bg-blue-50';
      case 'training': return 'bg-green-50';
      case 'payslip': return 'bg-purple-50';
      case 'report': return 'bg-orange-50';
      default: return 'bg-gray-50';
    }
  };

  // Get text color for news type
  const getNewsTextColor = (type: NewsItem['type']) => {
    switch (type) {
      case 'birthday': return 'text-pink-600';
      case 'conference': return 'text-blue-600';
      case 'training': return 'text-green-600';
      case 'payslip': return 'text-purple-600';
      case 'report': return 'text-orange-600';
      default: return 'text-gray-600';
    }
  };

  // Mock trends for "Silicon Valley" look
  const getTrend = (value: number, type: 'up' | 'down' | 'neutral') => {
    const isPositive = type === 'up';
    return (
      <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex items-center ${isPositive ? 'bg-green-100 text-green-700' : type === 'down' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>
        {type === 'neutral' ? <div className="w-2 h-2 rounded-full bg-gray-400 mr-1" /> : isPositive ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingUp className="w-3 h-3 mr-1 rotate-180" />}
        {type === 'neutral' ? '0%' : `${Math.floor(Math.random() * 20) + 5}%`}
      </span>
    );
  };

  return (
    <div className="min-h-screen p-6 md:p-8 font-sans bg-transparent">
      {/* Popup Messages */}
      <AnimatePresence>
        {showUnauthorizedPopup && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: 100 }}
            animate={{ opacity: 1, y: 0, x: 0 }}
            exit={{ opacity: 0, y: -20, x: 100 }}
            className="fixed top-5 right-5 p-4 rounded-xl text-white z-[1000] shadow-2xl bg-red-500 flex items-center"
          >
            <AlertCircle className="w-4 h-4 mr-2" />
            <span className="text-sm font-medium">Unauthorized access</span>
          </motion.div>
        )}

        {showSupportPopup && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: 100 }}
            animate={{ opacity: 1, y: 0, x: 0 }}
            exit={{ opacity: 0, y: -20, x: 100 }}
            className="fixed top-5 right-5 p-4 rounded-xl text-white z-[1000] shadow-2xl bg-emerald-500 flex items-center"
          >
            <Phone className="w-4 h-4 mr-2" />
            <span className="text-sm font-medium">Support: 0700594586</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="max-w-7xl mx-auto space-y-8">
        {/* Welcome Section - "Dark Mode Command Center" Style */}
        <motion.div
          className="rounded-[32px] p-8 md:p-10 relative overflow-hidden bg-white/80 backdrop-blur-xl border border-gray-200"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Subtle decorative gradients matching the brand */}
          <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-gradient-to-br from-[#03c04a]/10 to-green-300/10 rounded-full blur-[100px] -mr-32 -mt-32 pointer-events-none"></div>
          <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-gradient-to-br from-lime-200/20 to-green-200/20 rounded-full blur-[100px] -ml-20 -mb-20 pointer-events-none"></div>

          <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
            <div className="flex items-center gap-5">
              <motion.div
                className="flex-shrink-0"
                whileHover={{ scale: 1.05, rotate: 5 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
              >
                <img
                  src="/leaf3.png"
                  className="w-20 h-20 md:w-24 md:h-24 object-contain drop-shadow-lg"
                  alt="Logo"
                  style={{
                    maskImage: 'linear-gradient(to bottom, black 75%, transparent 100%)',
                    WebkitMaskImage: 'linear-gradient(to bottom, black 75%, transparent 100%)'
                  }}
                />
              </motion.div>
              <div>
                <motion.h1
                  className="text-3xl md:text-4xl font-bold tracking-tight mb-2 bg-gradient-to-r from-gray-900 via-green-900 to-[#03c04a] bg-clip-text text-transparent font-sans"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  Welcome back, Admin
                </motion.h1>
                <motion.div
                  className="flex flex-wrap items-center gap-3 text-gray-600 text-sm font-medium"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}
                >
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/60 border border-gray-200 backdrop-blur-sm shadow-sm">
                    <MapPin className="w-3.5 h-3.5 text-[#03c04a]" />
                    <span className="text-gray-900 font-semibold">{getDisplayName()}</span>
                  </span>
                  <span className="w-1 h-1 rounded-full bg-gray-400 hidden sm:block"></span>
                  <span className="hidden sm:inline">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
                </motion.div>
              </div>
            </div>

            {/* Quick Actions - Premium Pills */}
            <div className="flex flex-wrap gap-3">
              <motion.button
                onClick={handleRefresh}
                disabled={isLoading}
                className="px-4 py-2 rounded-full text-xs font-normal bg-white/60 border border-gray-200 hover:bg-white hover:border-[#03c04a] transition-all backdrop-blur-sm flex items-center gap-2 text-gray-700 hover:text-[#03c04a]"
                whileHover={{ scale: 1.05, y: -2 }}
                whileTap={{ scale: 0.95 }}
              >
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </motion.button>
            </div>
          </div>
        </motion.div>

        {/* Filters & Tabs */}
        <div className="flex items-center justify-between border-b border-gray-200 pb-1">
          <div className="flex gap-8">
            <button
              onClick={() => setActiveTab('overview')}
              className={`pb-4 text-xs font-normal relative transition-colors ${activeTab === 'overview' ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-800'}`}
            >
              Overview
              {activeTab === 'overview' && (
                <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-t-full" />
              )}
            </button>
            <button
              className="pb-4 text-xs font-normal text-gray-400 hover:text-gray-600 cursor-not-allowed"
              disabled
            >
              Analytics (Pro)
            </button>
          </div>
          <div className="text-xs font-normal text-gray-400">
            Last updated: {new Date().toLocaleTimeString()}
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center items-center h-64">
            <div className="relative w-16 h-16">
              <div className="absolute top-0 left-0 w-full h-full border-4 border-indigo-200 rounded-full opacity-20"></div>
              <div className="absolute top-0 left-0 w-full h-full border-4 border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
            </div>
          </div>
        ) : (
          /* Main Content - Bento Grid */
          <div className="grid grid-cols-12 gap-8">

            {/* Stats Cards - Updated Typography & Layout */}
            <div className="col-span-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                {
                  label: 'Total Employees',
                  value: stats.employees,
                  icon: Users,
                  color: 'text-indigo-600',
                  bg: 'bg-indigo-50/50',
                  trend: 'up'
                },
                {
                  label: 'Leave Requests',
                  value: stats.leaveRequests,
                  icon: CalendarDays,
                  color: 'text-pink-600',
                  bg: 'bg-pink-50/50',
                  trend: 'down'
                },
                {
                  label: 'Salary Advances',
                  value: stats.salaryAdvances,
                  icon: Wallet,
                  color: 'text-violet-600',
                  bg: 'bg-violet-50/50',
                  trend: 'up'
                },
                {
                  label: 'Total Expenses',
                  value: stats.jobApplications,
                  icon: NotepadText,
                  color: 'text-emerald-600',
                  bg: 'bg-emerald-50/50',
                  trend: 'neutral'
                },
              ].map((stat, i) => (
                <motion.div
                  key={i}
                  className="bg-white/80 backdrop-blur-xl rounded-[24px] p-6 border border-gray-200 transition-all duration-300 group"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  whileHover={{ y: -4, borderColor: "rgba(99, 102, 241, 0.4)" }}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className={`w-12 h-12 rounded-2xl ${stat.bg} ${stat.color} flex items-center justify-center group-hover:scale-110 transition-transform duration-300 shadow-sm border border-white/50`}>
                      <stat.icon className="w-5 h-5 stroke-[2px]" />
                    </div>
                    {getTrend(stat.value, stat.trend as any)}
                  </div>
                  <div>
                    <h3 className="text-3xl font-bold text-gray-900 tracking-tight font-sans">{stat.value}</h3>
                    <p className="text-sm font-medium text-gray-500 mt-1">{stat.label}</p>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Best Performers - Large Card */}
            <div className="col-span-12 lg:col-span-8">
              <motion.div
                className="bg-white/60 backdrop-blur-xl p-6 rounded-3xl border border-gray-200 relative overflow-hidden group"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900 tracking-tight font-sans">Top Performers</h2>
                    <p className="text-sm text-gray-500 font-medium mt-1">Employee performance rankings for this month</p>
                  </div>
                  <button className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1 transition-colors bg-indigo-50 px-3 py-1.5 rounded-full hover:bg-indigo-100">
                    View All <ChevronRight className="w-3 h-3" />
                  </button>
                </div>

                <div className="space-y-4">
                  {topPerformers.map((employee, index) => (
                    <motion.div
                      key={employee.id}
                      className="group flex items-center gap-4 p-4 rounded-2xl hover:bg-white/80 hover:shadow-md transition-all border border-transparent hover:border-gray-100/50"
                      whileHover={{ x: 4 }}
                    >
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold shadow-sm ${index === 0 ? 'bg-amber-100 text-amber-700 ring-4 ring-amber-50' : 'bg-gray-100/80 text-gray-600'}`}>
                        {index === 0 ? <Crown className="w-6 h-6 fill-amber-700" /> : `#${index + 1}`}
                      </div>
                      <div className="flex-1">
                        <h3 className="font-bold text-gray-900 font-sans">{employee.name}</h3>
                        <p className="text-xs text-gray-500 font-medium">{employee.position} • {employee.branch}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          <span className="block text-sm font-bold text-gray-900 font-sans">{employee.performance}%</span>
                          <span className="block text-[10px] text-gray-400 font-medium tracking-wide">PERFORMANCE</span>
                        </div>
                        <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <motion.div
                            className={`h-full rounded-full ${index === 0 ? 'bg-amber-500' : 'bg-indigo-500'}`}
                            initial={{ width: 0 }}
                            animate={{ width: `${employee.performance}%` }}
                            transition={{ duration: 1, delay: 0.5 + (index * 0.1) }}
                          />
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            </div>

            {/* Right Column - News & Quick Stats */}
            <div className="col-span-12 lg:col-span-4 space-y-8">
              {/* Company News */}
              <div className="bg-white/60 backdrop-blur-xl rounded-3xl border border-gray-200 p-6 flex flex-col h-full">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">Latest Updates</h3>
                    <p className="text-xs text-gray-500 font-medium">What's happening today</p>
                  </div>
                  <button className="p-2 rounded-full hover:bg-white/50 text-gray-400 hover:text-gray-600 transition-colors">
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-4">
                  {isNewsLoading ? (
                    <div className="animate-pulse space-y-4">
                      {[1, 2, 3].map(i => (
                        <div key={i} className="flex gap-4">
                          <div className="w-10 h-10 bg-gray-100 rounded-xl" />
                          <div className="flex-1">
                            <div className="h-4 bg-gray-100 rounded w-3/4 mb-2" />
                            <div className="h-3 bg-gray-50 rounded w-1/2" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    newsItems.slice(0, 4).map((news, index) => (
                      <motion.div
                        key={news.id}
                        className="flex gap-4 p-3 rounded-2xl hover:bg-white/60 transition-colors group cursor-pointer"
                        whileHover={{ x: 4 }}
                      >
                        <div className={`w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center ${getNewsBgColor(news.type)} ${getNewsTextColor(news.type)} shadow-sm group-hover:scale-110 transition-transform`}>
                          {getNewsIcon(news.type)}
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-gray-900 line-clamp-1 font-sans">{news.title}</h3>
                          <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">{news.description}</p>
                          <span className="text-[10px] font-medium text-gray-400 mt-1 inline-block bg-white/50 px-1.5 py-0.5 rounded-md border border-gray-100">{news.date}</span>
                        </div>
                      </motion.div>
                    ))
                  )}
                </div>
              </div>


            </div>

          </div>
        )}
      </div>
    </div>
  );
}