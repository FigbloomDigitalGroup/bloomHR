import { useState, useMemo, useEffect } from 'react';
import {
  Send, Upload, CreditCard, Info, Clock, FileEdit, Trash2,
  Plus, X, Search,
  Loader, RefreshCw, Save
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { smsSegments } from '../../lib/smsSegments';
import { getSmsBalance, sendSingleSms } from '../../lib/smsApi';
import { Card, Button, TabBar } from '../UI';
import { CELCOM_AFRICA_CONFIG } from '../../config/sms';
import toast from 'react-hot-toast';

// Types
type SMSPackage = {
  id: string;
  name: string;
  smsCount: number;
  cost: number;
  costPerSMS: number;
  popular?: boolean;
};

type SMSStats = {
  sentThisMonth: number;
  remaining: number;
  deliveryRate: number;
  failed: number;
  balance: string;
};

type Employee = {
  id: string;
  employee_id: string;
  employee_name: string;
  phone_number: string;
  department: string;
  position: string;
  town: string;
  selected?: boolean;
};

type SMSTemplate = {
  id: string;
  name: string;
  category: string;
  content: string;
  variables: string[];
  created_at?: string;
  updated_at?: string;
};

type ScheduledSMS = {
  id: string;
  message: string;
  recipients: string[];
  scheduledDate: string;
  scheduledTime: string;
  status: 'scheduled' | 'sent' | 'cancelled';
};

type BulkUpload = {
  id: string;
  filename: string;
  totalRecipients: number;
  processed: number;
  status: 'processing' | 'completed' | 'failed';
  uploadedAt: string;
};

type SenderIDConfig = {
  id?: string;
  user_id: string;
  sender_id_type: 'default' | 'custom';
  custom_sender_id?: string;
  business_certificate_url?: string;
  consent_letter_url?: string;
  provider: 'safaricom' | 'airtel' | 'orange';
  status: 'pending' | 'approved' | 'rejected';
  created_at?: string;
  updated_at?: string;
};

// Phone Number Formatting for Celcom Africa
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

// Reusable SMS Service Functions for Celcom Africa
export const SMSService = {
  // Send SMS using GET method - NO CORS PROXY, much faster
  async sendSMS(phoneNumber: string, message: string, shortcode: string): Promise<{
    success: boolean;
    message?: string;
    error?: string;
    messageId?: string;
    cost?: number;
  }> {
    try {
      const formattedPhone = formatPhoneNumberForSMS(phoneNumber);

      if (!formattedPhone) {
        throw new Error(`Invalid phone number format: ${phoneNumber}`);
      }

      if (!message || message.trim().length === 0) {
        throw new Error('Message cannot be empty');
      }

      // Sent by the backend (the provider key never reaches the browser). The result is the provider's real answer.
      const result = await sendSingleSms(formattedPhone, message.trim(), {
        purpose: 'sms-center',
        senderId: shortcode || undefined,
      });
      if (!result.success) {
        throw new Error(result.error || 'The SMS provider did not accept the message');
      }

      // Log the SMS to database as sent
      const messageId = result.messageId || `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      await this.logSMS(
        formattedPhone,
        message,
        'sent',
        shortcode,
        undefined,
        messageId,
        0
      );

      return {
        success: true,
        message: 'SMS sent successfully',
        messageId: messageId,
        cost: 0
      };

    } catch (error) {
      console.error('❌ SMS sending error:', error);

      // Even if there's an error, the SMS might still be sent
      // Log it as failed but note it might have gone through
      await this.logSMS(
        formatPhoneNumberForSMS(phoneNumber),
        message,
        'failed',
        shortcode,
        (error as Error).message
      );

      return {
        success: false,
        error: (error as Error).message
      };
    }
  },

  // One attempt. The server reports real failures, and retrying after a timeout could send the same text twice.
  async sendSMSWithRetry(
    phoneNumber: string,
    message: string,
    shortcode: string
  ): Promise<{ success: boolean; error?: string; messageId?: string; cost?: number }> {
    return this.sendSMS(phoneNumber, message, shortcode);
  },

  // Bulk send SMS - OPTIMIZED for speed
  async sendBulkSMS(
    phoneNumbers: string[],
    message: string,
    shortcode: string
  ): Promise<{
    success: boolean;
    sentCount: number;
    failedCount: number;
    errors: string[];
  }> {
    let sentCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    console.log(`📨 Starting bulk SMS send to ${phoneNumbers.length} numbers`);

    // Send all SMS concurrently for maximum speed
    const promises = phoneNumbers.map(async (phoneNumber, index) => {
      // Small delay to avoid overwhelming the API (50ms between requests)
      await new Promise(resolve => setTimeout(resolve, index * 50));

      try {
        const result = await this.sendSMS(phoneNumber, message, shortcode);
        if (result.success) {
          sentCount++;
          console.log(`✅ [${index + 1}/${phoneNumbers.length}] Sent to ${phoneNumber}`);
        } else {
          failedCount++;
          errors.push(`${phoneNumber}: ${result.error}`);
          console.log(`❌ [${index + 1}/${phoneNumbers.length}] Failed for ${phoneNumber}`);
        }
        return result;
      } catch (error) {
        failedCount++;
        errors.push(`${phoneNumber}: ${(error as Error).message}`);
        console.log(`💥 [${index + 1}/${phoneNumbers.length}] Error for ${phoneNumber}`);
        return { success: false, error: (error as Error).message };
      }
    });

    await Promise.all(promises);

    console.log(`🎉 Bulk SMS completed: ${sentCount} sent, ${failedCount} failed`);

    return {
      success: failedCount === 0,
      sentCount,
      failedCount,
      errors
    };
  },

  // Log SMS to database
  async logSMS(
    recipientPhone: string,
    message: string,
    status: 'sent' | 'failed',
    senderId: string,
    errorMessage?: string,
    messageId?: string,
    cost?: number
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('sms_logs')
        .insert({
          recipient_phone: recipientPhone,
          message: message,
          status: status,
          error_message: errorMessage,
          message_id: messageId,
          sender_id: senderId,
          cost: cost
        });

      if (error) {
        console.error('Failed to log SMS:', error);
      }
    } catch (error) {
      console.error('Error logging SMS:', error);
    }
  },

  // Save template to database
  async saveTemplate(template: Omit<SMSTemplate, 'id'>): Promise<SMSTemplate | null> {
    try {
      const { data, error } = await supabase
        .from('sms_templates')
        .insert([template])
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error saving template:', error);
      toast.error('Failed to save template');
      return null;
    }
  },

  // Load templates from database
  async loadTemplates(): Promise<SMSTemplate[]> {
    try {
      const { data, error } = await supabase
        .from('sms_templates')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error loading templates:', error);
      return [];
    }
  },

  // Delete template from database
  async deleteTemplate(templateId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('sms_templates')
        .delete()
        .eq('id', templateId);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Error deleting template:', error);
      toast.error('Failed to delete template');
      return false;
    }
  },

  // Get sender ID configuration
  async getSenderIDConfig(): Promise<SenderIDConfig | null> {
    try {
      const userId = 'current-user-id';

      const { data, error } = await supabase
        .from('sender_id_configs')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data;
    } catch (error) {
      console.error('Error loading sender ID config:', error);
      return null;
    }
  },

  // Save sender ID configuration
  async saveSenderIDConfig(config: Omit<SenderIDConfig, 'id' | 'created_at' | 'updated_at'>): Promise<SenderIDConfig | null> {
    try {
      const { data, error } = await supabase
        .from('sender_id_configs')
        .upsert([config])
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error saving sender ID config:', error);
      toast.error('Failed to save sender ID configuration');
      return null;
    }
  },

  // Upload file and get URL
  async uploadFile(file: File, bucket: string): Promise<string | null> {
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random().toString(36).substring(2)}.${fileExt}`;

      const { error } = await supabase.storage
        .from(bucket)
        .upload(fileName, file);

      if (error) throw error;

      const { data } = supabase.storage
        .from(bucket)
        .getPublicUrl(fileName);

      return data.publicUrl;
    } catch (error) {
      console.error('Error uploading file:', error);
      toast.error('Failed to upload file');
      return null;
    }
  }
};

// Balance from the SMS provider, via the backend.
const checkSMSBalance = async (): Promise<string> => {
  try {
    const balance = await getSmsBalance();
    return balance === null ? 'Unavailable' : balance.toLocaleString('en-KE', { maximumFractionDigits: 2 });
  } catch (error) {
    console.error('Balance check error:', error);
    return 'Unavailable';
  }
};

// Function to replace template variables with ACTUAL employee data
const replaceTemplateVariables = (
  template: string,
  employee: Employee,
  additionalData?: any,
  personalizationType: 'none' | 'firstname' | 'fullname' = 'fullname'
): string => {
  let message = template;

  // Replace with ACTUAL employee data - handle personalization type
  const employeeName = personalizationType === 'firstname'
    ? employee.employee_name.split(' ')[0] // First name only
    : employee.employee_name; // Full name

  message = message.replace(/{name}/gi, employeeName || 'Employee');
  message = message.replace(/{employee_id}/gi, employee.employee_id || '');
  message = message.replace(/{department}/gi, employee.department || '');
  message = message.replace(/{position}/gi, employee.position || '');
  message = message.replace(/{phone}/gi, employee.phone_number || '');
  message = message.replace(/{town}/gi, employee.town || '');

  // Replace company variable
  message = message.replace(/{company}/gi, 'Figbloom HR');

  // Replace current date variables
  const now = new Date();
  message = message.replace(/{date}/gi, now.toLocaleDateString());
  message = message.replace(/{month}/gi, now.toLocaleDateString('en-US', { month: 'long' }));
  message = message.replace(/{year}/gi, now.getFullYear().toString());

  // Replace additional data variables
  if (additionalData) {
    Object.keys(additionalData).forEach(key => {
      const placeholder = new RegExp(`{${key}}`, 'gi');
      message = message.replace(placeholder, additionalData[key] || '');
    });
  }

  return message;
};

// SMS Packages Data
const smsPackages: SMSPackage[] = [
  {
    id: 'basic',
    name: 'Basic Package',
    smsCount: 100000,
    cost: 50000,
    costPerSMS: 0.5,
  },
  {
    id: 'standard',
    name: 'Standard Package',
    smsCount: 250000,
    cost: 100000,
    costPerSMS: 0.4,
    popular: true,
  },
  {
    id: 'premium',
    name: 'Premium Package',
    smsCount: 666666,
    cost: 200000,
    costPerSMS: 0.3,
  },
  {
    id: 'enterprise',
    name: 'Enterprise Package',
    smsCount: 1500000,
    cost: 300000,
    costPerSMS: 0.2,
  },
];

// Function to parse CSV file
const parseCSV = (file: File): Promise<{ phone_number: string, message: string }[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const lines = content.split('\n').filter(line => line.trim());
        const results = [];

        for (let i = 1; i < lines.length; i++) {
          const [phone_number, message] = lines[i].split(',').map(field => field.trim());
          if (phone_number && message) {
            results.push({ phone_number, message });
          }
        }

        resolve(results);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
};

// Main SMS Center Component
export function SMSCenter() {
  const [activeTab, setActiveTab] = useState<'compose' | 'templates' | 'scheduled' | 'bulk' | 'sender-id'>('compose');
  const [message, setMessage] = useState('');
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [filteredEmployees, setFilteredEmployees] = useState<Employee[]>([]);
  const [templates, setTemplates] = useState<SMSTemplate[]>([]);
  const [scheduledMessages, setScheduledMessages] = useState<ScheduledSMS[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [isLoadingEmployees, setIsLoadingEmployees] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('all');
  const [selectedTown, setSelectedTown] = useState('all');
  const [selectedJobTitle, setSelectedJobTitle] = useState('all');
  const [personalizationType, setPersonalizationType] = useState<'none' | 'firstname' | 'fullname'>('none');
  const [smsStats, setSmsStats] = useState<SMSStats>({
    sentThisMonth: 0,
    remaining: 0,
    deliveryRate: 0,
    failed: 0,
    balance: 'Loading...'
  });
  const [isSending, setIsSending] = useState(false);
  const [sendingProgress, setSendingProgress] = useState<{ current: number, total: number }>({ current: 0, total: 0 });
  const [selectedPackage, setSelectedPackage] = useState<string>('standard');
  const [showPackageModal, setShowPackageModal] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [bulkUploads, setBulkUploads] = useState<BulkUpload[]>([]);
  const [showNewTemplateModal, setShowNewTemplateModal] = useState(false);
  const [newTemplate, setNewTemplate] = useState({ name: '', category: 'Business', content: '' });
  const [additionalVariables, setAdditionalVariables] = useState<Record<string, string>>({});
  const [showAdditionalVariablesModal, setShowAdditionalVariablesModal] = useState(false);

  // Sender ID State
  const [senderIdConfig, setSenderIdConfig] = useState<SenderIDConfig>({
    user_id: 'current-user-id',
    sender_id_type: 'default',
    provider: 'safaricom',
    status: 'pending'
  });
  const [businessCertificate, setBusinessCertificate] = useState<File | null>(null);
  const [consentLetter, setConsentLetter] = useState<File | null>(null);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);

  // Templates
  const kenyaHolidayTemplates: SMSTemplate[] = [
    {
      id: 'new_year',
      name: 'New Year Greetings',
      category: 'Holiday',
      content: 'Dear {name}, Wishing you a prosperous New Year {year}! May this year bring you success and happiness. From {company}',
      variables: ['name', 'year', 'company']
    },
    {
      id: 'christmas',
      name: 'Christmas Wishes',
      category: 'Holiday',
      content: 'Dear {name}, Merry Christmas! May this festive season bring joy and prosperity to you and your family. From {company}',
      variables: ['name', 'company']
    }
  ];

  const businessTemplates: SMSTemplate[] = [
    {
      id: 'payslip',
      name: 'Payslip Notification',
      category: 'Business',
      content: 'Dear {name}, your payslip for {period} is ready. Net Pay: KSh {amount}. Login to view details.',
      variables: ['name', 'period', 'amount']
    },
    {
      id: 'meeting',
      name: 'Meeting Reminder',
      category: 'Business',
      content: 'Hello {name}, reminder: {meeting_title} on {date} at {time}. Venue: {venue}',
      variables: ['name', 'meeting_title', 'date', 'time', 'venue']
    },
    {
      id: 'birthday',
      name: 'Birthday Wishes',
      category: 'Business',
      content: 'Happy Birthday {name}! Wishing you a wonderful year ahead filled with success and happiness. From {company}',
      variables: ['name', 'company']
    },
    {
      id: 'welcome',
      name: 'Welcome Message',
      category: 'Business',
      content: 'Welcome {name} to {company}! We are excited to have you in the {department} department.',
      variables: ['name', 'company', 'department']
    },
    {
      id: 'test',
      name: 'Simple Test',
      category: 'Business',
      content: 'Test SMS from Figbloom HR SMS Center. Please ignore.',
      variables: []
    }
  ];

  // Function to extract variables from message
  const extractVariablesFromMessage = (text: string): string[] => {
    const variableRegex = /{(\w+)}/g;
    const matches = text.match(variableRegex);
    return matches ? matches.map(match => match.slice(1, -1)) : [];
  };

  // Check if template needs additional variables beyond employee data
  const getAdditionalVariablesNeeded = (template: SMSTemplate): string[] => {
    const employeeVariables = ['name', 'employee_id', 'department', 'position', 'phone', 'town', 'company', 'date', 'month', 'year'];
    return template.variables.filter(variable => !employeeVariables.includes(variable));
  };

  // Get current shortcode for Celcom Africa
  const getCurrentShortcode = (): string => {
    if (senderIdConfig.sender_id_type === 'custom' && senderIdConfig.custom_sender_id) {
      return senderIdConfig.custom_sender_id;
    }
    return CELCOM_AFRICA_CONFIG.defaultShortcode;
  };

  const fetchEmployees = async () => {
    try {
      setIsLoadingEmployees(true);
      const { data, error } = await supabase
        .from('employees')
        .select(`
          "Employee Number",
          "First Name",
          "Middle Name", 
          "Last Name",
          "Mobile Number",
          "Personal Mobile",
          "Work Mobile",
          "Job Title",
          "Job Group",
          "Job Level",
          "Branch",
          "Office",
          "Town"
        `)
        .order('"First Name"');

      if (error) throw error;

      if (data) {
        const formattedEmployees: Employee[] = data
          .map(emp => {
            const rawPhone = emp['Mobile Number'] || emp['Personal Mobile'] || emp['Work Mobile'] || '';
            const phone_number = formatPhoneNumberForSMS(rawPhone);

            const firstName = emp['First Name'] || '';
            const middleName = emp['Middle Name'] || '';
            const lastName = emp['Last Name'] || '';
            const fullName = `${firstName} ${middleName} ${lastName}`.trim().replace(/\s+/g, ' ');
            const department = emp['Job Level'] || emp['Job Group'] || emp['Branch'] || emp['Office'] || 'Unknown';
            const position = emp['Job Title'] || 'Unknown';
            const town = emp['Town'] || 'Unknown';
            const employeeId = emp['Employee Number'] || `emp-${Math.random().toString(36).substr(2, 9)}`;

            return {
              id: employeeId,
              employee_id: employeeId,
              employee_name: fullName,
              phone_number: phone_number,
              department: department,
              position: position,
              town: town
            };
          })
          .filter((emp): emp is Employee => {
            if (!emp) return false;
            const phone = emp.phone_number;
            const hasValidPhone = phone && phone.length === 12 && phone.startsWith('254');
            return hasValidPhone;
          });

        setEmployees(formattedEmployees);
        setFilteredEmployees(formattedEmployees);
      }
    } catch (error) {
      console.error('Error fetching employees:', error);
      toast.error('Failed to load employees');
    } finally {
      setIsLoadingEmployees(false);
    }
  };

  const loadSMSStats = async () => {
    try {
      const balance = await checkSMSBalance();

      // Get current month start date
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      // Fetch real SMS stats from database
      const { data: logs, error } = await supabase
        .from('sms_logs')
        .select('status, cost, created_at')
        .gte('created_at', monthStart.toISOString());

      if (error) {
        console.error('Error loading SMS stats:', error);
        setSmsStats(prev => ({
          ...prev,
          balance: balance,
          sentThisMonth: 0,
          remaining: 0,
          deliveryRate: 0,
          failed: 0
        }));
        return;
      }

      // Calculate stats from real data
      const sentCount = logs?.filter(log => log.status === 'sent').length || 0;
      const failedCount = logs?.filter(log => log.status === 'failed').length || 0;
      const totalCount = sentCount + failedCount;
      const deliveryRate = totalCount > 0 ? ((sentCount / totalCount) * 100).toFixed(1) : 0;

      // Calculate remaining (you can adjust this based on your package)
      const packageLimit = 30000; // Default package limit
      const remaining = Math.max(0, packageLimit - sentCount);

      setSmsStats({
        sentThisMonth: sentCount,
        remaining: remaining,
        deliveryRate: parseFloat(deliveryRate.toString()),
        failed: failedCount,
        balance: balance
      });
    } catch (error) {
      console.error('Error loading SMS stats:', error);
      setSmsStats(prev => ({ ...prev, balance: 'Error loading balance' }));
    }
  };

  const loadTemplates = async () => {
    const dbTemplates = await SMSService.loadTemplates();
    setTemplates([...kenyaHolidayTemplates, ...businessTemplates, ...dbTemplates]);
  };

  const loadSenderIDConfig = async () => {
    const config = await SMSService.getSenderIDConfig();
    if (config) {
      setSenderIdConfig(config);
    }
  };

  useEffect(() => {
    loadTemplates();
    fetchEmployees();
    loadSMSStats();
    loadSenderIDConfig();

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setScheduleDate(tomorrow.toISOString().split('T')[0]);
    setScheduleTime('09:00');
  }, []);

  useEffect(() => {
    let filtered = employees;

    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter(emp =>
        emp.employee_name.toLowerCase().includes(searchLower) ||
        emp.employee_id.toLowerCase().includes(searchLower) ||
        emp.department.toLowerCase().includes(searchLower) ||
        emp.town.toLowerCase().includes(searchLower)
      );
    }

    if (selectedDepartment !== 'all') {
      filtered = filtered.filter(emp => emp.department === selectedDepartment);
    }

    if (selectedTown !== 'all') {
      filtered = filtered.filter(emp => emp.town === selectedTown);
    }

    if (selectedJobTitle !== 'all') {
      filtered = filtered.filter(emp => emp.position === selectedJobTitle);
    }

    setFilteredEmployees(filtered);
  }, [searchTerm, selectedDepartment, selectedTown, selectedJobTitle, employees]);

  const departments = useMemo(() => {
    const depts = [...new Set(employees.map(emp => emp.department))].filter(Boolean);
    return ['all', ...depts];
  }, [employees]);

  const towns = useMemo(() => {
    const townsList = [...new Set(employees.map(emp => emp.town))].filter(Boolean);
    return ['all', ...townsList];
  }, [employees]);

  const jobTitles = useMemo(() => {
    const titles = [...new Set(employees.map(emp => emp.position))].filter(Boolean);
    return ['all', ...titles];
  }, [employees]);

  const handleEmployeeSelect = (employeeId: string) => {
    setSelectedEmployees(prev =>
      prev.includes(employeeId)
        ? prev.filter(id => id !== employeeId)
        : [...prev, employeeId]
    );
  };

  const handleSelectAll = () => {
    if (selectedEmployees.length === filteredEmployees.length) {
      setSelectedEmployees([]);
    } else {
      setSelectedEmployees(filteredEmployees.map(emp => emp.id));
    }
  };

  // Template selection with ACTUAL employee data preview
  const handleTemplateSelect = (templateId: string) => {
    const template = templates.find(t => t.id === templateId);
    if (template) {
      setSelectedTemplate(templateId);

      // Show preview with ACTUAL selected employee data
      if (selectedEmployees.length > 0) {
        const firstEmployee = employees.find(emp => emp.id === selectedEmployees[0]);
        if (firstEmployee) {
          const previewMessage = replaceTemplateVariables(template.content, firstEmployee, additionalVariables, personalizationType);
          setMessage(previewMessage);
        }
      } else {
        setMessage(template.content);
      }

      // Check if we need additional variables
      const additionalVarsNeeded = getAdditionalVariablesNeeded(template);
      if (additionalVarsNeeded.length > 0) {
        const initialVariables: Record<string, string> = {};
        additionalVarsNeeded.forEach(variable => {
          initialVariables[variable] = additionalVariables[variable] || '';
        });
        setAdditionalVariables(initialVariables);
        setShowAdditionalVariablesModal(true);
      }
    }
  };

  // Save current message as template
  const saveCurrentAsTemplate = async () => {
    if (!message.trim()) {
      toast.error('Please enter a message first');
      return;
    }

    const variables = extractVariablesFromMessage(message);
    const newTemplateData = {
      name: `Custom Template ${templates.length + 1}`,
      category: 'Custom',
      content: message,
      variables: variables
    };

    const savedTemplate = await SMSService.saveTemplate(newTemplateData);
    if (savedTemplate) {
      setTemplates(prev => [...prev, savedTemplate]);
      toast.success('Template saved successfully!');
    }
  };

  // Apply template with additional variables
  const applyTemplateWithAdditionalVariables = () => {
    if (selectedEmployees.length > 0 && selectedTemplate) {
      const template = templates.find(t => t.id === selectedTemplate);
      const firstEmployee = employees.find(emp => emp.id === selectedEmployees[0]);
      if (template && firstEmployee) {
        const previewMessage = replaceTemplateVariables(template.content, firstEmployee, additionalVariables, personalizationType);
        setMessage(previewMessage);
      }
    }
    setShowAdditionalVariablesModal(false);
    toast.success('Additional variables saved!');
  };

  // SMS sending function with Celcom Africa API
  const handleSendSMS = async (immediate = true) => {
    if (!message.trim()) {
      toast.error('Please enter a message');
      return;
    }

    if (selectedEmployees.length === 0) {
      toast.error('Please select at least one employee');
      return;
    }

    const selectedEmployeeData = employees.filter(emp => selectedEmployees.includes(emp.id));
    const currentShortcode = getCurrentShortcode();

    setIsSending(true);
    setSendingProgress({ current: 0, total: selectedEmployeeData.length });

    try {
      if (immediate) {
        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < selectedEmployeeData.length; i++) {
          const employee = selectedEmployeeData[i];
          setSendingProgress({ current: i + 1, total: selectedEmployeeData.length });

          try {
            // Create PERSONALIZED message for EACH employee
            let personalizedMessage = message;

            // If using a template, replace variables with ACTUAL employee data
            if (selectedTemplate) {
              personalizedMessage = replaceTemplateVariables(message, employee, additionalVariables, personalizationType);
            }

            const result = await SMSService.sendSMSWithRetry(
              employee.phone_number,
              personalizedMessage,
              currentShortcode
            );

            if (result.success) {
              successCount++;
              // Log successful SMS
              await SMSService.logSMS(
                employee.phone_number,
                personalizedMessage,
                'sent',
                currentShortcode,
                undefined,
                result.messageId,
                result.cost
              );
            } else {
              failCount++;
              // Log failed SMS
              await SMSService.logSMS(
                employee.phone_number,
                personalizedMessage,
                'failed',
                currentShortcode,
                result.error
              );
            }
          } catch (error) {
            failCount++;
            // Log failed SMS
            await SMSService.logSMS(
              employee.phone_number,
              message,
              'failed',
              currentShortcode,
              (error as Error).message
            );
          }

          if (i < selectedEmployeeData.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }

        if (successCount > 0) {
          toast.success(`SMS sent to ${successCount} employees`);
        }
        if (failCount > 0) {
          toast.error(`Failed to send to ${failCount} employees`);
        }

        await loadSMSStats();
      } else {
        if (!scheduleDate || !scheduleTime) {
          toast.error('Please select schedule date and time');
          return;
        }

        const newScheduledSMS: ScheduledSMS = {
          id: Date.now().toString(),
          message,
          recipients: selectedEmployeeData.map(emp => emp.employee_name),
          scheduledDate: scheduleDate,
          scheduledTime: scheduleTime,
          status: 'scheduled'
        };

        setScheduledMessages(prev => [...prev, newScheduledSMS]);
        toast.success(`SMS scheduled for ${scheduleDate} at ${scheduleTime}`);
      }

      setMessage('');
      setSelectedEmployees([]);
      setSelectedTemplate('');
      setAdditionalVariables({});

    } catch (error) {
      console.error('SMS sending process failed:', error);
      toast.error('Failed to send SMS: ' + (error as Error).message);
    } finally {
      setIsSending(false);
      setSendingProgress({ current: 0, total: 0 });
    }
  };

  const testSMS = async () => {
    try {
      const testNumbers = ['254716431987', '0716431987'];
      const currentShortcode = getCurrentShortcode();

      let success = false;

      for (const testPhone of testNumbers) {
        const formatted = formatPhoneNumberForSMS(testPhone);

        if (!formatted) continue;

        const result = await SMSService.sendSMSWithRetry(
          formatted,
          'Test SMS from Figbloom HR SMS Center - Please ignore',
          currentShortcode
        );

        if (result.success) {
          toast.success(`Test SMS sent successfully to ${formatted}!`);
          success = true;
          break;
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      if (!success) {
        toast.error('All test SMS attempts failed.');
      }

      await loadSMSStats();

    } catch (error) {
      toast.error('Test SMS error: ' + (error as Error).message);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
        setUploadedFile(file);

        const uploadRecord: BulkUpload = {
          id: Date.now().toString(),
          filename: file.name,
          totalRecipients: 0,
          processed: 0,
          status: 'processing',
          uploadedAt: new Date().toISOString()
        };

        setBulkUploads(prev => [uploadRecord, ...prev]);
        toast.success('CSV file uploaded successfully.');
      } else {
        toast.error('Please upload a CSV file');
      }
    }
  };

  const processBulkUpload = async () => {
    if (!uploadedFile) {
      toast.error('Please upload a CSV file first');
      return;
    }

    try {
      const records = await parseCSV(uploadedFile);
      if (records.length === 0) {
        toast.error('No valid records found in CSV file');
        return;
      }

      setIsSending(true);
      setSendingProgress({ current: 0, total: records.length });

      let successCount = 0;
      let failCount = 0;
      const currentShortcode = getCurrentShortcode();

      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        setSendingProgress({ current: i + 1, total: records.length });

        try {
          const formattedPhone = formatPhoneNumberForSMS(record.phone_number);
          if (formattedPhone) {
            const result = await SMSService.sendSMSWithRetry(
              formattedPhone,
              record.message,
              currentShortcode
            );

            if (result.success) {
              successCount++;
              await SMSService.logSMS(
                formattedPhone,
                record.message,
                'sent',
                currentShortcode,
                undefined,
                result.messageId,
                result.cost
              );
            } else {
              failCount++;
              await SMSService.logSMS(
                formattedPhone,
                record.message,
                'failed',
                currentShortcode,
                result.error
              );
            }
          } else {
            failCount++;
          }
        } catch (error) {
          failCount++;
          await SMSService.logSMS(
            record.phone_number,
            record.message,
            'failed',
            currentShortcode,
            (error as Error).message
          );
        }

        setBulkUploads(prev => prev.map(upload =>
          upload.filename === uploadedFile.name
            ? { ...upload, processed: i + 1, totalRecipients: records.length }
            : upload
        ));

        if (i < records.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      setBulkUploads(prev => prev.map(upload =>
        upload.filename === uploadedFile.name
          ? { ...upload, status: 'completed' }
          : upload
      ));

      if (successCount > 0) {
        toast.success(`Bulk SMS completed: ${successCount} sent, ${failCount} failed`);
      } else {
        toast.error('Bulk SMS failed for all recipients');
      }

      await loadSMSStats();

    } catch (error) {
      console.error('Bulk upload error:', error);
      toast.error('Failed to process bulk upload');

      setBulkUploads(prev => prev.map(upload =>
        upload.filename === uploadedFile.name
          ? { ...upload, status: 'failed' }
          : upload
      ));
    } finally {
      setIsSending(false);
      setSendingProgress({ current: 0, total: 0 });
    }
  };

  const handleBuyPackage = (pkg: SMSPackage) => {
    setSelectedPackage(pkg.id);
    setShowPackageModal(true);
  };

  const cancelScheduledSMS = (id: string) => {
    setScheduledMessages(prev =>
      prev.map(msg =>
        msg.id === id ? { ...msg, status: 'cancelled' } : msg
      )
    );
    toast.success('Scheduled SMS cancelled');
  };

  const deleteTemplate = async (id: string) => {
    const success = await SMSService.deleteTemplate(id);
    if (success) {
      setTemplates(prev => prev.filter(t => t.id !== id));
      toast.success('Template deleted');
    }
  };

  // Create new template
  const createNewTemplate = async () => {
    if (!newTemplate.name.trim() || !newTemplate.content.trim()) {
      toast.error('Please fill in all fields');
      return;
    }

    const variables = extractVariablesFromMessage(newTemplate.content);
    const templateData = {
      name: newTemplate.name,
      category: newTemplate.category,
      content: newTemplate.content,
      variables: variables
    };

    const savedTemplate = await SMSService.saveTemplate(templateData);
    if (savedTemplate) {
      setTemplates(prev => [...prev, savedTemplate]);
      setNewTemplate({ name: '', category: 'Business', content: '' });
      setShowNewTemplateModal(false);
      toast.success('Template created successfully!');
    }
  };

  // Handle sender ID configuration
  const handleSenderIDConfig = async () => {
    try {
      setIsUploadingFiles(true);

      let businessCertificateUrl = senderIdConfig.business_certificate_url;
      let consentLetterUrl = senderIdConfig.consent_letter_url;

      // Upload files if provided
      if (businessCertificate) {
        businessCertificateUrl = await SMSService.uploadFile(businessCertificate, 'business-documents');
        if (!businessCertificateUrl) return;
      }

      if (consentLetter) {
        consentLetterUrl = await SMSService.uploadFile(consentLetter, 'business-documents');
        if (!consentLetterUrl) return;
      }

      const configData = {
        ...senderIdConfig,
        business_certificate_url: businessCertificateUrl,
        consent_letter_url: consentLetterUrl,
        status: 'pending' as const
      };

      const savedConfig = await SMSService.saveSenderIDConfig(configData);
      if (savedConfig) {
        setSenderIdConfig(savedConfig);
        toast.success('Sender ID configuration saved successfully!');
      }
    } catch (error) {
      console.error('Error saving sender ID config:', error);
    } finally {
      setIsUploadingFiles(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <p className="m-0 text-[13px] text-muted-foreground">Manage and send SMS messages to employees</p>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button variant="secondary" onClick={testSMS}>
            Test SMS
          </Button>
          <Button variant="secondary" onClick={loadSMSStats} icon={<RefreshCw className="w-3 h-3" strokeWidth={2} />}>
            Refresh Balance
          </Button>
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-tile bg-green-tint text-brand" role="status">
            <CreditCard className="w-3.5 h-3.5" strokeWidth={2} />
            <div>
              <div className="text-[9.5px] font-semibold opacity-75">SMS Balance</div>
              <div className="text-[12.5px] font-bold">{smsStats.balance}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        {[
          { label: 'Sent This Month', value: smsStats.sentThisMonth.toLocaleString() },
          { label: 'Remaining SMS', value: smsStats.remaining.toLocaleString() },
          { label: 'Delivery Rate', value: `${smsStats.deliveryRate}%` },
          { label: 'Failed SMS', value: String(smsStats.failed) },
        ].map((tile) => (
          <Card key={tile.label} padding="sm" className="!p-4">
            <div className="text-[11px] font-semibold text-muted-foreground">{tile.label}</div>
            <div className="text-xl font-bold text-ink mt-1">{tile.value}</div>
          </Card>
        ))}
      </div>

      <div>
        <TabBar
          items={[
            { id: 'compose', label: 'Compose SMS' },
            { id: 'templates', label: 'Templates' },
            { id: 'scheduled', label: 'Scheduled' },
            { id: 'bulk', label: 'Bulk SMS' },
            { id: 'sender-id', label: 'Sender ID' },
          ]}
          activeId={activeTab}
          onChange={(id) => setActiveTab(id as typeof activeTab)}
          className="border-b border-border"
        />

        <div className="pt-4">
          {activeTab === 'compose' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-4">
                  <div className="bg-white rounded-xl border border-border p-6">
                    <div className="flex justify-between items-center mb-3">
                      <label className="block text-xs font-medium text-ink">
                        Compose Message
                      </label>
                      <button
                        onClick={saveCurrentAsTemplate}
                        className="flex items-center gap-1 px-3 py-1 bg-secondary text-ink rounded text-xs hover:bg-border"
                      >
                        <Save className="w-3 h-3" />
                        Save as Template
                      </button>
                    </div>
                    <div className="relative">
                      <textarea
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        rows={6}
                        aria-describedby="sms-counter"
                        className="w-full border border-border rounded-xl p-4 focus:outline-none focus:border-brand resize-none text-xs"
                        placeholder="Type your message here... (Max 160 characters)"
                        maxLength={160}
                      />
                    </div>
                    {(() => {
                      const info = smsSegments(message);
                      const over = info.units > info.singleLimit;
                      return (
                        <div id="sms-counter" className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[10.5px]" aria-live="polite">
                          <span className={info.encoding === 'Unicode' && info.units > 0 ? 'text-orange-text-alt font-semibold' : 'text-subtle'}>
                            {info.encoding === 'Unicode' && info.units > 0
                              ? 'Special characters in this message: only 70 characters fit in one SMS'
                              : ''}
                          </span>
                          <span className={over ? 'text-orange-text-alt font-semibold' : 'text-subtle'}>
                            {info.units}/{info.singleLimit}
                            {info.segments > 0 && ` · ${info.segments} SMS${info.segments > 1 ? ' (billed per part)' : ''}`}
                          </span>
                        </div>
                      );
                    })()}

                    <div className="mt-4">
                      <label className="block text-xs font-medium text-ink mb-2">
                        Quick Templates
                      </label>
                      <select
                        value={selectedTemplate}
                        onChange={(e) => handleTemplateSelect(e.target.value)}
                        className="w-full border border-border rounded-lg p-3 focus:outline-none focus:border-brand text-xs"
                      >
                        <option value="">Select a template...</option>
                        {templates.map(template => (
                          <option key={template.id} value={template.id}>
                            {template.name} ({template.category}) - {template.variables.length} variables
                          </option>
                        ))}
                      </select>
                    </div>

                    {selectedTemplate && (
                      <div className="mt-4 p-3 bg-background rounded-lg">
                        <p className="text-xs font-medium text-ink mb-2">Template Variables:</p>
                        <div className="flex flex-wrap gap-1">
                          {templates.find(t => t.id === selectedTemplate)?.variables.map(variable => (
                            <span key={variable} className="px-2 py-1 bg-green-tint text-brand-dark rounded text-xs">
                              {variable}
                            </span>
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                          Variables like <strong>name</strong>, <strong>department</strong>, <strong>town</strong> will be automatically filled from employee data.
                          {getAdditionalVariablesNeeded(templates.find(t => t.id === selectedTemplate)!).length > 0 && (
                            <span className="text-orange-600"> Some variables need additional input.</span>
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="bg-white rounded-xl border border-border p-6">
                    <div className="flex justify-between items-center mb-4">
                      <label className="block text-xs font-medium text-ink">
                        Select Recipients ({filteredEmployees.length} of {employees.length} with valid phones)
                      </label>
                      <span className="text-xs text-subtle">
                        {selectedEmployees.length} selected
                      </span>
                    </div>

                    <div className="space-y-3 mb-4">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-subtle w-4 h-4" />
                        <input
                          type="text"
                          placeholder="Search employees by name, ID, department, or town..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="w-full pl-10 pr-4 py-2.5 border border-border rounded-lg focus:outline-none focus:border-brand text-xs"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <select
                          value={selectedDepartment}
                          onChange={(e) => setSelectedDepartment(e.target.value)}
                          className="w-full border border-border rounded-lg p-2.5 focus:outline-none focus:border-brand text-xs"
                        >
                          {departments.map(dept => (
                            <option key={dept} value={dept}>
                              {dept === 'all' ? 'All Departments' : dept}
                            </option>
                          ))}
                        </select>

                        <select
                          value={selectedTown}
                          onChange={(e) => setSelectedTown(e.target.value)}
                          className="w-full border border-border rounded-lg p-2.5 focus:outline-none focus:border-brand text-xs"
                        >
                          {towns.map(town => (
                            <option key={town} value={town}>
                              {town === 'all' ? 'All Towns' : town}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Job Title Filter */}
                      <div className="mt-3">
                        <select
                          value={selectedJobTitle}
                          onChange={(e) => setSelectedJobTitle(e.target.value)}
                          className="w-full border border-border rounded-lg p-2.5 focus:outline-none focus:border-brand text-xs"
                        >
                          {jobTitles.map(title => (
                            <option key={title} value={title}>
                              {title === 'all' ? 'All Job Titles' : title}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Personalization Options */}
                      <div className="mt-3 bg-background rounded-lg p-3">
                        <label className="block text-xs font-medium text-ink mb-2">
                          Message Personalization
                        </label>
                        <div className="space-y-2">
                          <label className="flex items-center cursor-pointer">
                            <input
                              type="radio"
                              name="personalization"
                              value="none"
                              checked={personalizationType === 'none'}
                              onChange={(e) => setPersonalizationType(e.target.value as any)}
                              className="mr-2"
                            />
                            <span className="text-xs text-ink">No personalization</span>
                          </label>
                          <label className="flex items-center cursor-pointer">
                            <input
                              type="radio"
                              name="personalization"
                              value="firstname"
                              checked={personalizationType === 'firstname'}
                              onChange={(e) => setPersonalizationType(e.target.value as any)}
                              className="mr-2"
                            />
                            <span className="text-xs text-ink">
                              First name only <span className="text-subtle">(e.g., "Hi John")</span>
                            </span>
                          </label>
                          <label className="flex items-center cursor-pointer">
                            <input
                              type="radio"
                              name="personalization"
                              value="fullname"
                              checked={personalizationType === 'fullname'}
                              onChange={(e) => setPersonalizationType(e.target.value as any)}
                              className="mr-2"
                            />
                            <span className="text-xs text-ink">
                              Full name <span className="text-subtle">(e.g., "Hi John Doe")</span>
                            </span>
                          </label>
                        </div>
                        {personalizationType !== 'none' && (
                          <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded text-xs text-green-800">
                            💡 Use <code className="bg-green-100 px-1 rounded">{'{name}'}</code> in your message
                          </div>
                        )}
                      </div>

                      {/* Recipient Count */}
                      <div className="mt-3 bg-green-tint border border-border rounded-lg p-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs font-medium text-brand-dark">
                              {filteredEmployees.length} Recipients Filtered
                            </p>
                            <p className="text-xs text-brand-dark">
                              {selectedEmployees.length} selected
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-bold text-brand-dark">
                              KES {(selectedEmployees.length * 1).toFixed(2)}
                            </p>
                            <p className="text-xs text-brand-dark">Est. cost</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="border border-border rounded-lg max-h-80 overflow-y-auto">
                      {isLoadingEmployees ? (
                        <div className="flex items-center justify-center p-8">
                          <Loader className="w-4 h-4 animate-spin text-brand" />
                          <span className="ml-2 text-xs text-muted-foreground">Loading employees...</span>
                        </div>
                      ) : filteredEmployees.length === 0 ? (
                        <div className="p-4 text-center text-subtle text-xs">
                          No employees found with valid phone numbers
                        </div>
                      ) : (
                        <div className="p-2">
                          <div className="flex items-center p-2 border-b border-[#F1F5F2]">
                            <input
                              type="checkbox"
                              checked={selectedEmployees.length === filteredEmployees.length && filteredEmployees.length > 0}
                              onChange={handleSelectAll}
                              className="mr-3 rounded border-border text-brand focus:ring-blue-500"
                            />
                            <span className="text-xs font-medium text-ink">Select All</span>
                          </div>
                          {filteredEmployees.map(employee => (
                            <div
                              key={employee.id}
                              className="flex items-center p-3 hover:bg-background rounded-lg transition-colors"
                            >
                              <input
                                type="checkbox"
                                checked={selectedEmployees.includes(employee.id)}
                                onChange={() => handleEmployeeSelect(employee.id)}
                                className="mr-3 rounded border-border text-brand focus:ring-blue-500"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-ink truncate">
                                  {employee.employee_name}
                                </p>
                                <p className="text-xs text-subtle truncate">
                                  {employee.department} • {employee.town} • {employee.phone_number}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {isSending && sendingProgress.total > 0 && (
                    <div className="bg-green-tint border border-border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-brand-dark">Sending Progress</span>
                        <span className="text-xs text-brand">
                          {sendingProgress.current} / {sendingProgress.total}
                        </span>
                      </div>
                      <div className="w-full bg-border rounded-full h-2">
                        <div
                          className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                          style={{
                            width: `${(sendingProgress.current / sendingProgress.total) * 100}%`
                          }}
                        ></div>
                      </div>
                      <p className="text-xs text-brand mt-2">
                        Sending personalized messages to each employee...
                      </p>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button
                      onClick={() => handleSendSMS(true)}
                      disabled={!message.trim() || selectedEmployees.length === 0 || isSending}
                      className="flex-1 text-xs bg-brand hover:bg-brand-dark disabled:bg-slate-300 disabled:cursor-not-allowed text-white py-3 px-4 rounded-lg font-medium transition-all flex items-center justify-center gap-2"
                    >
                      {isSending ? (
                        <Loader className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                      {isSending ? 'Sending...' : 'Send Now'}
                    </button>

                    <button
                      onClick={() => handleSendSMS(false)}
                      disabled={!message.trim() || selectedEmployees.length === 0 || isSending}
                      className="flex-1 text-xs bg-brand hover:bg-brand-dark disabled:bg-slate-300 disabled:cursor-not-allowed text-white py-3 px-4 rounded-lg font-medium transition-all flex items-center justify-center gap-2"
                    >
                      <Clock className="w-4 h-4" />
                      Schedule
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3 p-4 bg-background rounded-lg border border-border">
                    <div>
                      <label className="block text-xs font-medium text-ink mb-1">
                        Date
                      </label>
                      <input
                        type="date"
                        value={scheduleDate}
                        onChange={(e) => setScheduleDate(e.target.value)}
                        min={new Date().toISOString().split('T')[0]}
                        className="w-full border border-border rounded-lg p-2 text-xs focus:outline-none focus:border-brand"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ink mb-1">
                        Time
                      </label>
                      <input
                        type="time"
                        value={scheduleTime}
                        onChange={(e) => setScheduleTime(e.target.value)}
                        className="w-full border border-border rounded-lg p-2 text-xs focus:outline-none focus:border-brand"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'templates' && (
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold text-ink">SMS Templates</h3>
                <button
                  onClick={() => setShowNewTemplateModal(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium"
                >
                  <Plus className="w-4 h-4" />
                  New Template
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {templates.map(template => (
                  <div key={template.id} className="bg-white border border-border rounded-lg p-4 hover:shadow-md transition-shadow">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h4 className="text-sm font-medium text-ink">{template.name}</h4>
                        <span className="inline-block px-2 py-1 bg-secondary text-muted-foreground rounded text-xs mt-1">
                          {template.category}
                        </span>
                      </div>
                      <div className="flex gap-1">
                        <button className="p-1 hover:bg-secondary rounded">
                          <FileEdit className="w-4 h-4 text-muted-foreground" />
                        </button>
                        <button
                          onClick={() => deleteTemplate(template.id)}
                          className="p-1 hover:bg-secondary rounded"
                        >
                          <Trash2 className="w-4 h-4 text-red-600" />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3 line-clamp-3">{template.content}</p>
                    <div className="flex flex-wrap gap-1 mb-3">
                      {template.variables.map(variable => (
                        <span key={variable} className="px-2 py-1 bg-green-tint text-brand-dark rounded text-xs">
                          {variable}
                        </span>
                      ))}
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-subtle">
                        {template.variables.length} variables
                      </span>
                      <button
                        onClick={() => handleTemplateSelect(template.id)}
                        className="text-xs text-brand hover:text-brand-dark font-medium"
                      >
                        Use Template
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'scheduled' && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-ink">Scheduled Messages</h3>

              {scheduledMessages.length === 0 ? (
                <div className="text-center py-12">
                  <Clock className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                  <p className="text-subtle text-sm">No scheduled messages</p>
                  <p className="text-subtle text-xs mt-1">Schedule your first SMS from the Compose tab</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {scheduledMessages.map(sms => (
                    <div key={sms.id} className="bg-white border border-border rounded-lg p-4">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <span className={`px-2 py-1 rounded text-xs font-medium ${sms.status === 'scheduled'
                              ? 'bg-yellow-100 text-yellow-800'
                              : sms.status === 'sent'
                                ? 'bg-green-100 text-green-800'
                                : 'bg-red-100 text-red-800'
                              }`}>
                              {sms.status.charAt(0).toUpperCase() + sms.status.slice(1)}
                            </span>
                            <span className="text-xs text-subtle">
                              {sms.scheduledDate} at {sms.scheduledTime}
                            </span>
                          </div>
                          <p className="text-sm text-ink mb-2">{sms.message}</p>
                          <p className="text-xs text-subtle">
                            To: {sms.recipients.join(', ')}
                          </p>
                        </div>
                        {sms.status === 'scheduled' && (
                          <button
                            onClick={() => cancelScheduledSMS(sms.id)}
                            className="text-xs text-red-600 hover:text-red-700 font-medium"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'bulk' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-ink">Bulk SMS Upload</h3>

                  <div className="bg-background border-2 border-dashed border-border rounded-lg p-6 text-center">
                    <Upload className="w-8 h-8 text-subtle mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground mb-2">Upload CSV file with phone numbers</p>
                    <p className="text-xs text-subtle mb-4">
                      Format: phone_number,message (one per line)
                    </p>
                    <input
                      type="file"
                      accept=".csv"
                      onChange={handleFileUpload}
                      className="hidden"
                      id="csv-upload"
                    />
                    <label
                      htmlFor="csv-upload"
                      className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium cursor-pointer hover:bg-blue-700"
                    >
                      Choose CSV File
                    </label>
                    {uploadedFile && (
                      <p className="text-xs text-green-600 mt-3">
                        ✓ {uploadedFile.name} uploaded
                      </p>
                    )}
                  </div>

                  <button
                    onClick={processBulkUpload}
                    disabled={!uploadedFile || isSending}
                    className="w-full py-3 bg-green-600 text-white rounded-lg text-xs font-medium disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isSending ? (
                      <Loader className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    {isSending ? 'Processing...' : 'Process Bulk Upload'}
                  </button>

                  {bulkUploads.length > 0 && (
                    <div className="mt-6">
                      <h4 className="text-sm font-medium text-ink mb-3">Upload History</h4>
                      <div className="space-y-2">
                        {bulkUploads.map(upload => (
                          <div key={upload.id} className="flex justify-between items-center p-3 bg-background rounded-lg">
                            <div>
                              <p className="text-xs font-medium text-ink">{upload.filename}</p>
                              <p className="text-xs text-subtle">
                                {upload.processed}/{upload.totalRecipients} recipients
                              </p>
                            </div>
                            <span className={`px-2 py-1 rounded text-xs ${upload.status === 'completed'
                              ? 'bg-green-100 text-green-800'
                              : upload.status === 'processing'
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-red-100 text-red-800'
                              }`}>
                              {upload.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-ink">SMS Packages</h3>

                  <div className="space-y-3">
                    {smsPackages.map(pkg => (
                      <div
                        key={pkg.id}
                        className={`bg-white border rounded-lg p-4 cursor-pointer transition-all ${selectedPackage === pkg.id
                          ? 'border-brand ring-2 ring-blue-100'
                          : 'border-border hover:border-border'
                          } ${pkg.popular ? 'relative' : ''}`}
                        onClick={() => setSelectedPackage(pkg.id)}
                      >
                        {pkg.popular && (
                          <span className="absolute -top-2 left-4 bg-blue-600 text-white px-2 py-1 rounded text-xs font-medium">
                            POPULAR
                          </span>
                        )}
                        <div className="flex justify-between items-start mb-2">
                          <h4 className="text-sm font-medium text-ink">{pkg.name}</h4>
                          <div className="text-right">
                            <p className="text-lg font-bold text-ink">KSh {pkg.cost.toLocaleString()}</p>
                            <p className="text-xs text-subtle">KSh {pkg.costPerSMS} per SMS</p>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground mb-3">
                          {pkg.smsCount.toLocaleString()} SMS
                        </p>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleBuyPackage(pkg);
                          }}
                          className="w-full py-2 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700"
                        >
                          Buy Package
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'sender-id' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-ink">Sender ID Settings</h3>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-ink mb-2">
                        Sender ID Type
                      </label>
                      <div className="space-y-2">
                        <label className="flex items-center">
                          <input
                            type="radio"
                            name="senderType"
                            value="default"
                            checked={senderIdConfig.sender_id_type === 'default'}
                            onChange={(_e) => setSenderIdConfig(prev => ({
                              ...prev,
                              sender_id_type: 'default'
                            }))}
                            className="mr-2"
                          />
                          <span className="text-sm">Use Default Sender ID ({CELCOM_AFRICA_CONFIG.defaultShortcode})</span>
                        </label>
                        <label className="flex items-center">
                          <input
                            type="radio"
                            name="senderType"
                            value="custom"
                            checked={senderIdConfig.sender_id_type === 'custom'}
                            onChange={(_e) => setSenderIdConfig(prev => ({
                              ...prev,
                              sender_id_type: 'custom'
                            }))}
                            className="mr-2"
                          />
                          <span className="text-sm">Use Custom Sender ID</span>
                        </label>
                      </div>
                    </div>

                    {senderIdConfig.sender_id_type === 'custom' && (
                      <>
                        <div>
                          <label className="block text-xs font-medium text-ink mb-1">
                            Custom Sender ID
                          </label>
                          <input
                            type="text"
                            value={senderIdConfig.custom_sender_id || ''}
                            onChange={(e) => setSenderIdConfig(prev => ({
                              ...prev,
                              custom_sender_id: e.target.value
                            }))}
                            className="w-full border border-border rounded-lg p-2 text-xs focus:outline-none focus:border-brand"
                            placeholder="Enter your custom sender ID (max 11 characters)"
                            maxLength={11}
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-ink mb-2">
                            Mobile Provider
                          </label>
                          <select
                            value={senderIdConfig.provider}
                            onChange={(e) => setSenderIdConfig(prev => ({
                              ...prev,
                              provider: e.target.value as 'safaricom' | 'airtel' | 'orange'
                            }))}
                            className="w-full border border-border rounded-lg p-2 text-xs focus:outline-none focus:border-brand"
                          >
                            <option value="safaricom">Safaricom (KSh 10,000)</option>
                            <option value="airtel">Airtel (KSh 10,000)</option>
                            <option value="orange">Orange (KSh 10,000)</option>
                          </select>
                        </div>

                        <div className="space-y-3">
                          <div>
                            <label className="block text-xs font-medium text-ink mb-1">
                              Business Certificate of Registration
                            </label>
                            <input
                              type="file"
                              accept=".pdf,.jpg,.jpeg,.png"
                              onChange={(e) => setBusinessCertificate(e.target.files?.[0] || null)}
                              className="w-full border border-border rounded-lg p-2 text-xs"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-ink mb-1">
                              Letter of Consent (Company Letterhead)
                            </label>
                            <input
                              type="file"
                              accept=".pdf,.jpg,.jpeg,.png"
                              onChange={(e) => setConsentLetter(e.target.files?.[0] || null)}
                              className="w-full border border-border rounded-lg p-2 text-xs"
                            />
                          </div>
                        </div>

                        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                          <div className="flex items-start gap-3">
                            <Info className="w-5 h-5 text-yellow-600 mt-0.5" />
                            <div>
                              <p className="text-sm font-medium text-yellow-800">Custom Sender ID Requirements</p>
                              <ul className="text-xs text-yellow-700 mt-1 list-disc list-inside space-y-1">
                                <li>Cost: KSh 10,000 per provider</li>
                                <li>Approval process takes 3-5 business days</li>
                                <li>Valid business registration certificate required</li>
                                <li>Letter of consent on company letterhead required</li>
                                <li>Sender ID must be 11 characters or less</li>
                              </ul>
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  <button
                    onClick={handleSenderIDConfig}
                    disabled={isUploadingFiles}
                    className="w-full py-3 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isUploadingFiles ? (
                      <Loader className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    {isUploadingFiles ? 'Saving...' : 'Save Configuration'}
                  </button>
                </div>

                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-ink">Current Configuration</h3>

                  <div className="bg-background rounded-lg p-4">
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs text-muted-foreground">Sender ID Type</p>
                        <p className="text-sm font-medium text-ink capitalize">
                          {senderIdConfig.sender_id_type}
                        </p>
                      </div>

                      <div>
                        <p className="text-xs text-muted-foreground">Current Sender ID</p>
                        <p className="text-sm font-medium text-ink">
                          {getCurrentShortcode()}
                        </p>
                      </div>

                      {senderIdConfig.sender_id_type === 'custom' && (
                        <>
                          <div>
                            <p className="text-xs text-muted-foreground">Provider</p>
                            <p className="text-sm font-medium text-ink capitalize">
                              {senderIdConfig.provider}
                            </p>
                          </div>

                          <div>
                            <p className="text-xs text-muted-foreground">Status</p>
                            <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${senderIdConfig.status === 'approved'
                              ? 'bg-green-100 text-green-800'
                              : senderIdConfig.status === 'pending'
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-red-100 text-red-800'
                              }`}>
                              {senderIdConfig.status}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {senderIdConfig.sender_id_type === 'custom' && senderIdConfig.status === 'pending' && (
                    <div className="bg-green-tint border border-border rounded-lg p-4">
                      <div className="flex items-start gap-3">
                        <Clock className="w-5 h-5 text-brand mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-brand-dark">Pending Approval</p>
                          <p className="text-xs text-brand-dark mt-1">
                            Your custom sender ID application is under review. You can continue using the default sender ID in the meantime.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Additional Variables Modal */}
      {showAdditionalVariablesModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-ink">Additional Information Needed</h3>
              <button
                onClick={() => setShowAdditionalVariablesModal(false)}
                className="text-subtle hover:text-muted-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                The selected template requires some additional information that will be used for all recipients:
              </p>

              {Object.keys(additionalVariables).map(variable => (
                <div key={variable}>
                  <label className="block text-xs font-medium text-ink mb-1">
                    {variable.charAt(0).toUpperCase() + variable.slice(1)}
                  </label>
                  <input
                    type="text"
                    value={additionalVariables[variable]}
                    onChange={(e) => setAdditionalVariables(prev => ({
                      ...prev,
                      [variable]: e.target.value
                    }))}
                    className="w-full border border-border rounded-lg p-2 text-xs focus:outline-none focus:border-brand"
                    placeholder={`Enter ${variable}`}
                  />
                </div>
              ))}

              <div className="flex gap-3">
                <button
                  onClick={() => setShowAdditionalVariablesModal(false)}
                  className="flex-1 py-2 border border-border text-ink rounded-lg text-sm font-medium hover:bg-background"
                >
                  Cancel
                </button>
                <button
                  onClick={applyTemplateWithAdditionalVariables}
                  className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Template Modal */}
      {showNewTemplateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-ink">Create New Template</h3>
              <button
                onClick={() => setShowNewTemplateModal(false)}
                className="text-subtle hover:text-muted-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-ink mb-1">
                  Template Name
                </label>
                <input
                  type="text"
                  value={newTemplate.name}
                  onChange={(e) => setNewTemplate(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full border border-border rounded-lg p-2 text-xs focus:outline-none focus:border-brand"
                  placeholder="Enter template name"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-ink mb-1">
                  Category
                </label>
                <select
                  value={newTemplate.category}
                  onChange={(e) => setNewTemplate(prev => ({ ...prev, category: e.target.value }))}
                  className="w-full border border-border rounded-lg p-2 text-xs focus:outline-none focus:border-brand"
                >
                  <option value="Business">Business</option>
                  <option value="Holiday">Holiday</option>
                  <option value="Custom">Custom</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-ink mb-1">
                  Template Content
                </label>
                <textarea
                  value={newTemplate.content}
                  onChange={(e) => setNewTemplate(prev => ({ ...prev, content: e.target.value }))}
                  rows={4}
                  className="w-full border border-border rounded-lg p-2 text-xs focus:outline-none focus:border-brand resize-none"
                  placeholder="Enter template content (use {variable} for dynamic fields)"
                />
                <p className="text-xs text-subtle mt-1">
                  Use {'{variable}'} for dynamic fields. Employee data: {'{name}'}, {'{department}'}, {'{position}'}, {'{town}'}, {'{phone}'}
                </p>
              </div>

              <button
                onClick={createNewTemplate}
                className="w-full py-3 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
              >
                Create Template
              </button>
            </div>
          </div>
        </div>
      )}

      {showPackageModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-ink">Purchase SMS Package</h3>
              <button
                onClick={() => setShowPackageModal(false)}
                className="text-subtle hover:text-muted-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="bg-background rounded-lg p-4">
                <h4 className="font-medium text-ink text-sm">
                  {smsPackages.find(p => p.id === selectedPackage)?.name}
                </h4>
                <p className="text-muted-foreground text-sm mt-1">
                  {smsPackages.find(p => p.id === selectedPackage)?.smsCount.toLocaleString()} SMS
                </p>
                <p className="text-lg font-bold text-ink mt-2">
                  KSh {smsPackages.find(p => p.id === selectedPackage)?.cost.toLocaleString()}
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-ink mb-1">
                    Payment Method
                  </label>
                  <select className="w-full border border-border rounded-lg p-2 text-xs">
                    <option>MPESA</option>
                    <option>Credit Card</option>
                    <option>Bank Transfer</option>
                  </select>
                </div>

                <button className="w-full py-3 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
                  Complete Purchase
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}