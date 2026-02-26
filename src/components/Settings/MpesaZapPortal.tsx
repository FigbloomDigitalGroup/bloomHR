import React, { useState, useEffect } from 'react';
import {
    Smartphone, DollarSign, Send, RefreshCw,
    CheckCircle, XCircle, Clock, Activity,
    Search, Copy, ShieldCheck, Mail, AlertTriangle, Zap, Landmark, Building, MapPin, X, ArrowRight, TrendingUp
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
    employee_name?: string;
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

    const fetchCallbacks = async () => {
        try {
            setIsRefreshing(true);
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

            const tenMinsAgo = Date.now() - 10 * 60 * 1000;
            const activeData = (data || []).filter(item => {
                if (item.status === 'Pending') {
                    return new Date(item.callback_date).getTime() > tenMinsAgo;
                }
                return true;
            });

            const enhanced = await enhanceWithEmployees(activeData);
            setCallbacks(enhanced);

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
                    // Silent fail
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

    const isValidPhone = (phone: string) => /^254[17]\d{8}$/.test(phone);
    const isValidAmount = (amt: string) => {
        const n = Number(amt);
        return !isNaN(n) && n >= 10 && n <= 100000;
    };

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
                fetchCallbacks();
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
        <div className="space-y-6 pb-12">
            {/* Header section with minimal clean card */}
            <div className="bg-white border text-gray-900 border-gray-200 rounded-lg p-6 flex flex-col md:flex-row justify-between items-center shadow-sm">
                <div>
                    <h1 className="text-xl font-semibold text-gray-900 font-sans tracking-tight">M-Pesa Zap Disbursement</h1>
                    <p className="text-xs text-gray-500 mt-1">Instant B2C Disbursement Portal</p>
                </div>
                <div className="flex items-center gap-4 mt-4 md:mt-0">
                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                        <span className="text-xs font-medium text-gray-600">{autoRefresh ? 'Stream Active' : 'Stream Paused'}</span>
                    </div>
                    <button
                        onClick={() => setAutoRefresh(!autoRefresh)}
                        className="px-3 py-1.5 bg-white border border-gray-200 hover:bg-gray-50 rounded-md text-xs font-medium text-gray-700 transition-colors shadow-sm focus:outline-none"
                    >
                        {autoRefresh ? 'Pause' : 'Resume'}
                    </button>
                </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-xs font-medium text-gray-500">Utility Balance</p>
                        <p className="text-2xl font-semibold text-gray-900 mt-1">{utilityBalance}</p>
                        <p className="text-xs text-indigo-600 mt-1">Paybill: 4084659</p>
                    </div>
                    <div className="p-3 bg-indigo-50 text-indigo-600 rounded-lg">
                        <Landmark className="w-5 h-5" />
                    </div>
                </div>

                <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-xs font-medium text-gray-500">Daily Success</p>
                        <p className="text-2xl font-semibold text-gray-900 mt-1">
                            {callbacks.filter(c => c.result_code === 0 && new Date(c.callback_date).toDateString() === new Date().toDateString()).length}
                        </p>
                        <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                            Successful Transfers
                        </p>
                    </div>
                    <div className="p-3 bg-emerald-50 text-emerald-600 rounded-lg">
                        <CheckCircle className="w-5 h-5" />
                    </div>
                </div>

                <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-xs font-medium text-gray-500">Pending Transfers</p>
                        <p className="text-2xl font-semibold text-gray-900 mt-1">
                            {callbacks.filter(c => c.status === 'Pending').length}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">In Queue</p>
                    </div>
                    <div className="p-3 bg-amber-50 text-amber-600 rounded-lg">
                        <Clock className="w-5 h-5" />
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Send Money Form */}
                <div className="lg:col-span-1 space-y-6">
                    <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm">
                        <div className="mb-6">
                            <h3 className="text-base font-semibold text-gray-900">Initiate Payment</h3>
                            <p className="text-xs text-gray-500 mt-1">Send funds directly to a mobile number</p>
                        </div>

                        <form onSubmit={handleInitiateZap} className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Phone Number</label>
                                <div className="relative">
                                    <Smartphone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                    <input
                                        type="text"
                                        placeholder="2547XXXXXXXX"
                                        value={phoneNumber}
                                        onChange={(e) => setPhoneNumber(e.target.value)}
                                        className="w-full pl-9 pr-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                                    />
                                </div>
                                <p className="text-[10px] text-gray-500 mt-1">Must be Safaricom 254 format</p>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Amount (KES)</label>
                                <div className="relative">
                                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                    <input
                                        type="number"
                                        placeholder="Min 10 - Max 100,000"
                                        value={amount}
                                        onChange={(e) => setAmount(e.target.value)}
                                        className="w-full pl-9 pr-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                                    />
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50 shadow-sm"
                            >
                                {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                                Send Payment
                            </button>
                        </form>
                    </div>

                    <div className="bg-gray-50 rounded-lg p-5 border border-gray-200">
                        <div className="flex items-center gap-2 mb-2">
                            <ShieldCheck className="w-4 h-4 text-emerald-600" />
                            <h3 className="text-sm font-semibold text-gray-900">Security Note</h3>
                        </div>
                        <p className="text-xs text-gray-600 leading-relaxed">
                            All disbursements require admin email verification before final execution to prevent unauthorized transfers.
                        </p>
                    </div>
                </div>

                {/* Transaction Stream */}
                <div className="lg:col-span-2 flex flex-col h-full">
                    <div className="bg-white rounded-lg border border-gray-200 shadow-sm flex flex-col h-[600px] overflow-hidden">
                        <div className="p-5 border-b border-gray-200 flex items-center justify-between bg-white">
                            <div>
                                <h2 className="text-base font-semibold text-gray-900">Transaction History</h2>
                                <p className="text-xs text-gray-500 mt-1">Real-time record of all disbursements</p>
                            </div>
                            <button
                                onClick={fetchCallbacks}
                                className="p-2 bg-white border border-gray-200 rounded-md text-gray-500 hover:text-indigo-600 transition-colors shadow-sm"
                            >
                                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-5 scrollbar-thin scrollbar-thumb-gray-200">
                            <div className="space-y-3">
                                {callbacks.length > 0 ? (
                                    callbacks.map((log) => (
                                        <div
                                            key={log.id}
                                            className="group flex items-center justify-between p-4 bg-white border border-gray-100 hover:border-gray-200 rounded-lg transition-all"
                                        >
                                            <div className="flex items-center gap-4">
                                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${log.status === 'Pending' ? 'bg-amber-50 text-amber-600' :
                                                    log.result_code === 0 ? 'bg-emerald-50 text-emerald-600' :
                                                        'bg-red-50 text-red-600'
                                                    }`}>
                                                    {log.status === 'Pending' ? <Clock className="w-5 h-5 animate-pulse" /> :
                                                        log.result_code === 0 ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm font-medium text-gray-900">
                                                            {log.employee_name || log.transaction_id || 'Pending Transfer'}
                                                        </span>
                                                        <button onClick={() => copyToClipboard(log.transaction_id || '')} className="text-gray-400 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            <Copy className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                    <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                                                        <span>{log.phone_number || log.originator_conversation_id}</span>
                                                        <span className="w-1 h-1 rounded-full bg-gray-300" />
                                                        <span>{log.result_type || 'B2C'}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-sm font-semibold text-gray-900">KES {(log.amount ?? 0).toLocaleString()}</div>
                                                <div className="text-xs text-gray-500 mt-0.5 flex items-center justify-end gap-1">
                                                    <Clock className="w-3 h-3" />
                                                    {log.callback_date ? new Date(log.callback_date).toLocaleTimeString() : '---'}
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="h-full flex flex-col items-center justify-center py-20 text-center">
                                        <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mb-3">
                                            <Search className="w-5 h-5 text-gray-400" />
                                        </div>
                                        <p className="text-sm font-medium text-gray-900">No recent transactions</p>
                                        <p className="text-xs text-gray-500 mt-1">Disbursements will appear here</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Verification Modal */}
            <AnimatePresence>
                {showConfirm && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-gray-900/50 backdrop-blur-sm">
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-white rounded-lg shadow-xl w-full max-w-md overflow-hidden flex flex-col relative z-10"
                        >
                            <div className="p-6 border-b border-gray-100 flex flex-col items-center text-center">
                                <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center text-amber-600 mb-4">
                                    <AlertTriangle className="w-6 h-6" />
                                </div>
                                <h2 className="text-lg font-semibold text-gray-900">Confirm Payment</h2>
                                <p className="text-sm text-gray-600 mt-2">
                                    You are about to transfer <span className="font-semibold text-gray-900">KES {Number(amount).toLocaleString()}</span> to <span className="font-semibold text-gray-900">{phoneNumber}</span>.
                                </p>
                            </div>

                            <div className="p-6 space-y-4">
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">Confirm Admin Email</label>
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                        <input
                                            type="email"
                                            placeholder="Enter your admin email"
                                            value={confirmEmail}
                                            onChange={(e) => setConfirmEmail(e.target.value)}
                                            className="w-full pl-9 pr-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                                        />
                                    </div>
                                    <p className="text-[10px] text-gray-500 mt-1">Verify with: {user?.email}</p>
                                </div>

                                <div className="flex gap-3 pt-2">
                                    <button
                                        onClick={() => setShowConfirm(false)}
                                        className="flex-1 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-md transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleConfirmSend}
                                        disabled={!confirmEmail || loading}
                                        className="flex-1 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
                                        Confirm
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default MpesaZapPortal;
