import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
    Phone,
    CheckCircle2,
    XCircle,
    Clock,
    Search,
    Filter,
    AlertCircle,
    User,
    Calendar,
    MessageSquare
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

interface PhoneChangeRequest {
    id: string;
    employee_number: string;
    current_phone: string | null;
    requested_phone: string;
    reason: string | null;
    status: 'pending' | 'approved' | 'rejected';
    requested_at: string;
    reviewed_at: string | null;
    reviewed_by: string | null;
    admin_notes: string | null;
    employee_name?: string;
    employee_email?: string;
}

const PhoneNumberApprovals = () => {
    const [requests, setRequests] = useState<PhoneChangeRequest[]>([]);
    const [filteredRequests, setFilteredRequests] = useState<PhoneChangeRequest[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
    const [selectedRequest, setSelectedRequest] = useState<PhoneChangeRequest | null>(null);
    const [adminNotes, setAdminNotes] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);

    useEffect(() => {
        fetchRequests();
    }, []);

    useEffect(() => {
        filterRequests();
    }, [requests, searchTerm, statusFilter]);

    const fetchRequests = async () => {
        try {
            setIsLoading(true);

            // Fetch requests with employee details
            const { data: requestsData, error: requestsError } = await supabase
                .from('phone_number_change_requests')
                .select('*')
                .order('requested_at', { ascending: false });

            if (requestsError) throw requestsError;

            // Fetch employee details for each request
            const requestsWithEmployeeData = await Promise.all(
                (requestsData || []).map(async (request) => {
                    const { data: employeeData } = await supabase
                        .from('employees')
                        .select('"First Name", "Last Name", "Work Email"')
                        .eq('"Employee Number"', request.employee_number)
                        .single();

                    return {
                        ...request,
                        employee_name: employeeData
                            ? `${employeeData['First Name']} ${employeeData['Last Name']}`
                            : 'Unknown',
                        employee_email: employeeData?.['Work Email'] || ''
                    };
                })
            );

            setRequests(requestsWithEmployeeData);
        } catch (error) {
            console.error('Error fetching requests:', error);
            toast.error('Failed to load phone number change requests');
        } finally {
            setIsLoading(false);
        }
    };

    const filterRequests = () => {
        let filtered = requests;

        // Filter by status
        if (statusFilter !== 'all') {
            filtered = filtered.filter(req => req.status === statusFilter);
        }

        // Filter by search term
        if (searchTerm) {
            filtered = filtered.filter(req =>
                req.employee_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                req.employee_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
                req.requested_phone.includes(searchTerm)
            );
        }

        setFilteredRequests(filtered);
    };

    const approveRequest = async (requestId: string) => {
        setIsProcessing(true);
        try {
            const request = requests.find(r => r.id === requestId);
            if (!request) return;

            // Get current admin user
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Not authenticated');

            const { data: adminData } = await supabase
                .from('employees')
                .select('"First Name", "Last Name"')
                .eq('"Work Email"', user.email)
                .single();

            const adminName = adminData
                ? `${adminData['First Name']} ${adminData['Last Name']}`
                : user.email;

            // Update the employee's phone number
            const { error: updateError } = await supabase
                .from('employees')
                .update({ 'Mobile Number': request.requested_phone })
                .eq('"Employee Number"', request.employee_number);

            if (updateError) throw updateError;

            // Update the request status
            const { error: requestError } = await supabase
                .from('phone_number_change_requests')
                .update({
                    status: 'approved',
                    reviewed_at: new Date().toISOString(),
                    reviewed_by: adminName,
                    admin_notes: adminNotes || null
                })
                .eq('id', requestId);

            if (requestError) throw requestError;

            // Send notification to employee
            await notifyEmployee(
                request.employee_number,
                'approved',
                `Your phone number change request has been approved. Your new number is ${request.requested_phone}.`
            );

            toast.success('Phone number change request approved');
            setSelectedRequest(null);
            setAdminNotes('');
            await fetchRequests();
        } catch (error) {
            console.error('Error approving request:', error);
            toast.error('Failed to approve request');
        } finally {
            setIsProcessing(false);
        }
    };

    const rejectRequest = async (requestId: string) => {
        if (!adminNotes.trim()) {
            toast.error('Please provide a reason for rejection');
            return;
        }

        setIsProcessing(true);
        try {
            const request = requests.find(r => r.id === requestId);
            if (!request) return;

            // Get current admin user
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Not authenticated');

            const { data: adminData } = await supabase
                .from('employees')
                .select('"First Name", "Last Name"')
                .eq('"Work Email"', user.email)
                .single();

            const adminName = adminData
                ? `${adminData['First Name']} ${adminData['Last Name']}`
                : user.email;

            // Update the request status
            const { error: requestError } = await supabase
                .from('phone_number_change_requests')
                .update({
                    status: 'rejected',
                    reviewed_at: new Date().toISOString(),
                    reviewed_by: adminName,
                    admin_notes: adminNotes
                })
                .eq('id', requestId);

            if (requestError) throw requestError;

            // Send notification to employee
            await notifyEmployee(
                request.employee_number,
                'rejected',
                `Your phone number change request has been rejected. Reason: ${adminNotes}`
            );

            toast.success('Phone number change request rejected');
            setSelectedRequest(null);
            setAdminNotes('');
            await fetchRequests();
        } catch (error) {
            console.error('Error rejecting request:', error);
            toast.error('Failed to reject request');
        } finally {
            setIsProcessing(false);
        }
    };

    const notifyEmployee = async (employeeNumber: string, status: string, message: string) => {
        try {
            await supabase
                .from('notifications')
                .insert({
                    employee_number: employeeNumber,
                    type: `phone_change_${status}`,
                    title: `Phone Number Change ${status === 'approved' ? 'Approved' : 'Rejected'}`,
                    message,
                    priority: 'high',
                    is_read: false,
                    created_at: new Date().toISOString()
                });
        } catch (error) {
            console.error('Error sending notification:', error);
        }
    };

    const getStatusBadge = (status: string) => {
        const styles = {
            pending: 'bg-yellow-100 text-yellow-800 border-yellow-300',
            approved: 'bg-green-100 text-green-800 border-green-300',
            rejected: 'bg-red-100 text-red-800 border-red-300'
        };

        const icons = {
            pending: Clock,
            approved: CheckCircle2,
            rejected: XCircle
        };

        const Icon = icons[status as keyof typeof icons];

        return (
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[status as keyof typeof styles]}`}>
                <Icon className="w-3 h-3 mr-1" />
                {status.charAt(0).toUpperCase() + status.slice(1)}
            </span>
        );
    };

    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
            </div>
        );
    }

    return (
        <div className="p-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                {/* Header */}
                <div className="p-6 border-b border-gray-200">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h2 className="text-xl font-semibold text-gray-900">Phone Number Change Requests</h2>
                            <p className="text-sm text-gray-600 mt-1">Review and approve staff phone number updates</p>
                        </div>
                        <div className="flex items-center space-x-2 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
                            <AlertCircle className="h-3 w-3" />
                            <span>{filteredRequests.filter(r => r.status === 'pending').length} Pending</span>
                        </div>
                    </div>

                    {/* Filters */}
                    <div className="flex flex-col sm:flex-row gap-4">
                        <div className="flex-1 relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Search by name, employee number, or phone..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                            />
                        </div>
                        <div className="flex items-center space-x-2">
                            <Filter className="h-4 w-4 text-gray-400" />
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value as any)}
                                className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                            >
                                <option value="all">All Status</option>
                                <option value="pending">Pending</option>
                                <option value="approved">Approved</option>
                                <option value="rejected">Rejected</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Requests List */}
                <div className="divide-y divide-gray-200">
                    {filteredRequests.length === 0 ? (
                        <div className="p-12 text-center">
                            <Phone className="mx-auto h-12 w-12 text-gray-400" />
                            <h3 className="mt-2 text-sm font-medium text-gray-900">No requests found</h3>
                            <p className="mt-1 text-sm text-gray-500">
                                {statusFilter === 'pending'
                                    ? 'There are no pending phone number change requests.'
                                    : 'Try adjusting your filters.'}
                            </p>
                        </div>
                    ) : (
                        filteredRequests.map((request) => (
                            <motion.div
                                key={request.id}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="p-6 hover:bg-gray-50 transition-colors"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                        <div className="flex items-center space-x-3 mb-2">
                                            <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center">
                                                <User className="h-5 w-5 text-green-600" />
                                            </div>
                                            <div>
                                                <h3 className="text-sm font-medium text-gray-900">{request.employee_name}</h3>
                                                <p className="text-xs text-gray-500">{request.employee_number}</p>
                                            </div>
                                            {getStatusBadge(request.status)}
                                        </div>

                                        <div className="ml-13 space-y-2">
                                            <div className="flex items-center text-sm">
                                                <span className="text-gray-600 w-32">Current Phone:</span>
                                                <span className="font-medium text-gray-900">{request.current_phone || 'Not set'}</span>
                                            </div>
                                            <div className="flex items-center text-sm">
                                                <span className="text-gray-600 w-32">Requested Phone:</span>
                                                <span className="font-medium text-green-600">{request.requested_phone}</span>
                                            </div>
                                            {request.reason && (
                                                <div className="flex items-start text-sm">
                                                    <span className="text-gray-600 w-32">Reason:</span>
                                                    <span className="text-gray-900">{request.reason}</span>
                                                </div>
                                            )}
                                            <div className="flex items-center text-xs text-gray-500">
                                                <Calendar className="h-3 w-3 mr-1" />
                                                Requested {new Date(request.requested_at).toLocaleString()}
                                            </div>
                                            {request.reviewed_at && (
                                                <div className="flex items-start text-xs text-gray-500">
                                                    <span className="w-32">Reviewed by {request.reviewed_by}</span>
                                                    <span>{new Date(request.reviewed_at).toLocaleString()}</span>
                                                </div>
                                            )}
                                            {request.admin_notes && (
                                                <div className="flex items-start text-sm">
                                                    <MessageSquare className="h-4 w-4 mr-2 text-gray-400 mt-0.5" />
                                                    <span className="text-gray-600 italic">{request.admin_notes}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {request.status === 'pending' && (
                                        <div className="ml-4 flex flex-col space-y-2">
                                            <button
                                                onClick={() => setSelectedRequest(request)}
                                                className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
                                            >
                                                Review
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        ))
                    )}
                </div>
            </div>

            {/* Review Modal */}
            {selectedRequest && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6"
                    >
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">Review Phone Number Change</h3>

                        <div className="space-y-4 mb-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Employee</label>
                                <p className="text-sm text-gray-900">{selectedRequest.employee_name} ({selectedRequest.employee_number})</p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Current Phone</label>
                                <p className="text-sm text-gray-900">{selectedRequest.current_phone || 'Not set'}</p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Requested Phone</label>
                                <p className="text-sm font-medium text-green-600">{selectedRequest.requested_phone}</p>
                            </div>
                            {selectedRequest.reason && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                                    <p className="text-sm text-gray-900">{selectedRequest.reason}</p>
                                </div>
                            )}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Admin Notes (Optional)</label>
                                <textarea
                                    value={adminNotes}
                                    onChange={(e) => setAdminNotes(e.target.value)}
                                    rows={3}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                                    placeholder="Add notes about this decision..."
                                />
                            </div>
                        </div>

                        <div className="flex space-x-3">
                            <button
                                onClick={() => {
                                    setSelectedRequest(null);
                                    setAdminNotes('');
                                }}
                                disabled={isProcessing}
                                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => rejectRequest(selectedRequest.id)}
                                disabled={isProcessing}
                                className="flex-1 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center"
                            >
                                {isProcessing ? (
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                ) : (
                                    <>
                                        <XCircle className="h-4 w-4 mr-2" />
                                        Reject
                                    </>
                                )}
                            </button>
                            <button
                                onClick={() => approveRequest(selectedRequest.id)}
                                disabled={isProcessing}
                                className="flex-1 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center justify-center"
                            >
                                {isProcessing ? (
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                ) : (
                                    <>
                                        <CheckCircle2 className="h-4 w-4 mr-2" />
                                        Approve
                                    </>
                                )}
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </div>
    );
};

export default PhoneNumberApprovals;
