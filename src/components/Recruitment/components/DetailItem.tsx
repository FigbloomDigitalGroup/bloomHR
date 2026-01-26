import { Download, Eye } from 'lucide-react';

interface DetailItemProps {
  label: string;
  value: string | null;
  isTextArea?: boolean;
  isPdf?: boolean;
  fileName?: string;
  onViewPdf?: (fileName: string) => void;
}

export const DetailItem = ({ 
  label, 
  value, 
  isTextArea = false,
  isPdf = false,
  fileName = '',
  onViewPdf
}: DetailItemProps) => {
  if (!value && !isPdf) return null;
  
  if (isPdf) {
    return (
      <div className="space-y-1">
        <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
        <div className="flex gap-2">
          <a 
            href={value || '#'} 
            target="_blank" 
            rel="noopener noreferrer"
            className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md shadow-sm text-xs font-medium text-[#58cc8b] bg-white hover:bg-gray-50 transition-colors"
          >
            <Download className="w-4 h-4 mr-2" />
            {fileName || 'Download Resume'}
          </a>
        </div>
      </div>
    );
  }
  
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-gray-700">{label}</label>
      {isTextArea ? (
        <textarea 
          readOnly 
          className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs h-24"
          value={value ?? ''}
        />
      ) : (
        <input 
          type="text" 
          readOnly 
          className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs" 
          value={value ?? ''}
        />
      )}
    </div>
  );
};