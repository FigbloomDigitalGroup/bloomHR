// CommunicationDropdown.tsx
import { useState } from 'react';
import { MessageSquare, Video, ChevronDown, ChevronUp } from 'lucide-react';
import { motion } from 'framer-motion';

const CommunicationDropdown = ({ 
  activeTab, 
  setActiveTab 
}: { 
  activeTab: string, 
  setActiveTab: (tab: string) => void 
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative h-full">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center px-4 h-full text-xs font-medium ${
          ['chat', 'video'].includes(activeTab)
            ? 'text-white border-b-2 border-white'
            : 'text-gray-200 hover:text-white'
        } transition-colors`}
      >
        <span className="mr-2">Communication</span>
        {isOpen ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </button>

      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="absolute left-0 mt-2 w-48 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 py-1 z-10"
          onClick={() => setIsOpen(false)}
        >
          <button
            onClick={() => setActiveTab('chat')}
            className={`w-full text-left px-4 py-2 text-xs flex items-center ${
              activeTab === 'chat'
                ? 'bg-gray-100 text-gray-900'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <MessageSquare className="h-4 w-4 mr-2" />
            Team Chat
          </button>
          <button
            onClick={() => setActiveTab('video')}
            className={`w-full text-left px-4 py-2 text-xs flex items-center ${
              activeTab === 'video'
                ? 'bg-gray-100 text-gray-900'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <Video className="h-4 w-4 mr-2" />
            Video Calls
          </button>
        </motion.div>
      )}
    </div>
  );
};

export default CommunicationDropdown;