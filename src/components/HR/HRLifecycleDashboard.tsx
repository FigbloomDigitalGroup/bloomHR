import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Users, Clock, FileText, ShieldOff,
    XCircle, BarChart2, AlertTriangle, CheckCircle,
    RefreshCw, ChevronRight, UserMinus, Loader2, History
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import EmploymentStatusModule from './EmploymentStatusModule';
import LifecycleHistoryModule from './LifecycleHistoryModule';
import SuspensionModule from './SuspensionModule';
import TerminationModule from './TerminationModule';
import HRReportsDashboard from './HRReportsDashboard';

interface DashboardStats {
    on_probation: number;
    contracts_expiring: number;
    suspended: number;
    terminated: number;
    missing_joining_date: number;
    pending_confirmations: number;
    pending_interview: number;
}

const tabs = [
    { id: 'overview', label: 'Overview', icon: BarChart2 },
    { id: 'status', label: 'Employment Status', icon: Users },
    { id: 'history', label: 'Lifecycle History', icon: History },
    { id: 'suspension', label: 'Suspension', icon: ShieldOff },
    { id: 'termination', label: 'Termination', icon: XCircle },
    { id: 'reports', label: 'Reports', icon: FileText },
];

export default function HRLifecycleDashboard() {
    const [activeTab, setActiveTab] = useState('overview');
    const [stats, setStats] = useState<DashboardStats>({
        on_probation: 0, contracts_expiring: 0,
        suspended: 0, terminated: 0, missing_joining_date: 0,
        pending_confirmations: 0, pending_interview: 0,
    });
    const [loading, setLoading] = useState(true);

    const fetchDashboardStats = useCallback(async () => {
        setLoading(true);
        try {
            const today = new Date();
            const todayStr = today.toISOString().split('T')[0];
            const in30Days = new Date(today); in30Days.setDate(today.getDate() + 30);
            const in30Str = in30Days.toISOString().split('T')[0];

            const [empStatus, suspensions, terminations, interviews] = await Promise.all([
                supabase.from('hr_employment_status').select('*'),
                supabase.from('hr_suspensions').select('*').eq('is_active', true),
                supabase.from('hr_terminations').select('*').gte('created_at', new Date(Date.now() - 90 * 86400000).toISOString()),
                supabase.from('hr_termination_interviews').select('*').eq('is_completed', false)
            ]);

            const empData = empStatus.data || [];
            const suspData = suspensions.data || [];
            const termData = terminations.data || [];
            const intData = interviews.data || [];

            const onProbation = empData.filter(e => e.employment_type === 'Probation' && !e.is_confirmed &&
                e.probation_end_date && e.probation_end_date > todayStr).length;

            const contractsExpiring = empData.filter(e => e.employment_type === 'Contract' &&
                e.contract_end_date && e.contract_end_date >= todayStr && e.contract_end_date <= in30Str).length;

            const missingDates = empData.filter(e =>
                (e.employment_type === 'Probation' || e.employment_type === 'Contract') && !e.joining_date).length;

            const pendingConfirmations = empData.filter(e => e.employment_type === 'Probation' &&
                !e.is_confirmed && e.probation_end_date && e.probation_end_date <= todayStr).length;

            setStats({
                on_probation: onProbation,
                contracts_expiring: contractsExpiring,
                suspended: suspData.length,
                terminated: termData.length,
                missing_joining_date: missingDates,
                pending_confirmations: pendingConfirmations,
                pending_interview: intData.length,
            });
        } catch (error) {
            console.error('Error fetching dashboard stats:', error);
            toast.error('Failed to load dashboard stats');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchDashboardStats();
    }, [fetchDashboardStats]);

    const statCards = [
        { label: 'On Probation', value: stats.on_probation, icon: Clock, color: 'from-amber-500 to-orange-500', bg: 'bg-amber-50', text: 'text-amber-700', tab: 'status' },
        { label: 'Contracts Expiring', value: stats.contracts_expiring, icon: AlertTriangle, color: 'from-red-500 to-rose-500', bg: 'bg-red-50', text: 'text-red-700', tab: 'status' },
        { label: 'Suspended', value: stats.suspended, icon: ShieldOff, color: 'from-purple-500 to-violet-500', bg: 'bg-purple-50', text: 'text-purple-700', tab: 'suspension' },
        { label: 'Recently Terminated', value: stats.terminated, icon: UserMinus, color: 'from-gray-600 to-gray-800', bg: 'bg-gray-100', text: 'text-gray-700', tab: 'termination' },
        { label: 'Missing Joining Date', value: stats.missing_joining_date, icon: AlertTriangle, color: 'from-orange-500 to-red-500', bg: 'bg-orange-50', text: 'text-orange-700', tab: 'status' },
        { label: 'Pending Confirmations', value: stats.pending_confirmations, icon: CheckCircle, color: 'from-emerald-500 to-green-600', bg: 'bg-emerald-50', text: 'text-emerald-700', tab: 'status' },
        { label: 'Pending Interviews', value: stats.pending_interview, icon: Users, color: 'from-sky-500 to-blue-600', bg: 'bg-sky-50', text: 'text-sky-700', tab: 'termination' },
    ];

    return (
        <div className="min-h-screen bg-gray-50/50 p-4 md:p-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center">
                            <Users className="w-4 h-4 text-white" />
                        </div>
                        HR Lifecycle Management
                    </h1>
                    <p className="text-sm text-gray-500 mt-0.5">Complete HR lifecycle management — probation, contracts, leave, payroll, terminations & more</p>
                </div>
                <button
                    onClick={fetchDashboardStats}
                    className="flex items-center gap-2 px-3 py-2 text-xs bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-gray-600"
                >
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                    Refresh
                </button>
            </div>

            {/* Tab Navigation */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm mb-6 overflow-x-auto">
                <div className="flex min-w-max">
                    {tabs.map((tab) => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`relative flex items-center gap-2 px-4 py-3 text-xs font-medium transition-all whitespace-nowrap
                  ${isActive
                                        ? 'text-violet-700 border-b-2 border-violet-600 bg-violet-50/50'
                                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50 border-b-2 border-transparent'
                                    }`}
                            >
                                <Icon className="w-3.5 h-3.5" />
                                {tab.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Tab Content */}
            <AnimatePresence mode="wait">
                <motion.div
                    key={activeTab}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                >
                    {activeTab === 'overview' && (
                        <div className="space-y-6">
                            {/* Stats Grid */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                {statCards.map((card) => {
                                    const Icon = card.icon;
                                    return (
                                        <motion.button
                                            key={card.label}
                                            onClick={() => setActiveTab(card.tab)}
                                            whileHover={{ y: -2, scale: 1.02 }}
                                            whileTap={{ scale: 0.98 }}
                                            className="bg-white rounded-xl border border-gray-200 p-4 text-left shadow-sm hover:shadow-md transition-all group cursor-pointer"
                                        >
                                            <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${card.color} flex items-center justify-center mb-3`}>
                                                <Icon className="w-4.5 h-4.5 text-white" />
                                            </div>
                                            <div className="text-2xl font-bold text-gray-900 mb-0.5">
                                                {loading ? <Loader2 className="w-5 h-5 animate-spin text-gray-400" /> : card.value}
                                            </div>
                                            <p className="text-xs text-gray-500">{card.label}</p>
                                            <div className="flex items-center gap-1 mt-2 text-[10px] text-violet-600 opacity-0 group-hover:opacity-100 transition-opacity">
                                                View details <ChevronRight className="w-3 h-3" />
                                            </div>
                                        </motion.button>
                                    );
                                })}
                            </div>

                            {/* Quick Action Cards */}
                            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                                <h3 className="text-sm font-semibold text-gray-800 mb-4">Quick Actions</h3>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                    {[
                                        { label: 'Manage Employment Status', tab: 'status', icon: Users, desc: 'Probation, Contract, Permanent' },
                                        { label: 'Record Suspension', tab: 'suspension', icon: ShieldOff, desc: 'Suspend or reactivate staff' },
                                        { label: 'Process Termination', tab: 'termination', icon: XCircle, desc: 'Voluntary, Dismissal, etc.' },
                                    ].map(action => {
                                        const Icon = action.icon;
                                        return (
                                            <button
                                                key={action.tab}
                                                onClick={() => setActiveTab(action.tab)}
                                                className="flex flex-col items-start gap-1.5 p-3 rounded-lg border border-gray-100 hover:border-violet-200 hover:bg-violet-50/30 transition-all group text-left"
                                            >
                                                <div className="w-7 h-7 rounded-md bg-violet-100 flex items-center justify-center group-hover:bg-violet-200 transition-colors">
                                                    <Icon className="w-3.5 h-3.5 text-violet-700" />
                                                </div>
                                                <p className="text-xs font-semibold text-gray-800">{action.label}</p>
                                                <p className="text-[10px] text-gray-500">{action.desc}</p>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Missing Joining Date Alert */}
                            {stats.missing_joining_date > 0 && (
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.98 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-start gap-3"
                                >
                                    <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
                                    <div className="flex-1">
                                        <p className="text-sm font-semibold text-orange-800">
                                            {stats.missing_joining_date} employee(s) missing Joining Date
                                        </p>
                                        <p className="text-xs text-orange-700 mt-0.5">
                                            Probation/Contract duration calculations are blocked until joining dates are set.
                                        </p>
                                        <button
                                            onClick={() => setActiveTab('status')}
                                            className="mt-2 text-xs font-medium text-orange-700 underline hover:text-orange-900"
                                        >
                                            View affected employees →
                                        </button>
                                    </div>
                                </motion.div>
                            )}
                        </div>
                    )}

                    {activeTab === 'status' && <EmploymentStatusModule onRefresh={fetchDashboardStats} />}
                    {activeTab === 'history' && <LifecycleHistoryModule />}
                    {activeTab === 'suspension' && <SuspensionModule onRefresh={fetchDashboardStats} />}
                    {activeTab === 'termination' && <TerminationModule onRefresh={fetchDashboardStats} />}
                    {activeTab === 'reports' && <HRReportsDashboard stats={stats} />}
                </motion.div>
            </AnimatePresence>
        </div>
    );
}
