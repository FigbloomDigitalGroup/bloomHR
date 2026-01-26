import { useState } from 'react';
import { X, Check, User, MapPin, GraduationCap, Code, FileText, Download, ExternalLink, Briefcase } from 'lucide-react';
import { DetailItem } from '../DetailItem';
import { PDFViewer } from '../PDFViewer';

interface ApplicationDetailModalProps {
  application: any;
  onClose: () => void;
}

export const ApplicationDetailModal = ({ application, onClose }: ApplicationDetailModalProps) => {
  const [showPdfViewer, setShowPdfViewer] = useState(false);
  const [currentPdfFile, setCurrentPdfFile] = useState('');

  const handleViewPdf = (fileName: string) => {
    setCurrentPdfFile(fileName);
    setShowPdfViewer(true);
  };

  const getResumeFileName = () => {
    if (application.resume_file_name) {
      return application.resume_file_name;
    }
    if (application.resume_file_url) {
      const urlParts = application.resume_file_url.split('/');
      return urlParts[urlParts.length - 1];
    }
    return 'resume.pdf';
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="bg-gradient-to-r from-[#38d270] to-[#19b051] p-6 text-white">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-2xl font-bold">
                  {application.first_name} {application.last_name}
                </h3>
                <p className="text-blue-100 mt-1">
                  Application for {application.position || 'Position'}
                </p>
              </div>
              <button 
                onClick={onClose}
                className="text-white/80 hover:text-white transition-colors p-1 rounded-full hover:bg-white/10"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>
          
          {/* Content */}
          <div className="overflow-y-auto p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Personal Information */}
              <div className="bg-white border border-gray-100 shadow-sm rounded-lg p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="bg-blue-50 p-2 rounded-full">
                    <User className="w-5 h-5 text-[#38d270]" />
                  </div>
                  <h4 className="font-semibold text-gray-800 text-lg">
                    Personal Information
                  </h4>
                </div>
                <div className="space-y-4">
                  <DetailItem label="Full Name" value={`${application.first_name} ${application.last_name}`} />
                  <DetailItem label="Email" value={application.email} />
                  <DetailItem label="Phone" value={application.phone} />
                  <DetailItem label="ID Number" value={application.id_number} />
                  <DetailItem label="Nationality" value={application.nationality} />
                </div>
              </div>
              
              {/* Address Information */}
              <div className="bg-white border border-gray-100 shadow-sm rounded-lg p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="bg-blue-50 p-2 rounded-full">
                    <MapPin className="w-5 h-5 text-[#38d270]" />
                  </div>
                  <h4 className="font-semibold text-gray-800 text-lg">
                    Address Information
                  </h4>
                </div>
                <div className="space-y-4">
                  <DetailItem label="Address" value={application.address} isTextArea />
                  <DetailItem label="County" value={application.county} />
                  <DetailItem label="Constituency" value={application.constituency} />
                  <DetailItem label="Preferred Location" value={application.preferred_location} />
                </div>
              </div>
              
              {/* Education */}
              <div className="bg-white border border-gray-100 shadow-sm rounded-lg p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="bg-blue-50 p-2 rounded-full">
                    <GraduationCap className="w-5 h-5 text-[#38d270]" />
                  </div>
                  <h4 className="font-semibold text-gray-800 text-lg">
                    Education
                  </h4>
                </div>
                <div className="space-y-4">
                  <DetailItem label="University" value={application.university} />
                  <DetailItem label="Education Level" value={application.education} />
                  <DetailItem label="Graduation Year" value={application.graduation_year || 'N/A'} />
                </div>
              </div>
              
              {/* Work Experience */}
              <div className="bg-white border border-gray-100 shadow-sm rounded-lg p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="bg-blue-50 p-2 rounded-full">
                    <Briefcase className="w-5 h-5 text-[#38d270]" />
                  </div>
                  <h4 className="font-semibold text-gray-800 text-lg">
                    Work Experience
                  </h4>
                </div>
                <div className="space-y-4">
                  <DetailItem label="Previous Company" value={application.previous_company} />
                  <DetailItem label="Previous Role" value={application.previous_role} />
                  <DetailItem label="Work Experience" value={application.work_experience} isTextArea />
                  <DetailItem label="Previous Salary" value={application.previous_salary} />
                  <DetailItem label="Expected Salary" value={application.expected_salary} />
                </div>
              </div>
              
              {/* Skills & Languages */}
              <div className="bg-white border border-gray-100 shadow-sm rounded-lg p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="bg-blue-50 p-2 rounded-full">
                    <Code className="w-5 h-5 text-[#38d270]" />
                  </div>
                  <h4 className="font-semibold text-gray-800 text-lg">
                    Skills & Languages
                  </h4>
                </div>
                <div className="space-y-4">
                  <DetailItem label="Skills" value={application.skills} isTextArea />
                  <DetailItem label="Languages" value={application.languages} />
                  <DetailItem label="Markets Worked" value={application.markets_worked || 'N/A'} />
                </div>
              </div>
              
              {/* Application Materials */}
              <div className="bg-white border border-gray-100 shadow-sm rounded-lg p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="bg-blue-50 p-2 rounded-full">
                    <FileText className="w-5 h-5 text-[#38d270]" />
                  </div>
                  <h4 className="font-semibold text-gray-800 text-lg">
                    Application Materials
                  </h4>
                </div>
                <div className="space-y-4">
                  <DetailItem label="Cover Letter" value={application.cover_letter} isTextArea />
                  <DetailItem 
                    label="Resume" 
                    value={application.resume_file_url}
                    fileName={getResumeFileName()}
                    isPdf={true}
                    onViewPdf={handleViewPdf}
                  />
                </div>
              </div>
            </div>
          </div>
          
          {/* Footer */}
          <div className="border-t border-gray-100 bg-gray-50 px-6 py-4 flex justify-end gap-3">
            <button 
              onClick={onClose}
              className="px-5 py-2.5 border border-gray-300 hover:bg-gray-100 text-gray-700 rounded-lg text-xs font-medium transition-colors"
            >
              Close
            </button>
            {/* <button className="px-5 py-2.5 bg-[#38d270] hover:bg-[#19b051] text-white rounded-lg text-xs font-medium flex items-center gap-2 transition-colors">
              <Check className="w-4 h-4" />
              Shortlist Candidate
            </button> */}
          </div>
        </div>
      </div>

      {showPdfViewer && (
        <PDFViewer 
          fileName={currentPdfFile}
          isPublic={true}
          onClose={() => setShowPdfViewer(false)}
        />
      )}
    </>
  );
};