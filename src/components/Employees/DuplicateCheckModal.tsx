import React, { useMemo, useState } from 'react';
import { X, Mail, CreditCard, AlertTriangle, Users, ChevronDown, ChevronUp, Copy, Trash2, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Database } from '../../types/supabase';
import { supabase } from '../../lib/supabase';

type Employee = Database['public']['Tables']['employees']['Row'];

interface DuplicateCheckModalProps {
    isOpen: boolean;
    onClose: () => void;
    employees: Employee[];
    onRefresh: () => void;
}

const DuplicateCheckModal: React.FC<DuplicateCheckModalProps> = ({ isOpen, onClose, employees, onRefresh }) => {
    const [activeTab, setActiveTab] = useState<'id' | 'email'>('id');
    const [expandedGroups, setExpandedGroups] = useState<string[]>([]);

    // Deletion states
    const [employeeToDelete, setEmployeeToDelete] = useState<Employee | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    // Calculate duplicates
    const duplicates = useMemo(() => {
        const idMap = new Map<number, Employee[]>();
        const emailMap = new Map<string, Employee[]>();

        employees.forEach(emp => {
            // Check ID Number
            if (emp['ID Number']) {
                const id = emp['ID Number'];
                if (!idMap.has(id)) idMap.set(id, []);
                idMap.get(id)?.push(emp);
            }

            // Check Work Email
            if (emp['Work Email']) {
                const email = emp['Work Email'].toLowerCase().trim();
                if (email) {
                    if (!emailMap.has(email)) emailMap.set(email, []);
                    emailMap.get(email)?.push(emp);
                }
            }
        });

        const duplicateIds = Array.from(idMap.entries())
            .filter(([_, list]) => list.length > 1)
            .map(([id, list]) => ({ value: id.toString(), employees: list }));

        const duplicateEmails = Array.from(emailMap.entries())
            .filter(([_, list]) => list.length > 1)
            .map(([email, list]) => ({ value: email, employees: list }));

        return {
            ids: duplicateIds,
            emails: duplicateEmails
        };
    }, [employees]);

    const toggleGroup = (value: string) => {
        setExpandedGroups(prev =>
            prev.includes(value)
                ? prev.filter(g => g !== value)
                : [...prev, value]
        );
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        // You could add a toast notification here
    };

    const handleDeleteClick = (employee: Employee) => {
        setEmployeeToDelete(employee);
    };

    const confirmDelete = async () => {
        if (!employeeToDelete) return;

        try {
            setIsDeleting(true);
            const { error } = await supabase
                .from('employees')
                .delete()
                .eq('Employee Number', employeeToDelete['Employee Number']);

            if (error) throw error;

            // Success
            setEmployeeToDelete(null);
            onRefresh(); // Refresh the list
        } catch (err) {
            console.error('Error deleting employee:', err);
            alert('Failed to delete employee');
        } finally {
            setIsDeleting(false);
        }
    };

    if (!isOpen) return null;

    const currentDuplicates = activeTab === 'id' ? duplicates.ids : duplicates.emails;
    const hasDuplicates = currentDuplicates.length > 0;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden"
                >
                    {/* Header */}
                    <div className="px-6 py-4 flex items-center justify-between border-b border-gray-100 bg-gray-50/50">
                        <div className="flex items-center gap-2">
                            <div className="p-2 bg-red-100 text-red-600 rounded-lg">
                                <Users size={20} />
                            </div>
                            <h2 className="text-lg font-bold text-gray-800">Duplicate Check</h2>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    {/* Tabs */}
                    <div className="flex border-b border-gray-100">
                        <button
                            onClick={() => setActiveTab('id')}
                            className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors relative
                ${activeTab === 'id' ? 'text-green-600 bg-green-50/10' : 'text-gray-500 hover:bg-gray-50'}
              `}
                        >
                            <CreditCard size={16} />
                            Duplicate IDs
                            {duplicates.ids.length > 0 && (
                                <span className="ml-1 px-1.5 py-0.5 bg-red-100 text-red-600 text-xs rounded-full">
                                    {duplicates.ids.length}
                                </span>
                            )}
                            {activeTab === 'id' && (
                                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-green-500" />
                            )}
                        </button>
                        <button
                            onClick={() => setActiveTab('email')}
                            className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors relative
                ${activeTab === 'email' ? 'text-green-600 bg-green-50/10' : 'text-gray-500 hover:bg-gray-50'}
              `}
                        >
                            <Mail size={16} />
                            Duplicate Emails
                            {duplicates.emails.length > 0 && (
                                <span className="ml-1 px-1.5 py-0.5 bg-red-100 text-red-600 text-xs rounded-full">
                                    {duplicates.emails.length}
                                </span>
                            )}
                            {activeTab === 'email' && (
                                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-green-500" />
                            )}
                        </button>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-6 bg-gray-50/30">
                        {!hasDuplicates ? (
                            <div className="flex flex-col items-center justify-center h-64 text-center">
                                <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mb-4">
                                    <Users className="text-green-500" size={32} />
                                </div>
                                <h3 className="text-gray-900 font-medium text-lg">No duplicates found</h3>
                                <p className="text-gray-500 text-sm mt-1 max-w-xs">
                                    All employees have unique {activeTab === 'id' ? 'ID numbers' : 'email addresses'}.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-100 mb-4">
                                    <AlertTriangle size={16} />
                                    <span>
                                        Found {currentDuplicates.length} group{currentDuplicates.length !== 1 ? 's' : ''} of duplicates.
                                        Please review and resolve these issues.
                                    </span>
                                </div>

                                {currentDuplicates.map((group) => (
                                    <div key={group.value} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                                        <button
                                            onClick={() => toggleGroup(group.value)}
                                            className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
                                        >
                                            <div className="flex items-center gap-3">
                                                <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-1 rounded">
                                                    {group.employees.length} Matches
                                                </span>
                                                <span className="font-mono text-sm font-medium text-gray-700">
                                                    {group.value}
                                                </span>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        copyToClipboard(group.value);
                                                    }}
                                                    className="p-1 hover:bg-gray-200 rounded text-gray-400 hover:text-gray-600 transition-colors"
                                                    title="Copy to clipboard"
                                                >
                                                    <Copy size={14} />
                                                </button>
                                            </div>
                                            {expandedGroups.includes(group.value) ? (
                                                <ChevronUp size={16} className="text-gray-400" />
                                            ) : (
                                                <ChevronDown size={16} className="text-gray-400" />
                                            )}
                                        </button>

                                        {expandedGroups.includes(group.value) && (
                                            <div className="border-t border-gray-100 bg-gray-50/30">
                                                {group.employees.map((emp) => (
                                                    <div
                                                        key={emp['Employee Number']} // Assuming 'Employee Number' is unique per record ID or DB ID
                                                        className="p-4 border-b border-gray-100 last:border-0 hover:bg-white transition-colors flex items-center justify-between"
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-600">
                                                                {emp['First Name']?.[0]}{emp['Last Name']?.[0]}
                                                            </div>
                                                            <div>
                                                                <h4 className="text-sm font-medium text-gray-900">
                                                                    {emp['First Name']} {emp['Last Name']}
                                                                </h4>
                                                                <div className="flex items-center gap-2 text-xs text-gray-500">
                                                                    <span>{emp['Employee Number']}</span>
                                                                    <span>•</span>
                                                                    <span>{emp.Branch}</span>
                                                                    <span>•</span>
                                                                    <span>{emp.Town}</span>
                                                                    {emp['Termination Date'] && (
                                                                        <span className="text-red-500 bg-red-50 px-1 rounded ml-1">Inactive</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="text-right flex items-center justify-end gap-3">
                                                            <button
                                                                className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                                                                onClick={() => {
                                                                    // You might want to navigate to edit page
                                                                    window.open(`/edit-employee/${emp['Employee Number']}`, '_blank');
                                                                }}
                                                            >
                                                                View
                                                            </button>
                                                            <button
                                                                onClick={() => handleDeleteClick(emp)}
                                                                className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                                                title="Delete Employee"
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="p-4 border-t border-gray-100 bg-gray-50/50 flex justify-end">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                            Close
                        </button>
                    </div>
                </motion.div>
            </div>

            {/* Confirmation Modal Overlay */}
            {
                employeeToDelete && (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden"
                        >
                            <div className="p-6 text-center">
                                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <AlertTriangle className="text-red-500" size={24} />
                                </div>
                                <h3 className="text-lg font-bold text-gray-900 mb-2">Delete Duplicate?</h3>
                                <p className="text-sm text-gray-500 mb-6">
                                    Are you sure you want to delete <span className="font-semibold">{employeeToDelete['First Name']} {employeeToDelete['Last Name']}</span>?
                                    This action cannot be undone.
                                </p>

                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setEmployeeToDelete(null)}
                                        disabled={isDeleting}
                                        className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={confirmDelete}
                                        disabled={isDeleting}
                                        className="flex-1 px-4 py-2 bg-red-500 text-white font-medium rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                    >
                                        {isDeleting ? (
                                            <>
                                                <Loader2 size={16} className="animate-spin" />
                                                Deleting...
                                            </>
                                        ) : (
                                            'Delete'
                                        )}
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )
            }
        </AnimatePresence >
    );
};

export default DuplicateCheckModal;
