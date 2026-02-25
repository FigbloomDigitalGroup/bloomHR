import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Search, X, Loader2, CheckCircle,
    DollarSign, Calendar, Building, Eye, TrendingUp, RefreshCw, Briefcase,
    AlertTriangle, Clock, Download, FileText, ChevronLeft, ChevronRight,
    Filter, Zap, ArrowUpRight, Plus, MapPin, Landmark
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

interface Advance {
    id: number;
    "Employee Number": string;
    advance_date: string;
    advance_amount: number;
    monthly_deduction: number;
    total_repaid: number;
    remaining_balance: number;
    is_completed: boolean;
    notes: string | null;
    employee_name?: string;
    branch?: string;
    town?: string;
    mobile?: string;
}

interface Employee {
    "Employee Number": string;
    "First Name": string | null;
    "Last Name": string | null;
    "Job Title": string | null;
    Branch: string | null;
    Town: string | null;
    "Mobile Number": string | null;
}

export default function AdvanceDeductionModule({ onRefresh }: { onRefresh?: () => void }) {
    const [advances, setAdvances] = useState<Advance[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all');
    const [showModal, setShowModal] = useState(false);
    const [saving, setSaving] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 8;

    const [form, setForm] = useState({
        employeeNumber: '',
        advance_date: new Date().toISOString().split('T')[0],
        advance_amount: 0,
        monthly_deduction: 0,
        notes: ''
    });

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [advRes, empRes] = await Promise.all([
                supabase.from('hr_salary_advances').select('*').order('advance_date', { ascending: false }),
                supabase.from('employees').select('"Employee Number", "First Name", "Last Name", "Job Title", "Branch", "Town", "Mobile Number"')
            ]);
            const emps = (empRes.data || []) as Employee[];
            setEmployees(emps);

            const merged = (advRes.data || []).map(a => {
                const emp = emps.find(e => e['Employee Number'] === a['Employee Number']);
                const remaining = a.advance_amount - a.total_repaid;
                return {
                    ...a,
                    remaining_balance: remaining >= 0 ? remaining : 0,
                    is_completed: remaining <= 0,
                    employee_name: emp ? `${emp['First Name']} ${emp['Last Name']}` : a['Employee Number'],
                    branch: emp?.Branch || 'N/A',
                    town: emp?.Town || 'N/A',
                    mobile: emp?.['Mobile Number'] || 'N/A'
                };
            });
            setAdvances(merged);
        } catch (err) {
            console.error(err);
            toast.error('Failed to load advance records');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    const filtered = advances.filter(a => {
        const matchSearch = !search || a.employee_name?.toLowerCase().includes(search.toLowerCase()) || a['Employee Number'].toLowerCase().includes(search.toLowerCase());
        const matchFilter = filter === 'all' || (filter === 'active' ? !a.is_completed : a.is_completed);
        return matchSearch && matchFilter;
    });

    const totalPages = Math.ceil(filtered.length / itemsPerPage);
    const currentItems = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    const handleSave = async () => {
        if (!form.employeeNumber || !form.advance_amount || !form.monthly_deduction) {
            toast.error('Please fill all required fields');
            return;
        }
        setSaving(true);
        try {
            const { error } = await supabase.from('hr_salary_advances').insert({
                "Employee Number": form.employeeNumber,
                advance_date: form.advance_date,
                advance_amount: form.advance_amount,
                monthly_deduction: form.monthly_deduction,
                total_repaid: 0,
                remaining_balance: form.advance_amount,
                is_completed: false,
                notes: form.notes || null
            });

            if (error) throw error;

            await supabase.from('hr_lifecycle_history').insert({
                "Employee Number": form.employeeNumber,
                event_type: 'other',
                event_date: new Date().toISOString(),
                new_value: { type: 'salary_advance', amount: form.advance_amount, monthly_deduction: form.monthly_deduction },
                notes: `Salary advance recorded. Amount: KES ${form.advance_amount.toLocaleString()}`,
                performed_by: 'HR Admin'
            });

            toast.success('Advance recorded successfully');
            setShowModal(false);
            setForm({ employeeNumber: '', advance_date: new Date().toISOString().split('T')[0], advance_amount: 0, monthly_deduction: 0, notes: '' });
            fetchData();
            onRefresh?.();
        } catch (err) {
            console.error(err);
            toast.error('Failed to record advance');
        } finally {
            setSaving(false);
        }
    };

    const handleRecordRepayment = async (advance: Advance) => {
        const newRepaid = advance.total_repaid + advance.monthly_deduction;
        const isNowCompleted = newRepaid >= advance.advance_amount;
        try {
            await supabase.from('hr_salary_advances').update({
                total_repaid: Math.min(newRepaid, advance.advance_amount),
                remaining_balance: Math.max(0, advance.advance_amount - newRepaid),
                is_completed: isNowCompleted
            }).eq('id', advance.id);
            toast.success(isNowCompleted ? 'Advance fully repaid! ✓' : 'Repayment recorded');
            fetchData();
        } catch (err) {
            toast.error('Failed to record repayment');
        }
    };

    const formatKES = (amt: number) => `KES ${amt.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

    // Stats
    const stats = {
        total: advances.length,
        disbursed: advances.reduce((sum, a) => sum + a.advance_amount, 0),
        recovered: advances.reduce((sum, a) => sum + a.total_repaid, 0),
        outstanding: advances.filter(a => !a.is_completed).reduce((sum, a) => sum + a.remaining_balance, 0)
    };

    return (
        <div className="space-y-8 pb-12">
            {/* Premium Header Section */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="md:col-span-1 bg-gradient-to-br from-indigo-600 to-indigo-800 rounded-[2.5rem] p-8 text-white shadow-xl shadow-indigo-100 relative overflow-hidden group"
                >
                    <div className="relative z-10 space-y-6">
                        <div className="space-y-1">
                            <h2 className="text-2xl font-black tracking-tight italic uppercase">Advance Ledger</h2>
                            <p className="text-indigo-100 text-[10px] font-black uppercase tracking-[0.2em] opacity-80">Cycle-based Recovery Orchestration</p>
                        </div>

                        <div className="flex items-center gap-3">
                            <div className="p-3 bg-white/10 rounded-2xl backdrop-blur-md">
                                <Zap className="w-5 h-5 text-indigo-300" />
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-100">Live Recovery Stream</span>
                        </div>

                        <div className="flex flex-col gap-2">
                            <motion.button
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={() => setShowModal(true)}
                                className="w-full py-4 bg-white text-indigo-600 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-xl shadow-indigo-900/20 transition-all flex items-center justify-center gap-2"
                            >
                                <Plus className="w-4 h-4" />
                                Record New Entry
                            </motion.button>
                            <button className="w-full py-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-2xl text-[9px] font-black uppercase tracking-[0.2em] transition-all">
                                Export Full Ledger
                            </button>
                        </div>
                    </div>
                    <Landmark className="absolute -bottom-10 -right-10 w-48 h-48 text-white/5" />
                </motion.div>

                {/* Stat Cards */}
                <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-6">
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
                        className="bg-white rounded-[2.5rem] p-8 border border-gray-100 shadow-sm flex flex-col justify-between group">
                        <div className="flex items-center justify-between mb-4">
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Total Recovered</p>
                            <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl group-hover:bg-emerald-600 group-hover:text-white transition-all">
                                <CheckCircle className="w-5 h-5" />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <div className="text-3xl font-black text-gray-900 tracking-tighter">
                                {formatKES(stats.recovered)}
                            </div>
                            <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest flex items-center gap-1">
                                <ArrowUpRight className="w-3 h-3" /> Based on {stats.total} total
                            </p>
                        </div>
                    </motion.div>

                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
                        className="bg-white rounded-[2.5rem] p-8 border border-gray-100 shadow-sm flex flex-col justify-between group">
                        <div className="flex items-center justify-between mb-4">
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Current Exposure</p>
                            <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl group-hover:bg-indigo-600 group-hover:text-white transition-all">
                                <TrendingUp className="w-5 h-5" />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <div className="text-3xl font-black text-gray-900 tracking-tighter">
                                {formatKES(stats.outstanding)}
                            </div>
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Awaiting scheduled recovery</p>
                        </div>
                    </motion.div>

                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
                        className="bg-white rounded-[2.5rem] p-8 border border-gray-100 shadow-sm flex flex-col justify-between group overflow-hidden relative">
                        <div className="flex items-center justify-between mb-4">
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Recovery Velocity</p>
                            <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl group-hover:bg-blue-600 group-hover:text-white transition-all">
                                <RefreshCw className="w-5 h-5" />
                            </div>
                        </div>
                        <div className="space-y-1 pr-12">
                            <div className="text-4xl font-black text-gray-900 tracking-tighter">
                                {Math.round((stats.recovered / stats.disbursed) * 100 || 0)}%
                            </div>
                            <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">Global Amortization</p>
                        </div>
                        <Activity className="absolute bottom-[-10%] right-[-10%] w-24 h-24 text-blue-50" />
                    </motion.div>
                </div>
            </div>

            {/* Table Section */}
            <div className="bg-white border border-gray-100 rounded-[2.5rem] shadow-sm overflow-hidden flex flex-col">
                {/* Search & Toolbar */}
                <div className="p-8 border-b border-gray-50 flex flex-wrap items-center justify-between gap-6 bg-gray-50/50">
                    <div className="relative flex-1 min-w-[300px]">
                        <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search employee history node..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="w-full pl-14 pr-6 py-4 bg-white border border-gray-100 rounded-[2rem] text-[11px] font-black uppercase tracking-wider focus:outline-none focus:ring-4 focus:ring-indigo-50 shadow-sm transition-all"
                        />
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="flex items-center bg-white border border-gray-100 rounded-[1.5rem] p-1.5 shadow-sm">
                            {(['all', 'active', 'completed'] as const).map(f => (
                                <button
                                    key={f}
                                    onClick={() => setFilter(f)}
                                    className={`px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${filter === f ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'text-gray-400 hover:text-indigo-600'
                                        }`}
                                >
                                    {f}
                                </button>
                            ))}
                        </div>
                        <button onClick={fetchData} className="p-4 bg-white border border-gray-100 rounded-2xl text-gray-400 hover:text-indigo-600">
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                </div>

                {/* Ledger Table */}
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="bg-gray-50/80 text-left">
                                <th className="px-10 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">Employee Node</th>
                                <th className="px-10 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Status</th>
                                <th className="px-10 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">Financial Matrix</th>
                                <th className="px-10 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Ledger Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {currentItems.map((a) => {
                                const progress = (a.total_repaid / a.advance_amount) * 100;
                                return (
                                    <tr key={a.id} className="hover:bg-indigo-50/30 transition-all group">
                                        <td className="px-10 py-8">
                                            <div className="flex items-center gap-4">
                                                <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-black shadow-lg shadow-indigo-100">
                                                    {a.employee_name?.split(' ').map(n => n[0]).join('')}
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-black text-gray-900 uppercase tracking-tight group-hover:text-indigo-600 transition-colors">
                                                        {a.employee_name}
                                                    </span>
                                                    <div className="flex items-center gap-2 text-[10px] font-bold text-gray-400">
                                                        <span className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">{a['Employee Number']}</span>
                                                        <MapPin className="w-3 h-3" /> {a.branch}
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-10 py-8 text-center">
                                            <span className={`inline-flex px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest border shadow-sm ${a.is_completed ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100'
                                                }`}>
                                                {a.is_completed ? 'Fully Recovered' : 'Recovery Active'}
                                            </span>
                                        </td>
                                        <td className="px-10 py-8">
                                            <div className="w-48 space-y-2">
                                                <div className="flex justify-between items-end">
                                                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Progress</span>
                                                    <span className="text-[11px] font-black text-gray-900">{Math.round(progress)}%</span>
                                                </div>
                                                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden border border-gray-50">
                                                    <motion.div
                                                        initial={{ width: 0 }}
                                                        animate={{ width: `${progress}%` }}
                                                        className={`h-full ${a.is_completed ? 'bg-emerald-500' : 'bg-indigo-600'}`}
                                                    />
                                                </div>
                                                <div className="flex justify-between text-[9px] font-black uppercase">
                                                    <span className="text-emerald-600">{formatKES(a.total_repaid)}</span>
                                                    <span className="text-red-500">{formatKES(a.remaining_balance)}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-10 py-8 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                {!a.is_completed && (
                                                    <motion.button
                                                        whileHover={{ scale: 1.05 }}
                                                        whileTap={{ scale: 0.95 }}
                                                        onClick={() => handleRecordRepayment(a)}
                                                        className="p-3 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-600 hover:text-white transition-all shadow-sm border border-indigo-100"
                                                        title="Deduct Installment"
                                                    >
                                                        <RefreshCw className="w-4 h-4" />
                                                    </motion.button>
                                                )}
                                                <button className="p-3 bg-gray-50 text-gray-400 hover:text-indigo-600 rounded-xl transition-all border border-gray-100">
                                                    <Eye className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                <div className="p-10 border-t border-gray-50 flex items-center justify-between bg-gray-50/30">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
                        Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, filtered.length)} of {filtered.length} nodes
                    </p>
                    <div className="flex items-center gap-2">
                        <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="p-3 bg-white border border-gray-100 rounded-2xl disabled:opacity-30">
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <div className="flex items-center gap-1 mx-4">
                            {Array.from({ length: totalPages }, (_, i) => (
                                <button key={i} onClick={() => setCurrentPage(i + 1)} className={`w-10 h-10 rounded-xl text-[10px] font-black transition-all ${currentPage === i + 1 ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-100' : 'text-gray-400 hover:text-indigo-600'}`}>
                                    {i + 1}
                                </button>
                            ))}
                        </div>
                        <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="p-3 bg-white border border-gray-100 rounded-2xl disabled:opacity-30">
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Premium Create Modal */}
            <AnimatePresence>
                {showModal && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 sm:p-12">
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowModal(false)} className="absolute inset-0 bg-gray-900/60 backdrop-blur-md" />

                        <motion.div
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.9, opacity: 0, y: 20 }}
                            className="bg-white rounded-[3rem] shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col relative z-10 border border-white/20"
                        >
                            <div className="p-10 border-b border-gray-50 flex items-center justify-between bg-gray-50/50">
                                <div className="space-y-1">
                                    <h3 className="text-2xl font-black text-gray-900 tracking-tight uppercase italic">Ledger Node Entry</h3>
                                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Authorized Liability Recognition</p>
                                </div>
                                <motion.button whileHover={{ rotate: 90 }} onClick={() => setShowModal(false)} className="p-4 bg-white text-gray-400 hover:text-red-500 rounded-2xl shadow-sm border border-gray-100 transition-colors">
                                    <X className="w-6 h-6" />
                                </motion.button>
                            </div>

                            <div className="p-10 space-y-8 max-h-[70vh] overflow-y-auto">
                                <div className="space-y-4">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Personnel Selection</label>
                                    <div className="relative">
                                        <Briefcase className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                                        <select
                                            value={form.employeeNumber}
                                            onChange={e => setForm(f => ({ ...f, employeeNumber: e.target.value }))}
                                            className="w-full pl-16 pr-6 py-5 bg-gray-50 border-none rounded-[2rem] text-sm font-black tracking-widest focus:ring-4 focus:ring-indigo-100 transition-all appearance-none"
                                        >
                                            <option value="">SCAN OR SELECT EMPLOYEE...</option>
                                            {employees.map(e => (
                                                <option key={e['Employee Number']} value={e['Employee Number']}>
                                                    {e['Employee Number']} — {e['First Name']} {e['Last Name']}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-6">
                                    <div className="space-y-4">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Disbursement Date</label>
                                        <input
                                            type="date"
                                            value={form.advance_date}
                                            onChange={e => setForm(f => ({ ...f, advance_date: e.target.value }))}
                                            className="w-full px-8 py-5 bg-gray-50 border-none rounded-[2rem] text-sm font-black tracking-widest focus:ring-4 focus:ring-indigo-100 transition-all"
                                        />
                                    </div>
                                    <div className="space-y-4">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Gross Principal (KES)</label>
                                        <input
                                            type="number"
                                            value={form.advance_amount || ''}
                                            onChange={e => setForm(f => ({ ...f, advance_amount: Number(e.target.value) }))}
                                            className="w-full px-8 py-5 bg-indigo-50 border-none rounded-[2rem] text-sm font-black tracking-widest focus:ring-4 focus:ring-indigo-100 transition-all font-mono"
                                            placeholder="0"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Monthly Installment</label>
                                    <input
                                        type="number"
                                        value={form.monthly_deduction || ''}
                                        onChange={e => setForm(f => ({ ...f, monthly_deduction: Number(e.target.value) }))}
                                        className="w-full px-8 py-5 bg-emerald-50 border-none rounded-[2rem] text-sm font-black tracking-widest focus:ring-4 focus:ring-emerald-100 transition-all font-mono"
                                        placeholder="0"
                                    />
                                </div>

                                <div className="space-y-4">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Ledger Narrative</label>
                                    <textarea
                                        rows={3}
                                        value={form.notes}
                                        onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                                        className="w-full p-8 bg-gray-50 border-none rounded-[2.5rem] text-sm font-bold tracking-tight focus:ring-4 focus:ring-indigo-100 transition-all resize-none shadow-inner"
                                        placeholder="PROVIDE TRANSACTION JUSTIFICATION..."
                                    />
                                </div>
                            </div>

                            <div className="p-10 bg-gray-50 border-t border-gray-100 flex gap-4">
                                <button
                                    onClick={() => setShowModal(false)}
                                    className="flex-1 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 hover:text-gray-600 bg-white border border-gray-200 rounded-[2rem] transition-all"
                                >
                                    Abort
                                </button>
                                <button
                                    onClick={handleSave}
                                    disabled={saving}
                                    className="flex-[2] py-5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-[2rem] text-[10px] font-black uppercase tracking-[0.2em] shadow-xl shadow-indigo-100 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                                >
                                    {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Landmark className="w-5 h-5" />}
                                    Authorize Liability
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
