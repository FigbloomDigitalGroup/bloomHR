import React, { useState, useEffect } from 'react';
import {
    Search, RefreshCw, Filter, ArrowUpRight,
    CheckCircle, XCircle, Clock, MoreHorizontal,
    Copy, Smartphone, Calendar, DollarSign,
    ChevronLeft, ChevronRight, Activity, ArrowDownLeft
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';

// --- Types ---
interface MpesaLog {
    id: number;
    transaction_id: string;
    originator_conversation_id: string;
    result_code: number;
    result_desc: string;
    amount: number;
    receipt_number?: string;
    phone_number?: string;
    employee_id?: string; // We added this!
    callback_date: string;
    status: 'Completed' | 'Pending' | 'Failed' | 'Processing';
    raw_response?: string;
    // Join fields
    employees?: {
        "First Name": string;
        "Last Name": string;
        "Employee Number": string;
        "Profile Image"?: string;
    };
}

const MpesaCallbacks: React.FC = () => {
    const [logs, setLogs] = useState<MpesaLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [selectedLog, setSelectedLog] = useState<MpesaLog | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;

    // --- Fetch Data ---
    const fetchLogs = async () => {
        try {
            setLoading(true);
            // Query mpesa_callbacks and join with employees
            // Note: This relies on a foreign key or manual join. 
            // Since we store employee_id as string, we might need to do a manual fetch or setup FK.
            // For now, let's fetch callbacks first.

            const { data, error } = await supabase
                .from('mpesa_callbacks')
                .select('*')
                .order('callback_date', { ascending: false })
                .limit(100);

            if (error) throw error;

            // Manually fetch employee details if needed (or assume FK works)
            // Optimally we'd do: .select('*, employees!inner(First Name, Last Name)') but schema might vary.
            // Let's do a quick enrichment if employee_id exists
            const enrichedData = await Promise.all(data.map(async (log) => {
                if (log.employee_id) {
                    const { data: emp } = await supabase
                        .from('employees')
                        .select('"First Name", "Last Name", "Profile Image"')
                        .eq('Employee Number', log.employee_id)
                        .single();
                    if (emp) return { ...log, employees: emp };
                }
                return log;
            }));

            setLogs(enrichedData as MpesaLog[]);
        } catch (err) {
            console.error('Error fetching logs:', err);
            toast.error('Failed to refresh logs');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLogs();

        // Auto-refresh interval
        let interval: any;
        if (autoRefresh) {
            interval = setInterval(fetchLogs, 5000);
        }
        return () => clearInterval(interval);
    }, [autoRefresh]);

    // --- Stats ---
    const stats = {
        total: logs.length,
        success: logs.filter(l => l.result_code === 0).length,
        failed: logs.filter(l => l.result_code !== 0 && l.status !== 'Pending').length,
        pending: logs.filter(l => l.status === 'Pending').length,
        totalAmount: logs.filter(l => l.result_code === 0).reduce((sum, l) => sum + (l.amount || 0), 0)
    };

    // --- Filtering ---
    const filteredLogs = logs.filter(log => {
        const matchesSearch =
            log.transaction_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            log.receipt_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            log.employee_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (log.employees && `${log.employees["First Name"]} ${log.employees["Last Name"]}`.toLowerCase().includes(searchTerm.toLowerCase()));

        const matchesStatus = statusFilter === 'all' ||
            (statusFilter === 'success' && log.result_code === 0) ||
            (statusFilter === 'failed' && log.result_code !== 0 && log.status !== 'Pending') ||
            (statusFilter === 'pending' && log.status === 'Pending');

        return matchesSearch && matchesStatus;
    });

    // --- Pagination ---
    const totalPages = Math.ceil(filteredLogs.length / itemsPerPage);
    const currentLogs = filteredLogs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    // --- Helpers ---
    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        toast.success('Copied to clipboard');
    };

    const getStatusColor = (log: MpesaLog) => {
        if (log.status === 'Pending') return 'bg-yellow-100 text-yellow-700 border-yellow-200';
        if (log.result_code === 0) return 'bg-emerald-100 text-emerald-700 border-emerald-200';
        return 'bg-red-100 text-red-700 border-red-200';
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(amount);
    };

    return (
        <div className="space-y-6">
            {/* Header & Stats Section */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {/* Main Title Card */}
                <div className="md:col-span-1 bg-gradient-to-br from-green-600 to-emerald-700 rounded-2xl p-6 text-white shadow-lg relative overflow-hidden">
                    <div className="relative z-10">
                        <h2 className="text-xl font-bold mb-1">M-Pesa Live</h2>
                        <p className="text-green-100 text-xs mb-4">Real-time Transaction Stream</p>
                        <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${autoRefresh ? 'bg-green-300 animate-pulse' : 'bg-gray-400'}`}></span>
                            <span className="text-xs font-medium">{autoRefresh ? 'Live Updates On' : 'Live Updates Off'}</span>
                        </div>

                        <button
                            onClick={() => setAutoRefresh(!autoRefresh)}
                            className="mt-4 px-3 py-1.5 bg-white/20 hover:bg-white/30 backdrop-blur-sm rounded-lg text-xs font-medium transition-colors"
                        >
                            {autoRefresh ? 'Pause Stream' : 'Enable Stream'}
                        </button>
                    </div>
                    <Activity className="absolute -bottom-4 -right-4 w-32 h-32 text-white/10" />
                </div>

                {/* Stats Cards */}
                <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-gray-500 text-xs font-medium uppercase">Success Rate</span>
                        <span className="p-1.5 bg-green-50 rounded-lg"><CheckCircle className="w-4 h-4 text-green-600" /></span>
                    </div>
                    <div className="text-2xl font-bold text-gray-900">
                        {stats.total > 0 ? Math.round((stats.success / stats.total) * 100) : 0}%
                    </div>
                    <div className="text-xs text-green-600 flex items-center gap-1 mt-1">
                        <ArrowUpRight className="w-3 h-3" /> +2.4% <span className="text-gray-400 font-normal">this week</span>
                    </div>
                </div>

                <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-gray-500 text-xs font-medium uppercase">Total Volume</span>
                        <span className="p-1.5 bg-blue-50 rounded-lg"><DollarSign className="w-4 h-4 text-blue-600" /></span>
                    </div>
                    <div className="text-2xl font-bold text-gray-900">
                        {formatCurrency(stats.totalAmount)}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                        Across {stats.success} transactions
                    </div>
                </div>

                <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm flex flex-col justify-between">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-gray-500 text-xs font-medium uppercase">Failed/Pending</span>
                        <span className="p-1.5 bg-orange-50 rounded-lg"><AlertTriangle className="w-4 h-4 text-orange-600" /></span>
                    </div>
                    <div className="text-2xl font-bold text-gray-900">
                        {stats.failed} <span className="text-sm font-normal text-gray-400">/ {stats.pending}</span>
                    </div>
                    <div className="text-xs text-orange-600 mt-1">
                        Requires attention
                    </div>
                </div>
            </div>

            {/* Main Table Section */}
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">

                {/* Toolkit Toolbar */}
                <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search by Transaction ID, Receipt, or Employee..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 bg-gray-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-green-500/20 text-gray-700 placeholder-gray-400 transition-all"
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="flex items-center bg-gray-50 rounded-lg p-1">
                            {['all', 'success', 'pending', 'failed'].map(status => (
                                <button
                                    key={status}
                                    onClick={() => setStatusFilter(status)}
                                    className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-all ${statusFilter === status ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                                >
                                    {status}
                                </button>
                            ))}
                        </div>
                        <button
                            onClick={() => fetchLogs()}
                            className="p-2 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                            title="Refresh Data"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                </div>

                {/* Table */}
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="bg-gray-50/50 text-left">
                                <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Transaction</th>
                                <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Employee</th>
                                <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Amount</th>
                                <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                                <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Time</th>
                                <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            <AnimatePresence>
                                {currentLogs.map((log) => (
                                    <motion.tr
                                        key={log.id}
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0 }}
                                        className="hover:bg-gray-50/80 transition-colors group cursor-pointer"
                                        onClick={() => setSelectedLog(log)}
                                    >
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col">
                                                <span className="text-sm font-medium text-gray-900 font-mono flex items-center gap-2">
                                                    {(() => {
                                                        const isGenericId = log.transaction_id === 'UAT1000000';
                                                        let displayId = log.transaction_id || '---';

                                                        if (isGenericId && log.raw_response) {
                                                            try {
                                                                const raw = JSON.parse(log.raw_response);
                                                                // Handle both structure variations (Result root or direct)
                                                                const resultObj = raw.Result || raw;
                                                                const params = resultObj?.ResultParameters?.ResultParameter;

                                                                if (Array.isArray(params)) {
                                                                    const receiptParam = params.find((p: any) => p.Key === 'ReceiptNo');
                                                                    if (receiptParam?.Value) {
                                                                        displayId = receiptParam.Value;
                                                                    }
                                                                }
                                                            } catch (e) {
                                                                // fallback to generic ID if parsing fails
                                                            }
                                                        }
                                                        return (
                                                            <>
                                                                {displayId}
                                                                <Copy
                                                                    className="w-3 h-3 text-gray-300 hover:text-gray-600 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                                                                    onClick={(e) => { e.stopPropagation(); copyToClipboard(displayId); }}
                                                                />
                                                            </>
                                                        );
                                                    })()}
                                                </span>
                                                <span className="text-xs text-gray-500 font-mono mt-0.5">{log.originator_conversation_id}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            {log.employees ? (
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-700 text-xs font-bold">
                                                        {log.employees["First Name"][0]}{log.employees["Last Name"][0]}
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <span className="text-sm font-medium text-gray-900">{log.employees["First Name"]} {log.employees["Last Name"]}</span>
                                                        <span className="text-xs text-gray-500">{log.employees["Employee Number"]}</span>
                                                    </div>
                                                </div>
                                            ) : (
                                                <span className="text-sm text-gray-400 italic">Unknown Employee</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="text-sm font-bold text-gray-900">{formatCurrency(log.amount)}</span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${getStatusColor(log)}`}>
                                                {log.status === 'Pending' && <Clock className="w-3 h-3 animate-pulse" />}
                                                {log.result_code === 0 && <CheckCircle className="w-3 h-3" />}
                                                {log.result_code !== 0 && log.status !== 'Pending' && <XCircle className="w-3 h-3" />}
                                                {log.result_desc || log.status}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col">
                                                <span className="text-sm text-gray-900">{new Date(log.callback_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                <span className="text-xs text-gray-500">{new Date(log.callback_date).toLocaleDateString()}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <button className="text-gray-400 hover:text-gray-600">
                                                <MoreHorizontal className="w-5 h-5" />
                                            </button>
                                        </td>
                                    </motion.tr>
                                ))}
                            </AnimatePresence>

                            {filteredLogs.length === 0 && !loading && (
                                <tr>
                                    <td colSpan={6} className="px-6 py-12 text-center">
                                        <div className="flex flex-col items-center justify-center text-gray-400">
                                            <Search className="w-12 h-12 mb-3 text-gray-200" />
                                            <p className="text-sm font-medium text-gray-500">No logs found matching your filters</p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination Footer */}
                <div className="border-t border-gray-100 p-4 flex items-center justify-between bg-gray-50/30">
                    <p className="text-xs text-gray-500">
                        Showing <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-medium">{Math.min(currentPage * itemsPerPage, filteredLogs.length)}</span> of <span className="font-medium">{filteredLogs.length}</span> results
                    </p>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                            className="p-1.5 rounded-lg hover:bg-white border border-transparent hover:border-gray-200 text-gray-500 disabled:opacity-30 transition-all"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                            disabled={currentPage === totalPages}
                            className="p-1.5 rounded-lg hover:bg-white border border-transparent hover:border-gray-200 text-gray-500 disabled:opacity-30 transition-all"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Details Modal */}
            {selectedLog && (
                <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <motion.div
                        initial={{ scale: 0.95, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
                    >
                        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                            <div>
                                <h3 className="text-lg font-bold text-gray-900">Transaction Details</h3>
                                <p className="text-xs text-gray-500 font-mono mt-1">{selectedLog.originator_conversation_id}</p>
                            </div>
                            <button
                                onClick={() => setSelectedLog(null)}
                                className="p-2 bg-white rounded-full hover:bg-gray-100 transition-colors"
                            >
                                <ArrowDownLeft className="w-5 h-5 text-gray-500 rotate-45" />
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-4 rounded-xl bg-gray-50 border border-gray-100">
                                    <span className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Status</span>
                                    <div className={`mt-2 inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-bold ${getStatusColor(selectedLog)}`}>
                                        {selectedLog.result_desc}
                                    </div>
                                </div>
                                <div className="p-4 rounded-xl bg-gray-50 border border-gray-100">
                                    <span className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Amount</span>
                                    <div className="mt-1 text-xl font-bold text-gray-900">{formatCurrency(selectedLog.amount)}</div>
                                </div>
                            </div>

                            <div>
                                <h4 className="text-sm font-bold text-gray-900 mb-3">Raw M-Pesa Response</h4>
                                <div className="bg-slate-900 rounded-xl p-4 overflow-x-auto">
                                    <pre className="text-xs text-green-400 font-mono">
                                        {JSON.stringify(JSON.parse(selectedLog.raw_response || '{}'), null, 2)}
                                    </pre>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </div>
    );
}; // End Component

// Lucide Icon Component (Mock for AlertTriangle if needed, but imported above)
import { AlertTriangle } from 'lucide-react';

export default MpesaCallbacks;
