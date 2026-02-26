import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Search, X, Loader2, CheckCircle,
    Eye, TrendingUp, RefreshCw, Briefcase,
    Download, ChevronLeft, ChevronRight,
    ArrowUpRight, Plus, MapPin
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
        <div className="space-y-6 pb-12">
            {/* Header Section */}
            <div className="bg-white border text-gray-900 border-gray-200 rounded-lg p-6 flex flex-col md:flex-row justify-between items-center shadow-sm">
                <div>
                    <h1 className="text-xl font-semibold text-gray-900 font-sans tracking-tight">Advance Ledger</h1>
                    <p className="text-xs text-gray-500 mt-1">Salary Recovery and Disbursement Management</p>
                </div>
                <div className="flex items-center gap-4 mt-4 md:mt-0">
                    <button className="px-3 py-1.5 bg-white border border-gray-200 hover:bg-gray-50 rounded-md text-xs font-medium text-gray-700 transition-colors shadow-sm focus:outline-none flex items-center gap-2">
                        <Download className="w-4 h-4 text-gray-500" />
                        Export
                    </button>
                    <button
                        onClick={() => setShowModal(true)}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-md text-sm font-medium text-white transition-colors shadow-sm focus:outline-none flex items-center gap-2"
                    >
                        <Plus className="w-4 h-4" />
                        New Advance
                    </button>
                </div>
            </div>

            {/* Stat Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-xs font-medium text-gray-500">Total Recovered</p>
                        <p className="text-2xl font-semibold text-gray-900 mt-1">{formatKES(stats.recovered)}</p>
                        <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                            <ArrowUpRight className="w-3 h-3" /> Based on {stats.total} total
                        </p>
                    </div>
                    <div className="p-3 bg-emerald-50 text-emerald-600 rounded-lg">
                        <CheckCircle className="w-5 h-5" />
                    </div>
                </div>

                <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-xs font-medium text-gray-500">Current Exposure</p>
                        <p className="text-2xl font-semibold text-gray-900 mt-1">{formatKES(stats.outstanding)}</p>
                        <p className="text-xs text-indigo-600 mt-1 flex items-center gap-1">
                            Awaiting recovery
                        </p>
                    </div>
                    <div className="p-3 bg-indigo-50 text-indigo-600 rounded-lg">
                        <TrendingUp className="w-5 h-5" />
                    </div>
                </div>

                <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm flex items-center justify-between relative overflow-hidden">
                    <div>
                        <p className="text-xs font-medium text-gray-500">Recovery Progress</p>
                        <p className="text-2xl font-semibold text-gray-900 mt-1">{Math.round((stats.recovered / stats.disbursed) * 100 || 0)}%</p>
                        <p className="text-xs text-blue-600 mt-1 flex items-center gap-1">
                            Global Amortization
                        </p>
                    </div>
                    <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
                        <RefreshCw className="w-5 h-5" />
                    </div>
                </div>
            </div>

            {/* Table Section */}
            <div className="bg-white border border-gray-200 rounded-lg shadow-sm flex flex-col">
                {/* Search & Toolbar */}
                <div className="p-5 border-b border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="relative w-full sm:w-80">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search employee..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                        />
                    </div>

                    <div className="flex items-center gap-3 w-full sm:w-auto">
                        <div className="flex p-0.5 bg-gray-100 rounded-md border border-gray-200 w-full sm:w-auto">
                            {(['all', 'active', 'completed'] as const).map(f => (
                                <button
                                    key={f}
                                    onClick={() => setFilter(f)}
                                    className={`flex-1 sm:flex-none px-4 py-1.5 rounded text-xs font-medium capitalize transition-colors ${filter === f
                                        ? 'bg-white text-gray-900 shadow-sm border border-gray-200/50'
                                        : 'text-gray-500 hover:text-gray-900'
                                        }`}
                                >
                                    {f}
                                </button>
                            ))}
                        </div>
                        <button onClick={fetchData} className="p-2 border border-gray-300 rounded-md text-gray-500 hover:bg-gray-50 transition-colors bg-white shadow-sm flex-shrink-0">
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                </div>

                {/* Ledger Table */}
                <div className="overflow-x-auto min-h-[400px]">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-gray-50 border-b border-gray-200">
                                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Employee</th>
                                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider text-center">Status</th>
                                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Recovery Progress</th>
                                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 bg-white">
                            {currentItems.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="px-6 py-12 text-center text-gray-500 text-sm">
                                        No advance records found.
                                    </td>
                                </tr>
                            ) : currentItems.map((a) => {
                                const progress = (a.total_repaid / a.advance_amount) * 100;
                                return (
                                    <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-semibold text-sm">
                                                    {a.employee_name?.split(' ').map(n => n[0]).join('') || '?'}
                                                </div>
                                                <div>
                                                    <div className="text-sm font-medium text-gray-900">
                                                        {a.employee_name}
                                                    </div>
                                                    <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                                                        <span>{a['Employee Number']}</span>
                                                        <span className="text-gray-300">•</span>
                                                        <span className="flex items-center gap-1">
                                                            <MapPin className="w-3 h-3" /> {a.branch}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${a.is_completed
                                                ? 'bg-emerald-100 text-emerald-800'
                                                : 'bg-indigo-100 text-indigo-800'
                                                }`}>
                                                {a.is_completed ? 'Recovered' : 'Active'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="w-full max-w-xs">
                                                <div className="flex justify-between items-end mb-1">
                                                    <span className="text-xs font-medium text-gray-700">{Math.round(progress)}%</span>
                                                </div>
                                                <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                                                    <div
                                                        style={{ width: `${progress}%` }}
                                                        className={`h-full ${a.is_completed ? 'bg-emerald-500' : 'bg-indigo-600'}`}
                                                    />
                                                </div>
                                                <div className="flex justify-between text-xs mt-1">
                                                    <span className="text-gray-500">Paid: <span className="text-gray-900 font-medium">{formatKES(a.total_repaid)}</span></span>
                                                    <span className="text-gray-500">Left: <span className="text-gray-900 font-medium">{formatKES(a.remaining_balance)}</span></span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex items-center justify-end gap-3">
                                                {!a.is_completed && (
                                                    <button
                                                        onClick={() => handleRecordRepayment(a)}
                                                        className="text-xs font-medium text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded transition-colors"
                                                    >
                                                        Deduct Monthly
                                                    </button>
                                                )}
                                                <button className="text-gray-400 hover:text-gray-600 transition-colors p-1.5 hover:bg-gray-100 rounded">
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
                <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between bg-white rounded-b-lg">
                    <p className="text-xs text-gray-500">
                        Showing <span className="font-medium text-gray-900">{((currentPage - 1) * itemsPerPage) + 1}</span> to <span className="font-medium text-gray-900">{Math.min(currentPage * itemsPerPage, filtered.length)}</span> of <span className="font-medium text-gray-900">{filtered.length}</span> records
                    </p>
                    <div className="flex items-center gap-1">
                        <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} className="p-2 border border-gray-300 rounded-md bg-white text-gray-500 disabled:opacity-50 hover:bg-gray-50 transition-colors">
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <div className="flex items-center gap-1 mx-2">
                            {Array.from({ length: totalPages }, (_, i) => (
                                <button key={i} onClick={() => setCurrentPage(i + 1)} className={`w-8 h-8 rounded-md text-sm font-medium transition-colors ${currentPage === i + 1 ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'}`}>
                                    {i + 1}
                                </button>
                            ))}
                        </div>
                        <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} className="p-2 border border-gray-300 rounded-md bg-white text-gray-500 disabled:opacity-50 hover:bg-gray-50 transition-colors">
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>

            {/* New Advance Modal */}
            <AnimatePresence>
                {showModal && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-gray-900/50 backdrop-blur-sm">
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-white rounded-lg shadow-xl w-full max-w-lg overflow-hidden flex flex-col relative z-10"
                        >
                            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-white">
                                <div>
                                    <h3 className="text-lg font-semibold text-gray-900">Record New Advance</h3>
                                    <p className="text-sm text-gray-500 mt-1">Provide disbursement and recovery details</p>
                                </div>
                                <button onClick={() => setShowModal(false)} className="p-2 text-gray-400 hover:bg-gray-100 rounded-md transition-colors">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Employee</label>
                                    <div className="relative">
                                        <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                        <select
                                            value={form.employeeNumber}
                                            onChange={e => setForm(f => ({ ...f, employeeNumber: e.target.value }))}
                                            className="w-full pl-9 pr-8 py-2 bg-white border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors appearance-none"
                                        >
                                            <option value="">Select Employee...</option>
                                            {employees.map(e => (
                                                <option key={e['Employee Number']} value={e['Employee Number']}>
                                                    {e['Employee Number']} - {e['First Name']} {e['Last Name']}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Disbursement Date</label>
                                        <input
                                            type="date"
                                            value={form.advance_date}
                                            onChange={e => setForm(f => ({ ...f, advance_date: e.target.value }))}
                                            className="w-full px-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Total Amount (KES)</label>
                                        <input
                                            type="number"
                                            value={form.advance_amount || ''}
                                            onChange={e => setForm(f => ({ ...f, advance_amount: Number(e.target.value) }))}
                                            className="w-full px-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                                            placeholder="0"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Monthly Deduction (KES)</label>
                                    <input
                                        type="number"
                                        value={form.monthly_deduction || ''}
                                        onChange={e => setForm(f => ({ ...f, monthly_deduction: Number(e.target.value) }))}
                                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                                        placeholder="0"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Notes (Optional)</label>
                                    <textarea
                                        rows={3}
                                        value={form.notes}
                                        onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-colors resize-none"
                                        placeholder="Add any additional details..."
                                    />
                                </div>
                            </div>

                            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex gap-3 justify-end">
                                <button
                                    onClick={() => setShowModal(false)}
                                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSave}
                                    disabled={saving}
                                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                                >
                                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                    Save Record
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}
