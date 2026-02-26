import { useState, useEffect } from 'react';
import { supabase, supabaseAdmin } from '../lib/supabase';
import toast from 'react-hot-toast';
import { sendEmail } from '../services/email';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

export function useStaffSignupLogic() {
    const [requests, setRequests] = useState<any[]>([]);
    const [allBranches, setAllBranches] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [processingId, setProcessingId] = useState(null);
    const [selectedBranch, setSelectedBranch] = useState('all');
    const [currentPage, setCurrentPage] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedRequests, setSelectedRequests] = useState(new Set());
    const [bulkProcessing, setBulkProcessing] = useState(false);
    const [checkingExistingUsers, setCheckingExistingUsers] = useState(false);
    const [existingUsersCache, setExistingUsersCache] = useState(new Map());
    const [showBulkUpload, setShowBulkUpload] = useState(false);
    const [bulkEmails, setBulkEmails] = useState('');
    const [bulkBranch, setBulkBranch] = useState('');
    const [uploadingBulk, setUploadingBulk] = useState(false);
    const [emailLogs, setEmailLogs] = useState(new Map());
    const [checkingBounces, setCheckingBounces] = useState(false);
    const [uploadMethod, setUploadMethod] = useState('excel');
    const [excelFile, setExcelFile] = useState(null);
    const [parsedData, setParsedData] = useState<any[]>([]);
    const [parsingExcel, setParsingExcel] = useState(false);
    const [webhookEnabled, setWebhookEnabled] = useState(true);
    const [webhookStats, setWebhookStats] = useState({
        total: 0,
        bounced: 0,
        delivered: 0,
        sent: 0,
        lastUpdate: null
    });
    const [filterBounced, setFilterBounced] = useState(false);
    const [activeTab, setActiveTab] = useState<'requests' | 'emails'>('requests');

    const itemsPerPage = 100;

    useEffect(() => {
        fetchRequests();
        fetchBranches();
        setupRealtimeSubscription();
    }, [currentPage, selectedBranch]);

    // Set up real-time subscription for email logs
    const setupRealtimeSubscription = () => {
        const subscription = supabase
            .channel('email_logs_changes')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'email_logs',
                },
                (payload) => {
                    console.log('Real-time email log update:', payload);

                    // Update local email logs state
                    const newData = payload.new as any;
                    const updatedLogs = new Map(emailLogs);
                    const rawSentTo = newData ? (newData.sent_to || newData.email) : null;

                    if (rawSentTo) {
                        const emailKey = rawSentTo.toLowerCase();

                        updatedLogs.set(emailKey, {
                            ...payload.new,
                            request_id: payload.new.request_id ? payload.new.request_id.toString() : null,
                            message_id: payload.new.message_id || payload.new.resend_id
                        });

                        setEmailLogs(updatedLogs);
                        updateWebhookStats(updatedLogs);

                        // Show notification for new bounces
                        if (payload.new.status === 'bounced' && payload.eventType === 'UPDATE') {
                            toast.error(`Email bounced for ${rawSentTo}: ${payload.new.bounce_reason || 'Unknown reason'}`, {
                                duration: 6000,
                                icon: '🚫'
                            });

                            // Refresh requests to update UI
                            fetchRequests();
                        }

                        // Show notification for deliveries
                        if (payload.new.status === 'delivered' && payload.eventType === 'UPDATE') {
                            toast.success(`Email delivered to ${rawSentTo}`, {
                                duration: 3000,
                                icon: '✅'
                            });
                        }
                    }
                }
            )
            .subscribe();

        return () => {
            subscription.unsubscribe();
        };
    };

    // Update webhook statistics
    const updateWebhookStats = (logsMap = emailLogs) => {
        const logsArray = Array.from(logsMap.values());
        setWebhookStats({
            total: logsArray.length,
            bounced: logsArray.filter(log => log.status === 'bounced').length,
            delivered: logsArray.filter(log => log.status === 'delivered').length,
            sent: logsArray.filter(log => log.status === 'sent').length,
            lastUpdate: new Date() as any
        });
    };

    // Fetch email logs for bounce detection
    const fetchEmailLogs = async () => {
        try {
            const { data, error } = await supabase
                .from('email_logs')
                .select('*')
                .order('sent_at', { ascending: false });

            if (error) throw error;

            const logsMap = new Map();
            data.forEach(log => {
                const emailKey = (log.sent_to || log.email || '').toLowerCase();
                if (emailKey) {
                    logsMap.set(emailKey, {
                        ...log,
                        request_id: log.request_id ? log.request_id.toString() : null,
                        message_id: log.message_id || log.resend_id
                    });
                }
            });
            setEmailLogs(logsMap);
            updateWebhookStats(logsMap);
        } catch (error) {
            console.error('Error fetching email logs:', error);
        }
    };

    const fetchBranches = async () => {
        try {
            const { data, error } = await supabase
                .from('staff_signup_requests')
                .select('branch')
                .eq('status', 'pending');

            if (error) throw error;

            const uniqueBranches = [...new Set(data
                .map(item => item.branch)
                .filter(branch => branch != null && branch.trim() !== '')
            )].sort();
            setAllBranches(uniqueBranches);
        } catch (error) {
            console.error('Fetch branches error:', error);
        }
    };

    const fetchRequests = async () => {
        setLoading(true);
        try {
            let query = supabase
                .from('staff_signup_requests')
                .select('*', { count: 'exact' })
                .eq('status', 'pending');

            if (selectedBranch !== 'all') {
                query = query.eq('branch', selectedBranch);
            }

            const from = (currentPage - 1) * itemsPerPage;
            const to = from + itemsPerPage - 1;

            const { data, error, count } = await query
                .order('created_at', { ascending: true })
                .range(from, to);

            if (error) throw error;

            const requestsWithStringIds = (data || []).map(request => ({
                ...request,
                id: request.id.toString()
            }));

            setRequests(requestsWithStringIds);
            setTotalCount(count || 0);
            setSelectedRequests(new Set());

            await fetchEmailLogs();
        } catch (error) {
            console.error('Fetch error:', error);
            toast.error('Failed to fetch signup requests');
        } finally {
            setLoading(false);
        }
    };

    // Track email sends in database
    const trackEmailSend = async (email: any, subject: any, requestId: any = null, resendId: any = null) => {
        try {
            const requestIdBigInt = requestId ? parseInt(requestId, 10) : null;
            const client = supabaseAdmin || supabase;

            const { data, error } = await client
                .from('email_logs')
                .insert([
                    {
                        sent_to: email,
                        subject: subject,
                        request_id: requestIdBigInt,
                        message_id: resendId,
                        status: 'sent',
                        sent_at: new Date().toISOString()
                    }
                ])
                .select();

            if (error) throw error;

            if (data && data.length > 0) {
                const newLog = data[0];
                const updatedLogs = new Map(emailLogs);
                updatedLogs.set(email.toLowerCase(), {
                    ...newLog,
                    request_id: newLog.request_id ? newLog.request_id.toString() : null
                });
                setEmailLogs(updatedLogs);
                updateWebhookStats(updatedLogs);
            }

            return data;
        } catch (error) {
            console.error('Error tracking email:', error);
        }
    };

    // Update email status when bounce is detected
    const updateEmailStatus = async (email: any, status: any, bounceReason: any = null) => {
        try {
            const { data, error } = await supabase
                .from('email_logs')
                .update({
                    status: status,
                    bounce_reason: bounceReason,
                    bounced_at: status === 'bounced' ? new Date().toISOString() : null
                })
                .eq('sent_to', email)
                .order('sent_at', { ascending: false })
                .limit(1)
                .select();

            if (error) throw error;

            if (data && data.length > 0) {
                const updatedLog = data[0];
                const updatedLogs = new Map(emailLogs);
                updatedLogs.set(email.toLowerCase(), {
                    ...updatedLog,
                    request_id: updatedLog.request_id ? updatedLog.request_id.toString() : null
                });
                setEmailLogs(updatedLogs);
                updateWebhookStats(updatedLogs);
            }

            return data;
        } catch (error) {
            console.error('Error updating email status:', error);
        }
    };

    // Get all auth users with pagination
    const getAllAuthUsers = async () => {
        if (!supabaseAdmin) {
            console.error('Supabase Admin client not initialized. Check VITE_SUPABASE_SERVICE_ROLE_KEY.');
            return [];
        }
        let allUsers = [];
        let page = 1;
        const perPage = 1000;
        let hasMore = true;

        try {
            while (hasMore) {
                const { data: users, error } = await supabaseAdmin.auth.admin.listUsers({
                    page: page,
                    perPage: perPage
                });

                if (error) {
                    console.error('Error fetching auth users page', page, error);
                    break;
                }

                if (users && users.users.length > 0) {
                    allUsers = [...allUsers, ...users.users];
                    page++;

                    if (users.users.length < perPage) {
                        hasMore = false;
                    }
                } else {
                    hasMore = false;
                }
            }

            console.log(`Fetched ${allUsers.length} total auth users`);
            return allUsers;
        } catch (error) {
            console.error('Error in getAllAuthUsers:', error);
            return [];
        }
    };

    // Check if user exists and return user data
    const checkExistingUser = async (email) => {
        try {
            let allAuthUsers;
            if (existingUsersCache.size > 0) {
                allAuthUsers = Array.from(existingUsersCache.values());
            } else {
                allAuthUsers = await getAllAuthUsers();
                const newCache = new Map();
                allAuthUsers.forEach(user => {
                    if (user.email) {
                        newCache.set(user.email.toLowerCase(), user);
                    }
                });
                setExistingUsersCache(newCache);
            }

            const normalizedEmail = email.toLowerCase();
            const existingAuthUser = allAuthUsers.find(user =>
                user.email && user.email.toLowerCase() === normalizedEmail
            );

            if (existingAuthUser) {
                return {
                    exists: true,
                    type: 'auth',
                    user: existingAuthUser,
                    message: 'User already has an auth account'
                };
            }

            return {
                exists: false,
                type: null,
                user: null,
                message: 'User does not exist in system'
            };
        } catch (error) {
            console.error('Error checking existing user:', error);
            return {
                exists: false,
                type: 'error',
                user: null,
                message: 'Error checking user existence'
            };
        }
    };

    // Check all pending requests for existing users
    const checkAllExistingUsers = async () => {
        setCheckingExistingUsers(true);
        try {
            setExistingUsersCache(new Map());

            const results = [];
            let foundCount = 0;

            const allAuthUsers = await getAllAuthUsers();
            const authUserEmails = new Set(
                allAuthUsers
                    .filter(user => user.email)
                    .map(user => user.email.toLowerCase())
            );

            for (const request of requests) {
                const normalizedEmail = request.email.toLowerCase();
                const exists = authUserEmails.has(normalizedEmail);
                const existingUser = allAuthUsers.find(user =>
                    user.email && user.email.toLowerCase() === normalizedEmail
                );

                results.push({
                    ...request,
                    existingUser: {
                        exists,
                        type: exists ? 'auth' : null,
                        user: existingUser || null,
                        message: exists ? 'User already has an auth account' : 'User does not exist in system'
                    }
                });

                if (exists) {
                    foundCount++;
                }
            }

            setRequests(results);

            if (foundCount > 0) {
                toast.success(`Found ${foundCount} users already in the system`);
            } else {
                toast.success('No existing users found in the system');
            }
        } catch (error) {
            console.error('Error checking all users:', error);
            toast.error('Failed to check for existing users');
        } finally {
            setCheckingExistingUsers(false);
        }
    };

    // Webhook-based status check
    const checkWebhookStatus = async () => {
        setCheckingBounces(true);
        try {
            await fetchEmailLogs();
            await fetchRequests();

            const bounceCount = webhookStats.bounced;

            if (bounceCount > 0) {
                toast(`Webhooks detected ${bounceCount} bounced emails`, { icon: 'ℹ️' });
            } else {
                toast.success('No bounced emails detected via webhooks');
            }
        } catch (error) {
            console.error('Error checking webhook status:', error);
            toast.error('Failed to check email status');
        } finally {
            setCheckingBounces(false);
        }
    };

    const generateRandomPassword = () => {
        const lowercase = 'abcdefghijklmnopqrstuvwxyz';
        const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const numbers = '0123456789';
        const symbols = '!@#$%&*';
        const allChars = lowercase + uppercase + numbers + symbols;

        let password = '';

        password += lowercase[Math.floor(Math.random() * lowercase.length)];
        password += uppercase[Math.floor(Math.random() * uppercase.length)];
        password += numbers[Math.floor(Math.random() * numbers.length)];
        password += symbols[Math.floor(Math.random() * symbols.length)];

        for (let i = 4; i < 12; i++) {
            password += allChars[Math.floor(Math.random() * allChars.length)];
        }

        return password.split('').sort(() => 0.5 - Math.random()).join('');
    };

    const sendWelcomeEmail = async (email, tempPassword, branch, isResend = false, requestId = null) => {
        const subject = isResend
            ? `Your Zira HR Login Credentials - Resent`
            : `Welcome to Zira HR - Staff Account Approved`;

        try {
            const htmlContent = isResend ? `
        <div style="font-family: 'Avenir Next', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #2563eb; text-align: center;">Your Zira HR Login Credentials</h2>
          <p style="font-size: 16px;">Your login credentials have been resent as requested.</p>
          
          <div style="background-color: #fef3cd; padding: 16px; border-radius: 8px; margin: 16px 0; border-left: 4px solid #f59e0b;">
            <p style="font-weight: bold; margin-bottom: 8px; color: #92400e;">Your login credentials:</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Temporary Password:</strong> ${tempPassword}</p>
          </div>
          
          <p style="font-size: 14px; color: #64748b;">Please log in and change your password immediately for security reasons.</p>
          <p style="font-size: 14px;"><strong>Assigned Branch:</strong> ${branch}</p>
          
          <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b;">
            <p>If you didn't request these credentials, please contact our support team immediately.</p>
          </div>
        </div>
      ` : `
        <div style="font-family: 'Avenir Next', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #2563eb; text-align: center;">Welcome to Zira HR!</h2>
          <p style="font-size: 16px;">Your staff account has been approved by the administrator.</p>
          
          <div style="background-color: #f8fafc; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <p style="font-weight: bold; margin-bottom: 8px;">Your login credentials:</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Temporary Password:</strong> ${tempPassword}</p>
          </div>
          
          <p style="font-size: 14px; color: #64748b;">Please log in and change your password immediately for security reasons.</p>
          <p style="font-size: 14px;"><strong>Assigned Branch:</strong> ${branch}</p>
          
          <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b;">
            <p>If you didn't request this account, please contact our support team immediately.</p>
          </div>
        </div>
      `;

            const result = await sendEmail({
                to: email,
                subject: subject,
                html: htmlContent
            });

            await trackEmailSend(
                email,
                subject,
                requestId,
                result.id || null
            );

            return result;
        } catch (error) {
            console.error('Email sending error:', error);
            await trackEmailSend(email, subject, requestId, null);
            throw error;
        }
    };

    const handleProcessRequest = async (requestId, email, branch) => {
        if (!supabaseAdmin) {
            toast.error('Admin actions not available (Missing Service Role Key)');
            return;
        }
        setProcessingId(requestId);
        const tempPassword = generateRandomPassword();

        try {
            const existingUserCheck = await checkExistingUser(email);

            if (existingUserCheck.exists) {
                const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
                    existingUserCheck.user.id,
                    {
                        password: tempPassword,
                        user_metadata: {
                            ...existingUserCheck.user.user_metadata,
                            role: 'STAFF',
                            branch: branch || 'Main Branch',
                            updated_at: new Date().toISOString()
                        }
                    }
                );

                if (updateError) throw updateError;

                const { error: deleteError } = await supabase
                    .from('staff_signup_requests')
                    .delete()
                    .eq('id', parseInt(requestId, 10));

                if (deleteError) throw deleteError;

                await sendWelcomeEmail(email, tempPassword, branch || 'Main Branch', true, requestId);
                toast.success(`Credentials updated and resent to ${email}`);

            } else {
                const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
                    email,
                    password: tempPassword,
                    email_confirm: true,
                    user_metadata: {
                        role: 'STAFF',
                        branch: branch || 'Main Branch'
                    }
                });

                if (userError) {
                    if (userError.message.includes('already registered') || userError.status === 422) {
                        toast.error(`User ${email} was just created by another process. Please try again.`);
                        return;
                    }
                    throw userError;
                }

                const { error: deleteError } = await supabase
                    .from('staff_signup_requests')
                    .delete()
                    .eq('id', parseInt(requestId, 10));

                if (deleteError) throw deleteError;

                await sendWelcomeEmail(email, tempPassword, branch || 'Main Branch', false, requestId);
                toast.success(`Account created! Welcome email sent to ${email}`);
            }

            fetchRequests();
            fetchBranches();
            setExistingUsersCache(new Map());

        } catch (error: any) {
            console.error('Process request error:', error);
            toast.error(`Failed to process request: ${error.message || 'Unknown error'}`);
        } finally {
            setProcessingId(null);
        }
    };



    const handleBulkProcess = async () => {
        if (!supabaseAdmin) {
            toast.error('Admin actions not available (Missing Service Role Key)');
            return;
        }
        if (selectedRequests.size === 0) {
            toast.error('Please select at least one request to process');
            return;
        }

        setBulkProcessing(true);
        let successCount = 0;
        let errorCount = 0;
        let updatedExistingCount = 0;
        let createdNewCount = 0;

        try {
            const allAuthUsers = await getAllAuthUsers();
            const authUserMap = new Map();
            allAuthUsers.forEach(user => {
                if (user.email) {
                    authUserMap.set(user.email.toLowerCase(), user);
                }
            });

            const requestsToProcess = requests.filter(req => selectedRequests.has(req.id));

            for (const request of requestsToProcess) {
                try {
                    const tempPassword = generateRandomPassword();
                    const normalizedEmail = request.email.toLowerCase();
                    const existingUser = authUserMap.get(normalizedEmail);

                    if (existingUser) {
                        const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
                            existingUser.id,
                            {
                                password: tempPassword,
                                user_metadata: {
                                    ...existingUser.user_metadata,
                                    role: 'STAFF',
                                    branch: request.branch || 'Main Branch',
                                    updated_at: new Date().toISOString()
                                }
                            }
                        );

                        if (updateError) throw updateError;
                        updatedExistingCount++;
                    } else {
                        const { error: userError } = await supabaseAdmin.auth.admin.createUser({
                            email: request.email,
                            password: tempPassword,
                            email_confirm: true,
                            user_metadata: {
                                role: 'STAFF',
                                branch: request.branch || 'Main Branch'
                            }
                        });

                        if (userError) {
                            if (userError.message.includes('already registered') || userError.status === 422) {
                                continue;
                            }
                            throw userError;
                        }
                        createdNewCount++;
                    }

                    const { error: deleteError } = await supabase
                        .from('staff_signup_requests')
                        .delete()
                        .eq('id', parseInt(request.id, 10));

                    if (deleteError) throw deleteError;

                    await sendWelcomeEmail(request.email, tempPassword, request.branch || 'Main Branch', !!existingUser, request.id);
                    successCount++;
                } catch (error) {
                    console.error(`Failed to process request ${request.id}:`, error);
                    errorCount++;
                }
            }

            let message = `Successfully processed ${successCount} request(s)`;
            if (createdNewCount > 0) {
                message += ` - ${createdNewCount} new accounts created`;
            }
            if (updatedExistingCount > 0) {
                message += ` - ${updatedExistingCount} existing accounts updated`;
            }

            toast.success(message);

            if (errorCount > 0) {
                toast.error(`Failed to process ${errorCount} request(s)`);
            }

            fetchRequests();
            fetchBranches();
            setSelectedRequests(new Set());
            setExistingUsersCache(new Map());
        } catch (error) {
            console.error('Bulk process error:', error);
            toast.error('Bulk process failed');
        } finally {
            setBulkProcessing(false);
        }
    };

    // Download Excel template
    const downloadExcelTemplate = () => {
        const templateData = [
            {
                'Email': 'john.doe@company.com',
                'Branch': 'Main Branch',
                'Notes': 'HR Manager'
            },
            {
                'Email': 'jane.smith@company.com',
                'Branch': 'New York Office',
                'Notes': 'Sales Executive'
            },
            {
                'Email': 'mike.wilson@company.com',
                'Branch': 'London Office',
                'Notes': 'IT Support'
            }
        ];

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(templateData);

        const colWidths = [
            { wch: 25 },
            { wch: 20 },
            { wch: 30 }
        ];
        ws['!cols'] = colWidths;

        const instructionsData = [
            ['Instructions for Bulk Upload:'],
            [''],
            ['1. Fill in the "Staff Emails" sheet with staff information'],
            ['2. Required columns: Email, Branch'],
            ['3. Optional column: Notes (for internal reference)'],
            ['4. Save the file and upload it using the form'],
            ['5. All emails will be created as pending signup requests'],
            [''],
            ['Column Descriptions:'],
            ['- Email: Staff email address (required)'],
            ['- Branch: Assigned branch/department (required)'],
            ['- Notes: Any additional information (optional)'],
            [''],
            ['Example:'],
            ['Email', 'Branch', 'Notes'],
            ['john.doe@company.com', 'Main Branch', 'HR Manager'],
            ['jane.smith@company.com', 'New York Office', 'Sales Executive']
        ];

        const wsInstructions = XLSX.utils.aoa_to_sheet(instructionsData);
        const instructionColWidths = [
            { wch: 50 }
        ];
        wsInstructions['!cols'] = instructionColWidths;

        XLSX.utils.book_append_sheet(wb, ws, 'Staff Emails');
        XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions');

        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([wbout], { type: 'application/octet-stream' });
        saveAs(blob, 'staff_bulk_upload_template.xlsx');
    };

    // Parse Excel file
    const parseExcelFile = (file) => {
        setParsingExcel(true);
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });

                const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet);

                const validatedData = jsonData
                    .map((row, index) => {
                        const email = row['Email'] || row['email'];
                        const branch = row['Branch'] || row['branch'] || bulkBranch;

                        if (!email) {
                            console.warn(`Row ${index + 2}: Missing email address`);
                            return null;
                        }

                        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                        if (!emailRegex.test(email)) {
                            console.warn(`Row ${index + 2}: Invalid email format - ${email}`);
                            return null;
                        }

                        return {
                            email: email.trim(),
                            branch: branch ? branch.trim() : bulkBranch,
                            notes: row['Notes'] || row['notes'] || ''
                        };
                    })
                    .filter(row => row !== null);

                setParsedData(validatedData);
                setExcelFile(file);

                if (validatedData.length === 0) {
                    toast.error('No valid email addresses found in the Excel file');
                } else {
                    toast.success(`Found ${validatedData.length} valid staff records`);
                }
            } catch (error) {
                console.error('Error parsing Excel file:', error);
                toast.error('Error reading Excel file. Please check the format.');
            } finally {
                setParsingExcel(false);
            }
        };

        reader.onerror = () => {
            toast.error('Error reading file');
            setParsingExcel(false);
        };

        reader.readAsArrayBuffer(file);
    };

    // Handle Excel file upload
    const handleExcelUpload = (event) => {
        const file = event.target.files[0];
        if (!file) return;

        if (!file.name.match(/\.(xlsx|xls)$/)) {
            toast.error('Please upload a valid Excel file (.xlsx or .xls)');
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            toast.error('File size must be less than 5MB');
            return;
        }

        parseExcelFile(file);
    };

    // Handle bulk upload from Excel
    const handleBulkUploadFromExcel = async () => {
        if (parsedData.length === 0) {
            toast.error('No valid data to upload');
            return;
        }

        if (!bulkBranch.trim() && parsedData.some(item => !item.branch)) {
            toast.error('Please set a default branch or ensure all records have a branch');
            return;
        }

        setUploadingBulk(true);

        try {
            let successCount = 0;
            let duplicateCount = 0;
            let errorCount = 0;

            const { data: existingRequests, error: fetchError } = await supabase
                .from('staff_signup_requests')
                .select('email')
                .eq('status', 'pending');

            if (fetchError) throw fetchError;

            const existingEmails = new Set(
                (existingRequests || []).map(req => req.email.toLowerCase())
            );

            for (const record of parsedData) {
                try {
                    const finalBranch = record.branch || bulkBranch;

                    if (existingEmails.has(record.email.toLowerCase())) {
                        duplicateCount++;
                        continue;
                    }

                    const { error: insertError } = await supabase
                        .from('staff_signup_requests')
                        .insert([
                            {
                                email: record.email,
                                branch: finalBranch,
                                status: 'pending',
                                created_at: new Date().toISOString()
                            }
                        ]);

                    if (insertError) {
                        if (insertError.code === '23505') {
                            duplicateCount++;
                        } else {
                            throw insertError;
                        }
                    } else {
                        successCount++;
                    }
                } catch (error) {
                    console.error(`Error adding email ${record.email}:`, error);
                    errorCount++;
                }
            }

            let message = `Successfully added ${successCount} staff records`;
            if (duplicateCount > 0) {
                message += ` - ${duplicateCount} duplicates skipped`;
            }
            if (errorCount > 0) {
                message += ` - ${errorCount} errors`;
            }

            toast.success(message);

            setExcelFile(null);
            setParsedData([]);
            setShowBulkUpload(false);
            fetchRequests();
            fetchBranches();

        } catch (error) {
            console.error('Bulk upload error:', error);
            toast.error('Failed to upload staff records');
        } finally {
            setUploadingBulk(false);
        }
    };

    // Handle manual bulk upload
    const handleManualBulkUpload = async () => {
        if (!bulkEmails.trim()) {
            toast.error('Please enter at least one email address');
            return;
        }

        if (!bulkBranch.trim()) {
            toast.error('Please select a branch for the users');
            return;
        }

        setUploadingBulk(true);

        try {
            const emailList = bulkEmails
                .split(/[\n,;]+/)
                .map(email => email.trim())
                .filter(email => {
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    return email && emailRegex.test(email);
                });

            if (emailList.length === 0) {
                toast.error('No valid email addresses found');
                return;
            }

            let successCount = 0;
            let duplicateCount = 0;
            let errorCount = 0;

            const { data: existingRequests, error: fetchError } = await supabase
                .from('staff_signup_requests')
                .select('email')
                .eq('status', 'pending');

            if (fetchError) throw fetchError;

            const existingEmails = new Set(
                (existingRequests || []).map(req => req.email.toLowerCase())
            );

            for (const email of emailList) {
                try {
                    if (existingEmails.has(email.toLowerCase())) {
                        duplicateCount++;
                        continue;
                    }

                    const { error: insertError } = await supabase
                        .from('staff_signup_requests')
                        .insert([
                            {
                                email: email,
                                branch: bulkBranch,
                                status: 'pending',
                                created_at: new Date().toISOString()
                            }
                        ]);

                    if (insertError) {
                        if (insertError.code === '23505') {
                            duplicateCount++;
                        } else {
                            throw insertError;
                        }
                    } else {
                        successCount++;
                    }
                } catch (error) {
                    console.error(`Error adding email ${email}:`, error);
                    errorCount++;
                }
            }

            let message = `Successfully added ${successCount} signup request(s)`;
            if (duplicateCount > 0) {
                message += ` - ${duplicateCount} duplicates skipped`;
            }
            if (errorCount > 0) {
                message += ` - ${errorCount} errors`;
            }

            toast.success(message);

            setBulkEmails('');
            setShowBulkUpload(false);
            fetchRequests();
            fetchBranches();

        } catch (error) {
            console.error('Bulk upload error:', error);
            toast.error('Failed to upload emails');
        } finally {
            setUploadingBulk(false);
        }
    };

    // Get email status for a specific request
    const getEmailStatus = (email) => {
        const log = emailLogs.get(email.toLowerCase());
        if (!log) return null;

        return {
            status: log.status,
            bounceReason: log.bounce_reason,
            sentAt: log.sent_at,
            bouncedAt: log.bounced_at,
            lastWebhookEvent: log.last_webhook_event,
            webhookReceivedAt: log.webhook_received_at
        };
    };

    // Get status badge color
    const getStatusBadgeColor = (status) => {
        switch (status) {
            case 'bounced': return 'bg-red-100 text-red-800 border border-red-200';
            case 'delivered': return 'bg-green-100 text-green-800 border border-green-200';
            case 'sent': return 'bg-blue-100 text-blue-800 border border-blue-200';
            default: return 'bg-gray-100 text-gray-800 border border-gray-200';
        }
    };

    const handleReject = async (requestId, email) => {
        setProcessingId(requestId);
        try {
            const { error } = await supabase
                .from('staff_signup_requests')
                .delete()
                .eq('id', parseInt(requestId, 10));

            if (error) throw error;

            toast.success(`Request from ${email} has been rejected`);
            fetchRequests();
            fetchBranches();
        } catch (error) {
            console.error('Rejection error:', error);
            toast.error('Failed to reject request');
        } finally {
            setProcessingId(null);
        }
    };

    const handleBranchSelect = (branch) => {
        setSelectedBranch(branch);
        setCurrentPage(1);
        setIsDropdownOpen(false);
        setSearchTerm('');
    };

    const filteredBranches = allBranches.filter(branch =>
        branch && branch.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const toggleRequestSelection = (requestId) => {
        const newSelected = new Set(selectedRequests);
        if (newSelected.has(requestId)) {
            newSelected.delete(requestId);
        } else {
            newSelected.add(requestId);
        }
        setSelectedRequests(newSelected);
    };

    const toggleSelectAll = () => {
        if (selectedRequests.size === requests.length) {
            setSelectedRequests(new Set());
        } else {
            setSelectedRequests(new Set(requests.map(req => req.id)));
        }
    };

    const totalPages = Math.ceil(totalCount / itemsPerPage);

    const handlePreviousPage = () => {
        if (currentPage > 1) {
            setCurrentPage(currentPage - 1);
        }
    };

    const handleNextPage = () => {
        if (currentPage < totalPages) {
            setCurrentPage(currentPage + 1);
        }
    };

    const getSelectedBranchLabel = () => {
        if (selectedBranch === 'all') return 'All Branches';
        return selectedBranch;
    };

    const getBranchDisplayName = (branch) => {
        return branch || 'No Branch Assigned';
    };

    // Filter requests based on bounce filter
    const filteredRequests = filterBounced
        ? requests.filter(request => getEmailStatus(request.email)?.status === 'bounced')
        : requests;

    return {
        requests,
        allBranches,
        loading,
        processingId,
        selectedBranch,
        currentPage,
        totalCount,
        isDropdownOpen,
        searchTerm,
        selectedRequests,
        bulkProcessing,
        checkingExistingUsers,
        showBulkUpload,
        bulkEmails,
        bulkBranch,
        uploadingBulk,
        emailLogs,
        checkingBounces,
        uploadMethod,
        excelFile,
        parsedData,
        parsingExcel,
        webhookEnabled,
        webhookStats,
        filterBounced,
        activeTab,
        itemsPerPage,
        totalPages,
        filteredRequests,
        filteredBranches,

        // Setters (if needed directly)
        setSelectedBranch,
        setCurrentPage,
        setIsDropdownOpen,
        setSearchTerm,
        setShowBulkUpload,
        setBulkEmails,
        setBulkBranch,
        setUploadMethod,
        setFilterBounced,
        setActiveTab,
        setExcelFile,
        setParsedData,

        // Handlers
        checkWebhookStatus,
        updateWebhookStats,
        fetchEmailLogs,
        fetchBranches,
        fetchRequests,
        trackEmailSend,
        updateEmailStatus,
        checkExistingUser,
        checkAllExistingUsers,
        generateRandomPassword,
        sendWelcomeEmail,
        handleProcessRequest,
        handleBulkProcess,
        downloadExcelTemplate,
        parseExcelFile,
        handleExcelUpload,
        handleBulkUploadFromExcel,
        handleManualBulkUpload,
        getEmailStatus,
        getStatusBadgeColor,
        handleReject,
        handleBranchSelect,
        toggleRequestSelection,
        toggleSelectAll,
        handlePreviousPage,
        handleNextPage,
        getSelectedBranchLabel,
        getBranchDisplayName
    };

}
