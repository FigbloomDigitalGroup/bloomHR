import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Plus, Search, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface DropdownOption {
    label: string;
    value: string;
}

interface SearchableDropdownProps {
    options: (string | DropdownOption)[];
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
    icon?: React.ElementType;
    disabled?: boolean;
    /** lets the person type a value that isn't in the list ("+ Add ...") */
    allowCreate?: boolean;
}

const SearchableDropdown: React.FC<SearchableDropdownProps> = ({
    options,
    value,
    onChange,
    placeholder = 'Select...',
    className = '',
    icon: Icon,
    disabled = false,
    allowCreate = false
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Normalize options to DropdownOption format
    const normalizedOptions: DropdownOption[] = options.map(option =>
        typeof option === 'string'
            ? { label: option, value: option }
            : option
    );

    // Close when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // "all" (the filters' "everything") and "" (a form field left empty) both mean nothing chosen
    const isEmpty = value === 'all' || value === '';

    // a typed-in value (or one saved earlier) that isn't among the options still shows, selected
    if (!isEmpty && !normalizedOptions.some(o => o.value === value)) {
        normalizedOptions.unshift({ label: value, value });
    }

    const filteredOptions = normalizedOptions.filter(option =>
        option.label.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const typed = searchTerm.trim();
    const canCreate = allowCreate && typed !== '' &&
        !normalizedOptions.some(o => o.label.toLowerCase() === typed.toLowerCase());

    const handleSelect = (optionValue: string) => {
        onChange(optionValue);
        setIsOpen(false);
        setSearchTerm('');
    };

    const clearSelection = (e: React.MouseEvent) => {
        e.stopPropagation();
        onChange('all');
    };

    // Find label for current value
    const currentLabel = isEmpty
        ? placeholder
        : normalizedOptions.find(o => o.value === value)?.label || value;

    return (
        <div className={`relative ${className} ${isOpen ? 'z-50' : 'z-auto'}`} ref={dropdownRef}>
            <button
                onClick={() => !disabled && setIsOpen(!isOpen)}
                disabled={disabled}
                className={`w-full h-[32px] bg-gray-50/50 border border-gray-300 rounded-md px-2.5 py-1.5 text-gray-900 focus:outline-none focus:border-green-500 focus:shadow-[0_0_15px_rgba(34,197,94,0.1)] hover:bg-white transition-all duration-200 flex items-center justify-between text-left group ${disabled ? 'opacity-50 cursor-not-allowed bg-gray-100' : ''}`}
            >
                <div className="flex items-center gap-2 truncate flex-1">
                    {Icon && <Icon size={13} className={`text-gray-400 flex-shrink-0 ${!disabled && 'group-hover:text-green-600'} transition-colors`} />}
                    <span className={`truncate text-xs ${isEmpty ? 'text-gray-500' : 'text-gray-900 font-medium'}`}>
                        {currentLabel}
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    {!isEmpty && !disabled && (
                        <div onClick={clearSelection} className="p-0.5 hover:bg-gray-200 rounded-full text-gray-400 hover:text-red-500 transition-colors">
                            <X size={12} />
                        </div>
                    )}
                    <ChevronDown size={14} className={`text-gray-400 ${!disabled && 'group-hover:text-green-500'} transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </div>
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        transition={{ duration: 0.15, ease: "easeOut" }}
                        className="absolute z-[100] w-full mt-2 bg-white border border-gray-100 rounded-2xl shadow-[0_20px_50px_-12px_rgba(0,0,0,0.15)] overflow-hidden ring-1 ring-black/5"
                    >
                        <div className="p-3 border-b border-gray-100 bg-gray-50/50">
                            <div className="relative">
                                <Search size={14} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                                <input
                                    type="text"
                                    placeholder={allowCreate ? 'Search or type a new one...' : 'Search options...'}
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key !== 'Enter') return;
                                        e.preventDefault();
                                        const exact = normalizedOptions.find(o => o.label.toLowerCase() === typed.toLowerCase());
                                        if (exact) handleSelect(exact.value);
                                        else if (canCreate) handleSelect(typed);
                                        else if (filteredOptions.length === 1) handleSelect(filteredOptions[0].value);
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-full pl-9 pr-3 py-2 bg-white border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-green-500 focus:ring-4 focus:ring-green-500/10 transition-all"
                                    autoFocus
                                />
                            </div>
                        </div>
                        <div className="max-h-64 overflow-y-auto custom-scrollbar p-1.5 thin-scrollbar">
                            {canCreate && (
                                <button
                                    type="button"
                                    onClick={() => handleSelect(typed)}
                                    className="w-full text-left px-4 py-2.5 text-xs rounded-xl transition-all mb-0.5 flex items-center gap-2 font-semibold text-brand bg-green-tint hover:opacity-90"
                                >
                                    <Plus size={13} className="flex-shrink-0" />
                                    <span className="truncate">Add “{typed}”</span>
                                </button>
                            )}
                            <button
                                className={`w-full text-left px-4 py-2.5 text-xs rounded-xl transition-all mb-0.5 flex items-center justify-between
                    ${isEmpty ? 'bg-green-50 text-green-700 font-bold' : 'text-gray-600 hover:bg-gray-50'}`}
                                onClick={() => handleSelect('all')}
                            >
                                <span>{placeholder}</span>
                                {isEmpty && <div className="w-1.5 h-1.5 rounded-full bg-green-600" />}
                            </button>
                            {filteredOptions.map((option) => (
                                option.value !== 'all' && (
                                    <button
                                        key={option.value}
                                        onClick={() => handleSelect(option.value)}
                                        className={`w-full text-left px-4 py-2.5 text-xs rounded-xl transition-all mb-0.5 flex items-center justify-between
                        ${value === option.value ? 'bg-green-50 text-green-700 font-bold' : 'text-gray-700 hover:bg-gray-50 hover:text-green-600'}`}
                                    >
                                        <span className="truncate">{option.label}</span>
                                        {value === option.value && <div className="w-1.5 h-1.5 rounded-full bg-green-600" />}
                                    </button>
                                )
                            ))}
                            {filteredOptions.length === 0 && !canCreate && (
                                <div className="px-4 py-10 text-center text-gray-400 text-xs italic">
                                    <p>No matches found</p>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default SearchableDropdown;
