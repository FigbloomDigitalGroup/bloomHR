import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { History, Search, Filter, ChevronDown, ChevronUp, Calendar, User, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

interface HistoryEvent {
    id: number;
    "Employee Number": string;
    event_type: string;
    event_date: string;
    old_value: Record<string, unknown> | null;
    new_value: Record<string, unknown> | null;
    notes: string | null;
    performed_by: string | null;
    created_at: string;
    employee_name?: string;
}

const EVENT_TYPE_LABELS: Record<string, string> = {
    branch_transfer: 'Branch Transfer',
    promotion: 'Promotion',
    position_change: 'Position Change',
    salary_revision: 'Salary Revision',
    status_change: 'Status Change',
    probation_confirmed: 'Probation Confirmed',
    probation_extended: 'Probation Extended',
    contract_renewed: 'Contract Renewed',
    contract_converted: 'Converted to Permanent',
    suspension: 'Suspension',
    reactivation: 'Reactivation',
    termination: 'Termination',
    other: 'Other'
};

const EVENT_COLORS: Record<string, string> = {
    branch_transfer: 'bg-blue-100 text-blue-700',
    promotion: 'bg-emerald-100 text-emerald-700',
    position_change: 'bg-violet-100 text-violet-700',
    salary_revision: 'bg-amber-100 text-amber-700',
    probation_confirmed: 'bg-green-100 text-green-700',
    probation_extended: 'bg-orange-100 text-orange-700',
    contract_renewed: 'bg-sky-100 text-sky-700',
    contract_converted: 'bg-teal-100 text-teal-700',
    suspension: 'bg-red-100 text-red-700',
    reactivation: 'bg-lime-100 text-lime-700',
    termination: 'bg-gray-200 text-gray-700',
    status_change: 'bg-pink-100 text-pink-700',
    other: 'bg-gray-100 text-gray-600'
};

export default function LifecycleHistoryModule() {
    const [history, setHistory] = useState<HistoryEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [eventTypeFilter, setEventTypeFilter] = useState('all');
    const [expandedId, setExpandedId] = useState<number | null>(null);

    const fetchHistory = useCallback(async () => {
        setLoading(true);
        try {
            const [histRes, empRes] = await Promise.all([
                supabase.from('hr_lifecycle_history').select('*').order('event_date', { ascending: false }),
                supabase.from('employees').select('"Employee Number", "First Name", "Last Name"')
            ]);
            const emps = empRes.data || [];
            const merged = (histRes.data || []).map(h => ({
                ...h,
                employee_name: (() => {
                    const emp = emps.find((e: { "Employee Number": string }) => e['Employee Number'] === h['Employee Number']);
                    return emp ? `${emp['First Name']} ${emp['Last Name']}` : h['Employee Number'];
                })()
            }));
            setHistory(merged);
        } catch (err) {
            console.error(err);
            toast.error('Failed to load lifecycle history');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchHistory(); }, [fetchHistory]);

    const filtered = history.filter(h => {
        const matchSearch = !search || h.employee_name?.toLowerCase().includes(search.toLowerCase()) || h['Employee Number'].toLowerCase().includes(search.toLowerCase());
        const matchType = eventTypeFilter === 'all' || h.event_type === eventTypeFilter;
        return matchSearch && matchType;
    });

    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-bold text-gray-900">Staff Lifecycle History</h2>
                <p className="text-xs text-gray-500">Full audit trail of all employee lifecycle events — transfers, promotions, salary changes and more</p>
            </div>

            {/* Filters */}
            <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap gap-3 items-center">
                <div className="relative flex-1 min-w-[160px]">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type="text" placeholder="Search employee..." value={search} onChange={e => setSearch(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500" />
                </div>
                <select value={eventTypeFilter} onChange={e => setEventTypeFilter(e.target.value)}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500">
                    <option value="all">All Events</option>
                    {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
            </div>

            {loading ? (
                <div className="flex items-center justify-center h-40">
                    <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
                </div>
            ) : filtered.length === 0 ? (
                <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
                    <History className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">No history records found</p>
                </div>
            ) : (
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                    {/* Timeline */}
                    <div className="divide-y divide-gray-100">
                        {filtered.map((event, idx) => {
                            const isExpanded = expandedId === event.id;
                            return (
                                <motion.div key={event.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                                    className="p-4 hover:bg-gray-50/50 transition-colors">
                                    <div className="flex items-start justify-between gap-3 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : event.id)}>
                                        <div className="flex items-start gap-3">
                                            <div className="relative flex flex-col items-center">
                                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${EVENT_COLORS[event.event_type] || 'bg-gray-100 text-gray-600'}`}>
                                                    {(EVENT_TYPE_LABELS[event.event_type] || 'E')[0]}
                                                </div>
                                                {idx < filtered.length - 1 && <div className="w-px h-4 bg-gray-200 mt-1" />}
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <p className="text-sm font-semibold text-gray-900">{event.employee_name}</p>
                                                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${EVENT_COLORS[event.event_type] || 'bg-gray-100 text-gray-600'}`}>
                                                        {EVENT_TYPE_LABELS[event.event_type] || event.event_type}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-3 mt-0.5">
                                                    <p className="text-[10px] text-gray-500 flex items-center gap-1">
                                                        <Calendar className="w-3 h-3" /> {new Date(event.event_date).toLocaleDateString()}
                                                    </p>
                                                    {event.performed_by && (
                                                        <p className="text-[10px] text-gray-500 flex items-center gap-1">
                                                            <User className="w-3 h-3" /> {event.performed_by}
                                                        </p>
                                                    )}
                                                </div>
                                                {event.notes && <p className="text-[11px] text-gray-600 mt-1">{event.notes}</p>}
                                            </div>
                                        </div>
                                        {(event.old_value || event.new_value) && (
                                            <button className="text-gray-400 hover:text-gray-600 flex-shrink-0">
                                                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                            </button>
                                        )}
                                    </div>

                                    {isExpanded && (event.old_value || event.new_value) && (
                                        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                                            className="mt-3 ml-11 bg-gray-50 rounded-lg p-3 border border-gray-100">
                                            <div className="grid grid-cols-2 gap-3">
                                                {event.old_value && (
                                                    <div>
                                                        <p className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Before</p>
                                                        <pre className="text-[10px] text-gray-700 whitespace-pre-wrap">
                                                            {JSON.stringify(event.old_value, null, 2)}
                                                        </pre>
                                                    </div>
                                                )}
                                                {event.new_value && (
                                                    <div>
                                                        <p className="text-[10px] font-semibold text-emerald-600 uppercase mb-1">After</p>
                                                        <pre className="text-[10px] text-gray-700 whitespace-pre-wrap">
                                                            {JSON.stringify(event.new_value, null, 2)}
                                                        </pre>
                                                    </div>
                                                )}
                                            </div>
                                        </motion.div>
                                    )}
                                </motion.div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
