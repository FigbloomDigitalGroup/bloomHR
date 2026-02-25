import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Calendar, Plus, Search, X, Loader2, CheckCircle, Clock, Bell } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

interface LeaveSchedule {
    id: number;
    "Employee Number": string;
    leave_type: string;
    leave_start_date: string;
    leave_end_date: string;
    leave_days: number;
    status: string;
    notify_5days: boolean;
    notify_1day: boolean;
    notes: string | null;
    created_at: string;
    employee_name?: string;
}

interface Employee {
    "Employee Number": string;
    "First Name": string | null;
    "Last Name": string | null;
    "Job Title": string | null;
    Branch: string | null;
}

const LEAVE_TYPES = ['Annual Leave', 'Sick Leave', 'Maternity Leave', 'Paternity Leave', 'Compassionate Leave', 'Study Leave', 'Unpaid Leave', 'Other'];

export default function LeaveScheduleAssigner({ onRefresh }: { onRefresh?: () => void }) {
    const [schedules, setSchedules] = useState<LeaveSchedule[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [showModal, setShowModal] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({
        employeeNumber: '', leave_type: 'Annual Leave',
        leave_start_date: '', leave_end_date: '', leave_days: 1,
        notify_5days: true, notify_1day: true, notes: ''
    });

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [schedulesRes, empsRes] = await Promise.all([
                supabase.from('hr_leave_schedules').select('*').order('leave_start_date', { ascending: true }),
                supabase.from('employees').select('"Employee Number", "First Name", "Last Name", "Job Title", "Branch"')
            ]);
            const emps = empsRes.data || [];
            setEmployees(emps as Employee[]);
            const merged = (schedulesRes.data || []).map(s => ({
                ...s,
                employee_name: emps.find((e: Employee) => e['Employee Number'] === s['Employee Number'])
                    ? `${emps.find((e: Employee) => e['Employee Number'] === s['Employee Number'])?.['First Name']} ${emps.find((e: Employee) => e['Employee Number'] === s['Employee Number'])?.['Last Name']}`
                    : s['Employee Number']
            }));
            setSchedules(merged);
        } catch (err) {
            console.error(err);
            toast.error('Failed to load leave schedules');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    const filtered = schedules.filter(s => {
        const matchSearch = !search || s.employee_name?.toLowerCase().includes(search.toLowerCase()) || s['Employee Number'].toLowerCase().includes(search.toLowerCase());
        const matchStatus = statusFilter === 'all' || s.status === statusFilter;
        return matchSearch && matchStatus;
    });

    const handleSave = async () => {
        if (!form.employeeNumber || !form.leave_start_date || !form.leave_end_date) {
            toast.error('Please fill all required fields');
            return;
        }
        setSaving(true);
        try {
            await supabase.from('hr_leave_schedules').insert({
                "Employee Number": form.employeeNumber,
                leave_type: form.leave_type,
                leave_start_date: form.leave_start_date,
                leave_end_date: form.leave_end_date,
                leave_days: form.leave_days,
                status: 'Scheduled',
                notify_5days: form.notify_5days,
                notify_1day: form.notify_1day,
                notes: form.notes || null
            });
            toast.success('Leave schedule assigned successfully');
            setShowModal(false);
            setForm({ employeeNumber: '', leave_type: 'Annual Leave', leave_start_date: '', leave_end_date: '', leave_days: 1, notify_5days: true, notify_1day: true, notes: '' });
            fetchData();
            onRefresh?.();
        } catch (err) {
            toast.error('Failed to save leave schedule');
        } finally {
            setSaving(false);
        }
    };

    const handleStatusChange = async (id: number, status: string) => {
        try {
            await supabase.from('hr_leave_schedules').update({ status }).eq('id', id);
            toast.success(`Status updated to ${status}`);
            fetchData();
        } catch (err) {
            toast.error('Failed to update status');
        }
    };

    const today = new Date().toISOString().split('T')[0];
    const in5Days = new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0];

    const getStatusBadge = (s: LeaveSchedule) => {
        if (s.status === 'Completed') return 'bg-gray-100 text-gray-600 border-gray-200';
        if (s.status === 'Rejected') return 'bg-red-100 text-red-700 border-red-200';
        if (s.status === 'Approved') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
        if (s.leave_start_date >= today && s.leave_start_date <= in5Days) return 'bg-amber-100 text-amber-700 border-amber-200';
        return 'bg-blue-100 text-blue-700 border-blue-200';
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h2 className="text-lg font-bold text-gray-900">Leave Schedule Assigner</h2>
                    <p className="text-xs text-gray-500">Assign, track and manage employee leave schedules with notifications</p>
                </div>
                <button onClick={() => setShowModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-xs font-medium rounded-lg hover:bg-violet-700 transition-colors">
                    <Plus className="w-3.5 h-3.5" /> Assign Leave
                </button>
            </div>

            {/* Filters */}
            <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap gap-3 items-center">
                <div className="relative flex-1 min-w-[160px]">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type="text" placeholder="Search employee..." value={search} onChange={e => setSearch(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500" />
                </div>
                <div className="flex flex-wrap gap-2">
                    {['all', 'Scheduled', 'Approved', 'Completed', 'Rejected'].map(f => (
                        <button key={f} onClick={() => setStatusFilter(f)}
                            className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-all
                ${statusFilter === f ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-600 border-gray-200 hover:border-violet-300'}`}>
                            {f === 'all' ? 'All' : f}
                        </button>
                    ))}
                </div>
            </div>

            {/* List */}
            {loading ? (
                <div className="flex items-center justify-center h-40">
                    <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
                </div>
            ) : filtered.length === 0 ? (
                <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
                    <Calendar className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">No leave schedules found</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {filtered.map(s => (
                        <motion.div key={s.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                            className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-lg bg-violet-100 flex items-center justify-center">
                                    <Calendar className="w-4 h-4 text-violet-600" />
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-gray-900">{s.employee_name}</p>
                                    <p className="text-xs text-gray-500">{s.leave_type} · {s.leave_days} day(s)</p>
                                    <p className="text-xs text-gray-400">{s.leave_start_date} → {s.leave_end_date}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                                {s.notify_5days && (
                                    <span className="text-[10px] px-2 py-1 bg-sky-50 text-sky-600 border border-sky-100 rounded-full flex items-center gap-1">
                                        <Bell className="w-2.5 h-2.5" /> 5d
                                    </span>
                                )}
                                {s.notify_1day && (
                                    <span className="text-[10px] px-2 py-1 bg-sky-50 text-sky-600 border border-sky-100 rounded-full flex items-center gap-1">
                                        <Bell className="w-2.5 h-2.5" /> 1d
                                    </span>
                                )}
                                <span className={`text-[10px] font-medium px-2 py-1 rounded-full border ${getStatusBadge(s)}`}>{s.status}</span>
                                {s.status === 'Scheduled' && (
                                    <button onClick={() => handleStatusChange(s.id, 'Approved')}
                                        className="text-[10px] px-2.5 py-1 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors">
                                        Approve
                                    </button>
                                )}
                                {s.status === 'Approved' && (
                                    <button onClick={() => handleStatusChange(s.id, 'Completed')}
                                        className="text-[10px] px-2.5 py-1 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors">
                                        Complete
                                    </button>
                                )}
                            </div>
                        </motion.div>
                    ))}
                </div>
            )}

            {/* Add Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 overflow-y-auto max-h-[90vh]">
                        <div className="flex items-center justify-between mb-5">
                            <h3 className="text-sm font-bold text-gray-900">Assign Leave Schedule</h3>
                            <button onClick={() => setShowModal(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                                <X className="w-4 h-4 text-gray-500" />
                            </button>
                        </div>
                        <div className="space-y-3">
                            <div>
                                <label className="text-xs font-medium text-gray-700 block mb-1">Employee *</label>
                                <select value={form.employeeNumber} onChange={e => setForm(f => ({ ...f, employeeNumber: e.target.value }))}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500">
                                    <option value="">Select employee...</option>
                                    {employees.map(e => (
                                        <option key={e['Employee Number']} value={e['Employee Number']}>
                                            {e['First Name']} {e['Last Name']} ({e['Employee Number']})
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-700 block mb-1">Leave Type *</label>
                                <select value={form.leave_type} onChange={e => setForm(f => ({ ...f, leave_type: e.target.value }))}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500">
                                    {LEAVE_TYPES.map(t => <option key={t}>{t}</option>)}
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs font-medium text-gray-700 block mb-1">Start Date *</label>
                                    <input type="date" value={form.leave_start_date} onChange={e => setForm(f => ({ ...f, leave_start_date: e.target.value }))}
                                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500" />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-gray-700 block mb-1">End Date *</label>
                                    <input type="date" value={form.leave_end_date} onChange={e => setForm(f => ({ ...f, leave_end_date: e.target.value }))}
                                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500" />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-700 block mb-1">Number of Days</label>
                                <input type="number" min={1} value={form.leave_days} onChange={e => setForm(f => ({ ...f, leave_days: Number(e.target.value) }))}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500" />
                            </div>
                            <div className="flex items-center gap-4">
                                <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                                    <input type="checkbox" checked={form.notify_5days} onChange={e => setForm(f => ({ ...f, notify_5days: e.target.checked }))}
                                        className="w-3.5 h-3.5 accent-violet-600" />
                                    Notify 5 days before
                                </label>
                                <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                                    <input type="checkbox" checked={form.notify_1day} onChange={e => setForm(f => ({ ...f, notify_1day: e.target.checked }))}
                                        className="w-3.5 h-3.5 accent-violet-600" />
                                    Notify 1 day before
                                </label>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-700 block mb-1">Notes</label>
                                <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none" />
                            </div>
                        </div>
                        <div className="flex gap-2 mt-5">
                            <button onClick={() => setShowModal(false)}
                                className="flex-1 py-2 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">Cancel</button>
                            <button onClick={handleSave} disabled={saving}
                                className="flex-1 py-2 text-xs bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-1">
                                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                                Assign Leave
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </div>
    );
}
