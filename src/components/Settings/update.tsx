// src/components/Settings/update.tsx
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppUpdate } from '../../sw';

export const UpdateNotification: React.FC = () => {
  const { updateAvailable, refreshApp } = useAppUpdate();

  // Don't return early - always check if update is needed
  if (!updateAvailable) return null;

  return (
    <AnimatePresence>
      {updateAvailable && (
        <motion.div
          initial={{ opacity: 0, y: -50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -50 }}
          className="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="text-center">
              <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-blue-100 mb-4">
               <img src="up.png" alt="" />
              </div>
              
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                New Update Available
              </h3>
              
              <p className="text-gray-600 mb-6">
              
                Please update to continue using the latest features.
              </p>
              
              <div className="space-y-3">
                <button
                  onClick={refreshApp}
                  className="w-full py-3 px-4 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  Update Now
                </button>
                
                <p className="text-xs text-gray-500">
                  This will refresh the application and load the latest version
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};