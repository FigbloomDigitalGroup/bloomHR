
import React, { useState } from 'react';
import { X, Building2, MapPin, Save, Loader2, AlertCircle, PenLine, ListFilter } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import SearchableDropdown from '../UI/SearchableDropdown';

interface BulkEditModalProps {
    isOpen: boolean;
    onClose: () => void;
    selectedIds: string[];
    onSuccess: () => void;
    availableBranches: string[];
    availableTowns: string[];
}

const BulkEditModal: React.FC<BulkEditModalProps> = ({
    isOpen,
    onClose,
    selectedIds,
    onSuccess,
    availableBranches,
    availableTowns
}) => {
    const [selectedBranch, setSelectedBranch] = useState<string>('');
    const [selectedTown, setSelectedTown] = useState<string>('');

    // Toggle states for custom input mode
    const [isCustomBranch, setIsCustomBranch] = useState(false);
    const [isCustomTown, setIsCustomTown] = useState(false);

    const [isUpdating, setIsUpdating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Filter out 'all' and potential null/undefined
    const cleanBranches = availableBranches.filter(b => b && b !== 'all' && b !== 'Admin');
    const cleanTowns = availableTowns.filter(t => t && t !== 'all' && t !== 'ADMIN_ALL');

    const handleUpdate = async () => {
        if (!selectedBranch && !selectedTown) {
            setError("Please select or enter at least one field to update.");
            return;
        }

        setIsUpdating(true);
        setError(null);

        try {
            const updates: any = {};
            if (selectedBranch) updates.Branch = selectedBranch.trim(); // Ensure cleanliness
            if (selectedTown) updates.Town = selectedTown.trim();

            const { error: updateError } = await supabase
                .from('employees')
                .update(updates)
                .in('Employee Number', selectedIds);

            if (updateError) throw updateError;

            // Optional: You might want to refresh the available options if a new one was added,
            // but the parent component will re-fetch employees, so it should be fine.

            onSuccess();
            onClose();
        } catch (err: any) {
            console.error("Bulk update failed:", err);
            setError(err.message || "Failed to update employees");
        } finally {
            setIsUpdating(false);
        }
    };

    const toggleBranchMode = () => {
        setIsCustomBranch(!isCustomBranch);
        setSelectedBranch(''); // Reset value on toggle
    };

    const toggleTownMode = () => {
        setIsCustomTown(!isCustomTown);
        setSelectedTown(''); // Reset value on toggle
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
                    <div className="px-6 py-4 flex items-center justify-between border-b border-gray-100 bg-gray-50/50">
                        <div className="flex items-center gap-2">
                            <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg">
                                <Building2 size={20} />
                            </div>
                            <div>
                                <h2 className="text-lg font-bold text-gray-800">Relocate Employees</h2>
                                <p className="text-xs text-gray-500">Updating valid records for {selectedIds.length} employees</p>
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

                        <div className="space-y-5">
                            {/* Branch Selection */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                                        <MapPin size={14} className="text-gray-400" />
                                        New Branch
                                    </label>
                                    <button
                                        onClick={toggleBranchMode}
                                        className="text-[10px] flex items-center gap-1 text-emerald-600 hover:text-emerald-700 font-medium px-2 py-1 rounded bg-emerald-50 hover:bg-emerald-100 transition-colors"
                                    >
                                        {isCustomBranch ? <ListFilter size={12} /> : <PenLine size={12} />}
                                        {isCustomBranch ? 'Select from list' : 'Enter custom'}
                                    </button>
                                </div>

                                {isCustomBranch ? (
                                    <input
                                        type="text"
                                        placeholder="Enter new branch name..."
                                        value={selectedBranch}
                                        onChange={(e) => setSelectedBranch(e.target.value)}
                                        className="w-full h-[42px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/20 placeholder-gray-400"
                                        autoFocus
                                    />
                                ) : (
                                    <SearchableDropdown
                                        options={cleanBranches}
                                        value={selectedBranch}
                                        onChange={setSelectedBranch}
                                        placeholder="Select Branch"
                                    />
                                )}
                                {!isCustomBranch && <p className="text-[10px] text-gray-400 ml-1">Leave empty to keep current branch</p>}
                            </div>

                            {/* Town Selection */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                                        <Building2 size={14} className="text-gray-400" />
                                        New Town
                                    </label>
                                    <button
                                        onClick={toggleTownMode}
                                        className="text-[10px] flex items-center gap-1 text-emerald-600 hover:text-emerald-700 font-medium px-2 py-1 rounded bg-emerald-50 hover:bg-emerald-100 transition-colors"
                                    >
                                        {isCustomTown ? <ListFilter size={12} /> : <PenLine size={12} />}
                                        {isCustomTown ? 'Select from list' : 'Enter custom'}
                                    </button>
                                </div>

                                {isCustomTown ? (
                                    <input
                                        type="text"
                                        placeholder="Enter new town name..."
                                        value={selectedTown}
                                        onChange={(e) => setSelectedTown(e.target.value)}
                                        className="w-full h-[42px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/20 placeholder-gray-400"
                                    />
                                ) : (
                                    <SearchableDropdown
                                        options={cleanTowns}
                                        value={selectedTown}
                                        onChange={setSelectedTown}
                                        placeholder="Select Town"
                                    />
                                )}
                                {!isCustomTown && <p className="text-[10px] text-gray-400 ml-1">Leave empty to keep current town</p>}
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
                            disabled={isUpdating || (!selectedBranch && !selectedTown)}
                            className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {isUpdating ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" />
                                    Updating...
                                </>
                            ) : (
                                <>
                                    <Save size={16} />
                                    Save Changes
                                </>
                            )}
                        </button>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
};

export default BulkEditModal;
