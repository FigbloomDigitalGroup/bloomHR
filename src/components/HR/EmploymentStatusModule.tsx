import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
    Users, Clock, AlertTriangle, CheckCircle, XCircle,
    RefreshCw, Filter, Search, ChevronRight, Calendar,
    Edit3, UserCheck, Shield, Loader2, Plus, X
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

type EmploymentType = 'Attachment' | 'Probation' | 'Contract' | 'Permanent';

interface EmploymentStatus {
    id: number;
    "Employee Number": string;
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
    "Employee Number": string;
    "First Name": string | null;
    "Last Name": string | null;
    "Job Title": string | null;
    Branch: string | null;
    Department?: string | null;
}

type HRAction = 'confirm' | 'extend_probation' | 'terminate_probation' | 'renew_contract' | 'convert_permanent' | 'terminate_contract' | null;

export default function EmploymentStatusModule({ onRefresh }: { onRefresh?: () => void }) {
    const [statusList, setStatusList] = useState<(EmploymentStatus & { employee?: Employee })[]>([]);
    const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<EmploymentType | 'all' | 'missing_date' | 'overdue'>('all');
    const [search, setSearch] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [selectedRecord, setSelectedRecord] = useState<(EmploymentStatus & { employee?: Employee }) | null>(null);
    const [actionType, setActionType] = useState<HRAction>(null);
    const [actionNotes, setActionNotes] = useState('');
    const [extensionMonths, setExtensionMonths] = useState(1);
    const [saving, setSaving] = useState(false);
    const [defaultSettings, setDefaultSettings] = useState({ probation: 3, contract: 12 });

    // Add new status modal
    const [showAddModal, setShowAddModal] = useState(false);
    const [addForm, setAddForm] = useState({
        employeeNumber: '', employment_type: 'Probation' as EmploymentType,
        joining_date: '', probation_duration_months: 3, contract_duration_months: 12, notes: ''
    });

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [settingsRes, statusRes, empRes] = await Promise.all([
                supabase.from('hr_contract_settings').select('*').single(),
                supabase.from('hr_employment_status').select('*').order('id', { ascending: false }),
                supabase.from('employees').select('"Employee Number", "First Name", "Last Name", "Job Title", "Branch"')
            ]);

            if (settingsRes.data) {
                setDefaultSettings({ probation: settingsRes.data.default_probation_months, contract: settingsRes.data.default_contract_months });
            }

            const emps = empRes.data || [];
            setAllEmployees(emps as Employee[]);

            const merged = (statusRes.data || []).map(s => ({
                ...s,
                employee: emps.find((e: Employee) => e['Employee Number'] === s['Employee Number'])
            }));
            setStatusList(merged);
        } catch (err) {
            console.error(err);
            toast.error('Failed to load employment status data');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    const today = new Date().toISOString().split('T')[0];
    const in7Days = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    const in30Days = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];

    const filtered = statusList.filter(s => {
        const name = `${s.employee?.['First Name'] || ''} ${s.employee?.['Last Name'] || ''}`.toLowerCase();
        const matchSearch = !search || name.includes(search.toLowerCase()) || s['Employee Number'].toLowerCase().includes(search.toLowerCase());
        if (!matchSearch) return false;

        if (filter === 'missing_date') return !s.joining_date && (s.employment_type === 'Probation' || s.employment_type === 'Contract');
        if (filter === 'overdue') {
            return (s.employment_type === 'Probation' && !s.is_confirmed && s.probation_end_date && s.probation_end_date < today) ||
                (s.employment_type === 'Contract' && s.contract_end_date && s.contract_end_date < today);
        }
        if (filter !== 'all') return s.employment_type === filter;
        return true;
    });

    const getDaysInfo = (record: EmploymentStatus) => {
        if (record.employment_type === 'Probation' && record.probation_end_date) {
            const diff = Math.ceil((new Date(record.probation_end_date).getTime() - Date.now()) / 86400000);
            return diff;
        }
        if (record.employment_type === 'Contract' && record.contract_end_date) {
            const diff = Math.ceil((new Date(record.contract_end_date).getTime() - Date.now()) / 86400000);
            return diff;
        }
        return null;
    };

    const getStatusBadge = (record: EmploymentStatus) => {
        const days = getDaysInfo(record);
        if (!record.joining_date && (record.employment_type === 'Probation' || record.employment_type === 'Contract')) {
            return { label: 'Missing Date', color: 'bg-orange-100 text-orange-700 border-orange-200' };
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
                "Employee Number": selectedRecord['Employee Number'],
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
        } catch (err) {
            console.error(err);
            toast.error('Failed to perform action');
        } finally {
            setSaving(false);
        }
    };

    const handleAddStatus = async () => {
        if (!addForm.employeeNumber) { toast.error('Please select an employee'); return; }
        setSaving(true);
        try {
            await supabase.from('hr_employment_status').upsert({
                "Employee Number": addForm.employeeNumber,
                employment_type: addForm.employment_type,
                joining_date: addForm.joining_date || null,
                probation_duration_months: addForm.probation_duration_months,
                contract_duration_months: addForm.contract_duration_months,
                notes: addForm.notes,
                is_confirmed: false,
            }, { onConflict: '"Employee Number"' });
            toast.success('Employment status saved');
            setShowAddModal(false);
            setAddForm({ employeeNumber: '', employment_type: 'Probation', joining_date: '', probation_duration_months: 3, contract_duration_months: 12, notes: '' });
            fetchData();
            onRefresh?.();
        } catch (err) {
            toast.error('Failed to save status');
        } finally {
            setSaving(false);
        }
    };

    const typeColors: Record<EmploymentType, string> = {
        'Attachment': 'bg-sky-500',
        'Probation': 'bg-amber-500',
        'Contract': 'bg-violet-500',
        'Permanent': 'bg-emerald-500',
    };

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h2 className="text-lg font-bold text-gray-900">Employment Status Management</h2>
                    <p className="text-xs text-gray-500">Track probation, contracts, attachments and permanent employees</p>
                </div>
                <button
                    onClick={() => setShowAddModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-xs font-medium rounded-lg hover:bg-violet-700 transition-colors"
                >
                    <Plus className="w-3.5 h-3.5" /> Assign Status
                </button>
            </div>

            {/* Filters */}
            <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap gap-3 items-center">
                <div className="relative flex-1 min-w-[160px]">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text" placeholder="Search employee..." value={search} onChange={e => setSearch(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                    />
                </div>
                <div className="flex flex-wrap gap-2">
                    {['all', 'Probation', 'Contract', 'Permanent', 'Attachment', 'missing_date', 'overdue'].map(f => (
                        <button key={f} onClick={() => setFilter(f as typeof filter)}
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
                <div className="grid gap-3">
                    {filtered.map(record => {
                        const badge = getStatusBadge(record);
                        const days = getDaysInfo(record);
                        return (
                            <motion.div
                                key={record.id}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:shadow-sm transition-shadow"
                            >
                                <div className="flex items-center gap-3">
                                    <div className={`w-2 h-12 rounded-full ${typeColors[record.employment_type as EmploymentType] || 'bg-gray-400'}`} />
                                    <div>
                                        <p className="text-sm font-semibold text-gray-900">
                                            {record.employee?.['First Name']} {record.employee?.['Last Name']}
                                        </p>
                                        <p className="text-xs text-gray-500">{record['Employee Number']} · {record.employee?.['Job Title'] || '—'}</p>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${badge.color}`}>{badge.label}</span>
                                            <span className="text-[10px] text-gray-400">{record.employment_type}</span>
                                            {record.joining_date && <span className="text-[10px] text-gray-400">Joined: {record.joining_date}</span>}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2">
                                    {!record.joining_date && (record.employment_type === 'Probation' || record.employment_type === 'Contract') ? (
                                        <span className="text-[10px] px-2 py-1 bg-orange-50 text-orange-600 rounded-lg border border-orange-100 flex items-center gap-1">
                                            <AlertTriangle className="w-3 h-3" /> Missing Joining Date
                                        </span>
                                    ) : days !== null ? (
                                        <span className={`text-[10px] px-2 py-1 rounded-lg border flex items-center gap-1 ${days < 0 ? 'bg-red-50 text-red-600 border-red-100' : days <= 7 ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-blue-50 text-blue-600 border-blue-100'}`}>
                                            <Clock className="w-3 h-3" /> {days < 0 ? `${Math.abs(days)}d overdue` : `${days} days left`}
                                        </span>
                                    ) : null}

                                    {/* Action buttons */}
                                    {record.employment_type === 'Probation' && !record.is_confirmed && (
                                        <div className="flex gap-1.5">
                                            <button onClick={() => { setSelectedRecord(record); setActionType('confirm'); setShowModal(true); }}
                                                className="px-2.5 py-1.5 text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors flex items-center gap-1">
                                                <CheckCircle className="w-3 h-3" /> Confirm
                                            </button>
                                            <button onClick={() => { setSelectedRecord(record); setActionType('extend_probation'); setShowModal(true); }}
                                                className="px-2.5 py-1.5 text-[10px] bg-amber-50 text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors flex items-center gap-1">
                                                <Clock className="w-3 h-3" /> Extend
                                            </button>
                                        </div>
                                    )}
                                    {record.employment_type === 'Contract' && (
                                        <div className="flex gap-1.5">
                                            <button onClick={() => { setSelectedRecord(record); setActionType('renew_contract'); setShowModal(true); }}
                                                className="px-2.5 py-1.5 text-[10px] bg-violet-50 text-violet-700 border border-violet-200 rounded-lg hover:bg-violet-100 transition-colors flex items-center gap-1">
                                                <RefreshCw className="w-3 h-3" /> Renew
                                            </button>
                                            <button onClick={() => { setSelectedRecord(record); setActionType('convert_permanent'); setShowModal(true); }}
                                                className="px-2.5 py-1.5 text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors flex items-center gap-1">
                                                <UserCheck className="w-3 h-3" /> Convert
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        );
                    })}
                </div>
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
                                            actionType === 'convert_permanent' ? 'Convert to Permanent' : 'HR Action'}
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
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500" />
                            </div>
                        )}
                        <div className="mb-4">
                            <label className="text-xs font-medium text-gray-700 block mb-1">Notes (optional)</label>
                            <textarea rows={2} value={actionNotes} onChange={e => setActionNotes(e.target.value)}
                                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none" />
                        </div>
                        <div className="flex gap-2">
                            <button onClick={() => { setShowModal(false); setActionType(null); }}
                                className="flex-1 py-2 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">Cancel</button>
                            <button onClick={handleAction} disabled={saving}
                                className="flex-1 py-2 text-xs bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-1">
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
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-sm font-bold text-gray-900">Assign Employment Status</h3>
                            <button onClick={() => setShowAddModal(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                                <X className="w-4 h-4 text-gray-500" />
                            </button>
                        </div>
                        <div className="space-y-3">
                            <div>
                                <label className="text-xs font-medium text-gray-700 block mb-1">Employee</label>
                                <select value={addForm.employeeNumber} onChange={e => setAddForm(f => ({ ...f, employeeNumber: e.target.value }))}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500">
                                    <option value="">Select employee...</option>
                                    {allEmployees.map(e => (
                                        <option key={e['Employee Number']} value={e['Employee Number']}>
                                            {e['First Name']} {e['Last Name']} ({e['Employee Number']})
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-700 block mb-1">Employment Type</label>
                                <select value={addForm.employment_type} onChange={e => setAddForm(f => ({ ...f, employment_type: e.target.value as EmploymentType }))}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500">
                                    {['Attachment', 'Probation', 'Contract', 'Permanent'].map(t => <option key={t}>{t}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-700 block mb-1">Joining Date</label>
                                <input type="date" value={addForm.joining_date} onChange={e => setAddForm(f => ({ ...f, joining_date: e.target.value }))}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500" />
                            </div>
                            {addForm.employment_type === 'Probation' && (
                                <div>
                                    <label className="text-xs font-medium text-gray-700 block mb-1">Probation Duration (months)</label>
                                    <input type="number" min={1} max={12} value={addForm.probation_duration_months}
                                        onChange={e => setAddForm(f => ({ ...f, probation_duration_months: Number(e.target.value) }))}
                                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500" />
                                </div>
                            )}
                            {addForm.employment_type === 'Contract' && (
                                <div>
                                    <label className="text-xs font-medium text-gray-700 block mb-1">Contract Duration (months)</label>
                                    <input type="number" min={1} max={60} value={addForm.contract_duration_months}
                                        onChange={e => setAddForm(f => ({ ...f, contract_duration_months: Number(e.target.value) }))}
                                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500" />
                                </div>
                            )}
                            <div>
                                <label className="text-xs font-medium text-gray-700 block mb-1">Notes</label>
                                <textarea rows={2} value={addForm.notes} onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none" />
                            </div>
                        </div>
                        <div className="flex gap-2 mt-4">
                            <button onClick={() => setShowAddModal(false)}
                                className="flex-1 py-2 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">Cancel</button>
                            <button onClick={handleAddStatus} disabled={saving}
                                className="flex-1 py-2 text-xs bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-1">
                                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                                Save
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </div>
    );
}
