import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Briefcase,
    MapPin,
    Clock,
    DollarSign,
    Search,
    Filter,
    X,
    Send,
    CheckCircle2,
    AlertCircle,
    Calendar,
    Building2,
    FileText,
    Eye,
    Trash2
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

interface JobPosting {
    id: string;
    job_title: string;
    department: string;
    location: string | null;
    job_type: string;
    job_level: string | null;
    description: string;
    requirements: string;
    responsibilities: string | null;
    salary_range: string | null;
    benefits: string | null;
    application_deadline: string | null;
    status: string;
    posted_at: string;
}

interface JobApplication {
    id: string;
    job_posting_id: string;
    cover_letter: string | null;
    status: string;
    applied_at: string;
    job_posting?: JobPosting;
}

const JOB_TYPES = {
    full_time: 'Full Time',
    part_time: 'Part Time',
    contract: 'Contract',
    temporary: 'Temporary'
};

const APPLICATION_STATUS = {
    pending: { label: 'Pending', color: 'bg-blue-100 text-blue-800 border-blue-300' },
    under_review: { label: 'Under Review', color: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
    shortlisted: { label: 'Shortlisted', color: 'bg-purple-100 text-purple-800 border-purple-300' },
    interview_scheduled: { label: 'Interview Scheduled', color: 'bg-green-100 text-green-800 border-green-300' },
    rejected: { label: 'Rejected', color: 'bg-red-100 text-red-800 border-red-300' },
    accepted: { label: 'Accepted', color: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
    withdrawn: { label: 'Withdrawn', color: 'bg-gray-100 text-gray-800 border-gray-300' }
};

const JobApplications = () => {
    const [jobs, setJobs] = useState<JobPosting[]>([]);
    const [myApplications, setMyApplications] = useState<JobApplication[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [departmentFilter, setDepartmentFilter] = useState('all');
    const [jobTypeFilter, setJobTypeFilter] = useState('all');
    const [selectedJob, setSelectedJob] = useState<JobPosting | null>(null);
    const [showApplicationModal, setShowApplicationModal] = useState(false);
    const [coverLetter, setCoverLetter] = useState('');
    const [additionalInfo, setAdditionalInfo] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [activeTab, setActiveTab] = useState<'browse' | 'my-applications'>('browse');
    const [employeeNumber, setEmployeeNumber] = useState('');
    const [departments, setDepartments] = useState<string[]>([]);

    useEffect(() => {
        fetchEmployeeNumber();
        fetchJobs();
    }, []);

    useEffect(() => {
        if (employeeNumber) {
            fetchMyApplications();
        }
    }, [employeeNumber]);

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

    const fetchJobs = async () => {
        try {
            setIsLoading(true);
            const { data, error } = await supabase
                .from('job_postings')
                .select('*')
                .eq('status', 'open')
                .gte('application_deadline', new Date().toISOString().split('T')[0])
                .order('posted_at', { ascending: false });

            if (error) throw error;

            setJobs(data || []);

            // Extract unique departments
            const uniqueDepts = [...new Set((data || []).map(job => job.department))];
            setDepartments(uniqueDepts);
        } catch (error) {
            console.error('Error fetching jobs:', error);
            toast.error('Failed to load job postings');
        } finally {
            setIsLoading(false);
        }
    };

    const fetchMyApplications = async () => {
        try {
            const { data, error } = await supabase
                .from('job_applications')
                .select(`
          *,
          job_posting:job_postings(*)
        `)
                .eq('employee_number', employeeNumber)
                .order('applied_at', { ascending: false });

            if (error) throw error;
            setMyApplications(data || []);
        } catch (error) {
            console.error('Error fetching applications:', error);
            toast.error('Failed to load your applications');
        }
    };

    const handleApply = (job: JobPosting) => {
        // Check if already applied
        const hasApplied = myApplications.some(app => app.job_posting_id === job.id);
        if (hasApplied) {
            toast.error('You have already applied for this position');
            return;
        }

        setSelectedJob(job);
        setShowApplicationModal(true);
    };

    const submitApplication = async () => {
        if (!coverLetter.trim()) {
            toast.error('Please provide a cover letter');
            return;
        }

        setIsSubmitting(true);
        try {
            const { error } = await supabase
                .from('job_applications')
                .insert({
                    job_posting_id: selectedJob!.id,
                    employee_number: employeeNumber,
                    cover_letter: coverLetter.trim(),
                    additional_info: additionalInfo.trim() || null,
                    status: 'pending'
                });

            if (error) throw error;

            toast.success('Application submitted successfully!');
            setShowApplicationModal(false);
            setCoverLetter('');
            setAdditionalInfo('');
            setSelectedJob(null);

            // Refresh applications
            await fetchMyApplications();
        } catch (error: any) {
            console.error('Error submitting application:', error);
            if (error.message?.includes('duplicate')) {
                toast.error('You have already applied for this position');
            } else {
                toast.error('Failed to submit application');
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const withdrawApplication = async (applicationId: string) => {
        if (!confirm('Are you sure you want to withdraw this application?')) return;

        try {
            const { error } = await supabase
                .from('job_applications')
                .update({ status: 'withdrawn' })
                .eq('id', applicationId);

            if (error) throw error;

            toast.success('Application withdrawn');
            await fetchMyApplications();
        } catch (error) {
            console.error('Error withdrawing application:', error);
            toast.error('Failed to withdraw application');
        }
    };

    const filteredJobs = jobs.filter(job => {
        const matchesSearch = job.job_title.toLowerCase().includes(searchTerm.toLowerCase()) ||
            job.description.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesDepartment = departmentFilter === 'all' || job.department === departmentFilter;
        const matchesType = jobTypeFilter === 'all' || job.job_type === jobTypeFilter;

        return matchesSearch && matchesDepartment && matchesType;
    });

    const hasApplied = (jobId: string) => {
        return myApplications.some(app => app.job_posting_id === jobId);
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
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="mb-6">
                    <h1 className="text-2xl font-semibold text-gray-900">Internal Job Opportunities</h1>
                    <p className="text-sm text-gray-600 mt-1">
                        Explore and apply for open positions within the company
                    </p>
                </div>

                {/* Tabs */}
                <div className="flex space-x-4 mb-6 border-b border-gray-200">
                    <button
                        onClick={() => setActiveTab('browse')}
                        className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${activeTab === 'browse'
                                ? 'border-green-600 text-green-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                            }`}
                    >
                        <Briefcase className="h-4 w-4 inline mr-2" />
                        Browse Jobs ({filteredJobs.length})
                    </button>
                    <button
                        onClick={() => setActiveTab('my-applications')}
                        className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${activeTab === 'my-applications'
                                ? 'border-green-600 text-green-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                            }`}
                    >
                        <FileText className="h-4 w-4 inline mr-2" />
                        My Applications ({myApplications.length})
                    </button>
                </div>

                {/* Browse Jobs Tab */}
                {activeTab === 'browse' && (
                    <>
                        {/* Filters */}
                        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                                    <input
                                        type="text"
                                        placeholder="Search jobs..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                                    />
                                </div>
                                <select
                                    value={departmentFilter}
                                    onChange={(e) => setDepartmentFilter(e.target.value)}
                                    className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                                >
                                    <option value="all">All Departments</option>
                                    {departments.map(dept => (
                                        <option key={dept} value={dept}>{dept}</option>
                                    ))}
                                </select>
                                <select
                                    value={jobTypeFilter}
                                    onChange={(e) => setJobTypeFilter(e.target.value)}
                                    className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                                >
                                    <option value="all">All Job Types</option>
                                    {Object.entries(JOB_TYPES).map(([key, label]) => (
                                        <option key={key} value={key}>{label}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Job Listings */}
                        {filteredJobs.length === 0 ? (
                            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
                                <Briefcase className="mx-auto h-12 w-12 text-gray-400" />
                                <h3 className="mt-2 text-sm font-medium text-gray-900">No jobs found</h3>
                                <p className="mt-1 text-sm text-gray-500">
                                    Try adjusting your filters or check back later for new opportunities.
                                </p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 gap-4">
                                {filteredJobs.map((job) => (
                                    <motion.div
                                        key={job.id}
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow"
                                    >
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1">
                                                <div className="flex items-center space-x-3 mb-2">
                                                    <h3 className="text-lg font-semibold text-gray-900">{job.job_title}</h3>
                                                    {hasApplied(job.id) && (
                                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                                            <CheckCircle2 className="h-3 w-3 mr-1" />
                                                            Applied
                                                        </span>
                                                    )}
                                                </div>

                                                <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600 mb-3">
                                                    <span className="flex items-center">
                                                        <Building2 className="h-4 w-4 mr-1" />
                                                        {job.department}
                                                    </span>
                                                    {job.location && (
                                                        <span className="flex items-center">
                                                            <MapPin className="h-4 w-4 mr-1" />
                                                            {job.location}
                                                        </span>
                                                    )}
                                                    <span className="flex items-center">
                                                        <Clock className="h-4 w-4 mr-1" />
                                                        {JOB_TYPES[job.job_type as keyof typeof JOB_TYPES]}
                                                    </span>
                                                    {job.salary_range && (
                                                        <span className="flex items-center">
                                                            <DollarSign className="h-4 w-4 mr-1" />
                                                            {job.salary_range}
                                                        </span>
                                                    )}
                                                </div>

                                                <p className="text-sm text-gray-700 mb-3 line-clamp-2">{job.description}</p>

                                                {job.application_deadline && (
                                                    <div className="flex items-center text-xs text-orange-600">
                                                        <Calendar className="h-3 w-3 mr-1" />
                                                        Apply by {new Date(job.application_deadline).toLocaleDateString()}
                                                    </div>
                                                )}
                                            </div>

                                            <div className="ml-4 flex flex-col space-y-2">
                                                <button
                                                    onClick={() => {
                                                        setSelectedJob(job);
                                                    }}
                                                    className="px-4 py-2 text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center"
                                                >
                                                    <Eye className="h-4 w-4 mr-1" />
                                                    View Details
                                                </button>
                                                {!hasApplied(job.id) && (
                                                    <button
                                                        onClick={() => handleApply(job)}
                                                        className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors flex items-center"
                                                    >
                                                        <Send className="h-4 w-4 mr-1" />
                                                        Apply Now
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </motion.div>
                                ))}
                            </div>
                        )}
                    </>
                )}

                {/* My Applications Tab */}
                {activeTab === 'my-applications' && (
                    <div className="space-y-4">
                        {myApplications.length === 0 ? (
                            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
                                <FileText className="mx-auto h-12 w-12 text-gray-400" />
                                <h3 className="mt-2 text-sm font-medium text-gray-900">No applications yet</h3>
                                <p className="mt-1 text-sm text-gray-500">
                                    Start browsing job opportunities and submit your first application.
                                </p>
                                <button
                                    onClick={() => setActiveTab('browse')}
                                    className="mt-4 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700"
                                >
                                    Browse Jobs
                                </button>
                            </div>
                        ) : (
                            myApplications.map((app) => (
                                <div
                                    key={app.id}
                                    className="bg-white rounded-lg shadow-sm border border-gray-200 p-6"
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1">
                                            <h3 className="text-lg font-semibold text-gray-900 mb-2">
                                                {app.job_posting?.job_title}
                                            </h3>
                                            <div className="flex items-center space-x-3 mb-3">
                                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${APPLICATION_STATUS[app.status as keyof typeof APPLICATION_STATUS]?.color
                                                    }`}>
                                                    {APPLICATION_STATUS[app.status as keyof typeof APPLICATION_STATUS]?.label}
                                                </span>
                                                <span className="text-xs text-gray-500">
                                                    Applied on {new Date(app.applied_at).toLocaleDateString()}
                                                </span>
                                            </div>
                                            {app.cover_letter && (
                                                <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                                                    <p className="text-xs font-medium text-gray-700 mb-1">Cover Letter:</p>
                                                    <p className="text-sm text-gray-600 line-clamp-3">{app.cover_letter}</p>
                                                </div>
                                            )}
                                        </div>
                                        {app.status === 'pending' && (
                                            <button
                                                onClick={() => withdrawApplication(app.id)}
                                                className="ml-4 px-3 py-1 text-sm text-red-600 hover:text-red-800 font-medium flex items-center"
                                            >
                                                <Trash2 className="h-4 w-4 mr-1" />
                                                Withdraw
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>

            {/* Application Modal */}
            <AnimatePresence>
                {showApplicationModal && selectedJob && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
                        >
                            <div className="p-6 border-b border-gray-200 sticky top-0 bg-white z-10">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-lg font-semibold text-gray-900">Apply for {selectedJob.job_title}</h3>
                                    <button
                                        onClick={() => {
                                            setShowApplicationModal(false);
                                            setCoverLetter('');
                                            setAdditionalInfo('');
                                        }}
                                        className="text-gray-400 hover:text-gray-600"
                                    >
                                        <X className="h-5 w-5" />
                                    </button>
                                </div>
                            </div>

                            <div className="p-6 space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Cover Letter <span className="text-red-500">*</span>
                                    </label>
                                    <textarea
                                        value={coverLetter}
                                        onChange={(e) => setCoverLetter(e.target.value)}
                                        rows={8}
                                        placeholder="Explain why you're interested in this position and what makes you a great fit..."
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Additional Information (Optional)
                                    </label>
                                    <textarea
                                        value={additionalInfo}
                                        onChange={(e) => setAdditionalInfo(e.target.value)}
                                        rows={4}
                                        placeholder="Any additional information you'd like to share..."
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                                    />
                                </div>

                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                    <div className="flex items-start">
                                        <AlertCircle className="h-4 w-4 text-blue-600 mt-0.5 mr-2 flex-shrink-0" />
                                        <p className="text-xs text-blue-800">
                                            Your application will be reviewed by the HR team. You will be notified of any updates via the notifications system.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="p-6 border-t border-gray-200 bg-gray-50 flex justify-end space-x-3">
                                <button
                                    onClick={() => {
                                        setShowApplicationModal(false);
                                        setCoverLetter('');
                                        setAdditionalInfo('');
                                    }}
                                    disabled={isSubmitting}
                                    className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={submitApplication}
                                    disabled={isSubmitting || !coverLetter.trim()}
                                    className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center"
                                >
                                    {isSubmitting ? (
                                        <>
                                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                            Submitting...
                                        </>
                                    ) : (
                                        <>
                                            <Send className="h-4 w-4 mr-2" />
                                            Submit Application
                                        </>
                                    )}
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Job Details Modal */}
            <AnimatePresence>
                {selectedJob && !showApplicationModal && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
                        >
                            <div className="p-6 border-b border-gray-200 sticky top-0 bg-white z-10">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-xl font-semibold text-gray-900">{selectedJob.job_title}</h3>
                                    <button
                                        onClick={() => setSelectedJob(null)}
                                        className="text-gray-400 hover:text-gray-600"
                                    >
                                        <X className="h-5 w-5" />
                                    </button>
                                </div>
                            </div>

                            <div className="p-6 space-y-6">
                                <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                                    <span className="flex items-center">
                                        <Building2 className="h-4 w-4 mr-1" />
                                        {selectedJob.department}
                                    </span>
                                    {selectedJob.location && (
                                        <span className="flex items-center">
                                            <MapPin className="h-4 w-4 mr-1" />
                                            {selectedJob.location}
                                        </span>
                                    )}
                                    <span className="flex items-center">
                                        <Clock className="h-4 w-4 mr-1" />
                                        {JOB_TYPES[selectedJob.job_type as keyof typeof JOB_TYPES]}
                                    </span>
                                    {selectedJob.salary_range && (
                                        <span className="flex items-center">
                                            <DollarSign className="h-4 w-4 mr-1" />
                                            {selectedJob.salary_range}
                                        </span>
                                    )}
                                </div>

                                <div>
                                    <h4 className="text-sm font-medium text-gray-900 mb-2">Description</h4>
                                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{selectedJob.description}</p>
                                </div>

                                <div>
                                    <h4 className="text-sm font-medium text-gray-900 mb-2">Requirements</h4>
                                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{selectedJob.requirements}</p>
                                </div>

                                {selectedJob.responsibilities && (
                                    <div>
                                        <h4 className="text-sm font-medium text-gray-900 mb-2">Responsibilities</h4>
                                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{selectedJob.responsibilities}</p>
                                    </div>
                                )}

                                {selectedJob.benefits && (
                                    <div>
                                        <h4 className="text-sm font-medium text-gray-900 mb-2">Benefits</h4>
                                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{selectedJob.benefits}</p>
                                    </div>
                                )}

                                {selectedJob.application_deadline && (
                                    <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                                        <div className="flex items-center text-sm text-orange-800">
                                            <Calendar className="h-4 w-4 mr-2" />
                                            Application deadline: {new Date(selectedJob.application_deadline).toLocaleDateString()}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="p-6 border-t border-gray-200 bg-gray-50 flex justify-end space-x-3">
                                <button
                                    onClick={() => setSelectedJob(null)}
                                    className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
                                >
                                    Close
                                </button>
                                {!hasApplied(selectedJob.id) && (
                                    <button
                                        onClick={() => {
                                            setShowApplicationModal(true);
                                        }}
                                        className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors flex items-center"
                                    >
                                        <Send className="h-4 w-4 mr-2" />
                                        Apply for this Position
                                    </button>
                                )}
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default JobApplications;
