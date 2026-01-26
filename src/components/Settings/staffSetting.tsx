// components/AdvanceApplicationManager.tsx
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Lock,
  AlertCircle,
  CheckCircle2,
  Calendar,
  Clock,
  Settings,
  Bell,
  CalendarClock as Schedule // Using CalendarClock as Schedule replacement
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

interface AdvanceApplicationManagerProps {
  onStatusChange?: () => void;
}

interface ScheduleSettings {
  schedule_type: 'manual' | 'scheduled';
  scheduled_close?: string;
  scheduled_open?: string;
  custom_message?: string;
}

const AdvanceApplicationManager = ({ onStatusChange }: AdvanceApplicationManagerProps) => {
  const [isClosing, setIsClosing] = useState(false);
  const [isOpen, setIsOpen] = useState(true);
  const [showSchedulePanel, setShowSchedulePanel] = useState(false);
  const [scheduleSettings, setScheduleSettings] = useState<ScheduleSettings>({
    schedule_type: 'manual',
    scheduled_close: '',
    scheduled_open: '',
    custom_message: ''
  });
  const [currentSettings, setCurrentSettings] = useState<any>(null);

  // Fetch current settings
  useEffect(() => {
    fetchCurrentSettings();
  }, []);

  const fetchCurrentSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('salary_advance_settings')
        .select('*')
        .eq('id', 1)
        .single();

      if (error) throw error;

      if (data) {
        setCurrentSettings(data);
        setIsOpen(data.applications_active);
        setScheduleSettings({
          schedule_type: data.schedule_type || 'manual',
          scheduled_close: data.scheduled_close || '',
          scheduled_open: data.scheduled_open || '',
          custom_message: data.custom_message || ''
        });
      }
    } catch (error) {
      console.error('Error fetching settings:', error);
    }
  };

  const closeAdvanceApplications = async () => {
    setIsClosing(true);

    try {
      // 1. Update application status
      const { error: updateError } = await supabase
        .from('salary_advance_settings')
        .upsert({
          id: 1,
          applications_active: false,
          closed_until: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString(),
          closed_at: new Date().toISOString(),
          closed_by: 'Admin', // Get from auth in real implementation
          schedule_type: 'manual'
        });

      if (updateError) throw updateError;

      // 2. Create notification for all staff
      await notifyAllStaff(
        'Salary Advance Applications Temporarily Suspended',
        'Salary advance applications are currently unavailable. The application window will reopen at the beginning of the next calendar month. Please plan accordingly and submit any future requests during the designated application period.'
      );

      setIsOpen(false);
      await fetchCurrentSettings();
      toast.success('Salary advance applications closed successfully');

      if (onStatusChange) {
        onStatusChange();
      }

    } catch (error) {
      console.error('Error closing advance applications:', error);
      toast.error('Failed to close advance applications');
    } finally {
      setIsClosing(false);
    }
  };

  const reopenAdvanceApplications = async () => {
    setIsClosing(true);

    try {
      const { error: updateError } = await supabase
        .from('salary_advance_settings')
        .upsert({
          id: 1,
          applications_active: true,
          closed_until: null,
          reopened_at: new Date().toISOString(),
          schedule_type: 'manual'
        });

      if (updateError) throw updateError;

      // Notify staff that applications are open again
      await notifyAllStaff(
        'Salary Advance Applications Now Open',
        'Salary advance applications are now being accepted. You may submit your requests through the staff portal.'
      );

      setIsOpen(true);
      await fetchCurrentSettings();
      toast.success('Salary advance applications reopened successfully');

      if (onStatusChange) {
        onStatusChange();
      }

    } catch (error) {
      console.error('Error reopening advance applications:', error);
      toast.error('Failed to reopen advance applications');
    } finally {
      setIsClosing(false);
    }
  };

  const saveScheduleSettings = async () => {
    try {
      const { error } = await supabase
        .from('salary_advance_settings')
        .upsert({
          id: 1,
          schedule_type: scheduleSettings.schedule_type,
          scheduled_close: scheduleSettings.scheduled_close || null,
          scheduled_open: scheduleSettings.scheduled_open || null,
          custom_message: scheduleSettings.custom_message || null
        });

      if (error) throw error;

      toast.success('Schedule settings saved successfully');
      setShowSchedulePanel(false);
      await fetchCurrentSettings();

      // If switching to scheduled mode and close time is in past, close immediately
      if (scheduleSettings.schedule_type === 'scheduled' && scheduleSettings.scheduled_close) {
        const closeTime = new Date(scheduleSettings.scheduled_close);
        if (closeTime <= new Date()) {
          await closeAdvanceApplications();
        }
      }

    } catch (error) {
      console.error('Error saving schedule settings:', error);
      toast.error('Failed to save schedule settings');
    }
  };

  const notifyAllStaff = async (title: string, message: string) => {
    try {
      const { data: employees, error: employeesError } = await supabase
        .from('employees')
        .select('"Employee Number"');

      if (employeesError) throw employeesError;

      if (employees && employees.length > 0) {
        const notifications = employees.map(employee => ({
          employee_number: employee["Employee Number"],
          type: 'system_announcement',
          title,
          message: scheduleSettings.custom_message || message,
          priority: 'high',
          is_read: false,
          created_at: new Date().toISOString()
        }));

        const { error: notificationError } = await supabase
          .from('notifications')
          .insert(notifications);

        if (notificationError) throw notificationError;
      }
    } catch (error) {
      console.error('Error notifying staff:', error);
    }
  };

  const getScheduleStatus = () => {
    if (!currentSettings?.schedule_type || currentSettings.schedule_type === 'manual') {
      return null;
    }

    const now = new Date();
    const scheduledClose = currentSettings.scheduled_close ? new Date(currentSettings.scheduled_close) : null;
    const scheduledOpen = currentSettings.scheduled_open ? new Date(currentSettings.scheduled_open) : null;

    if (scheduledClose && scheduledClose > now) {
      return `Scheduled to close on ${scheduledClose.toLocaleString()}`;
    } else if (scheduledOpen && scheduledOpen > now) {
      return `Scheduled to reopen on ${scheduledOpen.toLocaleString()}`;
    }

    return null;
  };

  const scheduleStatus = getScheduleStatus();

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-800">Salary Advance Management</h3>
          <p className="text-sm text-gray-600">Manage application windows and scheduling</p>
        </div>
        <div className="flex items-center space-x-2">
          {scheduleStatus && (
            <div className="flex items-center space-x-2 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs">
              <Clock className="h-3 w-3" />
              <span>{scheduleStatus}</span>
            </div>
          )}
          <div className={`flex items-center space-x-2 px-3 py-1 rounded-full text-xs font-medium ${isOpen ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            }`}>
            {isOpen ? (
              <>
                <CheckCircle2 className="h-3 w-3" />
                <span>Applications Open</span>
              </>
            ) : (
              <>
                <Lock className="h-3 w-3" />
                <span>Applications Closed</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {/* Current Status */}
        <div className="bg-gray-50 p-4 rounded-lg">
          <div className="flex items-start space-x-3">
            <AlertCircle className="h-5 w-5 text-blue-500 mt-0.5" />
            <div className="flex-1">
              <h4 className="text-sm font-medium text-gray-900">Current Status</h4>
              <p className="text-xs text-gray-600 mt-1">
                {isOpen
                  ? 'Salary advance applications are currently being accepted from staff members.'
                  : 'Salary advance applications are temporarily suspended until the next calendar month.'
                }
              </p>
              {currentSettings?.closed_until && !isOpen && (
                <p className="text-xs text-orange-600 mt-1">
                  <strong>Reopening:</strong> {new Date(currentSettings.closed_until).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex space-x-3">
          {isOpen ? (
            <button
              onClick={closeAdvanceApplications}
              disabled={isClosing}
              className="flex-1 bg-red-600 text-white py-2 px-4 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {isClosing ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Closing Applications...
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4 mr-2" />
                  Close Applications Now
                </>
              )}
            </button>
          ) : (
            <button
              onClick={reopenAdvanceApplications}
              disabled={isClosing}
              className="flex-1 bg-green-600 text-white py-2 px-4 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {isClosing ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Reopening Applications...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Reopen Applications Now
                </>
              )}
            </button>
          )}

          <button
            onClick={() => setShowSchedulePanel(!showSchedulePanel)}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center"
          >
            <Settings className="h-4 w-4 mr-2" />
            Schedule
          </button>
        </div>

        {/* Schedule Panel */}
        {showSchedulePanel && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="bg-blue-50 border border-blue-200 rounded-lg p-4"
          >
            <h4 className="text-sm font-medium text-gray-900 mb-3 flex items-center">
              <Schedule className="h-4 w-4 mr-2" />
              Schedule Settings
            </h4>

            <div className="space-y-4">
              {/* Schedule Type */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">
                  Management Mode
                </label>
                <div className="flex space-x-4">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="schedule_type"
                      value="manual"
                      checked={scheduleSettings.schedule_type === 'manual'}
                      onChange={(e) => setScheduleSettings(prev => ({ ...prev, schedule_type: e.target.value as 'manual' | 'scheduled' }))}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                    />
                    <span className="ml-2 text-xs text-gray-700">Manual Control</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="schedule_type"
                      value="scheduled"
                      checked={scheduleSettings.schedule_type === 'scheduled'}
                      onChange={(e) => setScheduleSettings(prev => ({ ...prev, schedule_type: e.target.value as 'manual' | 'scheduled' }))}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                    />
                    <span className="ml-2 text-xs text-gray-700">Scheduled</span>
                  </label>
                </div>
              </div>

              {/* Scheduled Settings */}
              {scheduleSettings.schedule_type === 'scheduled' && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Schedule Close Date & Time
                      </label>
                      <input
                        type="datetime-local"
                        value={scheduleSettings.scheduled_close || ''}
                        onChange={(e) => setScheduleSettings(prev => ({ ...prev, scheduled_close: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        min={new Date().toISOString().slice(0, 16)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Schedule Reopen Date & Time
                      </label>
                      <input
                        type="datetime-local"
                        value={scheduleSettings.scheduled_open || ''}
                        onChange={(e) => setScheduleSettings(prev => ({ ...prev, scheduled_open: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        min={new Date().toISOString().slice(0, 16)}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Custom Notification Message (Optional)
                    </label>
                    <textarea
                      value={scheduleSettings.custom_message || ''}
                      onChange={(e) => setScheduleSettings(prev => ({ ...prev, custom_message: e.target.value }))}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Enter a custom message to display to staff when applications are closed..."
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      This message will be shown to staff members when applications are closed.
                    </p>
                  </div>
                </>
              )}

              {/* Action Buttons */}
              <div className="flex space-x-3 pt-2">
                <button
                  onClick={saveScheduleSettings}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 flex items-center"
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Save Schedule
                </button>
                <button
                  onClick={() => setShowSchedulePanel(false)}
                  className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}

        <div className="text-xs text-gray-500">
          <p>
            {isOpen
              ? 'Closing applications will prevent staff from submitting new salary advance requests and notify all staff members.'
              : 'Reopening applications will allow staff to submit new salary advance requests immediately.'
            }
          </p>
        </div>
      </div>
    </div>
  );
};

export default AdvanceApplicationManager;