import React, { useState } from 'react';
import { X, Save, Loader2, AlertCircle, CalendarDays, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabase';

interface BulkTerminateModalProps {
    isOpen: boolean;
    onClose: () => void;
    selectedIds: string[];
    onSuccess: () => void;
}

const BulkTerminateModal: React.FC<BulkTerminateModalProps> = ({
    isOpen,
    onClose,
    selectedIds,
    onSuccess,
}) => {
    const [terminationDate, setTerminationDate] = useState<string>(new Date().toISOString().split('T')[0]);
    const [terminationReason, setTerminationReason] = useState<string>('');
    const [exitNotes, setExitNotes] = useState<string>('');
    
    const [isUpdating, setIsUpdating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleUpdate = async () => {
        if (!terminationDate) {
            setError("Termination Date is required.");
            return;
        }
        if (!terminationReason) {
            setError("Termination Reason is required.");
            return;
        }

        setIsUpdating(true);
        setError(null);

        try {
            const updates = {
                'Termination Date': terminationDate,
                'Termination Reason': terminationReason,
                'Exit Interview Notes': exitNotes || null,
                'Status': 'Terminated'
            };

            const { error: updateError } = await supabase
                .from('employees')
                .update(updates)
                .in('Employee Number', selectedIds);

            if (updateError) throw updateError;

            onSuccess();
            onClose();
        } catch (err: any) {
            console.error("Bulk terminate failed:", err);
            setError(err.message || "Failed to terminate employees");
        } finally {
            setIsUpdating(false);
        }
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-100"
                >
                    {/* Header */}
                    <div className="px-6 py-4 flex items-center justify-between border-b border-gray-100 bg-red-50/50">
                        <div className="flex items-center gap-2">
                            <div className="p-2 bg-red-100 text-red-600 rounded-lg">
                                <AlertCircle size={20} />
                            </div>
                            <div>
                                <h2 className="text-lg font-bold text-gray-800">Bulk Terminate Employees</h2>
                                <p className="text-xs text-gray-500">Terminating {selectedIds.length} employees</p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="p-6 space-y-6">
                        {error && (
                            <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg flex items-center gap-2 border border-red-100">
                                <AlertCircle size={16} />
                                {error}
                            </div>
                        )}

                        <div className="space-y-4">
                            {/* Termination Date */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                                    <CalendarDays size={14} className="text-gray-400" />
                                    Termination Date *
                                </label>
                                <input
                                    type="date"
                                    value={terminationDate}
                                    onChange={(e) => setTerminationDate(e.target.value)}
                                    className="w-full h-[42px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/20"
                                />
                            </div>

                            {/* Termination Reason */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                                    <AlertCircle size={14} className="text-gray-400" />
                                    Termination Reason *
                                </label>
                                <select
                                    value={terminationReason}
                                    onChange={(e) => setTerminationReason(e.target.value)}
                                    className="w-full h-[42px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/20 bg-white"
                                >
                                    <option value="" disabled>Select Reason</option>
                                    <option value="Resignation">Resignation</option>
                                    <option value="Performance">Performance</option>
                                    <option value="Redundancy">Redundancy</option>
                                    <option value="Misconduct">Misconduct</option>
                                    <option value="End of Contract">End of Contract</option>
                                    <option value="Retirement">Retirement</option>
                                    <option value="Other">Other</option>
                                </select>
                            </div>

                            {/* Exit Interview Notes */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                                    <FileText size={14} className="text-gray-400" />
                                    Exit Notes (Optional)
                                </label>
                                <textarea
                                    value={exitNotes}
                                    onChange={(e) => setExitNotes(e.target.value)}
                                    placeholder="Add any notes regarding this bulk termination..."
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500/20 min-h-[80px] resize-y"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="p-4 border-t border-gray-100 bg-gray-50/50 flex gap-3 justify-end">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleUpdate}
                            disabled={isUpdating || !terminationDate || !terminationReason}
                            className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {isUpdating ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" />
                                    Terminating...
                                </>
                            ) : (
                                <>
                                    <Save size={16} />
                                    Confirm Termination
                                </>
                            )}
                        </button>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};

export default BulkTerminateModal;
