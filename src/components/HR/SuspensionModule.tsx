import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ShieldOff, Search, X, Loader2, CheckCircle,
    AlertTriangle, RefreshCw, Calendar, ChevronLeft,
    ChevronRight, ChevronDown, Users, Building2, MapPin
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

interface Suspension {
    id: number;
    'Employee Number': string;
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
    branch?: string;
    region?: string;
}

interface Employee {
    'Employee Number': string;
    'First Name': string | null;
    'Last Name': string | null;
    'Job Title': string | null;
    Branch: string | null;
    Town?: string | null;
}

const PAGE_SIZE = 15;

// ── Premium Select ──────────────────────────────────────────────────────
function PremiumSelect({
    value, onChange, options, placeholder, icon: Icon
}: {
    value: string; onChange: (v: string) => void;
    options: { label: string; value: string }[];
    placeholder: string; icon?: React.ElementType;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const selected = options.find(o => o.value === value);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    return (
        <div className="relative w-full" ref={ref}>
            <button type="button" onClick={() => setOpen(o => !o)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 text-xs border rounded-xl bg-white transition-all ${open ? 'border-red-400 ring-2 ring-red-300' : 'border-gray-200 hover:border-gray-300'}`}>
                <div className="flex items-center gap-2 min-w-0">
                    {Icon && <Icon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />}
                    <span className={`truncate ${selected ? 'text-gray-800 font-medium' : 'text-gray-400'}`}>
                        {selected?.label || placeholder}
                    </span>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            <AnimatePresence>
                {open && (
                    <motion.div initial={{ opacity: 0, y: 6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 4, scale: 0.97 }} transition={{ duration: 0.12 }}
                        className="absolute z-50 left-0 right-0 mt-1.5 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                        <div className="max-h-52 overflow-y-auto py-1">
                            {options.map(opt => (
                                <button key={opt.value} type="button"
                                    onClick={() => { onChange(opt.value); setOpen(false); }}
                                    className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-gray-50 ${value === opt.value ? 'text-red-600 bg-red-50 font-medium' : 'text-gray-700'}`}>
                                    {opt.label}
                                    {value === opt.value && <CheckCircle className="w-3 h-3 flex-shrink-0" />}
                                </button>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

// ── Premium Date Picker ───────────────────────────────────────────────────
function PremiumDatePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const [open, setOpen] = useState(false);
    const [viewDate, setViewDate] = useState(() => value ? new Date(value + 'T00:00') : new Date());
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const year = viewDate.getFullYear(), month = viewDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const displayValue = value ? new Date(value + 'T00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

    return (
        <div className="relative w-full" ref={ref}>
            <button type="button" onClick={() => setOpen(o => !o)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 text-xs border rounded-xl bg-white transition-all ${open ? 'border-red-400 ring-2 ring-red-300' : 'border-gray-200 hover:border-gray-300'}`}>
                <div className="flex items-center gap-2">
                    <Calendar className="w-3.5 h-3.5 text-gray-400" />
                    <span className={value ? 'text-gray-800 font-medium' : 'text-gray-400'}>{displayValue || 'Select date'}</span>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            <AnimatePresence>
                {open && (
                    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        transition={{ duration: 0.12 }}
                        className="absolute z-50 left-0 mt-1.5 bg-white border border-gray-200 rounded-xl shadow-lg p-3 w-64">
                        <div className="flex items-center justify-between mb-3">
                            <button type="button" onClick={() => setViewDate(new Date(year, month - 1, 1))} className="p-1 hover:bg-gray-100 rounded-lg"><ChevronLeft className="w-3.5 h-3.5" /></button>
                            <span className="text-xs font-semibold">{monthNames[month]} {year}</span>
                            <button type="button" onClick={() => setViewDate(new Date(year, month + 1, 1))} className="p-1 hover:bg-gray-100 rounded-lg"><ChevronRight className="w-3.5 h-3.5" /></button>
                        </div>
                        <div className="grid grid-cols-7 gap-0.5 mb-1">
                            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i} className="text-center text-[10px] font-medium text-gray-400 py-0.5">{d}</div>)}
                        </div>
                        <div className="grid grid-cols-7 gap-0.5">
                            {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
                            {Array.from({ length: daysInMonth }).map((_, i) => {
                                const day = i + 1;
                                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                                const isSelected = dateStr === value;
                                const isToday = dateStr === new Date().toISOString().split('T')[0];
                                return (
                                    <button key={day} type="button"
                                        onClick={() => { onChange(dateStr); setOpen(false); }}
                                        className={`text-[11px] py-1 rounded-lg text-center font-medium transition-colors
                                            ${isSelected ? 'bg-red-600 text-white' : isToday ? 'bg-red-100 text-red-700' : 'text-gray-700 hover:bg-gray-100'}`}>
                                        {day}
                                    </button>
                                );
                            })}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

// ── Main Component ────────────────────────────────────────────────────────
export default function SuspensionModule({ onRefresh }: { onRefresh?: () => void }) {
    const [suspensions, setSuspensions] = useState<Suspension[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [branchFilter, setBranchFilter] = useState('');
    const [regionFilter, setRegionFilter] = useState('');
    const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');
    const [page, setPage] = useState(1);
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
                supabase.from('employees').select('"Employee Number", "First Name", "Last Name", "Job Title", "Branch", "Town"')
            ]);
            const emps = (empRes.data || []) as Employee[];
            setEmployees(emps);
            const empMap = new Map(emps.map(e => [e['Employee Number'], e]));
            const merged = (suspRes.data || []).map(s => {
                const emp = empMap.get(s['Employee Number']);
                return {
                    ...s,
                    employee_name: emp ? `${emp['First Name'] || ''} ${emp['Last Name'] || ''}`.trim() : s['Employee Number'],
                    job_title: emp?.['Job Title'] || '—',
                    branch: emp?.Branch || '',
                    region: emp?.Town || ''
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

    // Auto-reactivation
    useEffect(() => {
        const today = new Date().toISOString().split('T')[0];
        const toReactivate = suspensions.filter(s => s.is_active && s.auto_reactivate && s.reactivation_date && s.reactivation_date <= today);
        if (toReactivate.length > 0) {
            toReactivate.forEach(async s => {
                await supabase.from('hr_suspensions').update({ is_active: false }).eq('id', s.id);
                toast.success(`${s.employee_name} auto-reactivated`);
            });
            fetchData();
        }
    }, [suspensions, fetchData]);

    const branches = Array.from(new Set(employees.map(e => e.Branch).filter(Boolean))) as string[];
    const regions = Array.from(new Set(employees.map(e => e.Town).filter(Boolean))) as string[];

    const filtered = suspensions.filter(s => {
        const matchSearch = !search || s.employee_name?.toLowerCase().includes(search.toLowerCase()) || s['Employee Number'].toLowerCase().includes(search.toLowerCase());
        const matchFilter = filter === 'all' || (filter === 'active' ? s.is_active : !s.is_active);
        const matchBranch = !branchFilter || s.branch === branchFilter;
        const matchRegion = !regionFilter || s.region === regionFilter;
        return matchSearch && matchFilter && matchBranch && matchRegion;
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    const activeSuspensions = suspensions.filter(s => s.is_active).length;

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
                const d = new Date(form.suspension_date + 'T00:00');
                d.setDate(d.getDate() + durationDays);
                reactivationDate = d.toISOString().split('T')[0];
            }
            await supabase.from('hr_suspensions').insert({
                'Employee Number': form.employeeNumber,
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
            await supabase.from('hr_lifecycle_history').insert({
                'Employee Number': form.employeeNumber,
                event_type: 'suspension',
                event_date: new Date().toISOString(),
                new_value: { suspension_date: form.suspension_date, duration_days: durationDays, reason: form.suspension_reason },
                notes: form.notes,
                performed_by: 'HR Admin'
            });
            toast.success('Suspension recorded');
            setShowModal(false);
            setForm({ employeeNumber: '', suspension_date: new Date().toISOString().split('T')[0], suspension_reason: '', duration_days: '', auto_reactivate: false, exclude_from_payroll: true, notes: '' });
            fetchData(); onRefresh?.();
        } catch {
            toast.error('Failed to record suspension');
        } finally {
            setSaving(false);
        }
    };

    const handleReactivate = async (s: Suspension) => {
        try {
            await supabase.from('hr_suspensions').update({ is_active: false }).eq('id', s.id);
            await supabase.from('hr_lifecycle_history').insert({
                'Employee Number': s['Employee Number'],
                event_type: 'reactivation',
                event_date: new Date().toISOString(),
                old_value: { suspended: true },
                new_value: { active: true },
                notes: 'Employee manually reactivated by HR',
                performed_by: 'HR Admin'
            });
            toast.success(`${s.employee_name} reactivated`);
            fetchData(); onRefresh?.();
        } catch {
            toast.error('Failed to reactivate');
        }
    };

    const empOptions = employees.map(e => ({
        label: `${e['First Name'] || ''} ${e['Last Name'] || ''} (${e['Employee Number']})`.trim(),
        value: e['Employee Number']
    }));

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h2 className="text-lg font-bold text-gray-900">Suspension Management</h2>
                    <p className="text-xs text-gray-500">Suspend employees, set duration, auto-reactivate · {suspensions.length} total records</p>
                </div>
                <button onClick={() => setShowModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 transition-colors">
                    <ShieldOff className="w-3.5 h-3.5" /> Suspend Employee
                </button>
            </div>

            {/* Active alert */}
            {activeSuspensions > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    <p className="text-xs text-red-700 font-medium">{activeSuspensions} employee(s) currently suspended</p>
                </div>
            )}

            {/* Filters */}
            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
                <div className="flex flex-wrap gap-3 items-center">
                    <div className="relative flex-1 min-w-[180px]">
                        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input type="text" placeholder="Search employee..." value={search}
                            onChange={e => { setSearch(e.target.value); setPage(1); }}
                            className="w-full pl-9 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400" />
                    </div>
                    <div className="w-40">
                        <PremiumSelect value={branchFilter} onChange={v => { setBranchFilter(v); setPage(1); }}
                            options={[{ label: 'All Branches', value: '' }, ...branches.map(b => ({ label: b, value: b }))]}
                            placeholder="Branch" icon={Building2} />
                    </div>
                    <div className="w-40">
                        <PremiumSelect value={regionFilter} onChange={v => { setRegionFilter(v); setPage(1); }}
                            options={[{ label: 'All Regions', value: '' }, ...regions.map(r => ({ label: r, value: r }))]}
                            placeholder="Region" icon={MapPin} />
                    </div>
                </div>
                <div className="flex gap-2">
                    {(['all', 'active', 'inactive'] as const).map(f => (
                        <button key={f} onClick={() => { setFilter(f); setPage(1); }}
                            className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-all
                                ${filter === f ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-600 border-gray-200 hover:border-red-300'}`}>
                            {f.charAt(0).toUpperCase() + f.slice(1)}
                            {f === 'active' && activeSuspensions > 0 && (
                                <span className="ml-1.5 bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full text-[9px] font-bold">{activeSuspensions}</span>
                            )}
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
                <>
                    <div className="space-y-2.5">
                        {paginated.map(s => (
                            <motion.div key={s.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                                className={`bg-white border rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${s.is_active ? 'border-red-200 bg-red-50/20' : 'border-gray-200'}`}>
                                <div className="flex items-start gap-3">
                                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${s.is_active ? 'bg-red-100' : 'bg-gray-100'}`}>
                                        <ShieldOff className={`w-4 h-4 ${s.is_active ? 'text-red-600' : 'text-gray-400'}`} />
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <p className="text-sm font-semibold text-gray-900">{s.employee_name}</p>
                                            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${s.is_active ? 'bg-red-100 text-red-700 border-red-200' : 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                                                {s.is_active ? 'Suspended' : 'Reactivated'}
                                            </span>
                                            {s.exclude_from_payroll && s.is_active && (
                                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200">Excl. Payroll</span>
                                            )}
                                        </div>
                                        <p className="text-xs text-gray-500 mt-0.5">{s['Employee Number']} · {s.job_title}</p>
                                        {s.branch && <p className="text-[10px] text-gray-400">{s.branch}{s.region ? ` · ${s.region}` : ''}</p>}
                                        <p className="text-xs text-gray-600 mt-1">{s.suspension_reason}</p>
                                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                                            <p className="text-[10px] text-gray-400 flex items-center gap-1"><Calendar className="w-3 h-3" /> {s.suspension_date}</p>
                                            {s.duration_days && <p className="text-[10px] text-gray-400">{s.duration_days} days</p>}
                                            {s.reactivation_date && <p className="text-[10px] text-gray-400">Auto-reactivate: {s.reactivation_date}</p>}
                                        </div>
                                        {s.notes && <p className="text-[10px] text-gray-400 mt-0.5 italic">"{s.notes}"</p>}
                                    </div>
                                </div>
                                {s.is_active && (
                                    <button onClick={() => handleReactivate(s)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 flex-shrink-0">
                                        <RefreshCw className="w-3 h-3" /> Reactivate
                                    </button>
                                )}
                            </motion.div>
                        ))}
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between pt-1">
                            <span className="text-xs text-gray-500">{filtered.length} records · Page {page} of {totalPages}</span>
                            <div className="flex gap-1">
                                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                                    className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 flex items-center gap-1">
                                    <ChevronLeft className="w-3 h-3" /> Prev
                                </button>
                                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                    const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
                                    return p <= totalPages ? (
                                        <button key={p} onClick={() => setPage(p)}
                                            className={`px-3 py-1.5 text-xs rounded-lg border ${p === page ? 'bg-red-600 text-white border-red-600' : 'border-gray-200 hover:bg-gray-50'}`}>{p}</button>
                                    ) : null;
                                })}
                                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                                    className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 flex items-center gap-1">
                                    Next <ChevronRight className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* Add Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh] overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
                            <div>
                                <h3 className="text-sm font-bold text-gray-900">Suspend Employee</h3>
                                <p className="text-[11px] text-gray-500 mt-0.5">Record a suspension with reason and duration</p>
                            </div>
                            <button onClick={() => setShowModal(false)} className="p-1.5 hover:bg-gray-100 rounded-xl transition-colors">
                                <X className="w-4 h-4 text-gray-500" />
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
                            <div className="space-y-4">
                                <div>
                                    <label className="text-xs font-semibold text-gray-700 block mb-1.5">Employee *</label>
                                    <PremiumSelect value={form.employeeNumber}
                                        onChange={v => setForm(f => ({ ...f, employeeNumber: v }))}
                                        options={empOptions} placeholder="Select employee..." icon={Users} />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-gray-700 block mb-1.5">Suspension Date *</label>
                                    <PremiumDatePicker value={form.suspension_date}
                                        onChange={v => setForm(f => ({ ...f, suspension_date: v }))} />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-gray-700 block mb-1.5">Suspension Reason *</label>
                                    <textarea rows={3} value={form.suspension_reason}
                                        onChange={e => setForm(f => ({ ...f, suspension_reason: e.target.value }))}
                                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
                                        placeholder="State the reason for suspension..." />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-gray-700 block mb-1.5">Duration (days, optional)</label>
                                    <input type="number" min={1} value={form.duration_days}
                                        onChange={e => setForm(f => ({ ...f, duration_days: e.target.value }))}
                                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-red-400"
                                        placeholder="Leave blank for indefinite" />
                                </div>
                                <div className="flex flex-col gap-2.5">
                                    <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                                        <input type="checkbox" checked={form.auto_reactivate}
                                            onChange={e => setForm(f => ({ ...f, auto_reactivate: e.target.checked }))}
                                            className="w-3.5 h-3.5 accent-violet-600" />
                                        Auto-reactivate after duration
                                    </label>
                                    <label className="flex items-center gap-2 text-xs text-red-700 cursor-pointer">
                                        <input type="checkbox" checked={form.exclude_from_payroll}
                                            onChange={e => setForm(f => ({ ...f, exclude_from_payroll: e.target.checked }))}
                                            className="w-3.5 h-3.5 accent-red-600" />
                                        Exclude from payroll
                                    </label>
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-gray-700 block mb-1.5">Additional Notes</label>
                                    <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-red-400 resize-none" />
                                </div>
                            </div>
                        </div>

                        <div className="px-6 py-4 border-t border-gray-100 flex gap-3 flex-shrink-0 bg-gray-50/50">
                            <button onClick={() => setShowModal(false)}
                                className="flex-1 py-2.5 text-xs font-semibold border border-gray-200 rounded-xl hover:bg-gray-100 text-gray-600 transition-colors">Cancel</button>
                            <button onClick={handleSave} disabled={saving}
                                className="flex-1 py-2.5 text-xs font-semibold bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-1.5 transition-colors">
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
