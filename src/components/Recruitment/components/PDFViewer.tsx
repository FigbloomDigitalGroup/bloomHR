import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { AlertCircle, X, Download, ExternalLink } from 'lucide-react';

interface PDFViewerProps {
  fileName: string;
  isPublic?: boolean;
  onClose: () => void;
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

export const PDFViewer = ({ fileName, isPublic = true, onClose }: PDFViewerProps) => {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const getPdfUrl = async () => {
      try {
        if (isPublic) {
          const { data } = supabase.storage
            .from('resumes')
            .getPublicUrl(`public/${fileName}`);
          setPdfUrl(data.publicUrl);
        } else {
          const { data, error } = await supabase.storage
            .from('resumes')
            .createSignedUrl(`private/${fileName}`, 60 * 60);
          
          if (error) {
            setError('Error loading PDF: ' + error.message);
          } else {
            setPdfUrl(data.signedUrl);
          }
        }
      } catch (err) {
        setError('Error loading PDF');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    getPdfUrl();
  }, [fileName, isPublic]);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6">
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-green-600"></div>
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
              className="px-3 py-1.5 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg text-xs flex items-center gap-2"
            >
              <ExternalLink className="w-4 h-4" />
              Open in New Tab
            </a>
            <a 
              href={pdfUrl || '#'} 
              download={fileName}
              className="px-3 py-1.5 bg-green-100 hover:bg-green-200 text-green-700 rounded-lg text-xs flex items-center gap-2"
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