import { useState } from 'react';
import { motion } from 'framer-motion';
import {
    FileText, Download, Clock, Users, ShieldOff,
    XCircle, Calendar, TrendingUp, AlertTriangle
} from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';

interface DashboardStats {
    on_probation: number;
    contracts_expiring: number;
    leave_starting_soon: number;
    suspended: number;
    terminated: number;
    missing_joining_date: number;
    pending_confirmations: number;
    pending_interview: number;
}

const REPORTS = [
    {
        id: 'probation',
        title: 'Probation Report',
        description: 'All employees currently on probation with end dates and confirmation status',
        icon: Clock,
        color: 'bg-amber-100 text-amber-700',
        table: 'hr_employment_status',
        filter: { employment_type: 'Probation' },
        columns: ['Employee Number', 'employment_type', 'joining_date', 'probation_end_date', 'is_confirmed']
    },
    {
        id: 'contract',
        title: 'Contract Report',
        description: 'Active contracts, expiry dates and renewal status',
        icon: FileText,
        color: 'bg-violet-100 text-violet-700',
        table: 'hr_employment_status',
        filter: { employment_type: 'Contract' },
        columns: ['Employee Number', 'employment_type', 'joining_date', 'contract_end_date']
    },
    {
        id: 'leave',
        title: 'Leave Report',
        description: 'Scheduled and approved leave schedules with status tracking',
        icon: Calendar,
        color: 'bg-blue-100 text-blue-700',
        table: 'hr_leave_schedules',
        filter: {},
        columns: ['Employee Number', 'leave_type', 'leave_start_date', 'leave_end_date', 'leave_days', 'status']
    },
    {
        id: 'movement',
        title: 'Staff Movement Report',
        description: 'Full staff lifecycle history — transfers, promotions, salary changes',
        icon: TrendingUp,
        color: 'bg-emerald-100 text-emerald-700',
        table: 'hr_lifecycle_history',
        filter: {},
        columns: ['Employee Number', 'event_type', 'event_date', 'notes', 'performed_by']
    },
    {
        id: 'termination',
        title: 'Termination Report',
        description: 'All employee terminations with type, reason and status',
        icon: XCircle,
        color: 'bg-red-100 text-red-700',
        table: 'hr_terminations',
        filter: {},
        columns: ['Employee Number', 'termination_date', 'termination_type', 'termination_reason', 'final_payroll_status', 'clearance_status']
    },
    {
        id: 'interview',
        title: 'Exit Interview Report',
        description: 'Termination interviews — scheduled, completed and pending',
        icon: Users,
        color: 'bg-sky-100 text-sky-700',
        table: 'hr_termination_interviews',
        filter: {},
        columns: ['Employee Number', 'interview_date', 'interviewer', 'is_completed']
    },
    {
        id: 'suspension',
        title: 'Suspension Report',
        description: 'Current and historical employee suspensions',
        icon: ShieldOff,
        color: 'bg-orange-100 text-orange-700',
        table: 'hr_suspensions',
        filter: {},
        columns: ['Employee Number', 'suspension_date', 'suspension_reason', 'duration_days', 'is_active']
    },
    {
        id: 'advance',
        title: 'Salary Advance Report',
        description: 'Active and completed salary advances with balances',
        icon: TrendingUp,
        color: 'bg-teal-100 text-teal-700',
        table: 'hr_salary_advances',
        filter: {},
        columns: ['Employee Number', 'advance_date', 'advance_amount', 'monthly_deduction', 'total_repaid', 'remaining_balance', 'is_completed']
    }
];

export default function HRReportsDashboard({ stats }: { stats: DashboardStats }) {
    const [generatingId, setGeneratingId] = useState<string | null>(null);

    const handleDownload = async (report: typeof REPORTS[0]) => {
        setGeneratingId(report.id);
        try {
            let query = supabase.from(report.table as 'hr_employment_status').select('*');
            if (report.filter && Object.keys(report.filter).length > 0) {
                const [key, value] = Object.entries(report.filter)[0];
                query = (query as any).eq(key, value);
            }
            const { data, error } = await query;
            if (error) throw error;

            if (!data || data.length === 0) {
                toast('No data available for this report', { icon: 'ℹ️' });
                return;
            }

            // Build CSV
            const headers = Object.keys(data[0]);
            const rows = data.map(row =>
                headers.map(h => {
                    const val = (row as any)[h];
                    if (val === null || val === undefined) return '';
                    if (typeof val === 'object') return JSON.stringify(val);
                    return String(val).includes(',') ? `"${val}"` : String(val);
                }).join(',')
            );
            const csv = [headers.join(','), ...rows].join('\n');

            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${report.id}_report_${new Date().toISOString().split('T')[0]}.csv`;
            a.click();
            URL.revokeObjectURL(url);
            toast.success(`${report.title} downloaded (${data.length} records)`);
        } catch (err) {
            console.error(err);
            toast.error(`Failed to generate ${report.title}`);
        } finally {
            setGeneratingId(null);
        }
    };

    const summaryWidgets = [
        { label: 'On Probation', value: stats.on_probation, icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50' },
        { label: 'Contracts Expiring', value: stats.contracts_expiring, icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50' },
        { label: 'Suspended', value: stats.suspended, icon: ShieldOff, color: 'text-purple-600', bg: 'bg-purple-50' },
        { label: 'Terminated (90d)', value: stats.terminated, icon: XCircle, color: 'text-gray-600', bg: 'bg-gray-100' },
        { label: 'Leave Soon', value: stats.leave_starting_soon, icon: Calendar, color: 'text-blue-600', bg: 'bg-blue-50' },
        { label: 'Missing Dates', value: stats.missing_joining_date, icon: AlertTriangle, color: 'text-orange-600', bg: 'bg-orange-50' },
        { label: 'Pending Confirmations', value: stats.pending_confirmations, icon: Users, color: 'text-emerald-600', bg: 'bg-emerald-50' },
        { label: 'Pending Interviews', value: stats.pending_interview, icon: FileText, color: 'text-sky-600', bg: 'bg-sky-50' },
    ];

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-lg font-bold text-gray-900">Reports & Dashboard</h2>
                <p className="text-xs text-gray-500">Generate and download HR lifecycle reports in CSV format</p>
            </div>

            {/* Summary Widgets */}
            <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Dashboard Summary</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {summaryWidgets.map(w => {
                        const Icon = w.icon;
                        return (
                            <div key={w.label} className={`${w.bg} rounded-xl p-3 text-center border border-white`}>
                                <Icon className={`w-5 h-5 mx-auto mb-1.5 ${w.color}`} />
                                <p className={`text-xl font-bold ${w.color}`}>{w.value}</p>
                                <p className="text-[10px] text-gray-500 mt-0.5 leading-tight">{w.label}</p>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Downloadable Reports */}
            <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Downloadable Reports</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {REPORTS.map(report => {
                        const Icon = report.icon;
                        const isGenerating = generatingId === report.id;
                        return (
                            <motion.div key={report.id}
                                whileHover={{ y: -2 }}
                                className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between gap-3 hover:shadow-sm transition-all">
                                <div className="flex items-center gap-3">
                                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${report.color}`}>
                                        <Icon className="w-4 h-4" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-semibold text-gray-900">{report.title}</p>
                                        <p className="text-[10px] text-gray-500 leading-relaxed">{report.description}</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleDownload(report)}
                                    disabled={isGenerating}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-50 flex-shrink-0"
                                >
                                    {isGenerating ? (
                                        <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    ) : (
                                        <Download className="w-3.5 h-3.5" />
                                    )}
                                    {isGenerating ? 'Generating...' : 'Download'}
                                </button>
                            </motion.div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
