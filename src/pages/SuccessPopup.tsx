// Create a new file SuccessPopup.tsx
import { useEffect } from 'react';
import { CheckCircleIcon, XMarkIcon } from '@heroicons/react/24/outline';

interface SuccessPopupProps {
  message: string;
  onClose: () => void;
  show: boolean;
}

export function SuccessPopup({ message, onClose, show }: SuccessPopupProps) {
  useEffect(() => {
    if (show) {
      const timer = setTimeout(() => {
        onClose();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [show, onClose]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 bg-black bg-opacity-50 backdrop-blur-sm">
      <div className="relative bg-white rounded-xl shadow-2xl p-8 max-w-md w-full mx-4 transform transition-all duration-300 scale-95 animate-scaleIn">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-500 focus:outline-none"
        >
          <XMarkIcon className="h-6 w-6" />
        </button>
        
        <div className="flex flex-col items-center text-center">
          <div className="relative mb-6">
            <div className="absolute inset-0 bg-green-100 rounded-full opacity-80 animate-ping"></div>
            <div className="relative flex items-center justify-center w-16 h-16 bg-green-500 rounded-full">
              <CheckCircleIcon className="h-10 w-10 text-white" />
            </div>
          </div>
          
          <h3 className="text-2xl font-bold text-gray-900 mb-2">Success!</h3>
          <p className="text-gray-600 mb-6">{message}</p>
          
          <div className="w-full bg-gray-100 rounded-full h-2.5">
            <div 
              className="bg-green-500 h-2.5 rounded-full animate-countdown" 
              style={{ animationDuration: '5s' }}
            ></div>
          </div>
        </div>
      </div>
    </div>
  );
}