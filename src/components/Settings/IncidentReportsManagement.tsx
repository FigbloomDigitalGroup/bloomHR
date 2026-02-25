import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    AlertTriangle,
    Search,
    Filter,
    Eye,
    CheckCircle2,
    XCircle,
    Clock,
    Shield,
    User,
    Calendar,
    MapPin,
    Users,
    MessageSquare,
    Download,
    X,
    ShieldAlert,
    Activity,
    ChevronRight,
    ArrowUpRight,
    Briefcase,
    Building,
    CheckCircle,
    Info,
    RefreshCw,
    GanttChart
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

interface IncidentReport {
    id: string;
    employee_number: string | null;
    is_anonymous: boolean;
    incident_type: string;
    severity: string;
    title: string;
    description: string;
    incident_date: string | null;
    location: string | null;
    witnesses: string | null;
    status: string;
    admin_notes: string | null;
    reviewed_by: string | null;
    reviewed_at: string | null;
    resolution: string | null;
    resolved_at: string | null;
    created_at: string;
    reporter_name?: string;
}

const INCIDENT_TYPES = [
    { value: 'all', label: 'All Types' },
    { value: 'harassment', label: 'Harassment' },
    { value: 'discrimination', label: 'Discrimination' },
    { value: 'safety_violation', label: 'Safety Violation' },
    { value: 'ethics_violation', label: 'Ethics Violation' },
    { value: 'fraud', label: 'Fraud' },
    { value: 'theft', label: 'Theft' },
    { value: 'policy_violation', label: 'Policy Violation' },
    { value: 'workplace_violence', label: 'Workplace Violence' },
    { value: 'other', label: 'Other' }
];

const STATUS_OPTIONS = [
    { value: 'all', label: 'All Status' },
    { value: 'new', label: 'New' },
    { value: 'under_review', label: 'Under Review' },
    { value: 'investigating', label: 'Investigating' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'closed', label: 'Closed' },
    { value: 'dismissed', label: 'Dismissed' }
];

const SEVERITY_LEVELS = [
    { value: 'all', label: 'All Severity' },
    { value: 'low', label: 'Low', color: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
    { value: 'medium', label: 'Medium', color: 'bg-amber-50 text-amber-700 border-amber-100' },
    { value: 'high', label: 'High', color: 'bg-orange-50 text-orange-700 border-orange-100' },
    { value: 'critical', label: 'Critical', color: 'bg-red-50 text-red-700 border-red-100' }
];

const IncidentReportsManagement = () => {
    const [reports, setReports] = useState<IncidentReport[]>([]);
    const [filteredReports, setFilteredReports] = useState<IncidentReport[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [typeFilter, setTypeFilter] = useState('all');
    const [severityFilter, setSeverityFilter] = useState('all');
    const [selectedReport, setSelectedReport] = useState<IncidentReport | null>(null);
    const [adminNotes, setAdminNotes] = useState('');
    const [resolution, setResolution] = useState('');
    const [isUpdating, setIsUpdating] = useState(false);

    useEffect(() => {
        fetchReports();
    }, []);

    useEffect(() => {
        let filtered = reports;
        if (statusFilter !== 'all') filtered = filtered.filter(r => r.status === statusFilter);
        if (typeFilter !== 'all') filtered = filtered.filter(r => r.incident_type === typeFilter);
        if (severityFilter !== 'all') filtered = filtered.filter(r => r.severity === severityFilter);
        if (searchTerm) {
            filtered = filtered.filter(r =>
                r.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                r.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                r.reporter_name?.toLowerCase().includes(searchTerm.toLowerCase())
            );
        }
        setFilteredReports(filtered);
    }, [reports, searchTerm, statusFilter, typeFilter, severityFilter]);

    const fetchReports = async () => {
        try {
            setIsLoading(true);
            const { data: reportsData, error } = await supabase
                .from('incident_reports')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;

            const reportsWithNames = await Promise.all(
                (reportsData || []).map(async (report) => {
                    if (!report.is_anonymous && report.employee_number) {
                        const { data: employeeData } = await supabase
                            .from('employees')
                            .select('"First Name", "Last Name"')
                            .eq('"Employee Number"', report.employee_number)
                            .single();

                        return {
                            ...report,
                            reporter_name: employeeData
                                ? `${employeeData['First Name']} ${employeeData['Last Name']}`
                                : 'Unknown'
                        };
                    }
                    return {
                        ...report,
                        reporter_name: 'Anonymous Reporter'
                    };
                })
            );

            setReports(reportsWithNames);
        } catch (error) {
            console.error('Error fetching reports:', error);
            toast.error('Failed to load incident reports');
        } finally {
            setIsLoading(false);
        }
    };

    const updateReportStatus = async (reportId: string, newStatus: string) => {
        setIsUpdating(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Not authenticated');

            const { data: adminData } = await supabase
                .from('employees')
                .select('"First Name", "Last Name"')
                .eq('"Work Email"', user.email)
                .single();

            const adminName = adminData ? `${adminData['First Name']} ${adminData['Last Name']}` : user.email;

            const updateData: any = {
                status: newStatus,
                reviewed_by: adminName,
                reviewed_at: new Date().toISOString()
            };

            if (adminNotes.trim()) updateData.admin_notes = adminNotes;
            if (newStatus === 'resolved' && resolution.trim()) {
                updateData.resolution = resolution;
                updateData.resolved_at = new Date().toISOString();
            }

            const { error } = await supabase
                .from('incident_reports')
                .update(updateData)
                .eq('id', reportId);

            if (error) throw error;

            const report = reports.find(r => r.id === reportId);
            if (report && !report.is_anonymous && report.employee_number) {
                await notifyReporter(report.employee_number, newStatus, reportId);
            }

            toast.success('Report status updated successfully');
            setSelectedReport(null);
            setAdminNotes('');
            setResolution('');
            await fetchReports();
        } catch (error) {
            toast.error('Failed to update report status');
        } finally {
            setIsUpdating(false);
        }
    };

    const notifyReporter = async (employeeNumber: string, status: string, reportId: string) => {
        try {
            const statusMessages: Record<string, string> = {
                under_review: 'Your incident report is now under review.',
                investigating: 'Your incident report is being investigated.',
                resolved: 'Your incident report has been resolved.',
                closed: 'Your incident report has been closed.',
                dismissed: 'Your incident report has been dismissed.'
            };

            await supabase.from('notifications').insert({
                employee_number: employeeNumber,
                type: 'incident_report_update',
                title: 'Incident Report Update',
                message: statusMessages[status] || 'Your incident report status has been updated.',
                priority: 'medium',
                is_read: false,
                created_at: new Date().toISOString()
            });
        } catch (error) {
            console.error('Error notifying reporter:', error);
        }
    };

    const getSeverityStyles = (severity: string) => {
        const level = SEVERITY_LEVELS.find(s => s.value === severity);
        return level?.color || 'bg-gray-50 text-gray-700 border-gray-100';
    };

    const getStatusStyles = (status: string) => {
        switch (status) {
            case 'new': return 'bg-indigo-50 text-indigo-700 border-indigo-100';
            case 'under_review': return 'bg-amber-50 text-amber-700 border-amber-100';
            case 'investigating': return 'bg-orange-50 text-orange-700 border-orange-100';
            case 'resolved': return 'bg-emerald-50 text-emerald-700 border-emerald-100';
            case 'closed': return 'bg-gray-100 text-gray-700 border-gray-200';
            case 'dismissed': return 'bg-red-50 text-red-700 border-red-100';
            default: return 'bg-gray-50 text-gray-700 border-gray-100';
        }
    };

    return (
        <div className="space-y-8 pb-12">
            {/* Premium Header Card */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="md:col-span-1 bg-gradient-to-br from-red-600 to-red-800 rounded-[2.5rem] p-8 text-white shadow-xl shadow-red-100 relative overflow-hidden group"
                >
                    <div className="relative z-10 space-y-6">
                        <div className="space-y-1">
                            <h2 className="text-2xl font-black tracking-tight italic uppercase">Incident Hub</h2>
                            <p className="text-red-100 text-[10px] font-black uppercase tracking-[0.2em] opacity-80">Crisis Response & Governance</p>
                        </div>

                        <div className="flex items-center gap-3">
                            <div className="p-3 bg-white/10 rounded-2xl backdrop-blur-md relative">
                                <ShieldAlert className="w-5 h-5 text-red-300" />
                                {filteredReports.filter(r => r.status === 'new').length > 0 && (
                                    <div className="absolute top-0 right-0 w-3 h-3 bg-white rounded-full animate-ping" />
                                )}
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-widest text-red-100">Governance Node</span>
                        </div>

                        <div className="flex flex-col gap-2 pt-4">
                            <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest border-b border-white/10 pb-2">
                                <span>Critical Alerts</span>
                                <span className="text-white font-black">{filteredReports.filter(r => r.severity === 'critical' || r.severity === 'high').length}</span>
                            </div>
                            <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-white/50 pt-2">
                                <span>Unresolved</span>
                                <span>{filteredReports.filter(r => r.status !== 'resolved' && r.status !== 'closed').length}</span>
                            </div>
                        </div>
                    </div>
                    <AlertTriangle className="absolute -bottom-10 -right-10 w-48 h-48 text-white/5" />
                </motion.div>

                {/* Sub Header Content */}
                <div className="lg:col-span-3 bg-white rounded-[2.5rem] border border-gray-100 shadow-sm p-8 flex flex-col justify-center">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        <div className="space-y-4 col-span-1 md:col-span-2">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-red-50 text-red-600 rounded-lg">
                                    <Activity className="w-4 h-4" />
                                </div>
                                <h3 className="text-lg font-black text-gray-900 uppercase italic">Integrity Monitor</h3>
                            </div>
                            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest leading-loose max-w-lg">
                                Real-time monitoring of workplace ethics, safety, and policy compliance. All reports undergo multi-stage verification before resolution.
                            </p>
                        </div>

                        <div className="flex flex-col gap-3 justify-end lg:col-span-2">
                            <div className="flex flex-wrap items-center gap-2 justify-end">
                                <select
                                    value={statusFilter}
                                    onChange={(e) => setStatusFilter(e.target.value)}
                                    className="px-4 py-2.5 bg-gray-50 border-none rounded-xl text-[9px] font-black uppercase tracking-widest focus:ring-2 focus:ring-indigo-100 transition-all outline-none shadow-sm shadow-inner"
                                >
                                    {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                                <select
                                    value={severityFilter}
                                    onChange={(e) => setSeverityFilter(e.target.value)}
                                    className="px-4 py-2.5 bg-gray-50 border-none rounded-xl text-[9px] font-black uppercase tracking-widest focus:ring-2 focus:ring-indigo-100 transition-all outline-none shadow-sm shadow-inner"
                                >
                                    {SEVERITY_LEVELS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                                <button onClick={fetchReports} className="p-2.5 bg-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all">
                                    <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Reports Registry */}
            <div className="bg-white rounded-[3rem] border border-gray-100 shadow-sm overflow-hidden">
                <div className="p-8 border-b border-gray-50 flex items-center justify-between bg-gray-50/50">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="SEARCH BY PAYLOAD TITLE..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-14 pr-6 py-4 bg-white border border-gray-100 rounded-[2rem] text-[10px] font-black uppercase tracking-widest focus:ring-4 focus:ring-indigo-100 transition-all font-mono shadow-sm"
                        />
                    </div>
                    <div className="hidden md:flex items-center gap-3">
                        <GanttChart className="w-5 h-5 text-gray-300" />
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Active Registry</span>
                    </div>
                </div>

                <div className="divide-y divide-gray-50">
                    {filteredReports.length > 0 ? (
                        filteredReports.map((report) => (
                            <motion.div
                                key={report.id}
                                layout
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                onClick={() => setSelectedReport(report)}
                                className="p-10 hover:bg-indigo-50/30 transition-all group cursor-pointer relative overflow-hidden"
                            >
                                <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-8">
                                    <div className="flex-1 space-y-4">
                                        <div className="flex items-center gap-3">
                                            <span className={`px-4 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest border border-transparent shadow-sm ${getSeverityStyles(report.severity)}`}>
                                                {report.severity}
                                            </span>
                                            <span className={`px-4 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest border border-transparent shadow-sm ${getStatusStyles(report.status)}`}>
                                                {report.status.replace('_', ' ')}
                                            </span>
                                            {report.is_anonymous && (
                                                <span className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-purple-50 text-purple-600 text-[9px] font-black uppercase tracking-widest border border-purple-100">
                                                    <Shield className="w-3 h-3" /> Encrypted
                                                </span>
                                            )}
                                        </div>

                                        <div className="space-y-1">
                                            <h3 className="text-xl font-black text-gray-900 tracking-tight group-hover:text-indigo-600 transition-colors uppercase italic italic">
                                                {report.title}
                                            </h3>
                                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em]">
                                                {report.incident_type.replace('_', ' ')} • ID: {report.id.slice(0, 8).toUpperCase()}
                                            </p>
                                        </div>

                                        <p className="text-sm text-gray-600 leading-relaxed font-medium line-clamp-2 max-w-3xl">
                                            {report.description}
                                        </p>

                                        <div className="flex items-center gap-6 pt-2">
                                            <div className="flex items-center gap-2">
                                                <div className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center font-black text-[10px] text-gray-500">
                                                    {report.reporter_name?.[0]}
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] font-black text-gray-900 uppercase">{report.reporter_name}</span>
                                                    <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Reporter Node</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Calendar className="w-4 h-4 text-gray-300" />
                                                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                                    {new Date(report.created_at).toLocaleDateString()}
                                                </span>
                                            </div>
                                            {report.location && (
                                                <div className="flex items-center gap-2">
                                                    <MapPin className="w-4 h-4 text-gray-300" />
                                                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{report.location}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex flex-col items-end gap-2">
                                        <div className="p-4 bg-white rounded-2xl border border-gray-100 shadow-sm opacity-0 group-hover:opacity-100 transition-all transform translate-x-4 group-hover:translate-x-0">
                                            <ArrowUpRight className="w-6 h-6 text-indigo-600" />
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        ))
                    ) : (
                        <div className="p-32 flex flex-col items-center justify-center space-y-4">
                            <div className="w-24 h-24 bg-gray-50 rounded-[2.5rem] flex items-center justify-center border border-gray-100 shadow-inner">
                                <ShieldCheck className="w-10 h-10 text-gray-300" />
                            </div>
                            <div className="text-center space-y-1">
                                <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Governance Registry Clean</h3>
                                <p className="text-[9px] font-bold text-gray-300 uppercase italic">Awaiting intake...</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Report Detail Modal */}
            <AnimatePresence>
                {selectedReport && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 sm:p-12 overflow-y-auto">
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelectedReport(null)} className="fixed inset-0 bg-gray-900/60 backdrop-blur-md" />

                        <motion.div
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.9, opacity: 0, y: 20 }}
                            className="bg-white rounded-[3rem] shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col relative z-10 border border-white/20"
                        >
                            <div className="p-8 border-b border-gray-50 flex items-center justify-between bg-gray-50/50">
                                <div className="space-y-1">
                                    <h3 className="text-2xl font-black text-gray-900 tracking-tight uppercase italic">Incident Manifest</h3>
                                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Governance ID: {selectedReport.id}</p>
                                </div>
                                <motion.button whileHover={{ rotate: 90 }} onClick={() => setSelectedReport(null)} className="p-4 bg-white text-gray-400 hover:text-red-500 rounded-2xl shadow-sm border border-gray-100 transition-colors">
                                    <X className="w-6 h-6" />
                                </motion.button>
                            </div>

                            <div className="p-10 grid grid-cols-1 lg:grid-cols-12 gap-10">
                                <div className="lg:col-span-12 space-y-10">
                                    {/* Critical Info Grid */}
                                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                                        <div className="p-6 bg-gray-50 rounded-[2rem] border border-gray-100">
                                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Integrity Node</p>
                                            <div className="flex items-center gap-2">
                                                {selectedReport.is_anonymous && <Shield className="w-4 h-4 text-purple-600" />}
                                                <span className="text-xs font-black text-gray-900 uppercase">{selectedReport.reporter_name}</span>
                                            </div>
                                        </div>
                                        <div className="p-6 bg-gray-50 rounded-[2rem] border border-gray-100">
                                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Classification</p>
                                            <span className="text-xs font-black text-indigo-600 uppercase italic">{selectedReport.incident_type.replace('_', ' ')}</span>
                                        </div>
                                        <div className="p-6 rounded-[2rem] border border-transparent shadow-sm" style={{ backgroundColor: SEVERITY_LEVELS.find(s => s.value === selectedReport.severity)?.color?.split(' ')[0].replace('bg-', 'var(--') }}>
                                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Threat Vector</p>
                                            <span className={`text-xs font-black uppercase ${getSeverityStyles(selectedReport.severity)} bg-transparent border-none`}>{selectedReport.severity}</span>
                                        </div>
                                        <div className="p-6 bg-gray-50 rounded-[2rem] border border-gray-100">
                                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Intake Timestamp</p>
                                            <span className="text-xs font-black text-gray-900 font-mono uppercase">{new Date(selectedReport.created_at).toLocaleString()}</span>
                                        </div>
                                    </div>

                                    {/* Main Body */}
                                    <div className="space-y-8">
                                        <div className="space-y-4">
                                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Incident Description</label>
                                            <div className="p-10 bg-gray-900 rounded-[3rem] text-indigo-100 text-xs font-bold uppercase tracking-widest leading-loose relative overflow-hidden">
                                                <p className="relative z-10">{selectedReport.description}</p>
                                                <Activity className="absolute bottom-[-10%] right-[-10%] w-32 h-32 text-white/5" />
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                                            <div className="space-y-4">
                                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Location Context</label>
                                                <div className="p-6 bg-gray-50 rounded-[2rem] border border-gray-100 flex items-center gap-3">
                                                    <MapPin className="w-5 h-5 text-indigo-600" />
                                                    <span className="text-[10px] font-black uppercase text-gray-700">{selectedReport.location || 'UNDISCLOSED'}</span>
                                                </div>
                                            </div>
                                            <div className="space-y-4">
                                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Witness Registry</label>
                                                <div className="p-6 bg-gray-50 rounded-[2rem] border border-gray-100 flex items-center gap-3">
                                                    <Users className="w-5 h-5 text-indigo-600" />
                                                    <span className="text-[10px] font-black uppercase text-gray-700">{selectedReport.witnesses || 'ZERO_WITNESS_RECOVERY'}</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-6 pt-10 border-t border-gray-100">
                                            <div className="flex items-center gap-3">
                                                <Shield className="w-6 h-6 text-indigo-600" />
                                                <h4 className="text-xl font-black text-gray-900 italic uppercase">Audit Action Node</h4>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                                                <div className="space-y-4">
                                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Update Registry Status</label>
                                                    <select
                                                        value={selectedReport.status}
                                                        onChange={(e) => updateReportStatus(selectedReport.id, e.target.value)}
                                                        className="w-full p-6 bg-white border border-gray-100 rounded-[2rem] text-[10px] font-black uppercase tracking-widest focus:ring-4 focus:ring-indigo-100 transition-all shadow-sm"
                                                    >
                                                        {STATUS_OPTIONS.filter(s => s.value !== 'all').map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                                    </select>
                                                </div>
                                                <div className="space-y-4">
                                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Resolution Protocol</label>
                                                    <textarea
                                                        value={resolution}
                                                        onChange={(e) => setResolution(e.target.value)}
                                                        rows={3}
                                                        className="w-full p-6 bg-gray-50 border-none rounded-[2rem] text-[10px] font-black uppercase tracking-widest focus:ring-4 focus:ring-indigo-100 transition-all resize-none shadow-inner"
                                                        placeholder="DOCUMENT FINAL RESOLUTION..."
                                                    />
                                                </div>
                                            </div>

                                            <div className="space-y-4 pb-10">
                                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Auditor Internal Remarks</label>
                                                <textarea
                                                    value={adminNotes}
                                                    onChange={(e) => setAdminNotes(e.target.value)}
                                                    rows={3}
                                                    className="w-full p-6 bg-gray-50 border-none rounded-[2rem] text-[10px] font-black uppercase tracking-widest focus:ring-4 focus:ring-indigo-100 transition-all resize-none shadow-inner"
                                                    placeholder="INTERNAL AUDIT NOTES..."
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="p-10 bg-gray-50 border-t border-gray-100 flex gap-4">
                                <button
                                    onClick={() => setSelectedReport(null)}
                                    disabled={isUpdating}
                                    className="px-10 py-5 bg-white border border-gray-200 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 hover:text-gray-600 rounded-[2rem] transition-all"
                                >
                                    Abort Audit
                                </button>
                                <button
                                    onClick={() => updateReportStatus(selectedReport.id, selectedReport.status)}
                                    disabled={isUpdating}
                                    className="flex-1 py-5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-[2rem] text-[10px] font-black uppercase tracking-[0.2em] shadow-xl shadow-indigo-100 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                                >
                                    {isUpdating ? <RefreshCw className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5" />}
                                    Commit Registry Changes
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default IncidentReportsManagement;
