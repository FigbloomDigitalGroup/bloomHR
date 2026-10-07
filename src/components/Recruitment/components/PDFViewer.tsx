import { useState, useEffect } from 'react';
import { AlertCircle, X, Download, ExternalLink } from 'lucide-react';

import { signedFileUrl } from '../../../lib/privateFiles';

interface PDFViewerProps {
  fileName: string;
  /** The stored link to the CV, when the application has one; otherwise the careers site's public/<file name>. */
  fileUrl?: string | null;
  onClose: () => void;
}

// CVs are in a private bucket, so the viewer asks for a short-lived signed link as the signed-in recruiter.
export const PDFViewer = ({ fileName, fileUrl, onClose }: PDFViewerProps) => {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const getPdfUrl = async () => {
      try {
        setPdfUrl(await signedFileUrl('resumes', fileUrl || `public/${fileName}`));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error loading PDF');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    getPdfUrl();
  }, [fileName, fileUrl]);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6">
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary"></div>
            <span>Loading PDF...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md">
          <div className="flex items-center gap-3 text-red-600 mb-4">
            <AlertCircle className="w-5 h-5" />
            <span>{error}</span>
          </div>
          <button 
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-6xl h-[90vh] flex flex-col">
        <div className="flex justify-between items-center p-4 border-b">
          <h3 className="text-lg font-semibold text-gray-900">Resume: {fileName}</h3>
          <div className="flex items-center gap-2">
            <a 
              href={pdfUrl || '#'} 
              target="_blank" 
              rel="noopener noreferrer"
              className="px-3 py-1.5 bg-green-tint hover:bg-brand/20 text-brand-dark rounded-lg text-xs flex items-center gap-2"
            >
              <ExternalLink className="w-4 h-4" />
              Open in New Tab
            </a>
            <a 
              href={pdfUrl || '#'} 
              download={fileName}
              className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg text-xs flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Download
            </a>
            <button 
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 p-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        
        <div className="flex-1 p-4">
          <iframe 
            src={pdfUrl || ''}
            className="w-full h-full border border-gray-200 rounded-lg"
            title={`Resume: ${fileName}`}
          />
        </div>
      </div>
    </div>
  );
};