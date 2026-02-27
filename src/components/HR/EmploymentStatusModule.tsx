import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Users, Clock, AlertTriangle, CheckCircle,
    RefreshCw, Search, ChevronRight, Calendar,
    Edit3, UserCheck, Loader2, Plus, X,
    ChevronLeft, ChevronDown, MapPin, Building2
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

type EmploymentType = 'Attachment' | 'Probation' | 'Contract' | 'Permanent';
type DurationUnit = 'months' | 'weeks';

interface EmploymentStatus {
    id: number;
    'Employee Number': string;
    employment_type: EmploymentType;
    joining_date: string | null;
    probation_duration_months: number | null;
    contract_duration_months: number | null;
    probation_end_date: string | null;
    contract_end_date: string | null;
    is_confirmed: boolean;
    notes: string | null;
}

interface Employee {
    'Employee Number': string;
    'First Name': string | null;
    'Last Name': string | null;
    'Job Title': string | null;
    Branch: string | null;
    Town?: string | null;
}

type HRAction = 'confirm' | 'extend_probation' | 'terminate_probation' | 'renew_contract' | 'convert_permanent' | 'terminate_contract' | null;

const PAGE_SIZE = 15;

// ── Premium Select Component ──────────────────────────────────────────────
function PremiumSelect({
    value, onChange, options, placeholder, icon: Icon, accentColor = 'violet'
}: {
    value: string; onChange: (v: string) => void;
    options: { label: string; value: string }[];
    placeholder: string; icon?: React.ElementType; accentColor?: string;
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

    const ringColor = accentColor === 'red' ? 'ring-red-400' : 'ring-violet-500';
    const activeText = accentColor === 'red' ? 'text-red-600 bg-red-50' : 'text-violet-700 bg-violet-50';

    return (
        <div className="relative w-full" ref={ref}>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 text-xs border rounded-xl bg-white transition-all ${open ? `border-violet-400 ring-2 ${ringColor}` : 'border-gray-200 hover:border-gray-300'}`}
            >
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
                    <motion.div
                        initial={{ opacity: 0, y: 6, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 4, scale: 0.97 }}
                        transition={{ duration: 0.12 }}
                        className="absolute z-50 left-0 right-0 mt-1.5 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden"
                    >
                        <div className="max-h-52 overflow-y-auto py-1">
                            {options.map(opt => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => { onChange(opt.value); setOpen(false); }}
                                    className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between transition-colors hover:bg-gray-50 ${value === opt.value ? activeText + ' font-medium' : 'text-gray-700'}`}
                                >
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
function PremiumDatePicker({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string }) {
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

    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const handleDay = (day: number) => {
        const d = new Date(year, month, day);
        const str = d.toISOString().split('T')[0];
        onChange(str);
        setOpen(false);
    };

    const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
    const nextMonth = () => setViewDate(new Date(year, month + 1, 1));

    const displayValue = value ? new Date(value + 'T00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

    return (
        <div className="relative w-full" ref={ref}>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 text-xs border rounded-xl bg-white transition-all ${open ? 'border-violet-400 ring-2 ring-violet-500' : 'border-gray-200 hover:border-gray-300'}`}
            >
                <div className="flex items-center gap-2">
                    <Calendar className="w-3.5 h-3.5 text-gray-400" />
                    <span className={value ? 'text-gray-800 font-medium' : 'text-gray-400'}>{displayValue || label || 'Select date'}</span>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ opacity: 0, y: 6, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 4, scale: 0.97 }}
                        transition={{ duration: 0.12 }}
                        className="absolute z-50 left-0 mt-1.5 bg-white border border-gray-200 rounded-xl shadow-lg p-3 w-64"
                    >
                        <div className="flex items-center justify-between mb-3">
                            <button type="button" onClick={prevMonth} className="p-1 hover:bg-gray-100 rounded-lg"><ChevronLeft className="w-3.5 h-3.5" /></button>
                            <span className="text-xs font-semibold text-gray-800">{monthNames[month]} {year}</span>
                            <button type="button" onClick={nextMonth} className="p-1 hover:bg-gray-100 rounded-lg"><ChevronRight className="w-3.5 h-3.5" /></button>
                        </div>
                        <div className="grid grid-cols-7 gap-0.5 mb-1">
                            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                                <div key={i} className="text-center text-[10px] font-medium text-gray-400 py-0.5">{d}</div>
                            ))}
                        </div>
                        <div className="grid grid-cols-7 gap-0.5">
                            {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
                            {Array.from({ length: daysInMonth }).map((_, i) => {
                                const day = i + 1;
                                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                                const isSelected = dateStr === value;
                                const isToday = dateStr === new Date().toISOString().split('T')[0];
                                return (
                                    <button
                                        key={day} type="button" onClick={() => handleDay(day)}
                                        className={`text-[11px] py-1 rounded-lg text-center transition-colors font-medium
                                            ${isSelected ? 'bg-violet-600 text-white' : isToday ? 'bg-violet-100 text-violet-700' : 'text-gray-700 hover:bg-gray-100'}`}
                                    >{day}</button>
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
export default function EmploymentStatusModule({ onRefresh }: { onRefresh?: () => void }) {
    const [statusList, setStatusList] = useState<(EmploymentStatus & { employee?: Employee })[]>([]);
    const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<EmploymentType | 'all' | 'missing_date' | 'overdue'>('all');
    const [search, setSearch] = useState('');
    const [branchFilter, setBranchFilter] = useState('');
    const [regionFilter, setRegionFilter] = useState('');
    const [page, setPage] = useState(1);

    // Action modal
    const [showModal, setShowModal] = useState(false);
    const [selectedRecord, setSelectedRecord] = useState<(EmploymentStatus & { employee?: Employee }) | null>(null);
    const [actionType, setActionType] = useState<HRAction>(null);
    const [actionNotes, setActionNotes] = useState('');
    const [extensionMonths, setExtensionMonths] = useState(1);
    const [saving, setSaving] = useState(false);

    // Add modal
    const [showAddModal, setShowAddModal] = useState(false);
    const [addForm, setAddForm] = useState({
        employeeNumber: '', employment_type: 'Probation' as EmploymentType,
        joining_date: '',
        probation_value: 3, probation_unit: 'months' as DurationUnit,
        contract_duration_months: 12, notes: ''
    });

    // Bulk select
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [showBulkModal, setShowBulkModal] = useState(false);
    const [bulkType, setBulkType] = useState<EmploymentType>('Permanent');

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [settingsRes, statusRes, empRes] = await Promise.all([
                supabase.from('hr_contract_settings').select('*').single(),
                supabase.from('hr_employment_status').select('*').order('id', { ascending: false }),
                supabase.from('employees').select('"Employee Number", "First Name", "Last Name", "Job Title", "Branch", "Town"')
            ]);

            const emps = (empRes.data || []) as Employee[];
            setAllEmployees(emps);

            if (settingsRes.data) {
                setAddForm(f => ({ ...f, probation_value: settingsRes.data.default_probation_months, contract_duration_months: settingsRes.data.default_contract_months }));
            }

            // Merge employment statuses with full employee data
            const statusData = (statusRes.data || []) as EmploymentStatus[];
            const statusMap = new Map(statusData.map(s => [s['Employee Number'], s]));

            // Auto-populate ALL employees
            const withStatus = emps.map(emp => {
                const existingStatus = statusMap.get(emp['Employee Number']);
                if (existingStatus) {
                    return { ...existingStatus, employee: emp };
                }
                // If they don't have a status, create a mock unassigned representation
                return {
                    id: Math.random() * -1000000, // Negative mock ID
                    'Employee Number': emp['Employee Number'],
                    employment_type: 'Probation' as EmploymentType,
                    joining_date: null,
                    probation_duration_months: null,
                    contract_duration_months: null,
                    probation_end_date: null,
                    contract_end_date: null,
                    is_confirmed: false,
                    notes: null,
                    employee: emp
                };
            });

            setStatusList(withStatus);
        } catch (err) {
            console.error(err);
            toast.error('Failed to load employment status data');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    const today = new Date().toISOString().split('T')[0];

    const branches = Array.from(new Set(allEmployees.map(e => e.Branch).filter(Boolean))) as string[];
    const regions = Array.from(new Set(allEmployees.map(e => e.Town).filter(Boolean))) as string[];

    const filtered = statusList.filter(s => {
        const name = `${s.employee?.['First Name'] || ''} ${s.employee?.['Last Name'] || ''}`.toLowerCase();
        const matchSearch = !search || name.includes(search.toLowerCase()) || s['Employee Number'].toLowerCase().includes(search.toLowerCase());
        if (!matchSearch) return false;
        if (branchFilter && s.employee?.Branch !== branchFilter) return false;
        if (regionFilter && s.employee?.Town !== regionFilter) return false;
        if (filter === 'missing_date') return !s.joining_date && (s.employment_type === 'Probation' || s.employment_type === 'Contract');
        if (filter === 'overdue') {
            return (s.employment_type === 'Probation' && !s.is_confirmed && s.probation_end_date && s.probation_end_date < today) ||
                (s.employment_type === 'Contract' && s.contract_end_date && s.contract_end_date < today);
        }
        if (filter !== 'all') return s.employment_type === filter;
        return true;
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    const getDaysInfo = (record: EmploymentStatus) => {
        if (record.employment_type === 'Probation' && record.probation_end_date) {
            return Math.ceil((new Date(record.probation_end_date).getTime() - Date.now()) / 86400000);
        }
        if (record.employment_type === 'Contract' && record.contract_end_date) {
            return Math.ceil((new Date(record.contract_end_date).getTime() - Date.now()) / 86400000);
        }
        return null;
    };

    const getStatusBadge = (record: EmploymentStatus) => {
        const days = getDaysInfo(record);
        if (record.id < 0 || (!record.joining_date && (record.employment_type === 'Probation' || record.employment_type === 'Contract'))) {
            return { label: 'Missing Status/Date', color: 'bg-orange-100 text-orange-700 border-orange-200' };
        }
        if (days !== null && days < 0) return { label: 'Overdue', color: 'bg-red-100 text-red-700 border-red-200' };
        if (days !== null && days <= 7) return { label: `${days}d left`, color: 'bg-amber-100 text-amber-700 border-amber-200' };
        if (days !== null && days <= 30) return { label: `${days}d left`, color: 'bg-yellow-100 text-yellow-700 border-yellow-200' };
        if (record.is_confirmed) return { label: 'Confirmed', color: 'bg-green-100 text-green-700 border-green-200' };
        return { label: record.employment_type, color: 'bg-blue-100 text-blue-700 border-blue-200' };
    };

    const handleAction = async () => {
        if (!selectedRecord || !actionType) return;
        setSaving(true);
        try {
            let updates: Record<string, unknown> = {};
            let historyEvent = '';
            let historyNew: Record<string, unknown> = {};

            if (actionType === 'confirm') {
                updates = { is_confirmed: true };
                historyEvent = 'probation_confirmed';
                historyNew = { employment_type: 'Confirmed', date: today };
            } else if (actionType === 'extend_probation') {
                const newEnd = new Date(selectedRecord.probation_end_date || today);
                newEnd.setMonth(newEnd.getMonth() + extensionMonths);
                updates = { probation_end_date: newEnd.toISOString().split('T')[0] };
                historyEvent = 'probation_extended';
                historyNew = { extended_by_months: extensionMonths, new_end_date: newEnd.toISOString().split('T')[0] };
            } else if (actionType === 'renew_contract') {
                const newEnd = new Date(selectedRecord.contract_end_date || today);
                newEnd.setMonth(newEnd.getMonth() + extensionMonths);
                updates = { contract_end_date: newEnd.toISOString().split('T')[0] };
                historyEvent = 'contract_renewed';
                historyNew = { renewed_by_months: extensionMonths, new_end_date: newEnd.toISOString().split('T')[0] };
            } else if (actionType === 'convert_permanent') {
                updates = { employment_type: 'Permanent', is_confirmed: true };
                historyEvent = 'contract_converted';
                historyNew = { employment_type: 'Permanent' };
            }

            await supabase.from('hr_employment_status').update({ ...updates, notes: actionNotes || selectedRecord.notes }).eq('id', selectedRecord.id);
            await supabase.from('hr_lifecycle_history').insert({
                'Employee Number': selectedRecord['Employee Number'],
                event_type: historyEvent,
                event_date: new Date().toISOString(),
                old_value: { employment_type: selectedRecord.employment_type },
                new_value: historyNew,
                notes: actionNotes,
                performed_by: 'HR Admin'
            });

            toast.success('Action completed successfully');
            setShowModal(false);
            setActionNotes('');
            setActionType(null);
            fetchData();
            onRefresh?.();
        } catch {
            toast.error('Failed to perform action');
        } finally {
            setSaving(false);
        }
    };

    const probationMonths = addForm.probation_unit === 'weeks'
        ? Math.ceil(addForm.probation_value / 4.33)
        : addForm.probation_value;

    const handleAddStatus = async () => {
        if (!addForm.employeeNumber) { toast.error('Please select an employee'); return; }
        setSaving(true);
        try {
            const joiningDate = addForm.joining_date || null;
            let probationEndDate: string | null = null;
            let contractEndDate: string | null = null;

            if (joiningDate) {
                if (addForm.employment_type === 'Probation') {
                    const d = new Date(joiningDate + 'T00:00');
                    d.setMonth(d.getMonth() + probationMonths);
                    probationEndDate = d.toISOString().split('T')[0];
                } else if (addForm.employment_type === 'Contract') {
                    const d = new Date(joiningDate + 'T00:00');
                    d.setMonth(d.getMonth() + addForm.contract_duration_months);
                    contractEndDate = d.toISOString().split('T')[0];
                }
            }

            await supabase.from('hr_employment_status').upsert({
                'Employee Number': addForm.employeeNumber,
                employment_type: addForm.employment_type,
                joining_date: joiningDate,
                probation_duration_months: probationMonths,
                contract_duration_months: addForm.contract_duration_months,
                probation_end_date: probationEndDate,
                contract_end_date: contractEndDate,
                notes: addForm.notes,
                is_confirmed: false,
            }, { onConflict: '"Employee Number"' });

            toast.success('Employment status saved');
            setShowAddModal(false);
            setAddForm({ employeeNumber: '', employment_type: 'Probation', joining_date: '', probation_value: 3, probation_unit: 'months', contract_duration_months: 12, notes: '' });
            fetchData();
            onRefresh?.();
        } catch {
            toast.error('Failed to save status');
        } finally {
            setSaving(false);
        }
    };

    const handleBulkAssign = async () => {
        if (selectedIds.size === 0) return;
        setSaving(true);
        try {
            const ids = Array.from(selectedIds);
            const validIds = ids.filter(id => id > 0); // Exclude unassigned mock records
            if (validIds.length > 0) {
                await supabase.from('hr_employment_status').update({ employment_type: bulkType }).in('id', validIds);
            }

            // For mock records, we upsert anew
            const mockIds = ids.filter(id => id < 0);
            for (const id of mockIds) {
                const rec = statusList.find(s => s.id === id);
                if (rec) {
                    await supabase.from('hr_employment_status').upsert({
                        'Employee Number': rec['Employee Number'],
                        employment_type: bulkType,
                        is_confirmed: false
                    }, { onConflict: '"Employee Number"' });
                }
            }

            for (const id of ids) {
                const rec = statusList.find(s => s.id === id);
                if (rec) {
                    await supabase.from('hr_lifecycle_history').insert({
                        'Employee Number': rec['Employee Number'],
                        event_type: 'status_change',
                        event_date: new Date().toISOString(),
                        old_value: { employment_type: rec.employment_type },
                        new_value: { employment_type: bulkType },
                        notes: 'Bulk status update',
                        performed_by: 'HR Admin'
                    });
                }
            }
            toast.success(`${ids.length} record(s) updated to ${bulkType}`);
            setSelectedIds(new Set());
            setShowBulkModal(false);
            fetchData();
            onRefresh?.();
        } catch {
            toast.error('Bulk update failed');
        } finally {
            setSaving(false);
        }
    };

    const toggleSelect = (id: number) => {
        setSelectedIds(prev => {
            const n = new Set(prev);
            if (n.has(id)) n.delete(id); else n.add(id);
            return n;
        });
    };

    const toggleAllPage = () => {
        const pageIds = paginated.map(r => r.id);
        const allSelected = pageIds.every(id => selectedIds.has(id));
        setSelectedIds(prev => {
            const n = new Set(prev);
            pageIds.forEach(id => { if (allSelected) n.delete(id); else n.add(id); });
            return n;
        });
    };

    const empOptions = allEmployees.map(e => ({
        label: `${e['First Name'] || ''} ${e['Last Name'] || ''} (${e['Employee Number']})`.trim(),
        value: e['Employee Number']
    }));

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h2 className="text-lg font-bold text-gray-900">Employment Status</h2>
                    <p className="text-xs text-gray-500">Track probation, contracts, attachments and permanent staff · {filtered.length} records</p>
                </div>
                <div className="flex items-center gap-2">
                    {selectedIds.size > 0 && (
                        <button onClick={() => setShowBulkModal(true)}
                            className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 text-white text-xs font-medium rounded-lg hover:bg-violet-700 transition-colors">
                            <Edit3 className="w-3 h-3" /> Bulk Update ({selectedIds.size})
                        </button>
                    )}
                    <button onClick={() => setShowAddModal(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-xs font-medium rounded-lg hover:bg-violet-700 transition-colors">
                        <Plus className="w-3.5 h-3.5" /> Assign Status
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
                <div className="flex flex-wrap gap-3 items-center">
                    <div className="relative flex-1 min-w-[180px]">
                        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text" placeholder="Search employee name or ID..." value={search}
                            onChange={e => { setSearch(e.target.value); setPage(1); }}
                            className="w-full pl-9 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                        />
                    </div>
                    <div className="w-40">
                        <PremiumSelect
                            value={branchFilter} onChange={v => { setBranchFilter(v); setPage(1); }}
                            options={[{ label: 'All Branches', value: '' }, ...branches.map(b => ({ label: b, value: b }))]}
                            placeholder="Branch" icon={Building2}
                        />
                    </div>
                    <div className="w-40">
                        <PremiumSelect
                            value={regionFilter} onChange={v => { setRegionFilter(v); setPage(1); }}
                            options={[{ label: 'All Regions', value: '' }, ...regions.map(r => ({ label: r, value: r }))]}
                            placeholder="Region" icon={MapPin}
                        />
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    {(['all', 'Probation', 'Contract', 'Permanent', 'Attachment', 'missing_date', 'overdue'] as const).map(f => (
                        <button key={f} onClick={() => { setFilter(f); setPage(1); }}
                            className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-all
                                ${filter === f ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-600 border-gray-200 hover:border-violet-300'}`}>
                            {f === 'all' ? 'All' : f === 'missing_date' ? 'Missing Date' : f === 'overdue' ? 'Overdue' : f}
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
                    <Users className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">No records found</p>
                </div>
            ) : (
                <>
                    {/* Bulk select header */}
                    <div className="flex items-center gap-3 px-1">
                        <input
                            type="checkbox"
                            checked={paginated.length > 0 && paginated.every(r => selectedIds.has(r.id))}
                            onChange={toggleAllPage}
                            className="w-3.5 h-3.5 accent-violet-600"
                        />
                        <span className="text-[11px] text-gray-500">{selectedIds.size > 0 ? `${selectedIds.size} selected` : `Select all on page`}</span>
                    </div>

                    <div className="grid gap-2.5">
                        {paginated.map(record => {
                            const badge = getStatusBadge(record);
                            const days = getDaysInfo(record);
                            const isSelected = selectedIds.has(record.id);
                            return (
                                <motion.div
                                    key={record.id}
                                    initial={{ opacity: 0, y: 6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className={`bg-white border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:shadow-sm transition-all ${isSelected ? 'border-violet-300 bg-violet-50/30' : 'border-gray-200'}`}
                                >
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="checkbox" checked={isSelected} onChange={() => toggleSelect(record.id)}
                                            className="w-3.5 h-3.5 accent-violet-600 flex-shrink-0"
                                        />
                                        <div>
                                            <p className="text-sm font-semibold text-gray-900">
                                                {record.employee?.['First Name']} {record.employee?.['Last Name']}
                                                {!record.employee && <span className="text-gray-400"> (no profile)</span>}
                                            </p>
                                            <p className="text-xs text-gray-500">{record['Employee Number']} · {record.employee?.['Job Title'] || '—'}</p>
                                            {record.employee?.Branch && (
                                                <p className="text-[10px] text-gray-400">{record.employee.Branch}{record.employee.Town ? ` · ${record.employee.Town}` : ''}</p>
                                            )}
                                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                                                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${badge.color}`}>{badge.label}</span>
                                                <span className="text-[10px] text-gray-400">{record.employment_type}</span>
                                                {record.joining_date && <span className="text-[10px] text-gray-400">Joined: {record.joining_date}</span>}
                                                {record.probation_end_date && record.employment_type === 'Probation' &&
                                                    <span className="text-[10px] text-gray-400">End: {record.probation_end_date}</span>}
                                                {record.contract_end_date && record.employment_type === 'Contract' &&
                                                    <span className="text-[10px] text-gray-400">End: {record.contract_end_date}</span>}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 ml-auto flex-wrap">
                                        {record.id < 0 || (!record.joining_date && (record.employment_type === 'Probation' || record.employment_type === 'Contract')) ? (
                                            <span className="text-[10px] px-2 py-1 bg-orange-50 text-orange-600 rounded-lg border border-orange-100 flex items-center gap-1">
                                                <AlertTriangle className="w-3 h-3" /> Missing Status/Date
                                            </span>
                                        ) : days !== null ? (
                                            <span className={`text-[10px] px-2 py-1 rounded-lg border flex items-center gap-1 ${days < 0 ? 'bg-red-50 text-red-600 border-red-100' : days <= 7 ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-blue-50 text-blue-600 border-blue-100'}`}>
                                                <Clock className="w-3 h-3" /> {days < 0 ? `${Math.abs(days)}d overdue` : `${days}d left`}
                                            </span>
                                        ) : null}

                                        {record.id > 0 && record.employment_type === 'Probation' && !record.is_confirmed && (
                                            <div className="flex gap-1.5">
                                                <button onClick={() => { setSelectedRecord(record); setActionType('confirm'); setShowModal(true); }}
                                                    className="px-2.5 py-1.5 text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 flex items-center gap-1">
                                                    <CheckCircle className="w-3 h-3" /> Confirm
                                                </button>
                                                <button onClick={() => { setSelectedRecord(record); setActionType('extend_probation'); setShowModal(true); }}
                                                    className="px-2.5 py-1.5 text-[10px] bg-amber-50 text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-100 flex items-center gap-1">
                                                    <Clock className="w-3 h-3" /> Extend
                                                </button>
                                            </div>
                                        )}
                                        {record.id > 0 && record.employment_type === 'Contract' && (
                                            <div className="flex gap-1.5">
                                                <button onClick={() => { setSelectedRecord(record); setActionType('renew_contract'); setShowModal(true); }}
                                                    className="px-2.5 py-1.5 text-[10px] bg-violet-50 text-violet-700 border border-violet-200 rounded-lg hover:bg-violet-100 flex items-center gap-1">
                                                    <RefreshCw className="w-3 h-3" /> Renew
                                                </button>
                                                <button onClick={() => { setSelectedRecord(record); setActionType('convert_permanent'); setShowModal(true); }}
                                                    className="px-2.5 py-1.5 text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 flex items-center gap-1">
                                                    <UserCheck className="w-3 h-3" /> Convert
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </motion.div>
                            );
                        })}
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between pt-2">
                            <span className="text-xs text-gray-500">
                                Page {page} of {totalPages} · {filtered.length} records
                            </span>
                            <div className="flex gap-1">
                                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                                    className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 flex items-center gap-1">
                                    <ChevronLeft className="w-3 h-3" /> Prev
                                </button>
                                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                    const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
                                    return p <= totalPages ? (
                                        <button key={p} onClick={() => setPage(p)}
                                            className={`px-3 py-1.5 text-xs rounded-lg border ${p === page ? 'bg-violet-600 text-white border-violet-600' : 'border-gray-200 hover:bg-gray-50'}`}>
                                            {p}
                                        </button>
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

            {/* Action Modal */}
            {showModal && selectedRecord && actionType && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-sm font-bold text-gray-900">
                                {actionType === 'confirm' ? 'Confirm Probation' :
                                    actionType === 'extend_probation' ? 'Extend Probation' :
                                        actionType === 'renew_contract' ? 'Renew Contract' :
                                            'Convert to Permanent'}
                            </h3>
                            <button onClick={() => { setShowModal(false); setActionType(null); }} className="p-1 hover:bg-gray-100 rounded-lg">
                                <X className="w-4 h-4 text-gray-500" />
                            </button>
                        </div>
                        <p className="text-xs text-gray-600 mb-4">
                            Employee: <strong>{selectedRecord.employee?.['First Name']} {selectedRecord.employee?.['Last Name']}</strong> ({selectedRecord['Employee Number']})
                        </p>
                        {(actionType === 'extend_probation' || actionType === 'renew_contract') && (
                            <div className="mb-3">
                                <label className="text-xs font-medium text-gray-700 block mb-1">Extension Months</label>
                                <input type="number" min={1} max={24} value={extensionMonths} onChange={e => setExtensionMonths(Number(e.target.value))}
                                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500" />
                            </div>
                        )}
                        <div className="mb-4">
                            <label className="text-xs font-medium text-gray-700 block mb-1">Notes (optional)</label>
                            <textarea rows={2} value={actionNotes} onChange={e => setActionNotes(e.target.value)}
                                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none" />
                        </div>
                        <div className="flex gap-2">
                            <button onClick={() => { setShowModal(false); setActionType(null); }}
                                className="flex-1 py-2 text-xs border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-600">Cancel</button>
                            <button onClick={handleAction} disabled={saving}
                                className="flex-1 py-2 text-xs bg-violet-600 text-white rounded-xl hover:bg-violet-700 disabled:opacity-50 flex items-center justify-center gap-1">
                                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                                Confirm
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}

            {/* Add Status Modal */}
            {showAddModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh] overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
                            <div>
                                <h3 className="text-sm font-bold text-gray-900">Assign Employment Status</h3>
                                <p className="text-[11px] text-gray-500 mt-0.5">Set type, duration and joining date</p>
                            </div>
                            <button onClick={() => setShowAddModal(false)} className="p-1.5 hover:bg-gray-100 rounded-xl transition-colors">
                                <X className="w-4 h-4 text-gray-500" />
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
                            <div className="space-y-4">
                                <div>
                                    <label className="text-xs font-semibold text-gray-700 block mb-1.5">Employee *</label>
                                    <PremiumSelect
                                        value={addForm.employeeNumber}
                                        onChange={v => {
                                            setAddForm(f => ({ ...f, employeeNumber: v }));
                                            // Auto-fill form from existing record if active
                                            const existing = statusList.find(s => s['Employee Number'] === v && s.id > 0);
                                            if (existing) {
                                                setAddForm(f => ({
                                                    ...f,
                                                    employment_type: existing.employment_type,
                                                    joining_date: existing.joining_date || '',
                                                    notes: existing.notes || ''
                                                }));
                                            }
                                        }}
                                        options={empOptions}
                                        placeholder="Select employee..."
                                        icon={Users}
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-gray-700 block mb-1.5">Employment Type</label>
                                    <PremiumSelect
                                        value={addForm.employment_type}
                                        onChange={v => setAddForm(f => ({ ...f, employment_type: v as EmploymentType }))}
                                        options={[
                                            { label: '🔵 Attachment', value: 'Attachment' },
                                            { label: '🟡 Probation', value: 'Probation' },
                                            { label: '🟣 Contract', value: 'Contract' },
                                            { label: '🟢 Permanent', value: 'Permanent' },
                                        ]}
                                        placeholder="Select type..."
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-gray-700 block mb-1.5">Joining Date</label>
                                    <PremiumDatePicker
                                        value={addForm.joining_date}
                                        onChange={v => setAddForm(f => ({ ...f, joining_date: v }))}
                                        label="Select joining date"
                                    />
                                </div>
                                {addForm.employment_type === 'Probation' && (
                                    <div>
                                        <label className="text-xs font-semibold text-gray-700 block mb-1.5">Probation Duration</label>
                                        <div className="flex gap-2">
                                            <input
                                                type="number" min={1} max={addForm.probation_unit === 'weeks' ? 52 : 12}
                                                value={addForm.probation_value}
                                                onChange={e => setAddForm(f => ({ ...f, probation_value: Number(e.target.value) }))}
                                                className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500"
                                            />
                                            <div className="w-32">
                                                <PremiumSelect
                                                    value={addForm.probation_unit}
                                                    onChange={v => setAddForm(f => ({ ...f, probation_unit: v as DurationUnit }))}
                                                    options={[{ label: 'Months', value: 'months' }, { label: 'Weeks', value: 'weeks' }]}
                                                    placeholder="Unit"
                                                />
                                            </div>
                                        </div>
                                        <p className="text-[10px] text-gray-400 mt-1">= {probationMonths} month(s)</p>
                                    </div>
                                )}
                                {addForm.employment_type === 'Contract' && (
                                    <div>
                                        <label className="text-xs font-semibold text-gray-700 block mb-1.5">Contract Duration (months)</label>
                                        <input
                                            type="number" min={1} max={60} value={addForm.contract_duration_months}
                                            onChange={e => setAddForm(f => ({ ...f, contract_duration_months: Number(e.target.value) }))}
                                            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500"
                                        />
                                    </div>
                                )}
                                <div>
                                    <label className="text-xs font-semibold text-gray-700 block mb-1.5">Notes</label>
                                    <textarea rows={2} value={addForm.notes} onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))}
                                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
                                        placeholder="Optional notes..." />
                                </div>
                            </div>
                        </div>

                        <div className="px-6 py-4 border-t border-gray-100 flex gap-3 flex-shrink-0 bg-gray-50/50">
                            <button onClick={() => setShowAddModal(false)}
                                className="flex-1 py-2.5 text-xs font-semibold border border-gray-200 rounded-xl hover:bg-gray-100 text-gray-600 transition-colors">Cancel</button>
                            <button onClick={handleAddStatus} disabled={saving}
                                className="flex-1 py-2.5 text-xs font-semibold bg-violet-600 text-white rounded-xl hover:bg-violet-700 disabled:opacity-50 flex items-center justify-center gap-1.5 transition-colors">
                                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                                Save
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}

            {/* Bulk Modal */}
            {showBulkModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-xs p-6">
                        <h3 className="text-sm font-bold text-gray-900 mb-1">Bulk Status Update</h3>
                        <p className="text-xs text-gray-500 mb-4">{selectedIds.size} employee(s) selected</p>
                        <div className="mb-4">
                            <label className="text-xs font-semibold text-gray-700 block mb-1.5">New Employment Type</label>
                            <PremiumSelect
                                value={bulkType}
                                onChange={v => setBulkType(v as EmploymentType)}
                                options={[
                                    { label: '🔵 Attachment', value: 'Attachment' },
                                    { label: '🟡 Probation', value: 'Probation' },
                                    { label: '🟣 Contract', value: 'Contract' },
                                    { label: '🟢 Permanent', value: 'Permanent' },
                                ]}
                                placeholder="Select type..."
                            />
                        </div>
                        <div className="flex gap-2">
                            <button onClick={() => setShowBulkModal(false)}
                                className="flex-1 py-2 text-xs border border-gray-200 rounded-xl hover:bg-gray-50">Cancel</button>
                            <button onClick={handleBulkAssign} disabled={saving}
                                className="flex-1 py-2 text-xs bg-violet-600 text-white rounded-xl hover:bg-violet-700 disabled:opacity-50 flex items-center justify-center gap-1">
                                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                                Apply
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </div>
    );
}
