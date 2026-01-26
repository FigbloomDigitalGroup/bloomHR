import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
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
    Download
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
    { value: 'low', label: 'Low', color: 'bg-blue-100 text-blue-800 border-blue-300' },
    { value: 'medium', label: 'Medium', color: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
    { value: 'high', label: 'High', color: 'bg-orange-100 text-orange-800 border-orange-300' },
    { value: 'critical', label: 'Critical', color: 'bg-red-100 text-red-800 border-red-300' }
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
        filterReports();
    }, [reports, searchTerm, statusFilter, typeFilter, severityFilter]);

    const fetchReports = async () => {
        try {
            setIsLoading(true);

            const { data: reportsData, error } = await supabase
                .from('incident_reports')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;

            // Fetch reporter names for non-anonymous reports
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

    const filterReports = () => {
        let filtered = reports;

        // Filter by status
        if (statusFilter !== 'all') {
            filtered = filtered.filter(r => r.status === statusFilter);
        }

        // Filter by type
        if (typeFilter !== 'all') {
            filtered = filtered.filter(r => r.incident_type === typeFilter);
        }

        // Filter by severity
        if (severityFilter !== 'all') {
            filtered = filtered.filter(r => r.severity === severityFilter);
        }

        // Filter by search term
        if (searchTerm) {
            filtered = filtered.filter(r =>
                r.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                r.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                r.reporter_name?.toLowerCase().includes(searchTerm.toLowerCase())
            );
        }

        setFilteredReports(filtered);
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
            setSelectedReport(null);
            setAdminNotes('');
            setResolution('');
            await fetchReports();
        } catch (error) {
            console.error('Error updating report:', error);
            toast.error('Failed to update report status');
        } finally {
            setIsUpdating(false);
        }
    };

    const notifyReporter = async (employeeNumber: string, status: string, reportId: string) => {
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

    const getSeverityBadge = (severity: string) => {
        const level = SEVERITY_LEVELS.find(s => s.value === severity);
        return (
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${level?.color || 'bg-gray-100 text-gray-800'}`}>
                {severity.toUpperCase()}
            </span>
        );
    };

    const getStatusBadge = (status: string) => {
        const styles = {
            new: 'bg-blue-100 text-blue-800 border-blue-300',
            under_review: 'bg-yellow-100 text-yellow-800 border-yellow-300',
            investigating: 'bg-orange-100 text-orange-800 border-orange-300',
            resolved: 'bg-green-100 text-green-800 border-green-300',
            closed: 'bg-gray-100 text-gray-800 border-gray-300',
            dismissed: 'bg-red-100 text-red-800 border-red-300'
        };

        return (
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[status as keyof typeof styles]}`}>
                {status.replace('_', ' ').toUpperCase()}
            </span>
        );
    };

    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
            </div>
        );
    }

    return (
        <div className="p-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                {/* Header */}
                <div className="p-6 border-b border-gray-200">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h2 className="text-xl font-semibold text-gray-900">Incident Reports Management</h2>
                            <p className="text-sm text-gray-600 mt-1">Review and manage workplace incident reports</p>
                        </div>
                        <div className="flex items-center space-x-4">
                            <div className="flex items-center space-x-2 px-3 py-1 bg-red-100 text-red-800 rounded-full text-xs font-medium">
                                <AlertTriangle className="h-3 w-3" />
                                <span>{filteredReports.filter(r => r.severity === 'critical' || r.severity === 'high').length} High Priority</span>
                            </div>
                            <div className="flex items-center space-x-2 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
                                <Clock className="h-3 w-3" />
                                <span>{filteredReports.filter(r => r.status === 'new').length} New</span>
                            </div>
                        </div>
                    </div>

                    {/* Filters */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Search reports..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                            />
                        </div>
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                        >
                            {STATUS_OPTIONS.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                        <select
                            value={typeFilter}
                            onChange={(e) => setTypeFilter(e.target.value)}
                            className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                        >
                            {INCIDENT_TYPES.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                        <select
                            value={severityFilter}
                            onChange={(e) => setSeverityFilter(e.target.value)}
                            className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                        >
                            {SEVERITY_LEVELS.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Reports List */}
                <div className="divide-y divide-gray-200">
                    {filteredReports.length === 0 ? (
                        <div className="p-12 text-center">
                            <AlertTriangle className="mx-auto h-12 w-12 text-gray-400" />
                            <h3 className="mt-2 text-sm font-medium text-gray-900">No reports found</h3>
                            <p className="mt-1 text-sm text-gray-500">
                                {statusFilter === 'new'
                                    ? 'There are no new incident reports.'
                                    : 'Try adjusting your filters.'}
                            </p>
                        </div>
                    ) : (
                        filteredReports.map((report) => (
                            <motion.div
                                key={report.id}
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="p-6 hover:bg-gray-50 transition-colors cursor-pointer"
                                onClick={() => setSelectedReport(report)}
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                        <div className="flex items-center space-x-3 mb-2">
                                            {report.is_anonymous && (
                                                <span className="inline-flex items-center px-2 py-1 rounded-md bg-purple-100 text-purple-800 text-xs font-medium">
                                                    <Shield className="h-3 w-3 mr-1" />
                                                    Anonymous
                                                </span>
                                            )}
                                            {getSeverityBadge(report.severity)}
                                            {getStatusBadge(report.status)}
                                            <span className="text-xs text-gray-500 capitalize">
                                                {report.incident_type.replace('_', ' ')}
                                            </span>
                                        </div>

                                        <h3 className="text-sm font-medium text-gray-900 mb-1">{report.title}</h3>
                                        <p className="text-sm text-gray-600 mb-2 line-clamp-2">{report.description}</p>

                                        <div className="flex items-center text-xs text-gray-500 space-x-4">
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

                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedReport(report);
                                        }}
                                        className="ml-4 px-3 py-1 text-sm text-blue-600 hover:text-blue-800 font-medium"
                                    >
                                        <Eye className="h-4 w-4" />
                                    </button>
                                </div>
                            </motion.div>
                        ))
                    )}
                </div>
            </div>

            {/* Report Details Modal */}
            {selectedReport && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
                    >
                        <div className="p-6 border-b border-gray-200 sticky top-0 bg-white z-10">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-semibold text-gray-900">Incident Report Details</h3>
                                <button
                                    onClick={() => {
                                        setSelectedReport(null);
                                        setAdminNotes('');
                                        setResolution('');
                                    }}
                                    className="text-gray-400 hover:text-gray-600"
                                >
                                    <XCircle className="h-5 w-5" />
                                </button>
                            </div>
                        </div>

                        <div className="p-6 space-y-6">
                            {/* Report Info */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Reporter</label>
                                    <div className="flex items-center">
                                        {selectedReport.is_anonymous && <Shield className="h-4 w-4 mr-2 text-purple-600" />}
                                        <p className="text-sm text-gray-900">{selectedReport.reporter_name}</p>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Report ID</label>
                                    <p className="text-sm text-gray-900 font-mono">{selectedReport.id.substring(0, 8)}...</p>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Incident Type</label>
                                    <p className="text-sm text-gray-900 capitalize">{selectedReport.incident_type.replace('_', ' ')}</p>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Severity</label>
                                    {getSeverityBadge(selectedReport.severity)}
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                                    {getStatusBadge(selectedReport.status)}
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Submitted</label>
                                    <p className="text-sm text-gray-900">{new Date(selectedReport.created_at).toLocaleString()}</p>
                                </div>
                            </div>

                            {/* Incident Details */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                                <p className="text-sm text-gray-900">{selectedReport.title}</p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                                <p className="text-sm text-gray-900 whitespace-pre-wrap">{selectedReport.description}</p>
                            </div>

                            {selectedReport.incident_date && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Incident Date</label>
                                    <p className="text-sm text-gray-900">{new Date(selectedReport.incident_date).toLocaleDateString()}</p>
                                </div>
                            )}

                            {selectedReport.location && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                                    <p className="text-sm text-gray-900">{selectedReport.location}</p>
                                </div>
                            )}

                            {selectedReport.witnesses && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Witnesses</label>
                                    <p className="text-sm text-gray-900">{selectedReport.witnesses}</p>
                                </div>
                            )}

                            {/* Admin Section */}
                            <div className="border-t border-gray-200 pt-6">
                                <h4 className="text-sm font-medium text-gray-900 mb-4">Admin Actions</h4>

                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Update Status</label>
                                        <select
                                            value={selectedReport.status}
                                            onChange={(e) => updateReportStatus(selectedReport.id, e.target.value)}
                                            disabled={isUpdating}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                                        >
                                            {STATUS_OPTIONS.filter(s => s.value !== 'all').map(option => (
                                                <option key={option.value} value={option.value}>{option.label}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Admin Notes</label>
                                        <textarea
                                            value={adminNotes || selectedReport.admin_notes || ''}
                                            onChange={(e) => setAdminNotes(e.target.value)}
                                            rows={3}
                                            placeholder="Add investigation notes or comments..."
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Resolution</label>
                                        <textarea
                                            value={resolution || selectedReport.resolution || ''}
                                            onChange={(e) => setResolution(e.target.value)}
                                            rows={3}
                                            placeholder="Document the resolution..."
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                                        />
                                    </div>

                                    {selectedReport.reviewed_by && (
                                        <div className="bg-gray-50 p-3 rounded-lg">
                                            <p className="text-xs text-gray-600">
                                                Last reviewed by <strong>{selectedReport.reviewed_by}</strong> on{' '}
                                                {new Date(selectedReport.reviewed_at!).toLocaleString()}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="p-6 border-t border-gray-200 bg-gray-50 flex justify-end space-x-3">
                            <button
                                onClick={() => {
                                    setSelectedReport(null);
                                    setAdminNotes('');
                                    setResolution('');
                                }}
                                disabled={isUpdating}
                                className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                            >
                                Close
                            </button>
                            <button
                                onClick={() => updateReportStatus(selectedReport.id, selectedReport.status)}
                                disabled={isUpdating}
                                className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center"
                            >
                                {isUpdating ? (
                                    <>
                                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                        Saving...
                                    </>
                                ) : (
                                    <>
                                        <CheckCircle2 className="h-4 w-4 mr-2" />
                                        Save Changes
                                    </>
                                )}
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </div>
    );
};

export default IncidentReportsManagement;
