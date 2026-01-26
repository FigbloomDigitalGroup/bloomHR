import { useState } from 'react';
import { Eye, Download, Edit, Briefcase, X, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { GlowButton } from './GlowButton';
import { StatusBadge } from './StatusBadge';
import { sendEmail } from '../../../services/email';
import toast from 'react-hot-toast';

interface ApplicationsTableProps {
  applications: any[];
  setSelectedApplication: (app: any) => void;
}

export const ApplicationsTable = ({ applications, setSelectedApplication }: ApplicationsTableProps) => {
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [selectedApplicationForSchedule, setSelectedApplicationForSchedule] = useState<any>(null);
  const [isSending, setIsSending] = useState(false);
  const [scheduleData, setScheduleData] = useState({
    date: '',
    time: '',
    duration: '30',
    interviewType: 'virtual',
    location: '',
    meetingLink: '',
    notes: ''
  });

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  // Calculate pagination values
  const totalPages = Math.ceil(applications.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentApplications = applications.slice(startIndex, endIndex);

  // Pagination handlers
  const goToPage = (page: number) => {
    setCurrentPage(page);
  };

  const goToNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  const goToPreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const getResumeFileName = (application: any) => {
    if (application.resume_file_name) {
      return application.resume_file_name;
    }
    if (application.resume_file_url) {
      const urlParts = application.resume_file_url.split('/');
      return urlParts[urlParts.length - 1];
    }
    return 'resume.pdf';
  };

  const handleOpenScheduleModal = (application: any) => {
    setSelectedApplicationForSchedule(application);
    setScheduleData({
      date: '',
      time: '',
      duration: '30',
      interviewType: 'virtual',
      location: '',
      meetingLink: '',
      notes: ''
    });
    setShowScheduleModal(true);
  };

  const handleScheduleSubmit = async (e) => {
    e.preventDefault();
    setIsSending(true);

    try {
      const emailContent = `
        <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #2563eb;">Interview Scheduled</h2>
          <p>Hello ${selectedApplicationForSchedule.first_name},</p>
          <p>Your interview for <strong>${selectedApplicationForSchedule.position}</strong> has been scheduled.</p>
          
          <div style="background-color: #f8fafc; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <p><strong>Date:</strong> ${scheduleData.date}</p>
            <p><strong>Time:</strong> ${scheduleData.time}</p>
            ${scheduleData.interviewType === 'virtual' ?
          `<p><strong>Meeting Link:</strong> ${scheduleData.meetingLink}</p>` :
          `<p><strong>Location:</strong> ${scheduleData.location}</p>`}
            ${scheduleData.notes ? `<p><strong>Notes:</strong> ${scheduleData.notes}</p>` : ''}
            <p> follow this link to do interview https://recruit-11b6.onrender.com </p>
          </div>
        </div>
      `;

      await sendEmail({
        to: selectedApplicationForSchedule.email,
        subject: `Interview Scheduled for ${selectedApplicationForSchedule.position}`,
        html: emailContent,
      });

      toast.success('Interview scheduled and email sent!');
      setShowScheduleModal(false);
    } catch (error) {
      toast.error('Failed to send email: ' + error.message);
    } finally {
      setIsSending(false);
    }
  };

  // Generate page numbers for pagination
  const getPageNumbers = () => {
    const pages = [];
    const maxVisiblePages = 5;

    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

    // Adjust if we're at the beginning
    if (endPage - startPage + 1 < maxVisiblePages) {
      startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
      pages.push(i);
    }

    return pages;
  };

  return (
    <>
      {/* Main Table Container - Responsive height based on screen size */}
      <div className="flex flex-col bg-white rounded-xl shadow-sm border border-gray-200">
        {/* Header - Fixed height */}
        <div className="flex-shrink-0 p-3 sm:p-4 md:p-6 border-b border-gray-200">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-4">
            <div>
              <h2 className="text-base sm:text-lg font-semibold text-gray-900">Job Applications</h2>
              <p className="text-gray-600 text-xs sm:text-xs">
                Showing {startIndex + 1}-{Math.min(endIndex, applications.length)} of {applications.length} applications
              </p>
            </div>
            <div className="flex flex-wrap gap-2 w-full sm:w-auto">
              <GlowButton variant="secondary" icon={Download} size="sm">Export</GlowButton>
            </div>
          </div>
        </div>

        {/* Table Container - Scrollable */}
        <div className="flex-1 overflow-auto min-h-0">
          <table className="w-full text-xs sm:text-xs min-w-[800px]">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
              <tr>
                <th className="text-left py-2 sm:py-3 px-2 sm:px-4 text-gray-700 font-semibold min-w-[120px] sm:min-w-[160px]">
                  Applicant
                </th>
                <th className="text-left py-2 sm:py-3 px-2 sm:px-4 text-gray-700 font-semibold min-w-[100px] sm:min-w-[120px]">
                  Position
                </th>
                <th className="text-left py-2 sm:py-3 px-2 sm:px-4 text-gray-700 font-semibold min-w-[80px] sm:min-w-[100px]">
                  Branch
                </th>
                <th className="text-left py-2 sm:py-3 px-2 sm:px-4 text-gray-700 font-semibold min-w-[80px] sm:min-w-[100px]">
                  Department
                </th>
                <th className="text-left py-2 sm:py-3 px-2 sm:px-4 text-gray-700 font-semibold min-w-[70px] sm:min-w-[80px]">
                  Resume
                </th>
                <th className="text-left py-2 sm:py-3 px-2 sm:px-4 text-gray-700 font-semibold min-w-[70px] sm:min-w-[80px]">
                  Status
                </th>
                <th className="text-left py-2 sm:py-3 px-2 sm:px-4 text-gray-700 font-semibold min-w-[80px] sm:min-w-[100px]">
                  Date Applied
                </th>
                <th className="text-center py-2 sm:py-3 px-2 sm:px-4 text-gray-700 font-semibold min-w-[120px] sm:min-w-[140px]">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {currentApplications.map((application, index) => (
                <tr key={application.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-3 sm:py-4 px-2 sm:px-4">
                    <div className="space-y-1">
                      <p className="text-gray-900 font-semibold text-xs sm:text-xs truncate">
                        {application.first_name} {application.last_name}
                      </p>
                      <p className="text-gray-500 text-xs truncate">{application.email}</p>
                    </div>
                  </td>
                  <td className="py-3 sm:py-4 px-2 sm:px-4">
                    <p className="text-gray-700 text-xs sm:text-xs truncate" title={application.position || 'N/A'}>
                      {application.position || 'N/A'}
                    </p>
                  </td>
                  <td className="py-3 sm:py-4 px-2 sm:px-4">
                    <p className="text-gray-700 text-xs sm:text-xs truncate" title={application.preferred_location || 'N/A'}>
                      {application.preferred_location || 'N/A'}
                    </p>
                  </td>
                  <td className="py-3 sm:py-4 px-2 sm:px-4">
                    <p className="text-gray-700 text-xs sm:text-xs truncate" title={application.department || 'N/A'}>
                      {application.department || 'N/A'}
                    </p>
                  </td>
                  <td className="py-3 sm:py-4 px-2 sm:px-4">
                    {application.resume_file_url && (
                      <div className="flex">
                        <button
                          onClick={() => window.open(application.resume_file_url, '_blank')}
                          className="px-1.5 sm:px-2 py-1 bg-green-100 hover:bg-green-200 text-green-700 rounded text-xs flex items-center gap-1 whitespace-nowrap"
                          title="View Resume"
                        >
                          <Eye className="w-3 h-3 flex-shrink-0" />
                          <span className="hidden sm:inline">View</span>
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="py-3 sm:py-4 px-2 sm:px-4">
                    <StatusBadge status={application.status || 'New'} />
                  </td>
                  <td className="py-3 sm:py-4 px-2 sm:px-4">
                    <p className="text-gray-700 text-xs sm:text-xs">
                      {new Date(application.created_at).toLocaleDateString()}
                    </p>
                  </td>
                  <td className="py-3 sm:py-4 px-2 sm:px-4">
                    <div className="flex justify-center gap-1 flex-col sm:flex-row">
                      <GlowButton
                        variant="secondary"
                        icon={Edit}
                        size="sm"
                        onClick={() => setSelectedApplication(application)}
                        className="text-xs whitespace-nowrap"
                      >
                        <span className="hidden sm:inline">Review</span>
                        <span className="sm:hidden">Rev</span>
                      </GlowButton>
                      <GlowButton
                        variant="secondary"
                        icon={Briefcase}
                        size="sm"
                        onClick={() => handleOpenScheduleModal(application)}
                        className="text-xs whitespace-nowrap"
                      >
                        <span className="hidden sm:inline">Schedule</span>
                        <span className="sm:hidden">Sch</span>
                      </GlowButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Empty state for small tables */}
          {applications.length === 0 && (
            <div className="flex items-center justify-center py-8 sm:py-12">
              <p className="text-gray-500 text-xs">No applications found</p>
            </div>
          )}
        </div>

        {/* Pagination - Fixed at bottom */}
        {applications.length > 0 && (
          <div className="flex-shrink-0 border-t border-gray-200 bg-white px-4 py-3 sm:px-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="text-xs text-gray-700">
                Showing <span className="font-medium">{startIndex + 1}</span> to{' '}
                <span className="font-medium">{Math.min(endIndex, applications.length)}</span> of{' '}
                <span className="font-medium">{applications.length}</span> results
              </div>

              <div className="flex items-center space-x-1">
                {/* Previous Button */}
                <button
                  onClick={goToPreviousPage}
                  disabled={currentPage === 1}
                  className={`relative inline-flex items-center px-2 py-2 text-xs font-medium rounded-md ${currentPage === 1
                    ? 'text-gray-300 cursor-not-allowed'
                    : 'text-gray-500 hover:bg-gray-50 focus:z-20 focus:outline-none focus:ring-2 focus:ring-[#47d475]'
                    }`}
                >
                  <span className="sr-only">Previous</span>
                  <ChevronLeft className="h-4 w-4" />
                </button>

                {/* Page Numbers */}
                {getPageNumbers().map((page) => (
                  <button
                    key={page}
                    onClick={() => goToPage(page)}
                    className={`relative inline-flex items-center px-3 py-2 text-xs font-medium rounded-md ${currentPage === page
                      ? 'z-10 bg-[#47d475] text-white focus:z-20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#47d475]'
                      : 'text-gray-500 hover:bg-gray-50 focus:z-20 focus:outline-none focus:ring-2 focus:ring-[#47d475]'
                      }`}
                  >
                    {page}
                  </button>
                ))}

                {/* Next Button */}
                <button
                  onClick={goToNextPage}
                  disabled={currentPage === totalPages}
                  className={`relative inline-flex items-center px-2 py-2 text-xs font-medium rounded-md ${currentPage === totalPages
                    ? 'text-gray-300 cursor-not-allowed'
                    : 'text-gray-500 hover:bg-gray-50 focus:z-20 focus:outline-none focus:ring-2 focus:ring-[#47d475]'
                    }`}
                >
                  <span className="sr-only">Next</span>
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Schedule Interview Modal - Fully responsive */}
      {showScheduleModal && selectedApplicationForSchedule && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start sm:items-center justify-center p-2 sm:p-4 z-50 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-md mx-auto my-4 sm:my-0 max-h-[95vh] sm:max-h-[90vh] flex flex-col">
            {/* Modal Header - Fixed */}
            <div className="flex-shrink-0 p-4 sm:p-6 border-b border-gray-100">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold text-gray-900">
                  Schedule Interview
                </h3>
                <button
                  onClick={() => setShowScheduleModal(false)}
                  className="text-gray-400 hover:text-gray-500 p-1 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mt-3 sm:mt-4">
                <p className="font-medium text-gray-900 text-xs sm:text-base">
                  {selectedApplicationForSchedule.first_name} {selectedApplicationForSchedule.last_name}
                </p>
                <p className="text-xs sm:text-xs text-gray-500">
                  {selectedApplicationForSchedule.position}
                </p>
              </div>
            </div>

            {/* Modal Body - Scrollable */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              <form onSubmit={handleScheduleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Date
                    </label>
                    <input
                      type="date"
                      className="w-full px-3 py-2 text-xs border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-[#47d475] focus:border-[#47d475]"
                      value={scheduleData.date}
                      onChange={(e) => setScheduleData({ ...scheduleData, date: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Time
                    </label>
                    <input
                      type="time"
                      className="w-full px-3 py-2 text-xs border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-[#47d475] focus:border-[#47d475]"
                      value={scheduleData.time}
                      onChange={(e) => setScheduleData({ ...scheduleData, time: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Duration (minutes)
                  </label>
                  <select
                    className="w-full px-3 py-2 text-xs border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-[#47d475] focus:border-[#47d475]"
                    value={scheduleData.duration}
                    onChange={(e) => setScheduleData({ ...scheduleData, duration: e.target.value })}
                  >
                    <option value="30">30 minutes</option>
                    <option value="45">45 minutes</option>
                    <option value="60">60 minutes</option>
                    <option value="90">90 minutes</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">
                    Interview Type
                  </label>
                  <div className="space-y-2">
                    <div className="flex items-center">
                      <input
                        id="virtual"
                        name="interviewType"
                        type="radio"
                        className="h-4 w-4 text-[#47d475] focus:ring-[#47d475] border-gray-300"
                        checked={scheduleData.interviewType === 'virtual'}
                        onChange={() => setScheduleData({ ...scheduleData, interviewType: 'virtual' })}
                      />
                      <label htmlFor="virtual" className="ml-2 block text-xs text-gray-700">
                        Virtual
                      </label>
                    </div>
                    <div className="flex items-center">
                      <input
                        id="in-person"
                        name="interviewType"
                        type="radio"
                        className="h-4 w-4 text-[#47d475] focus:ring-[#47d475] border-gray-300"
                        checked={scheduleData.interviewType === 'in-person'}
                        onChange={() => setScheduleData({ ...scheduleData, interviewType: 'in-person' })}
                      />
                      <label htmlFor="in-person" className="ml-2 block text-xs text-gray-700">
                        In-person
                      </label>
                    </div>
                  </div>
                </div>

                {scheduleData.interviewType === 'in-person' ? (
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Location
                    </label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 text-xs border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-[#47d475] focus:border-[#47d475]"
                      placeholder="Office address or meeting room"
                      value={scheduleData.location}
                      onChange={(e) => setScheduleData({ ...scheduleData, location: e.target.value })}
                      required={scheduleData.interviewType === 'in-person'}
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Meeting Link
                    </label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 text-xs border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-[#47d475] focus:border-[#47d475]"
                      placeholder="Zoom, Google Meet, etc."
                      value={scheduleData.meetingLink}
                      onChange={(e) => setScheduleData({ ...scheduleData, meetingLink: e.target.value })}
                      required={scheduleData.interviewType === 'virtual'}
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Notes (optional)
                  </label>
                  <textarea
                    rows={3}
                    className="w-full px-3 py-2 text-xs border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-[#47d475] focus:border-[#47d475] resize-none"
                    placeholder="Any special instructions or agenda items"
                    value={scheduleData.notes}
                    onChange={(e) => setScheduleData({ ...scheduleData, notes: e.target.value })}
                  />
                </div>

                {/* Modal Footer - Fixed */}
                <div className="flex flex-col sm:flex-row justify-end gap-3 pt-4 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setShowScheduleModal(false)}
                    className="w-full sm:w-auto px-4 py-2 border border-gray-300 rounded-md shadow-sm text-xs font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#47d475] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSending}
                    className={`w-full sm:w-auto px-4 py-2 border border-transparent rounded-md shadow-sm text-xs font-medium text-white bg-[#47d475] hover:bg-[#58cc8b] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#47d475] transition-colors ${isSending ? 'opacity-70 cursor-not-allowed' : ''
                      }`}
                  >
                    {isSending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin inline" />
                        Sending...
                      </>
                    ) : (
                      'Schedule Interview'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
};