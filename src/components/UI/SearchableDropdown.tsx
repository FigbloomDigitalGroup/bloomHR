import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
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
}

const SearchableDropdown: React.FC<SearchableDropdownProps> = ({
    options,
    value,
    onChange,
    placeholder = 'Select...',
    className = '',
    icon: Icon,
    disabled = false
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

    const filteredOptions = normalizedOptions.filter(option =>
        option.label.toLowerCase().includes(searchTerm.toLowerCase())
    );

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
    const currentLabel = value === 'all'
        ? placeholder
        : normalizedOptions.find(o => o.value === value)?.label || value;

    return (
        <div className={`relative ${className} ${isOpen ? 'z-50' : 'z-auto'}`} ref={dropdownRef}>
            <button
                onClick={() => !disabled && setIsOpen(!isOpen)}
                disabled={disabled}
                className={`w-full h-[42px] bg-gray-50/50 border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:border-green-500 focus:shadow-[0_0_15px_rgba(34,197,94,0.1)] hover:bg-white transition-all duration-200 flex items-center justify-between text-left group ${disabled ? 'opacity-50 cursor-not-allowed bg-gray-100' : ''}`}
            >
                <div className="flex items-center gap-2 truncate flex-1">
                    {Icon && <Icon size={15} className={`text-gray-400 ${!disabled && 'group-hover:text-green-600'} transition-colors`} />}
                    <span className={`truncate text-xs ${value === 'all' ? 'text-gray-500' : 'text-gray-900 font-medium'}`}>
                        {currentLabel}
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    {value !== 'all' && !disabled && (
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
                        transition={{ duration: 0.1 }}
                        className="absolute z-50 w-full mt-2 bg-white border border-gray-100 rounded-xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.1)] overflow-hidden ring-1 ring-black/5"
                    >
                        <div className="p-2 border-b border-gray-50 bg-gray-50/30">
                            <div className="relative">
                                <Search size={12} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                                <input
                                    type="text"
                                    placeholder="Search..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full pl-8 pr-3 py-2 bg-white border border-gray-200 rounded-lg text-xs focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/20"
                                    autoFocus
                                />
                            </div>
                        </div>
                        <div className="max-h-60 overflow-y-auto custom-scrollbar p-1">
                            <button
                                className={`w-full text-left px-3 py-2 text-xs rounded-lg transition-colors mb-0.5
                    ${value === 'all' ? 'bg-green-50 text-green-700 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
                                onClick={() => handleSelect('all')}
                            >
                                {placeholder}
                            </button>
                            {filteredOptions.map((option) => (
                                option.value !== 'all' && (
                                    <button
                                        key={option.value}
                                        onClick={() => handleSelect(option.value)}
                                        className={`w-full text-left px-3 py-2 text-xs rounded-lg transition-colors mb-0.5
                        ${value === option.value ? 'bg-green-50 text-green-700 font-medium' : 'text-gray-700 hover:bg-gray-50'}`}
                                    >
                                        {option.label}
                                    </button>
                                )
                            ))}
                            {filteredOptions.length === 0 && (
                                <div className="px-4 py-8 text-center text-gray-400 text-xs">
                                    <p>No results found</p>
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
