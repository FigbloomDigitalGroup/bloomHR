import React, { useState, useEffect } from 'react';
import { Cake, Send, Users, Phone, Calendar, CheckCircle, AlertCircle, Loader, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { CELCOM_AFRICA_CONFIG } from '../../config/sms';
import toast from 'react-hot-toast';

// Phone formatting function (same as your SMS system)
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

// Simple SMS function
const sendSMS = async (phone: string, message: string) => {
  try {
    const formattedPhone = formatPhoneNumberForSMS(phone);
    
    if (!formattedPhone) {
      throw new Error(`Invalid phone number: ${phone}`);
    }

    // Celcom Africa API - SIMPLE VERSION
    const apiKey = CELCOM_AFRICA_CONFIG.apiKey;
    const partnerID = CELCOM_AFRICA_CONFIG.partnerID;
    const shortcode = CELCOM_AFRICA_CONFIG.defaultShortcode;
    const encodedMessage = encodeURIComponent(message);
    
    // Create the URL
    const url = `https://isms.celcomafrica.com/api/services/sendsms/?apikey=${apiKey}&partnerID=${partnerID}&message=${encodedMessage}&shortcode=${shortcode}&mobile=${formattedPhone}`;
    
    console.log('Sending birthday SMS to:', formattedPhone);
    
    // Send request - no-cors mode like your system
    await fetch(url, {
      method: 'GET',
      mode: 'no-cors'
    });
    
    console.log('Birthday SMS request sent successfully');
    return { success: true, message: 'SMS sent' };
    
  } catch (error) {
    console.error('SMS Error:', error);
    return { success: false, error: error.message };
  }
};

export default function BirthdaySMS() {
  const [todayBirthdays, setTodayBirthdays] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [autoSend, setAutoSend] = useState(false);
  const [sendTime, setSendTime] = useState('09:00');

  // Fetch birthdays WITH PROPER PHONE NUMBERS
  const fetchBirthdays = async () => {
    setIsLoading(true);
    try {
      const today = new Date();
      const currentMonth = today.getMonth() + 1;
      const currentDay = today.getDate();
      
      // Get employees with ALL phone fields like your SMS system
      const { data: employees, error } = await supabase
        .from('employees')
        .select(`
          "Employee Number",
          "First Name",
          "Middle Name",
          "Last Name",
          "Mobile Number",
          "Personal Mobile",
          "Work Mobile",
          "Date of Birth",
          "Job Title",
          "Job Level",
          "Branch",
          "Office",
          "Town"
        `)
        .not('Date of Birth', 'is', null);

      if (error) throw error;

      const birthdaysToday = employees.filter(emp => {
        if (!emp['Date of Birth']) return false;
        try {
          const birthDate = new Date(emp['Date of Birth']);
          return birthDate.getMonth() + 1 === currentMonth && 
                 birthDate.getDate() === currentDay;
        } catch (e) {
          return false;
        }
      }).map(emp => {
        // EXTRACT PHONE LIKE YOUR SMS SYSTEM
        const rawPhone = emp['Mobile Number'] || emp['Personal Mobile'] || emp['Work Mobile'] || '';
        const phone_number = formatPhoneNumberForSMS(rawPhone);
        
        // Only include if valid phone
        if (phone_number && phone_number.length === 12 && phone_number.startsWith('254')) {
          const firstName = emp['First Name'] || '';
          const middleName = emp['Middle Name'] || '';
          const lastName = emp['Last Name'] || '';
          const fullName = `${firstName} ${middleName} ${lastName}`.trim().replace(/\s+/g, ' ');
          
          return {
            id: emp['Employee Number'] || Math.random().toString(),
            employee_id: emp['Employee Number'] || '',
            employee_name: fullName,
            phone_number: phone_number,
            department: emp['Job Level'] || emp['Branch'] || emp['Office'] || 'Unknown',
            position: emp['Job Title'] || 'Unknown',
            town: emp['Town'] || 'Unknown',
            date_of_birth: emp['Date of Birth']
          };
        }
        return null;
      }).filter(emp => emp !== null); // Remove null entries

      setTodayBirthdays(birthdaysToday);
      console.log('Found birthdays:', birthdaysToday.length, 'Valid phones:', birthdaysToday.filter(e => e.phone_number).length);
      
    } catch (error) {
      console.error('Error fetching birthdays:', error);
      toast.error('Failed to load birthday data');
    } finally {
      setIsLoading(false);
    }
  };

  // Send birthday SMS to one employee
  const sendBirthdaySMS = async (employee) => {
    if (!employee.phone_number) {
      toast.error(`No valid phone for ${employee.employee_name}`);
      return;
    }

    setIsSending(true);
    try {
      const message = `Happy Birthday ${employee.employee_name}! 🎉 Wishing you a fantastic year ahead from the Figbloom HR Team`;
      const result = await sendSMS(employee.phone_number, message);

      if (result.success) {
        toast.success(`Birthday SMS sent to ${employee.employee_name}`);
        // Log it
        await supabase.from('sms_logs').insert({
          recipient_phone: employee.phone_number,
          message: message,
          status: 'sent',
          sender_id: CELCOM_AFRICA_CONFIG.defaultShortcode,
          created_at: new Date().toISOString()
        });
      } else {
        toast.error(`Failed to send to ${employee.employee_name}`);
      }
    } catch (error) {
      toast.error(`Error: ${error.message}`);
    } finally {
      setIsSending(false);
    }
  };

  // Send to all birthdays
  const sendAllBirthdaySMS = async () => {
    const validBirthdays = todayBirthdays.filter(emp => emp.phone_number);
    
    if (validBirthdays.length === 0) {
      toast.error('No birthdays with valid phone numbers today');
      return;
    }

    setIsSending(true);
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < validBirthdays.length; i++) {
      const employee = validBirthdays[i];
      
      try {
        const message = `Happy Birthday ${employee.employee_name}! 🎉 Wishing you a fantastic year ahead from the Figbloom HR Team`;
        const result = await sendSMS(employee.phone_number, message);

        if (result.success) {
          successCount++;

          // Log it
          await supabase.from('sms_logs').insert({
            recipient_phone: employee.phone_number,
            message: message,
            status: 'sent',
            sender_id: CELCOM_AFRICA_CONFIG.defaultShortcode,
            created_at: new Date().toISOString()
          });
          
          console.log(`✅ Sent to ${employee.employee_name} (${employee.phone_number})`);
        } else {
          failCount++;
          console.log(`❌ Failed for ${employee.employee_name}`);
        }
        
        // Wait 1 second between SMS
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        failCount++;
        console.error(`💥 Error for ${employee.employee_name}:`, error);
      }
    }
    
    setIsSending(false);
    
    if (successCount > 0) {
      toast.success(`🎉 Sent ${successCount} birthday SMS successfully!`);
    }
    if (failCount > 0) {
      toast.error(`Failed to send ${failCount} SMS`);
    }
    
    // Refresh
    fetchBirthdays();
  };

  // Auto-send at scheduled time
  useEffect(() => {
    if (!autoSend) return;

    const checkAndSend = () => {
      const now = new Date();
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      
      if (currentTime === sendTime && todayBirthdays.length > 0) {
        console.log('Auto-sending birthday SMS at', sendTime);
        sendAllBirthdaySMS();
      }
    };

    // Check every minute
    const interval = setInterval(checkAndSend, 60000);
    return () => clearInterval(interval);
  }, [autoSend, sendTime, todayBirthdays]);

  // Load on mount
  useEffect(() => {
    fetchBirthdays();
  }, []);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-pink-500 to-rose-500 rounded-lg flex items-center justify-center">
            <Cake className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Birthday SMS Auto-Sender</h2>
            <p className="text-sm text-slate-600">
              {todayBirthdays.length} birthdays today • {todayBirthdays.filter(e => e.phone_number).length} with valid phones
            </p>
          </div>
        </div>
        
        <button
          onClick={fetchBirthdays}
          className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg hover:bg-slate-50"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          <span className="text-sm">Refresh</span>
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-gradient-to-br from-pink-50 to-rose-50 border border-pink-100 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-pink-700 font-medium">Today's Birthdays</p>
              <p className="text-2xl font-bold text-pink-900 mt-1">{todayBirthdays.length}</p>
            </div>
            <Cake className="w-8 h-8 text-pink-400" />
          </div>
        </div>
        
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-100 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-green-700 font-medium">Valid Phones</p>
              <p className="text-2xl font-bold text-green-900 mt-1">
                {todayBirthdays.filter(e => e.phone_number).length}
              </p>
            </div>
            <Phone className="w-8 h-8 text-green-400" />
          </div>
        </div>
        
        <div className="bg-gradient-to-br from-blue-50 to-cyan-50 border border-blue-100 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-blue-700 font-medium">Auto-Send</p>
              <p className="text-sm font-medium text-blue-900 mt-1">
                {autoSend ? `ON (${sendTime})` : 'OFF'}
              </p>
            </div>
            <Calendar className="w-8 h-8 text-blue-400" />
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="space-y-4 mb-6">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Auto-send at time:
            </label>
            <input
              type="time"
              value={sendTime}
              onChange={(e) => setSendTime(e.target.value)}
              className="w-full border border-slate-300 rounded-lg p-2 text-sm"
            />
          </div>
          
          <button
            onClick={() => setAutoSend(!autoSend)}
            className={`px-4 py-2 rounded-lg font-medium text-sm mt-6 ${
              autoSend 
                ? 'bg-red-600 hover:bg-red-700 text-white' 
                : 'bg-green-600 hover:bg-green-700 text-white'
            }`}
          >
            {autoSend ? 'Disable Auto' : 'Enable Auto'}
          </button>
        </div>

        <button
          onClick={sendAllBirthdaySMS}
          disabled={isSending || todayBirthdays.filter(e => e.phone_number).length === 0}
          className="w-full bg-gradient-to-r from-pink-600 to-rose-600 text-white py-3 rounded-lg font-medium flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {isSending ? (
            <>
              <Loader className="w-4 h-4 animate-spin" />
              Sending...
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              Send Birthday SMS ({todayBirthdays.filter(e => e.phone_number).length})
            </>
          )}
        </button>
      </div>

      {/* Birthday List */}
      <div>
        <h3 className="text-sm font-medium text-slate-700 mb-4">Today's Birthday Employees:</h3>
        
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : todayBirthdays.length === 0 ? (
          <div className="text-center py-8 border border-dashed border-slate-300 rounded-lg">
            <Cake className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">No birthdays today</p>
          </div>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
            {todayBirthdays.map(employee => (
              <div key={employee.id} className="border border-slate-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className="font-medium text-slate-900">{employee.employee_name}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {employee.phone_number ? (
                        <>
                          <Phone className="w-3 h-3 text-slate-400" />
                          <span className="text-sm text-slate-600">{employee.phone_number}</span>
                          <span className="text-slate-400">•</span>
                        </>
                      ) : (
                        <span className="text-sm text-red-600">No valid phone</span>
                      )}
                      <span className="text-sm text-slate-600">{employee.position}</span>
                      <span className="text-slate-400">•</span>
                      <span className="text-sm text-slate-600">{employee.town}</span>
                    </div>
                  </div>
                  
                  <button
                    onClick={() => sendBirthdaySMS(employee)}
                    disabled={isSending || !employee.phone_number}
                    className={`px-3 py-1 text-sm rounded ${
                      employee.phone_number 
                        ? 'bg-blue-600 text-white hover:bg-blue-700' 
                        : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    {employee.phone_number ? 'Send SMS' : 'No Phone'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Status */}
      {autoSend && (
        <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <div>
              <p className="font-medium text-green-800">Auto-send enabled</p>
              <p className="text-sm text-green-700 mt-1">
                System will automatically send birthday SMS daily at {sendTime} to {todayBirthdays.filter(e => e.phone_number).length} employees
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}