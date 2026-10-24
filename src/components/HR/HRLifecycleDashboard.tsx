import { useState, useEffect, useCallback } from 'react';
import {
    Users, Clock, ShieldOff,
    XCircle, AlertTriangle, CheckCircle,
    RefreshCw, Loader2, History, Bell, LogOut, FileSignature
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { useSearchParams } from 'react-router-dom';
import { Card, Button, TabBar } from '../UI';
import EmploymentStatusModule from './EmploymentStatusModule';
import LifecycleHistoryModule from './LifecycleHistoryModule';
import SuspensionModule from './SuspensionModule';
import HRReportsDashboard from './HRReportsDashboard';
import ExitsModule from './ExitsModule';
import ContractsModule from './ContractsModule';
import { useHRNotifications, fetchAdminHRNotifications, markAdminNotificationRead, type HRNotification } from '../../hooks/useHRNotifications';

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
    { id: 'overview', label: 'Overview' },
    { id: 'status', label: 'Employment Status' },
    { id: 'history', label: 'Lifecycle History' },
    { id: 'contracts', label: 'Contracts' },
    { id: 'suspension', label: 'Suspension' },
    { id: 'exits', label: 'Exits' },
    { id: 'reports', label: 'Reports' },
];

export default function HRLifecycleDashboard() {
    // Deep link, e.g. from Employee Management's Terminate: /hr-lifecycle?tab=status&q=<employee number>
    const [searchParams] = useSearchParams();
    const requestedTab = searchParams.get('tab');
    const [activeTab, setActiveTab] = useState(
        tabs.some(t => t.id === requestedTab) ? (requestedTab as string) : 'overview'
    );
    const [stats, setStats] = useState<DashboardStats>({
        on_probation: 0, contracts_expiring: 0,
        suspended: 0, terminated: 0, missing_joining_date: 0,
        pending_confirmations: 0, pending_interview: 0,
    });
    const [loading, setLoading] = useState(true);
    const [hrNotifications, setHrNotifications] = useState<HRNotification[]>([]);
    const { checkAndNotify } = useHRNotifications();

    const fetchDashboardStats = useCallback(async () => {
        setLoading(true);
        try {
            const today = new Date();
            const todayStr = today.toISOString().split('T')[0];
            const in30Days = new Date(today); in30Days.setDate(today.getDate() + 30);
            const in30Str = in30Days.toISOString().split('T')[0];

            // counts only, worked out by the database (loading the rows would stop at 1000)
            const statuses = () => supabase.from('hr_employment_status').select('*', { count: 'exact', head: true });
            const unconfirmed = 'is_confirmed.is.null,is_confirmed.eq.false';

            const results = await Promise.all([
                statuses().eq('employment_type', 'Probation').or(unconfirmed).gt('probation_end_date', todayStr),
                statuses().eq('employment_type', 'Contract').gte('contract_end_date', todayStr).lte('contract_end_date', in30Str),
                statuses().in('employment_type', ['Probation', 'Contract']).is('joining_date', null),
                statuses().eq('employment_type', 'Probation').or(unconfirmed).lte('probation_end_date', todayStr),
                supabase.from('hr_suspensions').select('*', { count: 'exact', head: true }).eq('is_active', true),
                supabase.from('hr_terminations').select('*', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 90 * 86400000).toISOString()),
                supabase.from('hr_termination_interviews').select('*', { count: 'exact', head: true }).eq('is_completed', false)
            ]);
            const [onProbation, contractsExpiring, missingDates, pendingConfirmations, suspended, terminated, pendingInterview] =
                results.map(r => r.count || 0);

            setStats({
                on_probation: onProbation,
                contracts_expiring: contractsExpiring,
                suspended,
                terminated,
                missing_joining_date: missingDates,
                pending_confirmations: pendingConfirmations,
                pending_interview: pendingInterview,
            });
        } catch (error) {
            console.error('Error fetching dashboard stats:', error);
            toast.error('Failed to load dashboard stats');
        } finally {
            setLoading(false);
        }
    }, []);

    const loadHRNotifications = useCallback(async () => {
        // the alerts this person hasn't read yet (dismissing one marks it read for them)
        const notifs = await fetchAdminHRNotifications();
        setHrNotifications(notifs.filter((n) => !n.is_read));
    }, []);

    const dismissNotification = async (id: number) => {
        await markAdminNotificationRead(id);
        setHrNotifications(prev => prev.filter(n => n.id !== id));
    };

    useEffect(() => {
        fetchDashboardStats();
        loadHRNotifications();
        checkAndNotify().then(() => loadHRNotifications());
    }, [fetchDashboardStats, loadHRNotifications, checkAndNotify]);

    const statCards = [
        { label: 'On Probation', value: stats.on_probation, icon: Clock, tint: 'bg-orange-tint text-orange', tab: 'status' },
        { label: 'Contracts Expiring', value: stats.contracts_expiring, icon: AlertTriangle, tint: 'bg-orange-tint-alt text-status-danger', tab: 'status' },
        { label: 'Suspended', value: stats.suspended, icon: ShieldOff, tint: 'bg-green-tint text-brand', tab: 'suspension' },
        { label: 'Missing Joining Date', value: stats.missing_joining_date, icon: AlertTriangle, tint: 'bg-orange-tint-alt text-status-danger', tab: 'status' },
        { label: 'Pending Confirmations', value: stats.pending_confirmations, icon: CheckCircle, tint: 'bg-green-tint text-brand', tab: 'status' },
    ];

    const quickActions = [
        { label: 'Manage Employment Status', tab: 'status', icon: Users, desc: 'Probation, Contract, Permanent' },
        { label: 'Lifecycle History', tab: 'history', icon: History, desc: 'View complete employee timelines' },
        { label: 'Record Suspension', tab: 'suspension', icon: ShieldOff, desc: 'Suspend or reactivate staff' },
        { label: 'Exits', tab: 'exits', icon: LogOut, desc: 'Resignations, terminations, clearance, final dues' },
        { label: 'Contracts to sign', tab: 'contracts', icon: FileSignature, desc: 'Send contracts, review signed copies' },
    ];

    return (
        <div>
            <div className="flex items-start justify-between mb-[18px]">
                <div className="flex items-center gap-3">
                    <div className="w-[42px] h-[42px] rounded-xl bg-brand text-white flex items-center justify-center">
                        <Users className="w-[19px] h-[19px]" strokeWidth={1.8} />
                    </div>
                    <div>
                        <h1 className="m-0 text-[17px] font-bold text-ink">HR Lifecycle Management</h1>
                        <div className="text-xs text-muted-foreground">Probation, contracts, leave, payroll, terminations &amp; more</div>
                    </div>
                </div>
                <Button
                    variant="secondary"
                    onClick={() => { fetchDashboardStats(); loadHRNotifications(); }}
                    icon={<RefreshCw className={`w-[13px] h-[13px] ${loading ? 'animate-spin' : ''}`} strokeWidth={2} />}
                >
                    Refresh
                </Button>
            </div>

            <TabBar
                items={tabs}
                activeId={activeTab}
                onChange={setActiveTab}
                className="border-b border-border mb-[18px]"
            />

            {activeTab === 'overview' && (
                <div className="space-y-4">
                    {/* Upcoming expiry alerts */}
                    {hrNotifications.length > 0 && (
                        <div className="bg-orange-tint border border-[#F6DCC7] rounded-card p-4">
                            <div className="flex items-center gap-2 mb-3">
                                <Bell className="w-4 h-4 text-orange-text-alt" />
                                <h3 className="m-0 text-[13px] font-bold text-orange-text">
                                    {hrNotifications.length} Upcoming Expiry Alert{hrNotifications.length !== 1 ? 's' : ''}
                                </h3>
                            </div>
                            <div className="space-y-2">
                                {hrNotifications.map(n => (
                                    <div key={n.id} className="flex items-center justify-between bg-white border border-border rounded-lg px-3 py-2">
                                        <div className="flex items-center gap-2">
                                            <Clock className="w-3.5 h-3.5 text-orange flex-shrink-0" />
                                            <div>
                                                <p className="m-0 text-xs font-semibold text-ink">{n.title}</p>
                                                <p className="m-0 text-[10px] text-muted-foreground">{n.message}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 ml-3">
                                            <button
                                                type="button"
                                                onClick={() => setActiveTab(n.notification_type === 'contract_signed' ? 'contracts' : 'status')}
                                                className="text-[10px] font-semibold text-orange-text bg-orange-tint-alt px-2 py-1 rounded-lg hover:bg-[#fbdcc5] transition-colors whitespace-nowrap"
                                            >
                                                View →
                                            </button>
                                            <button
                                                type="button"
                                                aria-label="Dismiss alert"
                                                onClick={() => dismissNotification(n.id)}
                                                className="text-subtle hover:text-ink"
                                            >
                                                <XCircle className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Live stat counts; each tile opens the tab that holds the detail */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        {statCards.map((card) => {
                            const Icon = card.icon;
                            return (
                                <button
                                    key={card.label}
                                    type="button"
                                    onClick={() => setActiveTab(card.tab)}
                                    className="bg-white border border-border rounded-card p-[18px] text-left hover:border-brand/40 transition-colors"
                                >
                                    <div className={`w-[34px] h-[34px] rounded-[10px] flex items-center justify-center mb-2.5 ${card.tint}`}>
                                        <Icon className="w-4 h-4" strokeWidth={1.8} />
                                    </div>
                                    <div className="text-xl font-bold text-ink">
                                        {loading ? <Loader2 className="w-5 h-5 animate-spin text-subtle" /> : card.value}
                                    </div>
                                    <div className="text-[11px] text-muted-foreground">{card.label}</div>
                                </button>
                            );
                        })}
                    </div>

                    <Card>
                        <div className="text-[13px] font-bold text-ink mb-3">Quick Actions</div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                            {quickActions.map(action => {
                                const Icon = action.icon;
                                return (
                                    <button
                                        key={action.tab}
                                        type="button"
                                        onClick={() => setActiveTab(action.tab)}
                                        className="flex items-center gap-2.5 p-3 border border-border rounded-xl text-left hover:border-brand/40 hover:bg-background transition-colors"
                                    >
                                        <div className="w-8 h-8 rounded-[9px] bg-secondary flex items-center justify-center text-muted-foreground shrink-0">
                                            <Icon className="w-[15px] h-[15px]" strokeWidth={1.8} />
                                        </div>
                                        <div>
                                            <div className="text-xs font-bold text-ink">{action.label}</div>
                                            <div className="text-[10.5px] text-subtle">{action.desc}</div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </Card>

                    {stats.missing_joining_date > 0 && (
                        <div className="bg-orange-tint border border-[#F6DCC7] rounded-card p-4 flex items-start gap-3">
                            <AlertTriangle className="w-5 h-5 text-orange flex-shrink-0 mt-0.5" />
                            <div className="flex-1">
                                <p className="m-0 text-[13px] font-bold text-orange-text">
                                    {stats.missing_joining_date} employee(s) missing Joining Date
                                </p>
                                <p className="m-0 text-xs text-orange-text-alt mt-0.5">
                                    Probation/Contract duration calculations are blocked until joining dates are set.
                                </p>
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('status')}
                                    className="mt-2 text-xs font-semibold text-orange-text underline hover:text-ink"
                                >
                                    View affected employees →
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'status' && <EmploymentStatusModule onRefresh={fetchDashboardStats} initialSearch={searchParams.get('q') || ''} />}
            {activeTab === 'history' && <LifecycleHistoryModule />}
            {activeTab === 'contracts' && <ContractsModule />}
            {activeTab === 'suspension' && <SuspensionModule onRefresh={fetchDashboardStats} />}
            {activeTab === 'exits' && <ExitsModule onRefresh={fetchDashboardStats} />}
            {activeTab === 'reports' && <HRReportsDashboard stats={stats} />}
        </div>
    );
}
