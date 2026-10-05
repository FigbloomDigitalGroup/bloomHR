import React, { useState, useEffect } from 'react';
import {
    Smartphone, DollarSign, RefreshCw,
    CheckCircle, XCircle, Clock,
    Search, Copy, ShieldCheck, Mail, AlertTriangle, Zap, Landmark
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { useUser } from '../ProtectedRoutes/UserContext';
import { PageHeader, Card, Button, EmptyState } from '../UI';

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
                } catch {
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

    const phoneInvalid = phoneNumber.length > 0 && !isValidPhone(phoneNumber);
    const amountInvalid = amount.length > 0 && !isValidAmount(amount);
    const successToday = callbacks.filter(c => c.result_code === 0 && new Date(c.callback_date).toDateString() === new Date().toDateString()).length;
    const pendingCount = callbacks.filter(c => c.status === 'Pending').length;
    const fieldClass = (invalid: boolean) =>
        `w-full pl-9 pr-3 py-2.5 bg-white border rounded-tile text-[12.5px] text-ink outline-none transition-colors ${invalid ? 'border-status-danger focus:border-status-danger' : 'border-border focus:border-brand'}`;

    return (
        <div className="pb-12">
            <PageHeader
                title="M-Pesa Zap Disbursement"
                subtitle="Instant B2C disbursement portal"
                actions={
                    <>
                        <span
                            className={`inline-flex items-center gap-1.5 px-3 py-[7px] rounded-pill text-[11.5px] font-bold ${autoRefresh ? 'bg-green-tint text-brand-dark' : 'bg-secondary text-muted-foreground'}`}
                            role="status"
                        >
                            <span className={`w-1.5 h-1.5 rounded-full ${autoRefresh ? 'bg-status-success' : 'bg-subtle'}`} />
                            {autoRefresh ? 'Stream Active' : 'Stream Paused'}
                        </span>
                        <Button variant="secondary" onClick={() => setAutoRefresh(!autoRefresh)}>
                            {autoRefresh ? 'Pause' : 'Resume'}
                        </Button>
                    </>
                }
            />

            {/* Summary cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-[18px]">
                <Card className="flex items-center gap-3">
                    <div className="w-[38px] h-[38px] shrink-0 rounded-tile bg-secondary text-muted-foreground flex items-center justify-center">
                        <Landmark className="w-[17px] h-[17px]" strokeWidth={1.8} />
                    </div>
                    <div>
                        <div className="text-[11px] font-semibold text-muted-foreground">Utility Balance</div>
                        <div className="text-base font-bold text-ink">{utilityBalance}</div>
                        <div className="text-[10.5px] text-subtle">Paybill: 4084659</div>
                    </div>
                </Card>
                <Card className="flex items-center gap-3">
                    <div className="w-[38px] h-[38px] shrink-0 rounded-tile bg-green-tint text-brand-dark flex items-center justify-center">
                        <CheckCircle className="w-[17px] h-[17px]" strokeWidth={1.8} />
                    </div>
                    <div>
                        <div className="text-[11px] font-semibold text-muted-foreground">Daily Success</div>
                        <div className="text-lg font-bold text-ink">{successToday} {successToday === 1 ? 'transfer' : 'transfers'}</div>
                    </div>
                </Card>
                <Card className="flex items-center gap-3">
                    <div className="w-[38px] h-[38px] shrink-0 rounded-tile bg-orange-tint text-orange-text flex items-center justify-center">
                        <Clock className="w-[17px] h-[17px]" strokeWidth={1.8} />
                    </div>
                    <div>
                        <div className="text-[11px] font-semibold text-muted-foreground">Pending Transfers</div>
                        <div className="text-lg font-bold text-ink">{pendingCount} in queue</div>
                    </div>
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-4 items-start">
                {/* Initiate payment */}
                <Card className="!p-5">
                    <h2 className="m-0 text-[13px] font-bold text-ink">Initiate Payment</h2>
                    <p className="m-0 text-[11.5px] text-muted-foreground mb-4">Send funds directly to a mobile number</p>

                    <form onSubmit={handleInitiateZap} className="space-y-3.5" noValidate>
                        <div>
                            <label htmlFor="zap-phone" className="block text-[11px] font-bold text-ink mb-1.5">Phone Number</label>
                            <div className="relative">
                                <Smartphone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
                                <input
                                    id="zap-phone"
                                    type="text"
                                    inputMode="numeric"
                                    autoComplete="off"
                                    placeholder="2547XXXXXXXX"
                                    value={phoneNumber}
                                    onChange={(e) => setPhoneNumber(e.target.value.trim())}
                                    aria-invalid={phoneInvalid}
                                    aria-describedby="zap-phone-hint"
                                    className={fieldClass(phoneInvalid)}
                                />
                            </div>
                            <p id="zap-phone-hint" className={`m-0 text-[10px] mt-1 ${phoneInvalid ? 'text-status-danger' : 'text-subtle'}`}>
                                {phoneInvalid ? 'Use 2547XXXXXXXX or 2541XXXXXXXX (12 digits)' : 'Must be Safaricom 254 format'}
                            </p>
                        </div>

                        <div>
                            <label htmlFor="zap-amount" className="block text-[11px] font-bold text-ink mb-1.5">Amount (KES)</label>
                            <div className="relative">
                                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
                                <input
                                    id="zap-amount"
                                    type="number"
                                    placeholder="Min 10 - Max 100,000"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    aria-invalid={amountInvalid}
                                    aria-describedby="zap-amount-hint"
                                    className={fieldClass(amountInvalid)}
                                />
                            </div>
                            <p id="zap-amount-hint" className={`m-0 text-[10px] mt-1 ${amountInvalid ? 'text-status-danger' : 'text-subtle'}`}>
                                {amountInvalid ? 'Amount must be between 10 and 100,000' : 'Between KES 10 and KES 100,000'}
                            </p>
                        </div>

                        <Button
                            type="submit"
                            disabled={loading}
                            className="w-full justify-center !py-2.5 !text-[12.5px] !font-bold"
                            icon={loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" strokeWidth={2} />}
                        >
                            Send Payment
                        </Button>
                    </form>

                    <div className="flex gap-2 p-3 mt-4 bg-background rounded-xl">
                        <ShieldCheck className="w-[15px] h-[15px] text-brand shrink-0 mt-px" strokeWidth={1.8} />
                        <p className="m-0 text-[10.5px] text-muted-foreground">
                            All disbursements require admin email verification before final execution to prevent unauthorized transfers.
                        </p>
                    </div>
                </Card>

                {/* Transaction history */}
                <Card padding="none" className="overflow-hidden flex flex-col h-[600px]">
                    <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                        <div>
                            <h2 className="m-0 text-[13px] font-bold text-ink">Transaction History</h2>
                            <p className="m-0 text-[11px] text-muted-foreground">Real-time record of all disbursements</p>
                        </div>
                        <button
                            type="button"
                            aria-label="Refresh transactions"
                            onClick={fetchCallbacks}
                            className="p-2 bg-white border border-border rounded-tile text-muted-foreground hover:text-brand hover:bg-secondary transition-colors"
                        >
                            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4">
                        {callbacks.length > 0 ? (
                            <div className="space-y-2.5">
                                {callbacks.map((log) => {
                                    const isPending = log.status === 'Pending';
                                    const isSuccess = log.result_code === 0;
                                    return (
                                        <div
                                            key={log.id}
                                            className="group flex items-center justify-between gap-3 p-3.5 bg-white border border-[#F1F5F2] hover:border-border rounded-xl transition-colors"
                                        >
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className={`w-10 h-10 rounded-tile flex items-center justify-center shrink-0 ${isPending ? 'bg-orange-tint text-orange-text' : isSuccess ? 'bg-green-tint text-brand-dark' : 'bg-orange-tint-alt text-status-danger'}`}>
                                                    {isPending ? <Clock className="w-5 h-5 animate-pulse" /> : isSuccess ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-xs font-bold text-ink truncate">
                                                            {log.employee_name || log.transaction_id || 'Pending Transfer'}
                                                        </span>
                                                        <button
                                                            type="button"
                                                            aria-label="Copy transaction ID"
                                                            onClick={() => copyToClipboard(log.transaction_id || '')}
                                                            className="text-subtle hover:text-brand opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                                                        >
                                                            <Copy className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                                                        <span className="truncate">{log.phone_number || log.originator_conversation_id}</span>
                                                        <span className="w-1 h-1 rounded-full bg-border shrink-0" />
                                                        <span>{log.result_type || 'B2C'}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <div className="text-[13px] font-bold text-ink">KES {(log.amount ?? 0).toLocaleString()}</div>
                                                <div className="text-[11px] text-subtle mt-0.5 flex items-center justify-end gap-1">
                                                    <Clock className="w-3 h-3" />
                                                    {log.callback_date ? new Date(log.callback_date).toLocaleTimeString() : '---'}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <EmptyState
                                className="h-full justify-center"
                                icon={<Search size={20} />}
                                title="No recent transactions"
                                description="Disbursements will appear here"
                            />
                        )}
                    </div>
                </Card>
            </div>

            {/* Verification Modal */}
            <AnimatePresence>
                {showConfirm && (
                    <div
                        className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-black/40"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="zap-confirm-title"
                    >
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-white rounded-card shadow-xl w-full max-w-md overflow-hidden flex flex-col relative z-10 border border-border"
                        >
                            <div className="p-6 border-b border-border flex flex-col items-center text-center">
                                <div className="w-12 h-12 rounded-full bg-orange-tint flex items-center justify-center text-orange mb-4">
                                    <AlertTriangle className="w-6 h-6" />
                                </div>
                                <h2 id="zap-confirm-title" className="m-0 text-base font-bold text-ink">Confirm Payment</h2>
                                <p className="m-0 text-[13px] text-muted-foreground mt-2">
                                    You are about to transfer <span className="font-bold text-ink">KES {Number(amount).toLocaleString()}</span> to <span className="font-bold text-ink">{phoneNumber}</span>.
                                </p>
                            </div>

                            <div className="p-6 space-y-4">
                                <div>
                                    <label htmlFor="zap-confirm-email" className="block text-[11px] font-bold text-ink mb-1.5">Confirm Admin Email</label>
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-subtle" />
                                        <input
                                            id="zap-confirm-email"
                                            type="email"
                                            placeholder="Enter your admin email"
                                            value={confirmEmail}
                                            onChange={(e) => setConfirmEmail(e.target.value)}
                                            className={fieldClass(false)}
                                        />
                                    </div>
                                    <p className="m-0 text-[10px] text-subtle mt-1">Verify with: {user?.email}</p>
                                </div>

                                <div className="flex gap-3 pt-1">
                                    <Button variant="secondary" className="flex-1 justify-center" onClick={() => setShowConfirm(false)}>
                                        Cancel
                                    </Button>
                                    <Button
                                        className="flex-1 justify-center"
                                        onClick={handleConfirmSend}
                                        disabled={!confirmEmail || loading}
                                        icon={loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : undefined}
                                    >
                                        Confirm
                                    </Button>
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
