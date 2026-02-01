
import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Loader2, Send, Filter, Users, User, X, Check, Paperclip } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import SearchableDropdown from '../UI/SearchableDropdown';


interface Employee {
  id: string; // Assuming there's an ID or 'Employee Number'
  'First Name': string;
  'Last Name': string;
  'Work Email': string;
  'Employee Number': string;
  Branch: string;
  'Employee Type': string; // Department
}

export default function SendEmail() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  // Form State
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  const [provider, setProvider] = useState<'resend' | 'cpanel'>('resend'); // Default provider
  const [cpanelUser, setCpanelUser] = useState<string>('support@mularcredit.com'); // Default cPanel user
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('');

  // Bulk Filters
  const [selectedBranch, setSelectedBranch] = useState('all');
  const [selectedDepartment, setSelectedDepartment] = useState('all');

  // Email Content
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<{ filename: string; content: string }[]>([]);

  // Computed unique lists for filters
  const [branches, setBranches] = useState<string[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);

  useEffect(() => {
    fetchEmployees();
  }, []);

  const fetchEmployees = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .not('Work Email', 'is', null) // Only fetch those with emails
        .not('Work Email', 'eq', '');

      if (error) throw error;

      const emps = data as Employee[] || [];
      setEmployees(emps);

      // Extract unique branches and departments
      const uniqueBranches = Array.from(new Set(emps.map(e => e.Branch).filter(Boolean)));
      const uniqueDepartments = Array.from(new Set(emps.map(e => e['Employee Type']).filter(Boolean)));

      setBranches(uniqueBranches);
      setDepartments(uniqueDepartments);

    } catch (error) {
      console.error('Error fetching employees:', error);
      toast.error('Failed to load employees');
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newAttachments: { filename: string; content: string }[] = [];
      const files = Array.from(e.target.files);

      for (const file of files) {
        // limit size - check if total payload might be too big? 
        // 50MB is limit on backend. Let's warn if single file > 5MB for now
        if (file.size > 5 * 1024 * 1024) {
          toast.error(`File ${file.name} is too large (max 5MB)`);
          continue;
        }

        const reader = new FileReader();
        try {
          const content = await new Promise<string>((resolve, reject) => {
            reader.onload = () => {
              const result = reader.result as string;
              // remove data url prefix (e.g. "data:image/png;base64,")
              const base64 = result.split(',')[1];
              resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          newAttachments.push({ filename: file.name, content });
        } catch (err) {
          console.error("Error reading file:", err);
          toast.error(`Failed to read file ${file.name}`);
        }
      }
      setAttachments(prev => [...prev, ...newAttachments]);
      // clear input value so same files can be selected again if cleared
      e.target.value = '';
    }
  };

  // Filtered recipients calculation
  const getRecipients = () => {
    if (mode === 'single') {
      const emp = employees.find(e => e['Employee Number'] === selectedEmployeeId);
      return emp ? [emp] : [];
    } else {
      return employees.filter(emp => {
        const matchesBranch = selectedBranch === 'all' || emp.Branch === selectedBranch;
        const matchesDept = selectedDepartment === 'all' || emp['Employee Type'] === selectedDepartment;
        return matchesBranch && matchesDept;
      });
    }
  };

  const recipients = getRecipients();

  const handleSend = async () => {
    if (recipients.length === 0) {
      toast.error('No recipients selected');
      return;
    }
    if (!subject.trim()) {
      toast.error('Subject is required');
      return;
    }
    if (!body.trim()) {
      toast.error('Email body is required');
      return;
    }

    setSending(true);
    const toastId = toast.loading(`Sending email to ${recipients.length} recipients...`);

    try {
      // We will send individually to each recipient to generate individual logs
      // Or we can use the backend to handle bulk sending if it supports it.
      // Looking at email_routes.js, it takes a single 'to' which can be string or array (Resend supports array).
      // However, for personal addressing usually we want one by one or BCC.
      // But the backend route:
      // const { to, subject, html } = req.body;
      // return res.status(400).json({ error: "to, subject, and html are required" });

      // If we send an array to 'to', everyone sees everyone else's email unless we use BCC.
      // But Resend 'to' can be array.
      // To keep it simple and safe (and avoid exposing emails), let's send individually or use BCC if supported by our backend logic properly.
      // But `email_routes.js` logic: `to` is passed directly to `resend.emails.send` or `transporter.sendMail`.

      // If we send to multiple people in 'to', they will see each other.
      // So for bulk, we should loop and send or use BCC.
      // "send email to single employee or bulk" -> usually implies a broadcast.
      // Let's loop for now to be safe and ensure privacy, although it might be slower.
      // Alternatively, we can batch them.

      const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.MODE === 'production' ? '/api' : "http://localhost:3001/api");

      let successCount = 0;
      let failCount = 0;

      // Prepare chunks of requests to avoid overwhelming
      // For a "portal", looping is fine for hundreds of employees.

      const sendEmailToRecipient = async (recipient: Employee) => {
        try {
          const response = await fetch(`${API_URL}/email/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: recipient['Work Email'],
              subject: subject,
              html: body,
              attachments: attachments.length > 0 ? attachments : undefined,
              provider, // Pass selected provider
              cpanelUser: provider === 'cpanel' ? cpanelUser : undefined // Pass dynamic user
            })
          });

          if (!response.ok) throw new Error('Failed');
          return true;
        } catch (e) {
          return false;
        }
      };

      // Send in parallel batches of 5
      const batchSize = 5;
      for (let i = 0; i < recipients.length; i += batchSize) {
        const batch = recipients.slice(i, i + batchSize);
        const results = await Promise.all(batch.map(emp => sendEmailToRecipient(emp)));
        results.forEach(success => {
          if (success) successCount++;
          else failCount++;
        });
      }

      toast.success(`Sent ${successCount} emails. ${failCount > 0 ? `${failCount} failed.` : ''}`, { id: toastId });

      if (successCount > 0) {
        // Clear form
        setSubject('');
        setBody('');
        if (mode === 'single') setSelectedEmployeeId('');
      }

    } catch (error) {
      console.error('Error sending emails:', error);
      toast.error('Failed to send emails', { id: toastId });
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 animate-spin text-green-500" />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="p-6 border-b border-gray-200 bg-gray-50/50">
        <h2 className="text-xl font-bold text-gray-900">Compose Email</h2>
        <p className="text-sm text-gray-500 mt-1">Send communication to employees</p>
      </div>

      <div className="p-6 space-y-8">
        {/* Controls Bar */}
        <div className="flex flex-col space-y-6 lg:flex-row lg:space-y-0 lg:items-center lg:justify-between bg-gray-50/50 p-4 rounded-2xl border border-gray-100/50">

          <div className="flex flex-wrap items-center gap-6">
            {/* Provider Selection */}
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-wider font-bold text-gray-400 ml-1">Email Provider</label>
              <div className="flex items-center space-x-1 bg-white p-1 rounded-xl border border-gray-200 shadow-sm">
                <button
                  onClick={() => setProvider('resend')}
                  className={`px-4 py-2 text-xs font-bold rounded-lg transition-all duration-200 ${provider === 'resend'
                    ? 'bg-[#03c04a] text-white shadow-md'
                    : 'text-gray-500 hover:bg-gray-50'
                    }`}
                >
                  Resend API
                </button>
                <button
                  onClick={() => setProvider('cpanel')}
                  className={`px-4 py-2 text-xs font-bold rounded-lg transition-all duration-200 ${provider === 'cpanel'
                    ? 'bg-[#03c04a] text-white shadow-md'
                    : 'text-gray-500 hover:bg-gray-50'
                    }`}
                >
                  cPanel (SMTP)
                </button>
              </div>
            </div>

            {/* Recipient Mode Selection */}
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-wider font-bold text-gray-400 ml-1">Recipient Type</label>
              <div className="flex items-center space-x-1 bg-white p-1 rounded-xl border border-gray-200 shadow-sm">
                <button
                  onClick={() => { setMode('single'); setSelectedEmployeeId(''); }}
                  className={`px-4 py-2 text-xs font-bold rounded-lg transition-all duration-200 ${mode === 'single'
                    ? 'bg-[#03c04a] text-white shadow-md'
                    : 'text-gray-500 hover:bg-gray-50'
                    }`}
                >
                  Single Employee
                </button>
                <button
                  onClick={() => { setMode('bulk'); setSelectedBranch('all'); setSelectedDepartment('all'); }}
                  className={`px-4 py-2 text-xs font-bold rounded-lg transition-all duration-200 ${mode === 'bulk'
                    ? 'bg-[#03c04a] text-white shadow-md'
                    : 'text-gray-500 hover:bg-gray-50'
                    }`}
                >
                  Bulk / Groups
                </button>
              </div>
            </div>
          </div>

          {/* Conditional cPanel Settings */}
          <AnimatePresence>
            {provider === 'cpanel' && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="flex flex-col space-y-2"
              >
                <label className="text-[10px] uppercase tracking-wider font-bold text-gray-400 ml-1">cPanel Configuration</label>
                <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-xl border border-gray-200 shadow-sm border-l-4 border-l-[#03c04a]">
                  <input
                    type="text"
                    placeholder="Username/Email"
                    className="text-xs font-medium border-none p-0 focus:ring-0 w-40 placeholder:text-gray-300"
                    value={cpanelUser}
                    onChange={(e) => setCpanelUser(e.target.value)}
                  />
                  <div className="w-px h-4 bg-gray-200" />
                  <span className="text-[10px] text-gray-400 font-medium">Auth User</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Dynamic Selection Controls */}
        <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
          {mode === 'single' ? (
            <div className="w-full max-w-md">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Select Employee</label>
              <SearchableDropdown
                options={employees.map(e => ({
                  label: `${e['First Name']} ${e['Last Name']} (${e['Work Email']})`,
                  value: e['Employee Number']
                }))}
                value={selectedEmployeeId}
                onChange={setSelectedEmployeeId}
                placeholder="Search employee..."
                icon={User}
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Filter by Branch</label>
                <SearchableDropdown
                  options={['all', ...branches].map(b => ({ label: b === 'all' ? 'All Branches' : b, value: b }))}
                  value={selectedBranch}
                  onChange={setSelectedBranch}
                  placeholder="All Branches"
                  icon={Users}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Filter by Department</label>
                <SearchableDropdown
                  options={['all', ...departments].map(d => ({ label: d === 'all' ? 'All Departments' : d, value: d }))}
                  value={selectedDepartment}
                  onChange={setSelectedDepartment}
                  placeholder="All Departments"
                  icon={Filter}
                />
              </div>
            </div>
          )}

          {/* Recipient Count Summary */}
          <div className="mt-4 flex items-center text-sm text-gray-600 bg-white p-3 rounded-lg border border-gray-200">
            <Users className="w-4 h-4 mr-2 text-green-600" />
            <span>
              Will send to <span className="font-bold text-gray-900">{recipients.length}</span> recipient{recipients.length !== 1 ? 's' : ''}.
            </span>
            {recipients.length > 0 && mode === 'single' && (
              <span className="ml-2 text-gray-500">
                ({recipients[0]['Work Email']})
              </span>
            )}
          </div>
        </div>

        {/* Subject */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
          <input
            type="text"
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-colors"
            placeholder="Enter email subject..."
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>

        {/* Body */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Message Body</label>
          <div className="relative">
            <textarea
              className="w-full h-64 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-colors resize-y font-sans"
              placeholder="Type your message here... (Simple HTML is supported)"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            ></textarea>
            <div className="absolute bottom-3 right-3 text-xs text-gray-400 pointer-events-none">
              HTML Supported
            </div>
          </div>
        </div>

        {/* Attachments */}
        <div>

          <div className="flex items-center space-x-2">
            <label className="cursor-pointer inline-flex items-center px-4 py-2 border border-green-200 shadow-sm text-sm font-medium rounded-lg text-green-700 bg-green-50 hover:bg-green-100 transition-colors focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-green-500">
              <Paperclip className="w-4 h-4 mr-2 text-green-600" />
              <span>Attach Files</span>
              <input
                type="file"
                multiple
                onChange={handleFileChange}
                className="sr-only"
              />
            </label>
            <span className="text-xs text-gray-500 italic">
              Max 5MB per file
            </span>
          </div>
          {attachments.length > 0 && (
            <div className="mt-2 space-y-1">
              {attachments.map((att, index) => (
                <div key={index} className="flex items-center text-xs text-gray-600">
                  <Check className="w-3 h-3 text-green-500 mr-1" />
                  {att.filename} ({(att.content.length * 0.75 / 1024).toFixed(2)} KB)
                  <button
                    onClick={() => setAttachments(prev => prev.filter((_, i) => i !== index))}
                    className="ml-2 text-red-500 hover:text-red-700"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        {/* Actions */}
        <div className="flex items-center justify-end pt-4 border-t border-gray-100">
          <button
            onClick={handleSend}
            disabled={sending || recipients.length === 0 || !subject || !body}
            className={`inline-flex items-center px-4 py-2 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white transition-all duration-200 
              ${sending || recipients.length === 0 || !subject || !body
                ? 'bg-gray-300 cursor-not-allowed'
                : 'bg-gray-900 hover:bg-gray-800 hover:shadow-md'
              }`}
          >
            {sending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                Send Email
              </>
            )}
          </button>
        </div>
      </div>
    </div>

  );
}
