import { useState, useEffect, useMemo } from 'react';
import {
    AlertTriangle,
    Eye,
    CheckCircle2,
    XCircle,
    Shield,
    User,
    Calendar,
    MapPin,
    ChevronDown
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { Card, Button, SearchInput, StatusPill, EmptyState } from '../UI';
import type { StatusTone } from '../UI';

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
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'critical', label: 'Critical' }
];

const SEVERITY_TONE: Record<string, StatusTone> = {
    low: 'info',
    medium: 'neutral',
    high: 'warning',
    critical: 'danger'
};

const STATUS_TONE: Record<string, StatusTone> = {
    new: 'info',
    under_review: 'purple',
    investigating: 'warning',
    resolved: 'success',
    closed: 'neutral',
    dismissed: 'danger'
};

const humanize = (value: string) => value.replace(/_/g, ' ');

const fieldClass =
    'w-full px-3 py-2 border border-border rounded-tile text-xs text-ink bg-white outline-none focus:border-brand transition-colors';

const IncidentReportsManagement = () => {
    const [reports, setReports] = useState<IncidentReport[]>([]);
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

    const fetchReports = async () => {
        try {
            setIsLoading(true);

            const { data: reportsData, error } = await supabase
                .from('incident_reports')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;

            // One lookup for every named reporter (anonymous reports carry no employee number).
            // employee_directory exposes names only, and works for every role that can open this page.
            const numbers = [
                ...new Set(
                    (reportsData || [])
                        .filter((r) => !r.is_anonymous && r.employee_number)
                        .map((r) => r.employee_number as string)
                )
            ];
            const names = new Map<string, string>();
            if (numbers.length > 0) {
                const { data: people } = await supabase
                    .from('employee_directory')
                    .select('"Employee Number", "First Name", "Last Name"')
                    .in('"Employee Number"', numbers);
                (people || []).forEach((p: any) => {
                    names.set(p['Employee Number'], `${p['First Name'] || ''} ${p['Last Name'] || ''}`.trim());
                });
            }

            setReports(
                (reportsData || []).map((report) => ({
                    ...report,
                    reporter_name:
                        !report.is_anonymous && report.employee_number
                            ? names.get(report.employee_number) || 'Unknown'
                            : 'Anonymous Reporter'
                }))
            );
        } catch (error) {
            console.error('Error fetching reports:', error);
            toast.error('Failed to load incident reports');
        } finally {
            setIsLoading(false);
        }
    };

    const filteredReports = useMemo(() => {
        const q = searchTerm.toLowerCase();
        return reports.filter((r) => {
            if (statusFilter !== 'all' && r.status !== statusFilter) return false;
            if (typeFilter !== 'all' && r.incident_type !== typeFilter) return false;
            if (severityFilter !== 'all' && r.severity !== severityFilter) return false;
            if (!q) return true;
            return (
                r.title.toLowerCase().includes(q) ||
                r.description.toLowerCase().includes(q) ||
                !!r.reporter_name?.toLowerCase().includes(q)
            );
        });
    }, [reports, searchTerm, statusFilter, typeFilter, severityFilter]);

    // Header badges count every report, not just the filtered ones
    const highPriorityCount = reports.filter((r) => r.severity === 'critical' || r.severity === 'high').length;
    const newCount = reports.filter((r) => r.status === 'new').length;

    const closeDetails = () => {
        setSelectedReport(null);
        setAdminNotes('');
        setResolution('');
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

            const adminName = adminData
                ? `${adminData['First Name']} ${adminData['Last Name']}`
                : user.email;

            const updateData: any = {
                status: newStatus,
                reviewed_by: adminName,
                reviewed_at: new Date().toISOString()
            };

            if (adminNotes.trim()) {
                updateData.admin_notes = adminNotes;
            }

            if (newStatus === 'resolved' && resolution.trim()) {
                updateData.resolution = resolution;
                updateData.resolved_at = new Date().toISOString();
            }

            const { error } = await supabase
                .from('incident_reports')
                .update(updateData)
                .eq('id', reportId);

            if (error) throw error;

            // Notify reporter if not anonymous
            const report = reports.find(r => r.id === reportId);
            if (report && !report.is_anonymous && report.employee_number) {
                await notifyReporter(report.employee_number, newStatus, reportId);
            }

            toast.success('Report status updated successfully');
            closeDetails();
            await fetchReports();
        } catch (error) {
            console.error('Error updating report:', error);
            toast.error('Failed to update report status');
        } finally {
            setIsUpdating(false);
        }
    };

    const notifyReporter = async (employeeNumber: string, status: string, _reportId: string) => {
        try {
            const statusMessages = {
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
                message: statusMessages[status as keyof typeof statusMessages] || 'Your incident report status has been updated.',
                priority: 'medium',
                is_read: false,
                created_at: new Date().toISOString()
            });
        } catch (error) {
            console.error('Error notifying reporter:', error);
        }
    };

    const severityPill = (severity: string) => (
        <StatusPill label={severity.toUpperCase()} tone={SEVERITY_TONE[severity] || 'neutral'} />
    );

    const statusPill = (status: string) => (
        <StatusPill label={humanize(status).toUpperCase()} tone={STATUS_TONE[status] || 'neutral'} />
    );

    const select = (
        label: string,
        value: string,
        onChange: (v: string) => void,
        options: { value: string; label: string }[]
    ) => (
        <label className="relative inline-block">
            <select
                aria-label={label}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="appearance-none rounded-tile border border-border bg-white pl-3.5 pr-8 py-2.5 text-xs font-semibold text-ink outline-none focus:border-brand cursor-pointer"
            >
                {options.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-subtle" strokeWidth={2} />
        </label>
    );

    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
            </div>
        );
    }

    return (
        <div>
            <div className="flex items-start justify-between flex-wrap gap-3 mb-[18px]">
                <div>
                    <h1 className="m-0 text-[21px] font-bold text-ink">Incident Reports Management</h1>
                    <div className="text-xs text-muted-foreground mt-1">Review and manage workplace incident reports</div>
                </div>
                <div className="flex gap-2">
                    <span className="inline-flex items-center gap-1.5 px-3 py-[7px] rounded-pill bg-orange-tint-alt text-status-danger text-[11px] font-bold">
                        <AlertTriangle className="w-3 h-3" />
                        {highPriorityCount} High Priority
                    </span>
                    <span className="inline-flex items-center px-3 py-[7px] rounded-pill bg-status-info-tint text-status-info text-[11px] font-bold">
                        {newCount} New
                    </span>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2.5 mb-[18px]">
                <div className="flex-1 min-w-[220px]">
                    <SearchInput
                        placeholder="Search reports..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="!bg-white !border-border"
                    />
                </div>
                {select('Filter by status', statusFilter, setStatusFilter, STATUS_OPTIONS)}
                {select('Filter by type', typeFilter, setTypeFilter, INCIDENT_TYPES)}
                {select('Filter by severity', severityFilter, setSeverityFilter, SEVERITY_LEVELS)}
            </div>

            {/* Reports list */}
            {filteredReports.length === 0 ? (
                <Card>
                    <EmptyState
                        className="py-12"
                        icon={<AlertTriangle size={20} />}
                        title="No reports found"
                        description={
                            statusFilter === 'new'
                                ? 'There are no new incident reports.'
                                : 'Try adjusting your filters.'
                        }
                    />
                </Card>
            ) : (
                <div className="flex flex-col gap-2.5">
                    {filteredReports.map((report) => (
                        <Card key={report.id} padding="none" className="!rounded-xl hover:border-brand/40 transition-colors">
                            <div
                                role="button"
                                tabIndex={0}
                                aria-label={`Open report: ${report.title}`}
                                className="p-4 cursor-pointer flex items-start justify-between gap-4 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                                onClick={() => setSelectedReport(report)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        setSelectedReport(report);
                                    }
                                }}
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center flex-wrap gap-2 mb-2">
                                        {report.is_anonymous && (
                                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-pill bg-status-purple-tint text-status-purple text-[11px] font-semibold leading-none">
                                                <Shield className="h-3 w-3" />
                                                Anonymous
                                            </span>
                                        )}
                                        {severityPill(report.severity)}
                                        {statusPill(report.status)}
                                        <span className="text-[11px] text-subtle capitalize">{humanize(report.incident_type)}</span>
                                    </div>

                                    <h3 className="m-0 text-[13px] font-bold text-ink mb-1">{report.title}</h3>
                                    <p className="m-0 text-xs text-muted-foreground mb-2 line-clamp-2">{report.description}</p>

                                    <div className="flex flex-wrap items-center text-[11px] text-subtle gap-x-4 gap-y-1">
                                        <span className="flex items-center">
                                            <User className="h-3 w-3 mr-1" />
                                            {report.reporter_name}
                                        </span>
                                        <span className="flex items-center">
                                            <Calendar className="h-3 w-3 mr-1" />
                                            {new Date(report.created_at).toLocaleDateString()}
                                        </span>
                                        {report.location && (
                                            <span className="flex items-center">
                                                <MapPin className="h-3 w-3 mr-1" />
                                                {report.location}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <Eye className="h-4 w-4 text-brand shrink-0 mt-1" aria-hidden="true" />
                            </div>
                        </Card>
                    ))}
                </div>
            )}

            {/* Report details */}
            {selectedReport && (
                <div
                    className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="incident-details-title"
                >
                    <div className="bg-white rounded-card border border-border shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="px-6 py-4 border-b border-border sticky top-0 bg-white z-10 flex items-center justify-between">
                            <h3 id="incident-details-title" className="m-0 text-base font-bold text-ink">Incident Report Details</h3>
                            <button type="button" aria-label="Close" onClick={closeDetails} className="text-subtle hover:text-ink">
                                <XCircle className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="p-6 space-y-5">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <div className="text-[10px] font-bold uppercase text-subtle mb-1">Reporter</div>
                                    <div className="flex items-center">
                                        {selectedReport.is_anonymous && <Shield className="h-4 w-4 mr-2 text-status-purple" />}
                                        <p className="m-0 text-xs text-ink">{selectedReport.reporter_name}</p>
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[10px] font-bold uppercase text-subtle mb-1">Report ID</div>
                                    <p className="m-0 text-xs text-ink font-mono">{selectedReport.id.substring(0, 8)}...</p>
                                </div>
                                <div>
                                    <div className="text-[10px] font-bold uppercase text-subtle mb-1">Incident Type</div>
                                    <p className="m-0 text-xs text-ink capitalize">{humanize(selectedReport.incident_type)}</p>
                                </div>
                                <div>
                                    <div className="text-[10px] font-bold uppercase text-subtle mb-1">Severity</div>
                                    {severityPill(selectedReport.severity)}
                                </div>
                                <div>
                                    <div className="text-[10px] font-bold uppercase text-subtle mb-1">Status</div>
                                    {statusPill(selectedReport.status)}
                                </div>
                                <div>
                                    <div className="text-[10px] font-bold uppercase text-subtle mb-1">Submitted</div>
                                    <p className="m-0 text-xs text-ink">{new Date(selectedReport.created_at).toLocaleString()}</p>
                                </div>
                            </div>

                            <div>
                                <div className="text-[10px] font-bold uppercase text-subtle mb-1">Title</div>
                                <p className="m-0 text-[13px] font-semibold text-ink">{selectedReport.title}</p>
                            </div>

                            <div>
                                <div className="text-[10px] font-bold uppercase text-subtle mb-1">Description</div>
                                <p className="m-0 text-xs text-ink whitespace-pre-wrap">{selectedReport.description}</p>
                            </div>

                            {selectedReport.incident_date && (
                                <div>
                                    <div className="text-[10px] font-bold uppercase text-subtle mb-1">Incident Date</div>
                                    <p className="m-0 text-xs text-ink">{new Date(selectedReport.incident_date).toLocaleDateString()}</p>
                                </div>
                            )}

                            {selectedReport.location && (
                                <div>
                                    <div className="text-[10px] font-bold uppercase text-subtle mb-1">Location</div>
                                    <p className="m-0 text-xs text-ink">{selectedReport.location}</p>
                                </div>
                            )}

                            {selectedReport.witnesses && (
                                <div>
                                    <div className="text-[10px] font-bold uppercase text-subtle mb-1">Witnesses</div>
                                    <p className="m-0 text-xs text-ink">{selectedReport.witnesses}</p>
                                </div>
                            )}

                            {/* Admin section */}
                            <div className="border-t border-border pt-5">
                                <h4 className="m-0 text-[13px] font-bold text-ink mb-4">Admin Actions</h4>

                                <div className="space-y-4">
                                    <div>
                                        <label htmlFor="incident-status" className="block text-[11px] font-semibold text-ink mb-1.5">Update Status</label>
                                        <select
                                            id="incident-status"
                                            value={selectedReport.status}
                                            onChange={(e) => updateReportStatus(selectedReport.id, e.target.value)}
                                            disabled={isUpdating}
                                            className={fieldClass}
                                        >
                                            {STATUS_OPTIONS.filter(s => s.value !== 'all').map(option => (
                                                <option key={option.value} value={option.value}>{option.label}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div>
                                        <label htmlFor="incident-notes" className="block text-[11px] font-semibold text-ink mb-1.5">Admin Notes</label>
                                        <textarea
                                            id="incident-notes"
                                            value={adminNotes || selectedReport.admin_notes || ''}
                                            onChange={(e) => setAdminNotes(e.target.value)}
                                            rows={3}
                                            placeholder="Add investigation notes or comments..."
                                            className={fieldClass}
                                        />
                                    </div>

                                    <div>
                                        <label htmlFor="incident-resolution" className="block text-[11px] font-semibold text-ink mb-1.5">Resolution</label>
                                        <textarea
                                            id="incident-resolution"
                                            value={resolution || selectedReport.resolution || ''}
                                            onChange={(e) => setResolution(e.target.value)}
                                            rows={3}
                                            placeholder="Document the resolution..."
                                            className={fieldClass}
                                        />
                                    </div>

                                    {selectedReport.reviewed_by && (
                                        <div className="bg-background p-3 rounded-xl">
                                            <p className="m-0 text-[11px] text-muted-foreground">
                                                Last reviewed by <strong className="text-ink">{selectedReport.reviewed_by}</strong> on{' '}
                                                {new Date(selectedReport.reviewed_at!).toLocaleString()}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="px-6 py-4 border-t border-border bg-gray-50 flex justify-end gap-2.5">
                            <Button variant="secondary" onClick={closeDetails} disabled={isUpdating}>
                                Close
                            </Button>
                            <Button
                                onClick={() => updateReportStatus(selectedReport.id, selectedReport.status)}
                                disabled={isUpdating}
                                icon={
                                    isUpdating ? (
                                        <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" />
                                    ) : (
                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                    )
                                }
                            >
                                {isUpdating ? 'Saving...' : 'Save Changes'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default IncidentReportsManagement;
