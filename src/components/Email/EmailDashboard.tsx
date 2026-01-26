import { useState, useEffect } from 'react';
import { Loader2, RefreshCw, CheckCircle, XCircle, Clock, Search, ChevronLeft, ChevronRight, Eye, X } from 'lucide-react';
import { toast } from 'react-hot-toast';

interface EmailLog {
    id: string;
    from: string;
    to: string[];
    subject: string;
    html: string;
    created_at: string;
    last_event: string;
    status: 'sent' | 'delivered' | 'bounced' | 'complaint' | 'opened' | 'clicked';
    bcc?: string[] | null;
    cc?: string[] | null;
    reply_to?: string[] | null;
}

interface EmailDetails extends EmailLog {
    text?: string | null;
}

export default function EmailDashboard() {
    const [logs, setLogs] = useState<EmailLog[]>([]);
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState<'all' | 'delivered' | 'bounced'>('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedEmail, setSelectedEmail] = useState<EmailDetails | null>(null);
    const [loadingDetails, setLoadingDetails] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);
    const itemsPerPage = 20;

    const fetchLogs = async (page: number = 1) => {
        setLoading(true);
        try {
            // Use same API URL logic as other components
            const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.MODE === 'production' ? '/api' : "http://localhost:3001/api");
            const url = `${API_URL}/email/logs?limit=${itemsPerPage}`;
            const response = await fetch(url);

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to fetch email logs from Resend');
            }

            const resendData = await response.json();
            // Resend API returns { object: 'list', data: [...], has_more: boolean }
            const emails = resendData.data || [];
            setHasMore(resendData.has_more || false);

            // Map Resend data to our interface
            const mappedLogs: EmailLog[] = emails.map((log: any) => ({
                id: log.id,
                from: log.from,
                to: log.to,
                subject: log.subject,
                html: '',
                created_at: log.created_at,
                last_event: log.last_event,
                status: log.last_event || 'sent',
                bcc: log.bcc,
                cc: log.cc,
                reply_to: log.reply_to
            }));

            setLogs(mappedLogs);
            setCurrentPage(page);
            toast.success(`Loaded ${mappedLogs.length} emails from Resend`);
        } catch (error) {
            console.error('Error fetching logs:', error);
            toast.error('Failed to load email logs from Resend');
        } finally {
            setLoading(false);
        }
    };

    const fetchEmailDetails = async (emailId: string) => {
        setLoadingDetails(true);
        try {
            const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.MODE === 'production' ? '/api' : "http://localhost:3001/api");
            const response = await fetch(`${API_URL}/email/logs/${emailId}`);

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to fetch email details');
            }

            const details = await response.json();
            setSelectedEmail(details);
        } catch (error) {
            console.error('Error fetching email details:', error);
            toast.error('Failed to load email details');
        } finally {
            setLoadingDetails(false);
        }
    };

    useEffect(() => {
        fetchLogs(1);
    }, []);

    const filteredLogs = logs.filter(log => {
        const matchesFilter = filter === 'all' ||
            (filter === 'delivered' && log.status === 'delivered') ||
            (filter === 'bounced' && (log.status === 'bounced' || log.status === 'complaint'));

        const toAddress = log.to[0] || '';

        const matchesSearch =
            toAddress.toLowerCase().includes(searchTerm.toLowerCase()) ||
            log.subject.toLowerCase().includes(searchTerm.toLowerCase());

        return matchesFilter && matchesSearch;
    });

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'delivered':
                return (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Delivered
                    </span>
                );
            case 'bounced':
            case 'complaint':
                return (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                        <XCircle className="w-3 h-3 mr-1" />
                        Bounced
                    </span>
                );
            case 'opened':
                return (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                        <Eye className="w-3 h-3 mr-1" />
                        Opened
                    </span>
                );
            case 'clicked':
                return (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Clicked
                    </span>
                );
            default:
                return (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        <Clock className="w-3 h-3 mr-1" />
                        {status ? (status.charAt(0).toUpperCase() + status.slice(1)) : 'Unknown'}
                    </span>
                );
        }
    };

    return (
        <>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-6 border-b border-gray-200">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900">Email Logs</h2>
                            <p className="text-sm text-gray-500">Monitor all emails directly from Resend</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => fetchLogs(currentPage)}
                                disabled={loading}
                                className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                            >
                                <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                                Refresh
                            </button>
                        </div>
                    </div>

                    <div className="mt-4 flex flex-col md:flex-row gap-4">
                        <div className="flex-1 relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <Search className="h-4 w-4 text-gray-400" />
                            </div>
                            <input
                                type="text"
                                className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                                placeholder="Search by email or subject..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="relative inline-block text-left">
                                <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
                                    <button
                                        onClick={() => setFilter('all')}
                                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${filter === 'all'
                                            ? 'bg-white text-gray-900 shadow-sm'
                                            : 'text-gray-500 hover:text-gray-700'
                                            }`}
                                    >
                                        All
                                    </button>
                                    <button
                                        onClick={() => setFilter('delivered')}
                                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${filter === 'delivered'
                                            ? 'bg-white text-green-700 shadow-sm'
                                            : 'text-gray-500 hover:text-gray-700'
                                            }`}
                                    >
                                        Delivered
                                    </button>
                                    <button
                                        onClick={() => setFilter('bounced')}
                                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${filter === 'bounced'
                                            ? 'bg-white text-red-700 shadow-sm'
                                            : 'text-gray-500 hover:text-gray-700'
                                            }`}
                                    >
                                        Bounced
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Status
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Recipient / Subject
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Date
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {loading && logs.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="px-6 py-12 text-center text-sm text-gray-500">
                                        <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin text-blue-500" />
                                        Loading email logs from Resend...
                                    </td>
                                </tr>
                            ) : filteredLogs.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="px-6 py-12 text-center text-sm text-gray-500">
                                        No email logs found in Resend.
                                    </td>
                                </tr>
                            ) : (
                                filteredLogs.map((log) => (
                                    <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            {getStatusBadge(log.status)}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col">
                                                <span className="text-sm font-medium text-gray-900">{log.to.join(', ')}</span>
                                                <span className="text-sm text-gray-500 truncate max-w-xs">{log.subject}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {new Date(log.created_at).toLocaleString()}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                                            <button
                                                onClick={() => fetchEmailDetails(log.id)}
                                                className="inline-flex items-center px-3 py-1.5 border border-gray-300 shadow-sm text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                                            >
                                                <Eye className="w-3 h-3 mr-1" />
                                                View Details
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
                    <div className="flex-1 flex justify-between sm:hidden">
                        <button
                            onClick={() => fetchLogs(currentPage - 1)}
                            disabled={currentPage === 1 || loading}
                            className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Previous
                        </button>
                        <button
                            onClick={() => fetchLogs(currentPage + 1)}
                            disabled={!hasMore || loading}
                            className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Next
                        </button>
                    </div>
                    <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                        <div>
                            <p className="text-sm text-gray-700">
                                Showing page <span className="font-medium">{currentPage}</span>
                            </p>
                        </div>
                        <div>
                            <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                                <button
                                    onClick={() => fetchLogs(currentPage - 1)}
                                    disabled={currentPage === 1 || loading}
                                    className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <span className="sr-only">Previous</span>
                                    <ChevronLeft className="h-5 w-5" />
                                </button>
                                <button
                                    onClick={() => fetchLogs(currentPage + 1)}
                                    disabled={!hasMore || loading}
                                    className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <span className="sr-only">Next</span>
                                    <ChevronRight className="h-5 w-5" />
                                </button>
                            </nav>
                        </div>
                    </div>
                </div>
            </div>

            {/* Email Details Modal */}
            {selectedEmail && (
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                            <h3 className="text-lg font-medium text-gray-900">Email Details</h3>
                            <button
                                onClick={() => setSelectedEmail(null)}
                                className="text-gray-400 hover:text-gray-500"
                            >
                                <X className="h-6 w-6" />
                            </button>
                        </div>

                        <div className="px-6 py-4 overflow-y-auto max-h-[calc(90vh-8rem)]">
                            {loadingDetails ? (
                                <div className="flex items-center justify-center py-12">
                                    <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">Status</label>
                                        <div className="mt-1">
                                            {getStatusBadge(selectedEmail.last_event)}
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">From</label>
                                        <p className="mt-1 text-sm text-gray-900">{selectedEmail.from}</p>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">To</label>
                                        <p className="mt-1 text-sm text-gray-900">{selectedEmail.to.join(', ')}</p>
                                    </div>

                                    {selectedEmail.cc && selectedEmail.cc.length > 0 && (
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700">CC</label>
                                            <p className="mt-1 text-sm text-gray-900">{selectedEmail.cc.join(', ')}</p>
                                        </div>
                                    )}

                                    {selectedEmail.bcc && selectedEmail.bcc.length > 0 && (
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700">BCC</label>
                                            <p className="mt-1 text-sm text-gray-900">{selectedEmail.bcc.join(', ')}</p>
                                        </div>
                                    )}

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">Subject</label>
                                        <p className="mt-1 text-sm text-gray-900">{selectedEmail.subject}</p>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">Created At</label>
                                        <p className="mt-1 text-sm text-gray-900">{new Date(selectedEmail.created_at).toLocaleString()}</p>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700">Email ID</label>
                                        <p className="mt-1 text-sm text-gray-500 font-mono">{selectedEmail.id}</p>
                                    </div>

                                    {selectedEmail.html && (
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">Email Preview</label>
                                            <div className="border border-gray-300 rounded-lg p-4 bg-gray-50 max-h-96 overflow-auto">
                                                <iframe
                                                    srcDoc={selectedEmail.html}
                                                    className="w-full min-h-[300px] bg-white"
                                                    sandbox="allow-same-origin"
                                                    title="Email Preview"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
                            <button
                                onClick={() => setSelectedEmail(null)}
                                className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
