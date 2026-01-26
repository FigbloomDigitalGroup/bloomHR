import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
    AlertTriangle,
    Shield,
    Upload,
    X,
    CheckCircle2,
    Eye,
    EyeOff,
    Calendar,
    MapPin,
    Users,
    FileText,
    Clock
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

interface IncidentReport {
    id: string;
    incident_type: string;
    severity: string;
    title: string;
    description: string;
    incident_date: string | null;
    location: string | null;
    witnesses: string | null;
    status: string;
    created_at: string;
    is_anonymous: boolean;
}

const INCIDENT_TYPES = [
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

const SEVERITY_LEVELS = [
    { value: 'low', label: 'Low', color: 'bg-blue-100 text-blue-800 border-blue-300' },
    { value: 'medium', label: 'Medium', color: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
    { value: 'high', label: 'High', color: 'bg-orange-100 text-orange-800 border-orange-300' },
    { value: 'critical', label: 'Critical', color: 'bg-red-100 text-red-800 border-red-300' }
];

const IncidentReport = () => {
    const [isAnonymous, setIsAnonymous] = useState(false);
    const [incidentType, setIncidentType] = useState('');
    const [severity, setSeverity] = useState('medium');
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [incidentDate, setIncidentDate] = useState('');
    const [location, setLocation] = useState('');
    const [witnesses, setWitnesses] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);
    const [submittedReportId, setSubmittedReportId] = useState('');
    const [myReports, setMyReports] = useState<IncidentReport[]>([]);
    const [showMyReports, setShowMyReports] = useState(false);
    const [employeeNumber, setEmployeeNumber] = useState('');

    useEffect(() => {
        fetchEmployeeNumber();
    }, []);

    useEffect(() => {
        if (showMyReports && !isAnonymous) {
            fetchMyReports();
        }
    }, [showMyReports]);

    const fetchEmployeeNumber = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user?.email) return;

            const { data } = await supabase
                .from('employees')
                .select('"Employee Number"')
                .eq('"Work Email"', user.email)
                .single();

            if (data) {
                setEmployeeNumber(data['Employee Number']);
            }
        } catch (error) {
            console.error('Error fetching employee number:', error);
        }
    };

    const fetchMyReports = async () => {
        try {
            const { data, error } = await supabase
                .from('incident_reports')
                .select('*')
                .eq('employee_number', employeeNumber)
                .eq('is_anonymous', false)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setMyReports(data || []);
        } catch (error) {
            console.error('Error fetching reports:', error);
            toast.error('Failed to load your reports');
        }
    };

    const resetForm = () => {
        setIncidentType('');
        setSeverity('medium');
        setTitle('');
        setDescription('');
        setIncidentDate('');
        setLocation('');
        setWitnesses('');
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!incidentType || !title.trim() || !description.trim()) {
            toast.error('Please fill in all required fields');
            return;
        }

        setIsSubmitting(true);
        try {
            const reportData = {
                employee_number: isAnonymous ? null : employeeNumber,
                is_anonymous: isAnonymous,
                incident_type: incidentType,
                severity,
                title: title.trim(),
                description: description.trim(),
                incident_date: incidentDate || null,
                location: location.trim() || null,
                witnesses: witnesses.trim() || null,
                status: 'new'
            };

            const { data, error } = await supabase
                .from('incident_reports')
                .insert(reportData)
                .select()
                .single();

            if (error) throw error;

            // Notify admins
            await notifyAdmins(data.id);

            setSubmittedReportId(data.id);
            setShowSuccess(true);
            resetForm();
            toast.success('Incident report submitted successfully');
        } catch (error) {
            console.error('Error submitting report:', error);
            toast.error('Failed to submit incident report');
        } finally {
            setIsSubmitting(false);
        }
    };

    const notifyAdmins = async (reportId: string) => {
        try {
            const { data: admins } = await supabase
                .from('employees')
                .select('"Employee Number"')
                .in('"Job Title"', ['Admin', 'HR Manager', 'System Administrator']);

            if (admins && admins.length > 0) {
                const notifications = admins.map(admin => ({
                    employee_number: admin['Employee Number'],
                    type: 'incident_report',
                    title: 'New Incident Report Submitted',
                    message: `A new ${isAnonymous ? 'anonymous' : ''} incident report has been submitted. Report ID: ${reportId}`,
                    priority: severity === 'critical' || severity === 'high' ? 'high' : 'medium',
                    is_read: false,
                    created_at: new Date().toISOString()
                }));

                await supabase.from('notifications').insert(notifications);
            }
        } catch (error) {
            console.error('Error notifying admins:', error);
        }
    };

    const getStatusBadge = (status: string) => {
        const styles = {
            new: 'bg-blue-100 text-blue-800',
            under_review: 'bg-yellow-100 text-yellow-800',
            investigating: 'bg-orange-100 text-orange-800',
            resolved: 'bg-green-100 text-green-800',
            closed: 'bg-gray-100 text-gray-800',
            dismissed: 'bg-red-100 text-red-800'
        };

        return (
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[status as keyof typeof styles]}`}>
                {status.replace('_', ' ').toUpperCase()}
            </span>
        );
    };

    if (showSuccess) {
        return (
            <div className="p-6">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="max-w-2xl mx-auto bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center"
                >
                    <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-green-100 mb-4">
                        <CheckCircle2 className="h-8 w-8 text-green-600" />
                    </div>
                    <h2 className="text-2xl font-semibold text-gray-900 mb-2">Report Submitted Successfully</h2>
                    <p className="text-gray-600 mb-4">
                        Your incident report has been submitted and will be reviewed by the appropriate personnel.
                    </p>
                    {!isAnonymous && (
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                            <p className="text-sm text-blue-800">
                                <strong>Report ID:</strong> {submittedReportId.substring(0, 8)}...
                            </p>
                            <p className="text-xs text-blue-600 mt-1">
                                You can track the status of your report in "My Reports"
                            </p>
                        </div>
                    )}
                    {isAnonymous && (
                        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
                            <p className="text-sm text-yellow-800">
                                Your report was submitted anonymously. You will not be able to track its status.
                            </p>
                        </div>
                    )}
                    <button
                        onClick={() => {
                            setShowSuccess(false);
                            setIsAnonymous(false);
                        }}
                        className="px-6 py-2 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 transition-colors"
                    >
                        Submit Another Report
                    </button>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="p-6">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h1 className="text-2xl font-semibold text-gray-900">Report an Incident</h1>
                            <p className="text-sm text-gray-600 mt-1">
                                Report workplace incidents, concerns, or violations confidentially
                            </p>
                        </div>
                        {!isAnonymous && (
                            <button
                                onClick={() => setShowMyReports(!showMyReports)}
                                className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors flex items-center"
                            >
                                <FileText className="h-4 w-4 mr-2" />
                                My Reports
                            </button>
                        )}
                    </div>

                    {/* Anonymity Toggle */}
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <div className="flex items-start">
                            <Shield className="h-5 w-5 text-blue-600 mt-0.5 mr-3 flex-shrink-0" />
                            <div className="flex-1">
                                <div className="flex items-center justify-between mb-2">
                                    <h3 className="text-sm font-medium text-blue-900">Anonymity Protection</h3>
                                    <button
                                        onClick={() => setIsAnonymous(!isAnonymous)}
                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isAnonymous ? 'bg-blue-600' : 'bg-gray-300'
                                            }`}
                                    >
                                        <span
                                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isAnonymous ? 'translate-x-6' : 'translate-x-1'
                                                }`}
                                        />
                                    </button>
                                </div>
                                <p className="text-xs text-blue-800">
                                    {isAnonymous ? (
                                        <>
                                            <EyeOff className="h-3 w-3 inline mr-1" />
                                            <strong>Anonymous Mode:</strong> Your identity will be completely protected. You won't be able to track this report.
                                        </>
                                    ) : (
                                        <>
                                            <Eye className="h-3 w-3 inline mr-1" />
                                            <strong>Identified Mode:</strong> Your identity will be visible to administrators. You can track your report status.
                                        </>
                                    )}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* My Reports Section */}
                {showMyReports && !isAnonymous && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6"
                    >
                        <h2 className="text-lg font-semibold text-gray-900 mb-4">My Submitted Reports</h2>
                        {myReports.length === 0 ? (
                            <p className="text-sm text-gray-500 text-center py-8">No reports submitted yet</p>
                        ) : (
                            <div className="space-y-3">
                                {myReports.map((report) => (
                                    <div key={report.id} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors">
                                        <div className="flex items-start justify-between mb-2">
                                            <h3 className="font-medium text-gray-900">{report.title}</h3>
                                            {getStatusBadge(report.status)}
                                        </div>
                                        <p className="text-sm text-gray-600 mb-2 line-clamp-2">{report.description}</p>
                                        <div className="flex items-center text-xs text-gray-500 space-x-4">
                                            <span className="flex items-center">
                                                <Clock className="h-3 w-3 mr-1" />
                                                {new Date(report.created_at).toLocaleDateString()}
                                            </span>
                                            <span className="capitalize">{report.incident_type.replace('_', ' ')}</span>
                                            <span className={`px-2 py-0.5 rounded-full ${SEVERITY_LEVELS.find(s => s.value === report.severity)?.color
                                                }`}>
                                                {report.severity}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </motion.div>
                )}

                {/* Report Form */}
                <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <div className="space-y-6">
                        {/* Incident Type and Severity */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Incident Type <span className="text-red-500">*</span>
                                </label>
                                <select
                                    value={incidentType}
                                    onChange={(e) => setIncidentType(e.target.value)}
                                    required
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                                >
                                    <option value="">Select incident type...</option>
                                    {INCIDENT_TYPES.map((type) => (
                                        <option key={type.value} value={type.value}>
                                            {type.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Severity Level <span className="text-red-500">*</span>
                                </label>
                                <select
                                    value={severity}
                                    onChange={(e) => setSeverity(e.target.value)}
                                    required
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                                >
                                    {SEVERITY_LEVELS.map((level) => (
                                        <option key={level.value} value={level.value}>
                                            {level.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Title */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Title <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                required
                                maxLength={200}
                                placeholder="Brief summary of the incident"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                            />
                        </div>

                        {/* Description */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Detailed Description <span className="text-red-500">*</span>
                            </label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                required
                                rows={6}
                                placeholder="Provide a detailed description of the incident, including what happened, when, and any other relevant information..."
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                            />
                            <p className="text-xs text-gray-500 mt-1">
                                Be as specific as possible. Include dates, times, locations, and names if applicable.
                            </p>
                        </div>

                        {/* Date, Location, Witnesses */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    <Calendar className="h-4 w-4 inline mr-1" />
                                    Incident Date
                                </label>
                                <input
                                    type="date"
                                    value={incidentDate}
                                    onChange={(e) => setIncidentDate(e.target.value)}
                                    max={new Date().toISOString().split('T')[0]}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    <MapPin className="h-4 w-4 inline mr-1" />
                                    Location
                                </label>
                                <input
                                    type="text"
                                    value={location}
                                    onChange={(e) => setLocation(e.target.value)}
                                    placeholder="Where did this occur?"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    <Users className="h-4 w-4 inline mr-1" />
                                    Witnesses
                                </label>
                                <input
                                    type="text"
                                    value={witnesses}
                                    onChange={(e) => setWitnesses(e.target.value)}
                                    placeholder="Any witnesses?"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                                />
                            </div>
                        </div>

                        {/* Warning */}
                        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                            <div className="flex items-start">
                                <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5 mr-3 flex-shrink-0" />
                                <div>
                                    <h4 className="text-sm font-medium text-yellow-900 mb-1">Important Information</h4>
                                    <ul className="text-xs text-yellow-800 space-y-1">
                                        <li>• All reports are treated confidentially and investigated thoroughly</li>
                                        <li>• False or malicious reports may result in disciplinary action</li>
                                        <li>• You will not face retaliation for reporting in good faith</li>
                                        {isAnonymous && <li>• Anonymous reports cannot be tracked or followed up on</li>}
                                    </ul>
                                </div>
                            </div>
                        </div>

                        {/* Submit Button */}
                        <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
                            <button
                                type="button"
                                onClick={resetForm}
                                disabled={isSubmitting}
                                className="px-6 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                            >
                                Clear Form
                            </button>
                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="px-6 py-2 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center"
                            >
                                {isSubmitting ? (
                                    <>
                                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                        Submitting...
                                    </>
                                ) : (
                                    <>
                                        <Shield className="h-4 w-4 mr-2" />
                                        Submit Report
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default IncidentReport;
