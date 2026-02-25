import React, { useState, useEffect } from 'react';
import {
    Smartphone, DollarSign, Send, RefreshCw,
    CheckCircle, XCircle, Clock, Activity,
    Search, Copy, ShieldCheck, Mail, AlertTriangle, Zap, Landmark, Building, MapPin, X, ArrowRight
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
        <div className="space-y-8 pb-12">
            {/* Premium Header Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="md:col-span-1 bg-gradient-to-br from-indigo-600 to-indigo-800 rounded-[2.5rem] p-8 text-white shadow-xl shadow-indigo-100 relative overflow-hidden group"
                >
                    <div className="relative z-10 space-y-6">
                        <div className="space-y-1">
                            <h2 className="text-2xl font-black tracking-tight italic uppercase">M-Pesa Zap</h2>
                            <p className="text-indigo-100 text-[10px] font-black uppercase tracking-[0.2em] opacity-80">Instant B2C Disbursement Node</p>
                        </div>

                        <div className="flex items-center gap-3">
                            <div className="relative">
                                <div className={`w-3 h-3 rounded-full ${autoRefresh ? 'bg-emerald-400 animate-ping' : 'bg-gray-400'}`} />
                                <div className={`absolute top-0 w-3 h-3 rounded-full ${autoRefresh ? 'bg-emerald-400' : 'bg-gray-400'}`} />
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-100">{autoRefresh ? 'Live Stream Active' : 'Stream Paused'}</span>
                        </div>

                        <div className="flex flex-col gap-2">
                            <button
                                onClick={() => setAutoRefresh(!autoRefresh)}
                                className="w-full py-4 bg-white/10 hover:bg-white/20 border border-white/20 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all"
                            >
                                {autoRefresh ? 'Stop Polling' : 'Resume Polling'}
                            </button>
                            <div className="flex items-center justify-center gap-2 px-3 py-2 bg-emerald-500/20 text-emerald-300 rounded-xl border border-emerald-500/20">
                                <ShieldCheck className="w-3 h-3" />
                                <span className="text-[9px] font-black uppercase tracking-widest">Secure TLS 1.3</span>
                            </div>
                        </div>
                    </div>
                    <Activity className="absolute -bottom-10 -right-10 w-48 h-48 text-white/5" />
                </motion.div>

                {/* Balance & Stats Cards */}
                <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-6">
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
                        className="bg-white rounded-[2.5rem] p-8 border border-gray-100 shadow-sm flex flex-col justify-between group overflow-hidden relative">
                        <div className="flex items-center justify-between mb-4">
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Utility Balance</p>
                            <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl group-hover:bg-indigo-600 group-hover:text-white transition-all">
                                <Landmark className="w-5 h-5" />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <div className="text-3xl font-black text-gray-900 tracking-tighter">
                                {utilityBalance}
                            </div>
                            <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Paybill: 4084659</p>
                        </div>
                        <Activity className="absolute bottom-[-10%] right-[-10%] w-24 h-24 text-indigo-50" />
                    </motion.div>

                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
                        className="bg-white rounded-[2.5rem] p-8 border border-gray-100 shadow-sm flex flex-col justify-between group">
                        <div className="flex items-center justify-between mb-4">
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Daily Success</p>
                            <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl group-hover:bg-emerald-600 group-hover:text-white transition-all">
                                <CheckCircle className="w-5 h-5" />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <div className="text-3xl font-black text-gray-900 tracking-tighter">
                                {callbacks.filter(c => c.result_code === 0 && new Date(c.callback_date).toDateString() === new Date().toDateString()).length}
                            </div>
                            <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest flex items-center gap-1">
                                <TrendingUp className="w-3 h-3 text-emerald-500" /> +12% Recovery
                            </p>
                        </div>
                    </motion.div>

                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
                        className="bg-white rounded-[2.5rem] p-8 border border-gray-100 shadow-sm flex flex-col justify-between group">
                        <div className="flex items-center justify-between mb-4">
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">In-Flight Nodes</p>
                            <div className="p-2.5 bg-amber-50 text-amber-600 rounded-xl group-hover:bg-amber-600 group-hover:text-white transition-all">
                                <Clock className="w-5 h-5" />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <div className="text-3xl font-black text-gray-900 tracking-tighter">
                                {callbacks.filter(c => c.status === 'Pending').length}
                            </div>
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Monitoring latency...</p>
                        </div>
                    </motion.div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Send Money Form */}
                <div className="lg:col-span-4 space-y-6">
                    <motion.div
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="bg-white rounded-[3rem] p-10 border border-gray-100 shadow-sm space-y-8"
                    >
                        <div className="space-y-2">
                            <h3 className="text-xl font-black text-gray-900 tracking-tight uppercase italic">Initiate Zap</h3>
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Direct B2C Allocation</p>
                        </div>

                        <form onSubmit={handleInitiateZap} className="space-y-6">
                            <div className="space-y-3">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Recipient Key (Phone)</label>
                                <div className="relative group">
                                    <Smartphone className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 group-focus-within:text-indigo-600 transition-colors" />
                                    <input
                                        type="text"
                                        placeholder="2547XXXXXXXX"
                                        value={phoneNumber}
                                        onChange={(e) => setPhoneNumber(e.target.value)}
                                        className="w-full pl-16 pr-6 py-5 bg-gray-50 border-none rounded-[2rem] text-sm font-black tracking-widest focus:ring-4 focus:ring-indigo-100 transition-all font-mono"
                                    />
                                </div>
                                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest pl-1 italic">Must be Safaricom 254 Format</p>
                            </div>

                            <div className="space-y-3">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Payload (Amount KES)</label>
                                <div className="relative group">
                                    <DollarSign className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 group-focus-within:text-emerald-600 transition-colors" />
                                    <input
                                        type="number"
                                        placeholder="Min 10 - Max 100,000"
                                        value={amount}
                                        onChange={(e) => setAmount(e.target.value)}
                                        className="w-full pl-16 pr-6 py-5 bg-emerald-50/30 border-none rounded-[2rem] text-sm font-black tracking-widest focus:ring-4 focus:ring-emerald-100 transition-all font-mono"
                                    />
                                </div>
                            </div>

                            <motion.button
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                type="submit"
                                disabled={loading}
                                className="w-full py-5 bg-indigo-600 text-white rounded-[2rem] font-black text-[10px] uppercase tracking-[0.2em] shadow-xl shadow-indigo-100 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                            >
                                {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
                                Authorize Zap
                            </motion.button>
                        </form>
                    </motion.div>

                    <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-[2.5rem] p-8 text-white relative overflow-hidden group">
                        <ShieldCheck className="w-10 h-10 text-emerald-400 mb-6" />
                        <h3 className="text-lg font-black uppercase tracking-tight italic mb-2">Security Note</h3>
                        <p className="text-gray-400 text-[11px] leading-loose font-bold uppercase tracking-widest">
                            All disbursements are subject to double-node verification. Admin credentials required for final execution.
                        </p>
                        <Building className="absolute -bottom-8 -right-8 w-32 h-32 text-white/5 group-hover:scale-110 transition-transform" />
                    </div>
                </div>

                {/* Transaction Stream */}
                <div className="lg:col-span-8 flex flex-col h-full">
                    <motion.div
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="bg-white rounded-[3rem] border border-gray-100 shadow-sm overflow-hidden flex flex-col h-[700px]"
                    >
                        <div className="p-8 border-b border-gray-50 flex items-center justify-between bg-gray-50/50">
                            <div className="space-y-1">
                                <h2 className="text-xl font-black text-gray-900 tracking-tight uppercase italic">Ledger Stream</h2>
                                <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Real-time Transaction Manifest</p>
                            </div>
                            <button
                                onClick={fetchCallbacks}
                                className="p-4 bg-white border border-gray-100 rounded-2xl text-gray-400 hover:text-indigo-600 transition-all shadow-sm"
                            >
                                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-8 space-y-4">
                            <AnimatePresence mode='popLayout'>
                                {callbacks.length > 0 ? (
                                    callbacks.map((log) => (
                                        <motion.div
                                            key={log.id}
                                            layout
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, scale: 0.95 }}
                                            className="group bg-white hover:bg-gray-50 border border-gray-50 rounded-[2rem] p-6 transition-all hover:shadow-xl hover:shadow-indigo-50/50"
                                        >
                                            <div className="flex items-center justify-between gap-6">
                                                <div className="flex items-center gap-6">
                                                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all border ${log.status === 'Pending' ? 'bg-amber-50 text-amber-600 border-amber-100' :
                                                            log.result_code === 0 ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                                                                'bg-red-50 text-red-600 border-red-100'
                                                        }`}>
                                                        {log.status === 'Pending' ? <Clock className="w-6 h-6 animate-pulse" /> :
                                                            log.result_code === 0 ? <CheckCircle className="w-6 h-6" /> : <XCircle className="w-6 h-6" />}
                                                    </div>
                                                    <div className="space-y-1">
                                                        <div className="flex items-center gap-3">
                                                            <span className="text-sm font-black text-gray-900 tracking-widest font-mono uppercase">
                                                                {log.employee_name || log.transaction_id || 'PENDING...'}
                                                            </span>
                                                            <button onClick={() => copyToClipboard(log.transaction_id || '')} className="p-1 text-gray-300 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-all">
                                                                <Copy className="w-3 h-3" />
                                                            </button>
                                                        </div>
                                                        <div className="flex items-center gap-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                                                            <span className="font-mono">{log.phone_number || log.originator_conversation_id}</span>
                                                            <span className="w-1 h-1 rounded-full bg-gray-200" />
                                                            <span className="bg-gray-100 px-2 py-0.5 rounded text-gray-600">{log.result_type || 'B2C'}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="text-lg font-black text-gray-900 tracking-tight">KES {(log.amount ?? 0).toLocaleString()}</div>
                                                    <div className="text-[9px] font-black text-gray-400 uppercase tracking-[0.2em] flex items-center justify-end gap-1">
                                                        <Clock className="w-3 h-3" />
                                                        {log.callback_date ? new Date(log.callback_date).toLocaleTimeString() : '---'}
                                                    </div>
                                                </div>
                                            </div>
                                        </motion.div>
                                    ))
                                ) : (
                                    <div className="h-full flex flex-col items-center justify-center space-y-4">
                                        <div className="w-24 h-24 bg-gray-50 rounded-[2rem] flex items-center justify-center border border-gray-100">
                                            <Search className="w-10 h-10 text-gray-300" />
                                        </div>
                                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Awaiting Transaction Burst...</p>
                                    </div>
                                )}
                            </AnimatePresence>
                        </div>
                    </motion.div>
                </div>
            </div>

            {/* Verification Modal */}
            <AnimatePresence>
                {showConfirm && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 border border-white/20">
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowConfirm(false)} className="absolute inset-0 bg-gray-900/60 backdrop-blur-md" />

                        <motion.div
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.9, opacity: 0, y: 20 }}
                            className="bg-white rounded-[3rem] shadow-2xl w-full max-w-lg overflow-hidden flex flex-col relative z-10 p-10 space-y-8"
                        >
                            <div className="flex flex-col items-center text-center space-y-6">
                                <div className="w-20 h-20 rounded-[2rem] bg-amber-50 flex items-center justify-center text-amber-500 shadow-xl shadow-amber-900/5 border border-amber-100">
                                    <AlertTriangle className="w-10 h-10" />
                                </div>
                                <div className="space-y-2">
                                    <h2 className="text-2xl font-black text-gray-900 tracking-tight uppercase">Security Challenge</h2>
                                    <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest leading-loose">
                                        Authorizing payment of <span className="text-gray-900 font-black">KES {Number(amount).toLocaleString()}</span> to <span className="text-gray-900 font-black">{phoneNumber}</span>.
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-6">
                                <div className="space-y-4">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Admin Node Signature (Email)</label>
                                    <div className="relative group">
                                        <Mail className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 group-focus-within:text-indigo-600 transition-colors" />
                                        <input
                                            type="email"
                                            placeholder="VERIFY ADMIN CONTEXT"
                                            value={confirmEmail}
                                            onChange={(e) => setConfirmEmail(e.target.value)}
                                            className="w-full pl-16 pr-6 py-5 bg-gray-50 border-none rounded-[2rem] text-sm font-black tracking-widest focus:ring-4 focus:ring-indigo-100 transition-all font-mono"
                                        />
                                    </div>
                                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest pl-1">Target Account: {user?.email}</p>
                                </div>

                                <div className="flex gap-4">
                                    <button
                                        onClick={() => setShowConfirm(false)}
                                        className="flex-1 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 hover:text-gray-600 bg-white border border-gray-200 rounded-[2rem] transition-all"
                                    >
                                        Abort
                                    </button>
                                    <button
                                        onClick={handleConfirmSend}
                                        disabled={!confirmEmail}
                                        className="flex-[2] py-5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-[2rem] text-[10px] font-black uppercase tracking-[0.2em] shadow-xl shadow-indigo-100 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                                    >
                                        Execute Pulse
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
