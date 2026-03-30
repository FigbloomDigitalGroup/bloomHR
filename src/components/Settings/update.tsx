// src/components/Settings/update.tsx
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppUpdate } from '../../sw';
import { RefreshCw, ArrowRight } from 'lucide-react';

export const UpdateNotification: React.FC = () => {
  const { updateAvailable, refreshApp } = useAppUpdate();

  if (!updateAvailable) return null;

  return (
    <AnimatePresence>
      {updateAvailable && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center p-6"
          style={{ background: 'rgba(2, 44, 34, 0.75)', backdropFilter: 'blur(8px)' }}
        >
          <motion.div
            initial={{ scale: 0.92, y: 24, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.92, y: 24, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="bg-white rounded-2xl shadow-2xl max-w-sm w-full border border-gray-100 overflow-hidden"
          >
            {/* Green header band */}
            <div className="h-1.5 w-full" style={{ background: 'linear-gradient(90deg, #022c22, #16a34a, #4ade80)' }} />

            <div className="p-8 text-center space-y-6">
              {/* Icon */}
              <div className="flex justify-center">
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg"
                  style={{ background: 'linear-gradient(135deg, #022c22 0%, #16a34a 100%)' }}
                >
                  <RefreshCw className="w-7 h-7 text-white" />
                </div>
              </div>

              {/* Text */}
              <div className="space-y-1.5">
                <h3 className="text-lg font-bold text-gray-900">Update Available</h3>
                <p className="text-xs font-semibold text-green-600 uppercase tracking-wide">New version ready</p>
              </div>

              <p className="text-sm text-gray-500 leading-relaxed">
                A new version of Zira is available with the latest improvements and security patches. Refresh to get the latest version.
              </p>

              {/* Action */}
              <button
                onClick={refreshApp}
                className="w-full py-3 px-6 text-white text-sm font-semibold rounded-xl flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-95 shadow-md"
                style={{ background: 'linear-gradient(135deg, #022c22 0%, #16a34a 100%)' }}
              >
                <RefreshCw className="w-4 h-4" />
                Refresh Now
                <ArrowRight className="w-4 h-4" />
              </button>

              <p className="text-[10px] text-gray-400">
                Your current session and data will be preserved
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};