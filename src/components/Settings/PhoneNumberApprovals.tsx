import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
    MessageSquare,
    ChevronLeft,
    ChevronRight,
    ArrowUpRight,
    Building,
    MapPin,
    ShieldCheck,
    X,
    CheckCircle,
    Zap
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
    branch?: string;
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
        let filtered = requests;
        if (statusFilter !== 'all') {
            filtered = filtered.filter(req => req.status === statusFilter);
        }
        if (searchTerm) {
            filtered = filtered.filter(req =>
                req.employee_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                req.employee_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
                req.requested_phone.includes(searchTerm)
            );
        }
        setFilteredRequests(filtered);
    }, [requests, searchTerm, statusFilter]);

    const fetchRequests = async () => {
        try {
            setIsLoading(true);
            const { data: requestsData, error: requestsError } = await supabase
                .from('phone_number_change_requests')
                .select('*')
                .order('requested_at', { ascending: false });

            if (requestsError) throw requestsError;

            const requestsWithEmployeeData = await Promise.all(
                (requestsData || []).map(async (request) => {
                    const { data: employeeData } = await supabase
                        .from('employees')
                        .select('"First Name", "Last Name", "Work Email", "Branch"')
                        .eq('"Employee Number"', request.employee_number)
                        .single();

                    return {
                        ...request,
                        employee_name: employeeData
                            ? `${employeeData['First Name']} ${employeeData['Last Name']}`
                            : 'Unknown',
                        employee_email: employeeData?.['Work Email'] || '',
                        branch: employeeData?.Branch || 'Mular Central'
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

    const approveRequest = async (requestId: string) => {
        setIsProcessing(true);
        try {
            const request = requests.find(r => r.id === requestId);
            if (!request) return;

            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Not authenticated');

            const { data: adminData } = await supabase
                .from('employees')
                .select('"First Name", "Last Name"')
                .eq('"Work Email"', user.email)
                .single();

            const adminName = adminData ? `${adminData['First Name']} ${adminData['Last Name']}` : user.email;

            const { error: updateError } = await supabase
                .from('employees')
                .update({ 'Mobile Number': request.requested_phone })
                .eq('"Employee Number"', request.employee_number);

            if (updateError) throw updateError;

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

            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Not authenticated');

            const { data: adminData } = await supabase
                .from('employees')
                .select('"First Name", "Last Name"')
                .eq('"Work Email"', user.email)
                .single();

            const adminName = adminData ? `${adminData['First Name']} ${adminData['Last Name']}` : user.email;

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
            toast.error('Failed to reject request');
        } finally {
            setIsProcessing(false);
        }
    };

    const notifyEmployee = async (employeeNumber: string, status: string, message: string) => {
        try {
            await supabase.from('notifications').insert({
                employee_number: employeeNumber,
                type: `phone_change_${status}`,
                title: `Phone Number Change ${status.toUpperCase()}`,
                message,
                priority: 'high',
                is_read: false,
                created_at: new Date().toISOString()
            });
        } catch (error) {
            console.error('Error sending notification:', error);
        }
    };

    const getStatusStyles = (status: string) => {
        switch (status) {
            case 'approved': return 'bg-emerald-50 text-emerald-700 border-emerald-100';
            case 'rejected': return 'bg-red-50 text-red-700 border-red-100';
            default: return 'bg-amber-50 text-amber-700 border-amber-100';
        }
    };

    return (
        <div className="space-y-8 pb-12">
            {/* Premium Header Card */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="md:col-span-1 bg-gradient-to-br from-indigo-600 to-indigo-800 rounded-[2.5rem] p-8 text-white shadow-xl shadow-indigo-100 relative overflow-hidden group"
                >
                    <div className="relative z-10 space-y-6">
                        <div className="space-y-1">
                            <h2 className="text-2xl font-black tracking-tight italic uppercase">Identity Node</h2>
                            <p className="text-indigo-100 text-[10px] font-black uppercase tracking-[0.2em] opacity-80">Phone Authentication Registry</p>
                        </div>

                        <div className="flex items-center gap-3">
                            <div className="p-3 bg-white/10 rounded-2xl backdrop-blur-md">
                                <ShieldCheck className="w-5 h-5 text-indigo-300" />
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-100">Auth Gatekeeper</span>
                        </div>

                        <div className="flex flex-col gap-2 pt-4">
                            <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest border-b border-white/10 pb-2">
                                <span>Pending Requests</span>
                                <span className="text-emerald-400">{requests.filter(r => r.status === 'pending').length}</span>
                            </div>
                            <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-white/50 pt-2">
                                <span>Total Audits</span>
                                <span>{requests.length}</span>
                            </div>
                        </div>
                    </div>
                    <Phone className="absolute -bottom-10 -right-10 w-48 h-48 text-white/5" />
                </motion.div>

                {/* Sub Header Content */}
                <div className="lg:col-span-3 bg-white rounded-[2.5rem] border border-gray-100 shadow-sm p-8 flex flex-col justify-center">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
                        <div className="space-y-4 max-w-xl">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                                    <Zap className="w-4 h-4" />
                                </div>
                                <h3 className="text-lg font-black text-gray-900 uppercase italic">Verification Protocol</h3>
                            </div>
                            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest leading-loose">
                                Ensure all phone number changes are verified against physical employee records. Approved changes will immediately update the M-Pesa disbursement endpoint for the target node.
                            </p>
                        </div>

                        <div className="flex items-center bg-gray-50 p-1.5 rounded-2xl border border-gray-100">
                            {(['all', 'pending', 'approved', 'rejected'] as const).map(f => (
                                <button
                                    key={f}
                                    onClick={() => setStatusFilter(f)}
                                    className={`px-5 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${statusFilter === f ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'text-gray-400 hover:text-indigo-600'
                                        }`}
                                >
                                    {f}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content Section */}
            <div className="bg-white rounded-[3rem] border border-gray-100 shadow-sm overflow-hidden min-h-[500px]">
                <div className="p-8 border-b border-gray-50 flex items-center justify-between bg-gray-50/50">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="SEARCH BY NODE PK..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-14 pr-6 py-4 bg-white border border-gray-100 rounded-[2rem] text-[10px] font-black uppercase tracking-widest focus:ring-4 focus:ring-indigo-100 transition-all font-mono shadow-sm"
                        />
                    </div>

                    <button onClick={fetchRequests} className="p-4 bg-white border border-gray-100 rounded-2xl text-gray-400 hover:text-indigo-600 transition-all shadow-sm">
                        <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                    </button>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="bg-gray-50/80 text-left">
                                <th className="px-10 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">Employee Context</th>
                                <th className="px-10 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Protocol Delta</th>
                                <th className="px-10 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">Request Status</th>
                                <th className="px-10 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Audit Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {filteredRequests.map((request) => (
                                <tr key={request.id} className="hover:bg-indigo-50/30 transition-all group">
                                    <td className="px-10 py-8">
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-black shadow-lg shadow-indigo-100">
                                                {request.employee_name?.split(' ').map(n => n[0]).join('')}
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-sm font-black text-gray-900 uppercase tracking-widest group-hover:text-indigo-600 transition-colors">
                                                    {request.employee_name}
                                                </span>
                                                <div className="flex items-center gap-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                                                    <span className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600 font-mono">{request.employee_number}</span>
                                                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {request.branch}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-10 py-8">
                                        <div className="flex items-center justify-center gap-4 text-xs font-black">
                                            <span className="text-gray-400 line-through font-mono uppercase tracking-widest">{request.current_phone || 'NULL_NODE'}</span>
                                            <ArrowUpRight className="w-4 h-4 text-indigo-400" />
                                            <span className="text-emerald-600 font-mono uppercase tracking-widest">{request.requested_phone}</span>
                                        </div>
                                    </td>
                                    <td className="px-10 py-8">
                                        <div className="flex flex-col items-start gap-2">
                                            <span className={`inline-flex px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest border border-transparent shadow-sm ${getStatusStyles(request.status)}`}>
                                                {request.status}
                                            </span>
                                            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter">
                                                {new Date(request.requested_at).toLocaleDateString()} NODE_INTAKE
                                            </p>
                                        </div>
                                    </td>
                                    <td className="px-10 py-8 text-right">
                                        {request.status === 'pending' ? (
                                            <motion.button
                                                whileHover={{ scale: 1.05 }}
                                                whileTap={{ scale: 0.95 }}
                                                onClick={() => setSelectedRequest(request)}
                                                className="px-6 py-3 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-[0.2em] shadow-xl shadow-indigo-100 transition-all"
                                            >
                                                Audit Req
                                            </motion.button>
                                        ) : (
                                            <div className="flex flex-col items-end opacity-50">
                                                <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Reviewed By</span>
                                                <span className="text-[10px] font-black text-gray-900 uppercase">{request.reviewed_by || 'SYSTEM_NODE'}</span>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {filteredRequests.length === 0 && (
                        <div className="p-24 flex flex-col items-center justify-center space-y-4">
                            <div className="w-20 h-20 bg-gray-50 rounded-[2rem] flex items-center justify-center border border-gray-100">
                                <ShieldCheck className="w-10 h-10 text-gray-300" />
                            </div>
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Registry Clear. No pending identities.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Review Modal */}
            <AnimatePresence>
                {selectedRequest && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 border border-white/20">
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelectedRequest(null)} className="absolute inset-0 bg-gray-900/60 backdrop-blur-md" />

                        <motion.div
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.9, opacity: 0, y: 20 }}
                            className="bg-white rounded-[3rem] shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col relative z-10 border border-white/20"
                        >
                            <div className="p-10 border-b border-gray-50 flex items-center justify-between bg-gray-50/50">
                                <div className="space-y-1">
                                    <h3 className="text-2xl font-black text-gray-900 tracking-tight uppercase italic">Audit Identities</h3>
                                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Manual Identity Verification</p>
                                </div>
                                <motion.button whileHover={{ rotate: 90 }} onClick={() => setSelectedRequest(null)} className="p-4 bg-white text-gray-400 hover:text-red-500 rounded-2xl shadow-sm border border-gray-100 transition-colors">
                                    <X className="w-6 h-6" />
                                </motion.button>
                            </div>

                            <div className="p-10 space-y-8">
                                <div className="grid grid-cols-2 gap-6">
                                    <div className="p-6 bg-gray-50 rounded-[2rem] border border-gray-100">
                                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Origin Node</p>
                                        <p className="text-sm font-black text-gray-900 uppercase font-mono">{selectedRequest.current_phone || 'NULL_NODE'}</p>
                                    </div>
                                    <div className="p-6 bg-emerald-50 rounded-[2rem] border border-emerald-100">
                                        <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-3">Target Node</p>
                                        <p className="text-sm font-black text-emerald-700 uppercase font-mono">{selectedRequest.requested_phone}</p>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Applicant Justification</label>
                                    <div className="p-8 bg-gray-900 rounded-[2.5rem] text-indigo-100 text-[11px] font-bold uppercase tracking-widest leading-loose">
                                        {selectedRequest.reason || 'NO_JUSTIFICATION_PROVIDED'}
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Admin Auditor Remarks</label>
                                    <textarea
                                        value={adminNotes}
                                        onChange={(e) => setAdminNotes(e.target.value)}
                                        rows={3}
                                        className="w-full p-8 bg-gray-50 border-none rounded-[2.5rem] text-sm font-bold tracking-tight focus:ring-4 focus:ring-indigo-100 transition-all resize-none shadow-inner"
                                        placeholder="PROVIDE AUDIT RATIONALE..."
                                    />
                                </div>
                            </div>

                            <div className="p-10 bg-gray-50 border-t border-gray-100 flex gap-4">
                                <button
                                    onClick={() => rejectRequest(selectedRequest.id)}
                                    disabled={isProcessing}
                                    className="flex-1 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-red-500 hover:text-red-700 bg-white border border-red-100 rounded-[2rem] transition-all flex items-center justify-center gap-2"
                                >
                                    {isProcessing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                                    Revoke
                                </button>
                                <button
                                    onClick={() => approveRequest(selectedRequest.id)}
                                    disabled={isProcessing}
                                    className="flex-[2] py-5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-[2rem] text-[10px] font-black uppercase tracking-[0.2em] shadow-xl shadow-indigo-100 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                                >
                                    {isProcessing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-5 h-5" />}
                                    Validate Node
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default PhoneNumberApprovals;
