import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
    ShieldOff, Plus, Search, X, Loader2, CheckCircle,
    AlertTriangle, RefreshCw, Calendar, User
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

interface Suspension {
    id: number;
    "Employee Number": string;
    suspension_date: string;
    suspension_reason: string | null;
    duration_days: number | null;
    auto_reactivate: boolean;
    reactivation_date: string | null;
    is_active: boolean;
    exclude_from_payroll: boolean;
    notes: string | null;
    performed_by: string | null;
    employee_name?: string;
    job_title?: string;
}

interface Employee {
    "Employee Number": string;
    "First Name": string | null;
    "Last Name": string | null;
    "Job Title": string | null;
    Branch: string | null;
}

export default function SuspensionModule({ onRefresh }: { onRefresh?: () => void }) {
    const [suspensions, setSuspensions] = useState<Suspension[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');
    const [showModal, setShowModal] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({
        employeeNumber: '',
        suspension_date: new Date().toISOString().split('T')[0],
        suspension_reason: '',
        duration_days: '' as string | number,
        auto_reactivate: false,
        exclude_from_payroll: true,
        notes: ''
    });

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [suspRes, empRes] = await Promise.all([
                supabase.from('hr_suspensions').select('*').order('suspension_date', { ascending: false }),
                supabase.from('employees').select('"Employee Number", "First Name", "Last Name", "Job Title", "Branch"')
            ]);
            const emps = (empRes.data || []) as Employee[];
            setEmployees(emps);
            const merged = (suspRes.data || []).map(s => {
                const emp = emps.find(e => e['Employee Number'] === s['Employee Number']);
                return {
                    ...s,
                    employee_name: emp ? `${emp['First Name']} ${emp['Last Name']}` : s['Employee Number'],
                    job_title: emp?.['Job Title'] || '—'
                };
            });
            setSuspensions(merged);
        } catch (err) {
            console.error(err);
            toast.error('Failed to load suspension records');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    // Auto-reactivation check
    useEffect(() => {
        const today = new Date().toISOString().split('T')[0];
        const toReactivate = suspensions.filter(s =>
            s.is_active && s.auto_reactivate && s.reactivation_date && s.reactivation_date <= today
        );
        if (toReactivate.length > 0) {
            toReactivate.forEach(async s => {
                await supabase.from('hr_suspensions').update({ is_active: false }).eq('id', s.id);
                toast.success(`${s.employee_name} has been auto-reactivated`);
            });
            if (toReactivate.length > 0) fetchData();
        }
    }, [suspensions]);

    const filtered = suspensions.filter(s => {
        const matchSearch = !search || s.employee_name?.toLowerCase().includes(search.toLowerCase()) || s['Employee Number'].toLowerCase().includes(search.toLowerCase());
        const matchFilter = filter === 'all' || (filter === 'active' ? s.is_active : !s.is_active);
        return matchSearch && matchFilter;
    });

    const handleSave = async () => {
        if (!form.employeeNumber || !form.suspension_reason) {
            toast.error('Please fill all required fields');
            return;
        }
        setSaving(true);
        try {
            const durationDays = form.duration_days ? Number(form.duration_days) : null;
            let reactivationDate: string | null = null;
            if (durationDays && form.auto_reactivate) {
                const d = new Date(form.suspension_date);
                d.setDate(d.getDate() + durationDays);
                reactivationDate = d.toISOString().split('T')[0];
            }

            await supabase.from('hr_suspensions').insert({
                "Employee Number": form.employeeNumber,
                suspension_date: form.suspension_date,
                suspension_reason: form.suspension_reason,
                duration_days: durationDays,
                auto_reactivate: form.auto_reactivate,
                reactivation_date: reactivationDate,
                is_active: true,
                exclude_from_payroll: form.exclude_from_payroll,
                notes: form.notes || null,
                performed_by: 'HR Admin'
            });

            // Log history
            await supabase.from('hr_lifecycle_history').insert({
                "Employee Number": form.employeeNumber,
                event_type: 'suspension',
                event_date: new Date().toISOString(),
                new_value: { suspension_date: form.suspension_date, duration_days: durationDays, reason: form.suspension_reason },
                notes: form.notes,
                performed_by: 'HR Admin'
            });

            toast.success('Suspension recorded successfully');
            setShowModal(false);
            setForm({
                employeeNumber: '', suspension_date: new Date().toISOString().split('T')[0],
                suspension_reason: '', duration_days: '', auto_reactivate: false, exclude_from_payroll: true, notes: ''
            });
            fetchData();
            onRefresh?.();
        } catch (err) {
            console.error(err);
            toast.error('Failed to record suspension');
        } finally {
            setSaving(false);
        }
    };

    const handleReactivate = async (suspension: Suspension) => {
        try {
            await supabase.from('hr_suspensions').update({ is_active: false }).eq('id', suspension.id);

            await supabase.from('hr_lifecycle_history').insert({
                "Employee Number": suspension['Employee Number'],
                event_type: 'reactivation',
                event_date: new Date().toISOString(),
                old_value: { suspended: true },
                new_value: { active: true },
                notes: 'Employee manually reactivated by HR',
                performed_by: 'HR Admin'
            });

            toast.success(`${suspension.employee_name} has been reactivated`);
            fetchData();
            onRefresh?.();
        } catch (err) {
            toast.error('Failed to reactivate employee');
        }
    };

    const activeSuspensions = suspensions.filter(s => s.is_active).length;

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h2 className="text-lg font-bold text-gray-900">Suspension Module</h2>
                    <p className="text-xs text-gray-500">Suspend employees, set duration, auto-reactivate, and maintain full suspension history</p>
                </div>
                <button onClick={() => setShowModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 transition-colors">
                    <ShieldOff className="w-3.5 h-3.5" /> Suspend Employee
                </button>
            </div>

            {/* Active Alert */}
            {activeSuspensions > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    <p className="text-xs text-red-700 font-medium">{activeSuspensions} employee(s) currently suspended</p>
                </div>
            )}

            {/* Filters */}
            <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap gap-3 items-center">
                <div className="relative flex-1 min-w-[160px]">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type="text" placeholder="Search employee..." value={search} onChange={e => setSearch(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400" />
                </div>
                <div className="flex gap-2">
                    {(['all', 'active', 'inactive'] as const).map(f => (
                        <button key={f} onClick={() => setFilter(f)}
                            className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-all
                ${filter === f ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-600 border-gray-200 hover:border-red-300'}`}>
                            {f.charAt(0).toUpperCase() + f.slice(1)}
                        </button>
                    ))}
                </div>
            </div>

            {/* Records */}
            {loading ? (
                <div className="flex items-center justify-center h-40">
                    <Loader2 className="w-6 h-6 animate-spin text-red-500" />
                </div>
            ) : filtered.length === 0 ? (
                <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
                    <ShieldOff className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">No suspension records found</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {filtered.map(s => (
                        <motion.div key={s.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                            className={`bg-white border rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3
                ${s.is_active ? 'border-red-200 bg-red-50/30' : 'border-gray-200'}`}>
                            <div className="flex items-start gap-3">
                                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${s.is_active ? 'bg-red-100' : 'bg-gray-100'}`}>
                                    <ShieldOff className={`w-4 h-4 ${s.is_active ? 'text-red-600' : 'text-gray-400'}`} />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <p className="text-sm font-semibold text-gray-900">{s.employee_name}</p>
                                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border
                      ${s.is_active ? 'bg-red-100 text-red-700 border-red-200' : 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                                            {s.is_active ? 'Suspended' : 'Reactivated'}
                                        </span>
                                        {s.exclude_from_payroll && s.is_active && (
                                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200">
                                                Excluded from Payroll
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-gray-500 mt-0.5">{s['Employee Number']} · {s.job_title}</p>
                                    <p className="text-xs text-gray-600 mt-1">{s.suspension_reason}</p>
                                    <div className="flex items-center gap-3 mt-1">
                                        <p className="text-[10px] text-gray-400 flex items-center gap-1">
                                            <Calendar className="w-3 h-3" /> {s.suspension_date}
                                        </p>
                                        {s.duration_days && <p className="text-[10px] text-gray-400">{s.duration_days} days</p>}
                                        {s.reactivation_date && <p className="text-[10px] text-gray-400">Auto: {s.reactivation_date}</p>}
                                    </div>
                                    {s.notes && <p className="text-[10px] text-gray-400 mt-0.5">{s.notes}</p>}
                                </div>
                            </div>

                            {s.is_active && (
                                <button onClick={() => handleReactivate(s)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors flex-shrink-0">
                                    <RefreshCw className="w-3 h-3" /> Reactivate
                                </button>
                            )}
                        </motion.div>
                    ))}
                </div>
            )}

            {/* Add Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 overflow-y-auto max-h-[90vh]">
                        <div className="flex items-center justify-between mb-5">
                            <h3 className="text-sm font-bold text-gray-900">Suspend Employee</h3>
                            <button onClick={() => setShowModal(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                                <X className="w-4 h-4 text-gray-500" />
                            </button>
                        </div>
                        <div className="space-y-3">
                            <div>
                                <label className="text-xs font-medium text-gray-700 block mb-1">Employee *</label>
                                <select value={form.employeeNumber} onChange={e => setForm(f => ({ ...f, employeeNumber: e.target.value }))}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-red-400">
                                    <option value="">Select employee...</option>
                                    {employees.map(e => (
                                        <option key={e['Employee Number']} value={e['Employee Number']}>
                                            {e['First Name']} {e['Last Name']} ({e['Employee Number']})
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-700 block mb-1">Suspension Date *</label>
                                <input type="date" value={form.suspension_date} onChange={e => setForm(f => ({ ...f, suspension_date: e.target.value }))}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-red-400" />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-700 block mb-1">Suspension Reason *</label>
                                <textarea rows={3} value={form.suspension_reason} onChange={e => setForm(f => ({ ...f, suspension_reason: e.target.value }))}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
                                    placeholder="State the reason for suspension..." />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-700 block mb-1">Duration (days, optional)</label>
                                <input type="number" min={1} value={form.duration_days} onChange={e => setForm(f => ({ ...f, duration_days: e.target.value }))}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-red-400" placeholder="Leave blank for indefinite" />
                            </div>
                            <div className="space-y-2">
                                <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                                    <input type="checkbox" checked={form.auto_reactivate} onChange={e => setForm(f => ({ ...f, auto_reactivate: e.target.checked }))}
                                        className="w-3.5 h-3.5 accent-violet-600" />
                                    Auto-reactivate after duration
                                </label>
                                <label className="flex items-center gap-2 text-xs text-red-700 cursor-pointer">
                                    <input type="checkbox" checked={form.exclude_from_payroll} onChange={e => setForm(f => ({ ...f, exclude_from_payroll: e.target.checked }))}
                                        className="w-3.5 h-3.5 accent-red-600" />
                                    Exclude from payroll
                                </label>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-700 block mb-1">Additional Notes</label>
                                <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-red-400 resize-none" />
                            </div>
                        </div>
                        <div className="flex gap-2 mt-5">
                            <button onClick={() => setShowModal(false)}
                                className="flex-1 py-2 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">Cancel</button>
                            <button onClick={handleSave} disabled={saving}
                                className="flex-1 py-2 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-1">
                                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldOff className="w-3.5 h-3.5" />}
                                Confirm Suspension
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </div>
    );
}
