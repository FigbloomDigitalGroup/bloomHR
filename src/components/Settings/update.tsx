// src/components/Settings/update.tsx
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppUpdate } from '../../sw';
import { RefreshCw, Zap, ShieldCheck } from 'lucide-react';

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
          className="fixed inset-0 z-[9999] bg-indigo-900/60 backdrop-blur-md flex items-center justify-center p-6"
        >
          <motion.div
            initial={{ scale: 0.9, y: 20, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.9, y: 20, opacity: 0 }}
            className="bg-white rounded-[3rem] shadow-2xl max-w-sm w-full p-10 text-center border border-white/20 relative overflow-hidden"
          >
            {/* Decorative Background Icon */}
            <Zap className="absolute -top-10 -right-10 w-40 h-40 text-indigo-50/50 -rotate-12" />

            <div className="relative z-10 space-y-8">
              <div className="flex justify-center">
                <div className="w-20 h-20 bg-indigo-600 rounded-[2rem] flex items-center justify-center shadow-2xl shadow-indigo-200">
                  <RefreshCw className="w-8 h-8 text-white animate-spin-slow" />
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-2xl font-black text-gray-900 tracking-tight uppercase italic">
                  Registry Sync
                </h3>
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">New Protocol Version Available</p>
              </div>

              <p className="text-sm font-medium text-gray-500 leading-relaxed uppercase tracking-tight italic">
                A system-wide update has been detected. Synchronize your node to maintain protocol integrity.
              </p>

              <div className="space-y-4 pt-4">
                <button
                  onClick={refreshApp}
                  className="w-full py-5 px-6 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-[2rem] hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all flex items-center justify-center gap-3 active:scale-95"
                >
                  <ShieldCheck className="w-4 h-4" />
                  Synchronize Node
                </button>

                <p className="text-[8px] font-black text-gray-400 uppercase tracking-[0.3em]">
                  Security Level 9 Enforced
                </p>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};