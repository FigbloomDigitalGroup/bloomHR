import React, { useState, useEffect } from 'react';
import {
    Smartphone, DollarSign, Send, RefreshCw,
    CheckCircle, XCircle, Clock, Activity,
    Search, Copy, ShieldCheck, Mail, AlertTriangle
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { useUser } from '../ProtectedRoutes/UserContext';

// --- Types ---
interface MpesaCallback {
    id: number;
    transaction_id: string;
    originator_conversation_id: string;
    result_code: number;
    result_desc: string;
    amount: number;
    status: string;
    callback_date: string;
    raw_response?: string;
    result_type?: string;
    phone_number?: string;
    employee_name?: string; // Enhanced field
}

const MpesaZapPortal: React.FC = () => {
    const { user } = useUser();
    const [phoneNumber, setPhoneNumber] = useState('');
    const [amount, setAmount] = useState('');
    const [loading, setLoading] = useState(false);
    const [callbacks, setCallbacks] = useState<MpesaCallback[]>([]);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);

    // Confirmation State
    const [showConfirm, setShowConfirm] = useState(false);
    const [confirmEmail, setConfirmEmail] = useState('');
    const [utilityBalance, setUtilityBalance] = useState<string>('---');

    // --- Fetch Callbacks ---
    const fetchCallbacks = async () => {
        try {
            setIsRefreshing(true);

            // Filter: Hide technical status checks and only show payments (B2C/C2B)
            // Limit to last 24 hours to keep the stream clean
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

            const { data, error } = await supabase
                .from('mpesa_callbacks')
                .select('*')
                .neq('result_type', 'TransactionStatus')
                .neq('result_type', 'TransactionStatus_Pending')
                .gt('callback_date', oneDayAgo)
                .order('callback_date', { ascending: false })
                .limit(25);

            if (error) throw error;

            // Filter out "dead" pending requests (any Pending older than 10 minutes is likely a failure)
            const tenMinsAgo = Date.now() - 10 * 60 * 1000;
            const activeData = (data || []).filter(item => {
                if (item.status === 'Pending') {
                    return new Date(item.callback_date).getTime() > tenMinsAgo;
                }
                return true;
            });

            // Enhance data with employee names if phone numbers exist
            const enhanced = await enhanceWithEmployees(activeData);
            setCallbacks(enhanced);

            // Extract Utility Balance from latest B2C success
            const latestB2C = enhanced.find(c => (c.result_type === 'B2C' || !c.result_type) && c.result_code === 0);
            if (latestB2C?.raw_response) {
                try {
                    const raw = typeof latestB2C.raw_response === 'string'
                        ? JSON.parse(latestB2C.raw_response)
                        : latestB2C.raw_response;

                    const params = (raw as any)?.Result?.ResultParameters?.ResultParameter || [];
                    const fundsParam = params.find((p: any) => p.Key === 'B2CWorkingAccountAvailableFunds' || p.Key === 'B2CUtilityAccountAvailableFunds');

                    if (fundsParam?.Value) {
                        setUtilityBalance(`KES ${Number(fundsParam.Value).toLocaleString()}`);
                    }
                } catch (e) {
                    // Silent fail for balance parsing
                }
            }
        } catch (err) {
            console.error('Error fetching callbacks:', err);
        } finally {
            setIsRefreshing(false);
        }
    };

    const enhanceWithEmployees = async (data: any[]) => {
        const phones = data.map(c => c.phone_number).filter(Boolean);
        if (phones.length === 0) return data;

        // Simple matching: get the last 9 digits to be safe
        const cleanPhones = phones.map(p => p.replace(/\D/g, '').slice(-9));

        const { data: employees } = await supabase
            .from('employees')
            .select('"Full Name", "Mobile Number"')
            .or(cleanPhones.map(p => `"Mobile Number".ilike.%${p}%`).join(','));

        const empMap: Record<string, string> = {};
        employees?.forEach(e => {
            const p = e["Mobile Number"]?.replace(/\D/g, '').slice(-9);
            if (p) empMap[p] = e["Full Name"];
        });

        return data.map(c => ({
            ...c,
            employee_name: c.phone_number ? empMap[c.phone_number.replace(/\D/g, '').slice(-9)] : undefined
        }));
    };

    useEffect(() => {
        fetchCallbacks();

        // REAL-TIME SUBSCRIPTION
        const channel = supabase.channel('mpesa_zap_stream')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'mpesa_callbacks'
            }, () => {
                fetchCallbacks();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    // --- Form Validation ---
    const isValidPhone = (phone: string) => /^254[17]\d{8}$/.test(phone);
    const isValidAmount = (amt: string) => {
        const n = Number(amt);
        return !isNaN(n) && n >= 10 && n <= 100000;
    };

    // --- Handlers ---
    const handleInitiateZap = (e: React.FormEvent) => {
        e.preventDefault();
        if (!isValidPhone(phoneNumber)) {
            toast.error('Invalid phone number. Must be 254xxxxxxxxx');
            return;
        }
        if (!isValidAmount(amount)) {
            toast.error('Invalid amount. Must be between 10 and 100,000');
            return;
        }
        setShowConfirm(true);
    };

    const handleConfirmSend = async () => {
        if (confirmEmail.toLowerCase() !== user?.email?.toLowerCase()) {
            toast.error('Email verification failed. Please enter your correct admin email.');
            return;
        }

        try {
            setLoading(true);
            setShowConfirm(false);

            const API_BASE = import.meta.env.VITE_API_URL || "https://mpesa-22p0.onrender.com/api";

            const response = await fetch(`${API_BASE}/mpesa/b2c`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    phoneNumber,
                    amount: Number(amount),
                    employeeNumber: 'M-PESA-ZAP',
                    fullName: `Sent via M-Pesa Zap`
                })
            });

            const result = await response.json();

            if (result.success) {
                toast.success('M-Pesa Zap initiated successfully!');
                setAmount('');
                setConfirmEmail('');
                fetchCallbacks(); // Immediate fetch
            } else {
                throw new Error(result.message || 'Failed to initiate payment');
            }
        } catch (err: any) {
            toast.error(err.message || 'An error occurred');
        } finally {
            setLoading(false);
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        toast.success('Copied to clipboard');
    };

    return (
        <div className="max-w-6xl mx-auto space-y-8 p-6">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Mpesa Zap</h1>
                    <p className="text-gray-500 mt-1">Quickly send money and monitor transaction status in real-time.</p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 text-green-700 rounded-full border border-green-100 ring-4 ring-green-50/50">
                        <ShieldCheck className="w-4 h-4" />
                        <span className="text-xs font-semibold uppercase tracking-wider">Secure Payment Gateway</span>
                    </div>
                    <button
                        onClick={() => setAutoRefresh(!autoRefresh)}
                        className={`p-2 rounded-xl transition-all ${autoRefresh ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'bg-gray-100 text-gray-400'}`}
                        title={autoRefresh ? "Pause Live Updates" : "Resume Live Updates"}
                    >
                        <RefreshCw className={`w-5 h-5 ${autoRefresh && isRefreshing ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Dashboard Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-gradient-to-br from-indigo-900 to-indigo-800 rounded-[28px] p-6 text-white shadow-xl relative overflow-hidden group">
                    <div className="absolute right-0 top-0 w-32 h-32 bg-white/5 rounded-bl-full transition-transform group-hover:scale-110" />
                    <div className="relative z-10 flex flex-col h-full justify-between">
                        <div className="flex items-center justify-between mb-6">
                            <div className="p-2.5 bg-white/10 rounded-xl backdrop-blur-sm">
                                <Activity className="w-5 h-5 text-indigo-300" />
                            </div>
                            <span className="px-3 py-1 bg-green-500/20 text-green-300 text-[11px] font-bold rounded-full border border-green-500/20 flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                                Live
                            </span>
                        </div>
                        <div>
                            <p className="text-indigo-200 text-xs font-medium uppercase tracking-wider mb-1">Utility Balance</p>
                            <h3 className="text-3xl font-bold tracking-tight mb-2">{utilityBalance}</h3>
                            <div className="flex items-center gap-2 text-[10px] text-indigo-300/80">
                                <span>Updated: Just now</span>
                                <span className="w-1 h-1 rounded-full bg-current" />
                                <span>Paybill: 4084659</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-[28px] p-6 border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex flex-col h-full justify-between">
                        <div className="flex items-center justify-between mb-4">
                            <div className="p-2.5 bg-green-50 rounded-xl">
                                <CheckCircle className="w-5 h-5 text-green-600" />
                            </div>
                            <span className="text-xs font-bold text-gray-400">TODAY</span>
                        </div>
                        <div>
                            <p className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">Successful Zaps</p>
                            <h3 className="text-2xl font-bold text-gray-900 tracking-tight">
                                {callbacks.filter(c => c.result_code === 0 && new Date(c.callback_date).toDateString() === new Date().toDateString()).length}
                            </h3>
                            <p className="text-xs text-green-600 mt-2 font-medium flex items-center gap-1">
                                <span className="w-4 h-4 rounded-full bg-green-100 flex items-center justify-center text-[10px]">↑</span>
                                +12% from yesterday
                            </p>
                        </div>
                    </div>
                </div>

                <div className="bg-white rounded-[28px] p-6 border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex flex-col h-full justify-between">
                        <div className="flex items-center justify-between mb-4">
                            <div className="p-2.5 bg-amber-50 rounded-xl">
                                <Clock className="w-5 h-5 text-amber-600" />
                            </div>
                            <span className="text-xs font-bold text-gray-400">PENDING</span>
                        </div>
                        <div>
                            <p className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">Processing</p>
                            <h3 className="text-2xl font-bold text-gray-900 tracking-tight">
                                {callbacks.filter(c => c.status === 'Pending').length}
                            </h3>
                            <p className="text-xs text-gray-400 mt-2 font-medium">
                                Awaiting M-Pesa response
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Input Form Column */}
                <div className="lg:col-span-4 space-y-6">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-white rounded-[24px] p-6 shadow-sm border border-gray-100"
                    >
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
                                <Activity className="w-6 h-6" />
                            </div>
                            <h2 className="font-bold text-gray-800 text-lg">Send Money (Zap)</h2>
                        </div>

                        <form onSubmit={handleInitiateZap} className="space-y-4">
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Recipient Phone</label>
                                <div className="relative">
                                    <Smartphone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                    <input
                                        type="text"
                                        placeholder="2547XXXXXXXX"
                                        value={phoneNumber}
                                        onChange={(e) => setPhoneNumber(e.target.value)}
                                        className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-100 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none"
                                    />
                                </div>
                                <p className="text-[10px] text-gray-400 ml-1">Format: 254712345678 (Safaricom Only)</p>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Amount (KES)</label>
                                <div className="relative">
                                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                    <input
                                        type="number"
                                        placeholder="Min 10 - Max 100,000"
                                        value={amount}
                                        onChange={(e) => setAmount(e.target.value)}
                                        className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-100 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none"
                                    />
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full py-4 bg-indigo-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 mt-4"
                            >
                                {loading ? (
                                    <RefreshCw className="w-5 h-5 animate-spin" />
                                ) : (
                                    <>
                                        <Send className="w-4 h-4" />
                                        Zap Money Now
                                    </>
                                )}
                            </button>
                        </form>
                    </motion.div>

                    {/* Quick Info Card */}
                    <div className="bg-gradient-to-br from-indigo-600 to-blue-700 rounded-[24px] p-6 text-white shadow-xl">
                        <Activity className="w-8 h-8 text-indigo-300 mb-4" />
                        <h3 className="text-lg font-bold mb-2">Zap Service</h3>
                        <p className="text-indigo-100 text-sm leading-relaxed">
                            Mpesa Zap allows for instant B2C transfers.
                            Ensure the recipient number is correct before confirming.
                            All transactions are logged for security.
                        </p>
                    </div>
                </div>

                {/* Callbacks Column */}
                <div className="lg:col-span-8 space-y-6">
                    <motion.div
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-white rounded-[24px] border border-gray-100 shadow-sm overflow-hidden flex flex-col h-[600px]"
                    >
                        <div className="p-6 border-b border-gray-50 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center text-green-600">
                                    <Activity className="w-6 h-6" />
                                </div>
                                <div>
                                    <h2 className="font-bold text-gray-800 text-lg">Transaction Stream</h2>
                                    <p className="text-xs text-gray-400">Recent M-Pesa activities</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={fetchCallbacks}
                                    className="p-2 text-gray-400 hover:text-indigo-600 transition-colors"
                                >
                                    <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                                </button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 space-y-3">
                            <AnimatePresence mode='popLayout'>
                                {callbacks.length > 0 ? (
                                    callbacks.map((log) => (
                                        <motion.div
                                            key={log.id}
                                            layout
                                            initial={{ opacity: 0, x: -20 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, scale: 0.95 }}
                                            className="group bg-gray-50 hover:bg-white hover:shadow-md transition-all border border-gray-100 rounded-[18px] p-4"
                                        >
                                            <div className="flex items-start justify-between gap-4">
                                                <div className="flex items-start gap-3">
                                                    <div className={`mt-1 w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${log.status === 'Pending' ? 'bg-amber-100 text-amber-600' : log.result_code === 0 ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'
                                                        }`}>
                                                        {log.status === 'Pending' ? <Clock className="w-4 h-4 animate-spin" /> : log.result_code === 0 ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-sm font-bold text-gray-900">
                                                                {log.employee_name || log.transaction_id || (log.status === 'Pending' ? 'Processing...' : 'NO_TRANS_ID')}
                                                            </span>
                                                            {log.transaction_id && (
                                                                <Copy
                                                                    className="w-3 h-3 text-gray-300 hover:text-gray-600 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                                                                    onClick={(e) => { e.stopPropagation(); copyToClipboard(log.transaction_id || ''); }}
                                                                />
                                                            )}
                                                        </div>
                                                        <div className="flex items-center gap-2 mt-0.5">
                                                            <span className="text-[11px] font-mono text-gray-400 truncate max-w-[200px] text-xs">
                                                                {log.phone_number || log.originator_conversation_id}
                                                            </span>
                                                            <span className="text-[10px] px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded font-bold uppercase tracking-tighter">
                                                                {log.result_type || 'B2C'}
                                                            </span>
                                                        </div>
                                                        <p className={`text-xs mt-2 font-medium ${log.status === 'Pending' ? 'text-amber-600' : 'text-gray-600'}`}>
                                                            {log.result_desc || (log.status === 'Pending' ? 'Waiting for M-Pesa response...' : '')}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="text-right flex flex-col items-end gap-2 px-2">
                                                    <span className="text-sm font-bold text-gray-900">KES {(log.amount ?? 0).toLocaleString()}</span>
                                                    <span className="text-[10px] text-gray-400 flex items-center gap-1">
                                                        <Clock className="w-3 h-3" />
                                                        {log.callback_date ? new Date(log.callback_date).toLocaleTimeString() : '---'}
                                                    </span>
                                                </div>
                                            </div>
                                        </motion.div>
                                    ))
                                ) : (
                                    <div className="h-full flex flex-col items-center justify-center text-gray-300 space-y-4">
                                        <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center border border-gray-100">
                                            <Search className="w-10 h-10" />
                                        </div>
                                        <p className="text-sm font-medium">Listening for transactions...</p>
                                    </div>
                                )}
                            </AnimatePresence>
                        </div>
                    </motion.div>
                </div>
            </div >

            {/* Confirmation Modal */}
            <AnimatePresence>
                {
                    showConfirm && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                onClick={() => setShowConfirm(false)}
                                className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm"
                            />
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                                className="relative w-full max-w-md bg-white rounded-[32px] p-8 shadow-2xl overflow-hidden"
                            >
                                <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />

                                <div className="flex flex-col items-center text-center space-y-4">
                                    <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-500 ring-8 ring-amber-50/50">
                                        <AlertTriangle className="w-8 h-8" />
                                    </div>
                                    <div>
                                        <h2 className="text-2xl font-bold text-gray-900">Confirm Payment</h2>
                                        <p className="text-gray-500 mt-2">
                                            You are about to send <span className="font-bold text-gray-900">KES {Number(amount).toLocaleString()}</span> to <span className="font-bold text-gray-900">{phoneNumber}</span>.
                                        </p>
                                    </div>

                                    <div className="w-full space-y-4 mt-6">
                                        <div className="space-y-2 text-left">
                                            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest ml-1 flex items-center gap-2">
                                                <Mail className="w-3 h-3" />
                                                Admin Verification
                                            </label>
                                            <input
                                                type="email"
                                                placeholder="Type your admin email to confirm"
                                                value={confirmEmail}
                                                onChange={(e) => setConfirmEmail(e.target.value)}
                                                className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none"
                                            />
                                            <p className="text-[10px] text-gray-400">Logged in as: <span className="font-medium text-gray-600">{user?.email}</span></p>
                                        </div>

                                        <div className="flex gap-3">
                                            <button
                                                onClick={() => setShowConfirm(false)}
                                                className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-bold text-sm hover:bg-gray-200 transition-colors"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                onClick={handleConfirmSend}
                                                disabled={!confirmEmail}
                                                className="flex-3 px-8 py-3 bg-indigo-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-50 transition-all"
                                            >
                                                Confirm & Send
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        </div>
                    )
                }
            </AnimatePresence >
        </div >
    );
};

export default MpesaZapPortal;
