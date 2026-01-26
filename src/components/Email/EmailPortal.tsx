
import { useState } from 'react';
import { List, Send } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import EmailDashboard from './EmailDashboard';
import SendEmail from './SendEmail';

export default function EmailPortal() {
    const [activeTab, setActiveTab] = useState<'compose' | 'logs'>('compose');

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Email Portal</h1>
                    <p className="text-gray-600 mt-1">Manage communications and monitor email logs</p>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex space-x-1 bg-gray-100 p-1 rounded-xl w-fit">
                <button
                    onClick={() => setActiveTab('compose')}
                    className={`flex items-center px-4 py-2 text-sm font-medium rounded-lg transition-all ${activeTab === 'compose'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-900 hover:bg-gray-200/50'
                        }`}
                >
                    <Send className="w-4 h-4 mr-2" />
                    Compose & Send
                </button>
                <button
                    onClick={() => setActiveTab('logs')}
                    className={`flex items-center px-4 py-2 text-sm font-medium rounded-lg transition-all ${activeTab === 'logs'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-900 hover:bg-gray-200/50'
                        }`}
                >
                    <List className="w-4 h-4 mr-2" />
                    Email Logs
                </button>
            </div>

            {/* Content Area */}
            <div className="mt-6">
                <AnimatePresence mode="wait">
                    {activeTab === 'compose' ? (
                        <motion.div
                            key="compose"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.2 }}
                        >
                            <SendEmail />
                        </motion.div>
                    ) : (
                        <motion.div
                            key="logs"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.2 }}
                        >
                            <EmailDashboard />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}
