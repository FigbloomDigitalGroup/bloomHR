import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
    History, Search, ChevronDown, ChevronUp, Calendar, User,
    Loader2, ChevronLeft, ChevronRight, RefreshCw, Users
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

interface HistoryEvent {
    id: number;
    'Employee Number': string;
    event_type: string;
    event_date: string;
    old_value: Record<string, unknown> | null;
    new_value: Record<string, unknown> | null;
    notes: string | null;
    performed_by: string | null;
    created_at: string;
    employee_name?: string;
}

interface Employee {
    'Employee Number': string;
    'First Name': string | null;
    'Last Name': string | null;
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
    branch_transfer: 'bg-blue-100 text-blue-700 border-blue-200',
    promotion: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    position_change: 'bg-violet-100 text-violet-700 border-violet-200',
    salary_revision: 'bg-amber-100 text-amber-700 border-amber-200',
    probation_confirmed: 'bg-green-100 text-green-700 border-green-200',
    probation_extended: 'bg-orange-100 text-orange-700 border-orange-200',
    contract_renewed: 'bg-sky-100 text-sky-700 border-sky-200',
    contract_converted: 'bg-teal-100 text-teal-700 border-teal-200',
    suspension: 'bg-red-100 text-red-700 border-red-200',
    reactivation: 'bg-lime-100 text-lime-700 border-lime-200',
    termination: 'bg-gray-200 text-gray-700 border-gray-300',
    status_change: 'bg-pink-100 text-pink-700 border-pink-200',
    other: 'bg-gray-100 text-gray-600 border-gray-200'
};

const PAGE_SIZE = 20;

export default function LifecycleHistoryModule() {
    const [history, setHistory] = useState<HistoryEvent[]>([]);
    const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [eventTypeFilter, setEventTypeFilter] = useState('all');
    const [expandedId, setExpandedId] = useState<number | null>(null);
    const [page, setPage] = useState(1);
    const [selectedEmp, setSelectedEmp] = useState(''); // view specific employee's history

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [histRes, empRes] = await Promise.all([
                supabase.from('hr_lifecycle_history').select('*').order('event_date', { ascending: false }),
                supabase.from('employees').select('"Employee Number", "First Name", "Last Name"')
            ]);
            const emps = (empRes.data || []) as Employee[];
            setAllEmployees(emps);
            const empMap = new Map(emps.map(e => [e['Employee Number'], e]));
            const merged = (histRes.data || []).map(h => ({
                ...h,
                employee_name: (() => {
                    const emp = empMap.get(h['Employee Number']);
                    return emp ? `${emp['First Name'] || ''} ${emp['Last Name'] || ''}`.trim() : h['Employee Number'];
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

    useEffect(() => { fetchData(); }, [fetchData]);

    const filtered = history.filter(h => {
        const matchSearch = !search ||
            h.employee_name?.toLowerCase().includes(search.toLowerCase()) ||
            h['Employee Number'].toLowerCase().includes(search.toLowerCase());
        const matchType = eventTypeFilter === 'all' || h.event_type === eventTypeFilter;
        const matchEmp = !selectedEmp || h['Employee Number'] === selectedEmp;
        return matchSearch && matchType && matchEmp;
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    const eventTypeCounts = Object.keys(EVENT_TYPE_LABELS).reduce((acc, k) => {
        acc[k] = history.filter(h => h.event_type === k).length;
        return acc;
    }, {} as Record<string, number>);

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h2 className="text-lg font-bold text-gray-900">Staff Lifecycle History</h2>
                    <p className="text-xs text-gray-500">Full audit trail of all employee lifecycle events · {history.length} total events</p>
                </div>
                <button onClick={fetchData} className="flex items-center gap-2 px-3 py-2 text-xs bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
                </button>
            </div>

            {/* Filters */}
            <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
                <div className="flex flex-wrap gap-3 items-center">
                    <div className="relative flex-1 min-w-[200px]">
                        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input type="text" placeholder="Search employee name or ID..."
                            value={search} onChange={e => { setSearch(e.target.value); setPage(1); setSelectedEmp(''); }}
                            className="w-full pl-9 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500" />
                    </div>
                    <select value={eventTypeFilter} onChange={e => { setEventTypeFilter(e.target.value); setPage(1); }}
                        className="border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white">
                        <option value="all">All Events ({history.length})</option>
                        {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => (
                            <option key={k} value={k}>{v} ({eventTypeCounts[k] || 0})</option>
                        ))}
                    </select>
                    {selectedEmp && (
                        <button onClick={() => setSelectedEmp('')}
                            className="flex items-center gap-1.5 px-3 py-2 text-xs bg-violet-50 text-violet-700 border border-violet-200 rounded-lg hover:bg-violet-100">
                            <Users className="w-3 h-3" />
                            {allEmployees.find(e => e['Employee Number'] === selectedEmp)?.['First Name'] || selectedEmp}
                            <span className="ml-1 text-violet-400">×</span>
                        </button>
                    )}
                </div>
            </div>

            {loading ? (
                <div className="flex items-center justify-center h-40">
                    <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
                </div>
            ) : filtered.length === 0 ? (
                <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
                    <History className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm font-semibold text-gray-900">No history records found</p>
                    <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">This timeline will automatically populate as you assign statuses, suspend employees, and perform other HR actions.</p>
                </div>
            ) : (
                <>
                    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                            <span className="text-xs font-semibold text-gray-700">
                                {filtered.length} event{filtered.length !== 1 ? 's' : ''} {selectedEmp ? '(filtered by employee)' : ''}
                            </span>
                            <span className="text-xs text-gray-400">Page {page} of {totalPages}</span>
                        </div>
                        <div className="divide-y divide-gray-100">
                            {paginated.map((event, idx) => {
                                const isExpanded = expandedId === event.id;
                                const colorClass = EVENT_COLORS[event.event_type] || 'bg-gray-100 text-gray-600 border-gray-200';
                                return (
                                    <motion.div key={event.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                                        className="p-4 hover:bg-gray-50/50 transition-colors">
                                        <div className="flex items-start justify-between gap-3 cursor-pointer"
                                            onClick={() => setExpandedId(isExpanded ? null : event.id)}>
                                            <div className="flex items-start gap-3">
                                                <div className="relative flex flex-col items-center">
                                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border ${colorClass}`}>
                                                        {(EVENT_TYPE_LABELS[event.event_type] || 'E')[0]}
                                                    </div>
                                                    {idx < paginated.length - 1 && <div className="w-px h-4 bg-gray-200 mt-1" />}
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <button
                                                            onClick={e => { e.stopPropagation(); setSelectedEmp(event['Employee Number']); setSearch(''); setPage(1); }}
                                                            className="text-sm font-semibold text-gray-900 hover:text-violet-700 transition-colors"
                                                        >
                                                            {event.employee_name}
                                                        </button>
                                                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${colorClass}`}>
                                                            {EVENT_TYPE_LABELS[event.event_type] || event.event_type}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                                                        <p className="text-[10px] text-gray-500 flex items-center gap-1">
                                                            <Calendar className="w-3 h-3" />
                                                            {new Date(event.event_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                                                        </p>
                                                        {event.performed_by && (
                                                            <p className="text-[10px] text-gray-500 flex items-center gap-1">
                                                                <User className="w-3 h-3" /> {event.performed_by}
                                                            </p>
                                                        )}
                                                        <p className="text-[10px] text-gray-400">{event['Employee Number']}</p>
                                                    </div>
                                                    {event.notes && <p className="text-[11px] text-gray-600 mt-1 italic">"{event.notes}"</p>}
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
                                                className="mt-3 ml-11 bg-gray-50 rounded-xl p-3 border border-gray-100">
                                                <div className="grid grid-cols-2 gap-3">
                                                    {event.old_value && (
                                                        <div>
                                                            <p className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Before</p>
                                                            <pre className="text-[10px] text-gray-700 whitespace-pre-wrap bg-white rounded-lg p-2 border border-gray-100">
                                                                {JSON.stringify(event.old_value, null, 2)}
                                                            </pre>
                                                        </div>
                                                    )}
                                                    {event.new_value && (
                                                        <div>
                                                            <p className="text-[10px] font-semibold text-emerald-600 uppercase mb-1">After</p>
                                                            <pre className="text-[10px] text-gray-700 whitespace-pre-wrap bg-white rounded-lg p-2 border border-emerald-100">
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
        </div>
    );
}
