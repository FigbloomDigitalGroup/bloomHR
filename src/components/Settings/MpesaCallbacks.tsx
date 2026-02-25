import React, { useState, useEffect } from 'react';
import {
    Search, RefreshCw, CheckCircle, XCircle, Clock,
    Copy, ChevronLeft, ChevronRight, Activity,
    Banknote, Zap, X
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
    callback_date: string;
    status: 'Completed' | 'Pending' | 'Failed' | 'Processing';
    raw_response?: string;
    employees?: {
        "First Name": string;
        "Last Name": string;
        "Employee Number": string;
    };
}

const getStatusColor = (log: MpesaLog) => {
    if (log.status === 'Pending') return 'bg-amber-50 text-amber-700 border-amber-100';
    if (log.result_code === 0) return 'bg-emerald-50 text-emerald-700 border-emerald-100';
    return 'bg-red-50 text-red-700 border-red-100';
};

const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-KE', {
        style: 'currency',
        currency: 'KES',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(amount);
};

const MpesaCallbacks: React.FC = () => {
    const [logs, setLogs] = useState<MpesaLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [selectedLog, setSelectedLog] = useState<MpesaLog | null>(null);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 15;

    const fetchLogs = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('mpesa_callbacks')
                .select(`
                    *,
                    employees!inner (
                        "First Name",
                        "Last Name",
                        "Employee Number"
                    )
                `)
                .order('callback_date', { ascending: false });

            if (error) throw error;
            setLogs(data || []);
        } catch (error) {
            console.error('Error fetching logs:', error);
            toast.error('Failed to fetch M-Pesa logs');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLogs();
        let interval: NodeJS.Timeout;
        if (autoRefresh) {
            interval = setInterval(fetchLogs, 10000);
        }
        return () => clearInterval(interval);
    }, [autoRefresh]);

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        toast.success('Copied to clipboard');
    };

    const filteredLogs = logs.filter(log => {
        const searchStr = `${log.transaction_id} ${log.receipt_number} ${log.originator_conversation_id} ${log.employees?.["Employee Number"]} ${log.employees?.["First Name"]} ${log.employees?.["Last Name"]}`.toLowerCase();
        const matchesSearch = searchStr.includes(searchTerm.toLowerCase());
        const matchesStatus = statusFilter === 'all' ||
            (statusFilter === 'success' && log.result_code === 0) ||
            (statusFilter === 'pending' && log.status === 'Pending') ||
            (statusFilter === 'failed' && log.result_code !== 0 && log.status !== 'Pending');

        return matchesSearch && matchesStatus;
    });

    const stats = {
        total: logs.length,
        success: logs.filter(l => l.result_code === 0).length,
        failed: logs.filter(l => l.result_code !== 0 && l.status !== 'Pending').length,
        pending: logs.filter(l => l.status === 'Pending').length,
        totalAmount: logs.filter(l => l.result_code === 0).reduce((acc, curr) => acc + (curr.amount || 0), 0)
    };

    const totalPages = Math.ceil(filteredLogs.length / itemsPerPage);
    const currentLogs = filteredLogs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    return (
        <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="md:col-span-1 bg-gradient-to-br from-indigo-600 to-blue-700 rounded-[2rem] p-8 text-white shadow-xl shadow-indigo-100 relative overflow-hidden group"
                >
                    <div className="relative z-10 space-y-4">
                        <div className="space-y-1">
                            <h2 className="text-xl font-black tracking-tight">M-Pesa Live</h2>
                            <p className="text-indigo-100 text-[10px] font-black uppercase tracking-widest opacity-80">Real-time Transaction Stream</p>
                        </div>

                        <div className="flex items-center gap-3">
                            <div className="relative">
                                <div className={`w-3 h-3 rounded-full ${autoRefresh ? 'bg-emerald-400 animate-ping' : 'bg-gray-400'}`} />
                                <div className={`absolute top-0 w-3 h-3 rounded-full ${autoRefresh ? 'bg-emerald-400' : 'bg-gray-400'}`} />
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-wider">{autoRefresh ? 'Live Updates On' : 'Live Updates Off'}</span>
                        </div>

                        <button
                            onClick={() => setAutoRefresh(!autoRefresh)}
                            className="w-full py-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all"
                        >
                            {autoRefresh ? 'Pause Stream' : 'Enable Stream'}
                        </button>
                    </div>
                    <Activity className="absolute -bottom-8 -right-8 w-40 h-40 text-white/5" />
                </motion.div>

                <div className="bg-white rounded-[2rem] p-8 border border-gray-100 shadow-sm">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4">Success Rate</p>
                    <div className="text-4xl font-black text-gray-900 tracking-tighter">
                        {stats.total > 0 ? Math.round((stats.success / stats.total) * 100) : 0}%
                    </div>
                    <p className="text-[10px] font-black text-emerald-600 uppercase mt-2">Based on {stats.total} entries</p>
                </div>

                <div className="bg-white rounded-[2rem] p-8 border border-gray-100 shadow-sm">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4">Total Volume</p>
                    <div className="text-3xl font-black text-gray-900 tracking-tighter">
                        {formatCurrency(stats.totalAmount)}
                    </div>
                    <p className="text-[10px] font-black text-gray-400 uppercase mt-2">{stats.success} transactions</p>
                </div>

                <div className="bg-white rounded-[2rem] p-8 border border-gray-100 shadow-sm text-orange-600">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4">Pending/Failed</p>
                    <div className="text-4xl font-black tracking-tighter">
                        {stats.pending} / {stats.failed}
                    </div>
                    <p className="text-[10px] font-black uppercase mt-2">Requires Attention</p>
                </div>
            </div>

            <div className="bg-white border border-gray-100 rounded-[2.5rem] shadow-sm overflow-hidden">
                <div className="p-6 border-b border-gray-50 flex flex-wrap items-center justify-between gap-6 bg-gray-50/50">
                    <div className="relative flex-1 min-w-[300px]">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search by Transaction ID, Receipt, or Employee..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="w-full pl-11 pr-4 py-3 bg-white border border-gray-100 rounded-2xl text-[11px] font-black uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
                        />
                    </div>

                    <div className="flex items-center gap-3">
                        {['all', 'success', 'pending', 'failed'].map(status => (
                            <button
                                key={status}
                                onClick={() => setStatusFilter(status)}
                                className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${statusFilter === status ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-indigo-600'
                                    }`}
                            >
                                {status}
                            </button>
                        ))}
                        <button onClick={() => fetchLogs()} className="p-3 bg-white border border-gray-100 rounded-2xl text-gray-400 hover:text-indigo-600">
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="bg-gray-50/80 text-left">
                                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Transaction</th>
                                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">Employee</th>
                                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Status</th>
                                <th className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Amount</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {currentLogs.map((log) => (
                                <tr key={log.id} onClick={() => setSelectedLog(log)} className="hover:bg-indigo-50/30 transition-all cursor-pointer group">
                                    <td className="px-8 py-6">
                                        <div className="flex flex-col gap-1">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-black text-gray-900 group-hover:text-indigo-600">
                                                    {(() => {
                                                        const isGenericId = log.transaction_id === 'UAT1000000';
                                                        let displayId = log.transaction_id || '---';

                                                        if (isGenericId && log.raw_response) {
                                                            try {
                                                                const raw = JSON.parse(log.raw_response);
                                                                const resultObj = raw.Result || raw;
                                                                const params = resultObj?.ResultParameters?.ResultParameter;

                                                                if (Array.isArray(params)) {
                                                                    const receiptParam = params.find((p: any) => p.Key === 'ReceiptNo');
                                                                    if (receiptParam?.Value) {
                                                                        displayId = receiptParam.Value;
                                                                    }
                                                                }
                                                            } catch (e) {
                                                                // fallback
                                                            }
                                                        }
                                                        return displayId;
                                                    })()}
                                                </span>
                                                <button onClick={(e) => { e.stopPropagation(); copyToClipboard(log.transaction_id); }}>
                                                    <Copy className="w-3 h-3 text-gray-300 hover:text-indigo-600" />
                                                </button>
                                            </div>
                                            <span className="text-[10px] font-bold text-gray-400 uppercase">{log.originator_conversation_id}</span>
                                        </div>
                                    </td>
                                    <td className="px-8 py-6">
                                        {log.employees ? (
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-black">
                                                    {log.employees["First Name"][0]}{log.employees["Last Name"][0]}
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-black text-gray-900 uppercase">{log.employees["First Name"]} {log.employees["Last Name"]}</span>
                                                    <span className="text-[10px] font-bold text-gray-400 uppercase">{log.employees["Employee Number"]}</span>
                                                </div>
                                            </div>
                                        ) : (
                                            <span className="text-[10px] font-black text-gray-300 uppercase italic">Unknown Employee</span>
                                        )}
                                    </td>
                                    <td className="px-8 py-6 text-center">
                                        <span className={`inline-flex px-4 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider border ${getStatusColor(log)}`}>
                                            {log.result_desc || log.status}
                                        </span>
                                    </td>
                                    <td className="px-8 py-6 text-right">
                                        <span className="text-sm font-black text-gray-900">{formatCurrency(log.amount)}</span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="p-8 flex items-center justify-between bg-gray-50/30 border-t border-gray-50">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                        Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, filteredLogs.length)} of {filteredLogs.length} logs
                    </p>
                    <div className="flex gap-2">
                        <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="p-2 border border-gray-100 rounded-xl disabled:opacity-30">
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="p-2 border border-gray-100 rounded-xl disabled:opacity-30">
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>

            <AnimatePresence>
                {selectedLog && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 sm:p-12">
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelectedLog(null)} className="absolute inset-0 bg-gray-900/60 backdrop-blur-md" />
                        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="bg-white rounded-[3rem] w-full max-w-2xl overflow-hidden relative z-10 border border-white/20">
                            <div className="p-10 border-b border-gray-50 flex items-center justify-between bg-gray-50/50">
                                <h3 className="text-2xl font-black text-gray-900 tracking-tight">Transaction Details</h3>
                                <button onClick={() => setSelectedLog(null)} className="p-3 bg-white text-gray-400 hover:text-red-500 rounded-2xl shadow-sm border border-gray-100 transition-colors">
                                    <X className="w-6 h-6" />
                                </button>
                            </div>
                            <div className="p-10 space-y-8">
                                <div className="grid grid-cols-2 gap-6">
                                    <div className="p-6 bg-gray-50 rounded-3xl border border-gray-100">
                                        <p className="text-[10px] font-black text-gray-400 uppercase mb-2">Status</p>
                                        <div className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase text-center border ${getStatusColor(selectedLog)}`}>
                                            {selectedLog.result_desc}
                                        </div>
                                    </div>
                                    <div className="p-6 bg-indigo-600 rounded-3xl text-white">
                                        <p className="text-[10px] font-black text-indigo-100 uppercase mb-2">Amount</p>
                                        <div className="text-3xl font-black">{formatCurrency(selectedLog.amount)}</div>
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Raw Response</p>
                                    <div className="bg-slate-900 rounded-[2rem] p-6 text-emerald-400 font-mono text-[11px] overflow-x-auto">
                                        <pre>{JSON.stringify(JSON.parse(selectedLog.raw_response || '{}'), null, 2)}</pre>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default MpesaCallbacks;
