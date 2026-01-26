
import { useState, useEffect, useMemo, useRef } from 'react';
import {
    format,
    startOfMonth,
    endOfMonth,
    eachDayOfInterval,
    isSameDay,
    addMonths,
    subMonths,
    isWeekend,
    differenceInDays,
    parseISO
} from 'date-fns';
import {
    ChevronLeft,
    ChevronRight,
    Calendar as CalendarIcon,
    Plus,
    Loader2,
    Search,
    MoreHorizontal,
    Download
} from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface LeaveSchedulerProps {
    selectedTown?: string;
}

// CORRECTED TYPE DEFINITION MATCHING 'EmployeeList.tsx'
type Employee = {
    id: string;
    "Employee Number": string;
    "First Name": string;
    "Last Name": string;
    "Middle Name"?: string;
    Branch: string;     // Matches 'office' logic
    Town: string;
    "Employee Type": string; // Matches 'department' logic usually
    "Job Title": string;
    "Work Email": string;
    "Mobile Number": string;
    avatar_url?: string;
};

type LeaveApplication = {
    id: string;
    "Employee Number": string;
    "Start Date": string;
    "End Date": string;
    "Leave Type": string;
    Status: string;
    Reason?: string;
};

// Distinct colors for leave types/statuses
const STATUS_STYLES = {
    approved: { bg: 'bg-emerald-500', border: 'border-emerald-600', text: 'text-white', shadow: 'shadow-emerald-500/30' },
    pending: { bg: 'bg-amber-400', border: 'border-amber-500', text: 'text-amber-900', shadow: 'shadow-amber-500/30' },
    rejected: { bg: 'bg-rose-400', border: 'border-rose-500', text: 'text-white', shadow: 'shadow-rose-500/30' },
    DEFAULT: { bg: 'bg-blue-500', border: 'border-blue-600', text: 'text-white', shadow: 'shadow-blue-500/30' }
};

const LeaveScheduler = ({ selectedTown }: LeaveSchedulerProps) => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [leaves, setLeaves] = useState<LeaveApplication[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // --- Search & Auto-Suggest State ---
    const [showSuggestions, setShowSuggestions] = useState(false);
    const searchWrapperRef = useRef<HTMLDivElement>(null);

    // Derived state for calendar grid
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const daysInMonth = useMemo(() => eachDayOfInterval({ start: monthStart, end: monthEnd }), [monthStart, monthEnd]);

    useEffect(() => {
        fetchData();
    }, [selectedTown, currentDate]);

    // Close suggestions when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (searchWrapperRef.current && !searchWrapperRef.current.contains(event.target as Node)) {
                setShowSuggestions(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            // 1. Fetch Employees
            let employeeQuery = supabase
                .from('employees')
                .select('*');

            if (selectedTown && selectedTown !== 'ADMIN_ALL') {
                employeeQuery = employeeQuery.eq('Town', selectedTown);
            }

            const { data: empData, error: empError } = await employeeQuery;
            if (empError) throw empError;

            // 2. Fetch Leaves
            const { data: leaveData, error: leaveError } = await supabase
                .from('leave_application')
                .select('*')
                .neq('Status', 'rejected')
                .lte('Start Date', monthEnd.toISOString())
                .gte('End Date', monthStart.toISOString());

            if (leaveError) throw leaveError;

            // Sort employees by name (Accessing correct columns)
            const sortedEmps = (empData || []).sort((a, b) =>
                (a["First Name"] || '').localeCompare(b["First Name"] || '')
            );

            setEmployees(sortedEmps);
            setLeaves(leaveData || []);

        } catch (err) {
            console.error("Error fetching scheduler data:", err);
        } finally {
            setLoading(false);
        }
    };

    const handlePrevMonth = () => setCurrentDate(subMonths(currentDate, 1));
    const handleNextMonth = () => setCurrentDate(addMonths(currentDate, 1));

    const filteredEmployees = useMemo(() => {
        if (!searchTerm) return employees;
        const lowerTerm = searchTerm.toLowerCase();

        return employees.filter(emp => {
            // Correct Column Mapping
            const first = (emp["First Name"] || '').toLowerCase();
            const last = (emp["Last Name"] || '').toLowerCase();
            const middle = (emp["Middle Name"] || '').toLowerCase();
            const fullName = `${first} ${middle} ${last}`;

            const empNo = (emp["Employee Number"] || '').toLowerCase();
            const dept = (emp["Employee Type"] || '').toLowerCase(); // Assuming Employee Type maps closely to department
            const email = (emp["Work Email"] || '').toLowerCase();
            const position = (emp["Job Title"] || '').toLowerCase();

            return fullName.includes(lowerTerm) ||
                empNo.includes(lowerTerm) ||
                dept.includes(lowerTerm) ||
                email.includes(lowerTerm) ||
                position.includes(lowerTerm);
        });
    }, [employees, searchTerm]);

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchTerm(e.target.value);
        setShowSuggestions(true);
    };

    const handleSelectEmployee = (emp: Employee) => {
        setSearchTerm(`${emp["First Name"]} ${emp["Last Name"]}`);
        setShowSuggestions(false);
    };

    // --- Gantt Bar Calculation ---
    const getLeaveBars = (employeeNumber: string) => {
        // Both tables use "Employee Number" so this maps correctly
        const empLeaves = leaves.filter(l => l["Employee Number"] === employeeNumber);

        return empLeaves.map(leave => {
            const startDate = parseISO(leave["Start Date"]);
            const endDate = parseISO(leave["End Date"]);

            const effectiveStart = startDate < monthStart ? monthStart : startDate;
            const effectiveEnd = endDate > monthEnd ? monthEnd : endDate;

            if (effectiveStart > effectiveEnd) return null;

            const duration = differenceInDays(effectiveEnd, effectiveStart) + 1;
            const startOffset = differenceInDays(effectiveStart, monthStart);

            return {
                ...leave,
                startOffset,
                duration,
                isPartialStart: startDate < monthStart,
                isPartialEnd: endDate > monthEnd
            };
        }).filter(Boolean);
    };

    const getInitials = (first: string, last: string) => {
        const f = first || '';
        const l = last || '';
        return `${f.charAt(0)}${l.charAt(0)}`.toUpperCase();
    };

    return (
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 flex flex-col h-[calc(100vh-180px)] overflow-hidden">

            {/* 1. Header Toolbar */}
            <div className="p-4 border-b border-gray-200 flex flex-col sm:flex-row justify-between items-center bg-white gap-4 z-20 shadow-sm relative">

                {/* Date Navigation */}
                <div className="flex items-center gap-4 bg-gray-50 p-1.5 rounded-lg border border-gray-200 shadow-sm">
                    <button
                        onClick={handlePrevMonth}
                        className="p-1.5 hover:bg-white hover:shadow-sm rounded-md transition-all text-gray-600"
                        title="Previous Month"
                    >
                        <ChevronLeft className="w-5 h-5" />
                    </button>
                    <div className="flex items-center gap-2 min-w-[160px] justify-center">
                        <CalendarIcon className="w-4 h-4 text-emerald-600" />
                        <span className="text-sm font-bold text-gray-800 tracking-wide">
                            {format(currentDate, 'MMMM yyyy')}
                        </span>
                    </div>
                    <button
                        onClick={handleNextMonth}
                        className="p-1.5 hover:bg-white hover:shadow-sm rounded-md transition-all text-gray-600"
                        title="Next Month"
                    >
                        <ChevronRight className="w-5 h-5" />
                    </button>
                </div>

                {/* Search & Actions */}
                <div className="flex items-center gap-3 w-full sm:w-auto">
                    <div className="relative group flex-1 sm:flex-none" ref={searchWrapperRef}>
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 group-focus-within:text-emerald-500 transition-colors" />
                        <input
                            type="text"
                            placeholder="Search staff..."
                            value={searchTerm}
                            onChange={handleSearchChange}
                            onFocus={() => setShowSuggestions(true)}
                            className="pl-9 pr-4 py-2 w-full sm:w-72 border border-gray-200 bg-gray-50 rounded-lg text-sm focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all shadow-sm"
                        />

                        {/* Suggestion Dropdown */}
                        {showSuggestions && (
                            <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-gray-100 rounded-xl shadow-2xl z-50 max-h-80 overflow-auto py-2 custom-scrollbar ring-1 ring-black/5">
                                {filteredEmployees.length > 0 ? (
                                    <>
                                        <div className="px-4 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest bg-gray-50/50 sticky top-0 backdrop-blur-sm">
                                            Suggested Staff
                                        </div>
                                        {filteredEmployees.map(emp => (
                                            <div
                                                key={emp.id}
                                                onClick={() => handleSelectEmployee(emp)}
                                                className="px-4 py-3 hover:bg-emerald-50 cursor-pointer flex items-center gap-3 transition-colors border-b border-gray-50 last:border-0 group"
                                            >
                                                <div className="w-10 h-10 flex-shrink-0 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500 overflow-hidden ring-2 ring-white shadow-sm group-hover:ring-emerald-200 transition-all">
                                                    {emp.avatar_url ? (
                                                        <img src={emp.avatar_url} alt="" className="w-full h-full object-cover" />
                                                    ) : getInitials(emp["First Name"], emp["Last Name"])}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-sm font-semibold text-gray-900 truncate group-hover:text-emerald-700">
                                                        {emp["First Name"]} {emp["Last Name"]}
                                                    </div>
                                                    <div className="text-xs text-gray-500 truncate flex items-center gap-1.5">
                                                        <span className="inline-flex items-center rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 ring-1 ring-inset ring-gray-500/10">
                                                            {emp["Employee Number"]}
                                                        </span>
                                                        <span>{emp["Job Title"] || emp["Employee Type"]}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </>
                                ) : (
                                    <div className="px-4 py-8 text-center">
                                        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 mb-3">
                                            <Search className="w-6 h-6 text-gray-400" />
                                        </div>
                                        <p className="text-sm font-medium text-gray-900">No staff found</p>
                                        <p className="text-xs text-gray-500 mt-1">We couldn't find anyone matching "{searchTerm}"</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <button
                        className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 transition-all shadow-md shadow-emerald-600/20 active:scale-95 whitespace-nowrap active:shadow-sm"
                    >
                        <Plus className="w-4 h-4" />
                        <span className="hidden sm:inline font-medium">Assign Leave</span>
                    </button>

                    <button className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg border border-gray-200 transition-colors hover:text-gray-700">
                        <Download className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* --- Scheduler Layout --- */}
            <div className="flex-1 overflow-hidden relative flex bg-gray-50/50">

                {loading ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm z-50">
                        <Loader2 className="w-10 h-10 animate-spin text-emerald-600 mb-2" />
                        <p className="text-sm text-gray-500 font-medium animate-pulse">Syncing Schedule...</p>
                    </div>
                ) : (
                    <>
                        {/* 1. Sticky Sidebar: Employees */}
                        <div className="flex flex-col border-r border-gray-200 bg-white z-20 shadow-[4px_0_24px_-2px_rgba(0,0,0,0.05)] w-[280px] min-w-[280px]">
                            {/* Sidebar Header */}
                            <div className="h-14 border-b border-gray-200 bg-gray-50/80 flex items-center px-6 font-bold text-gray-600 text-xs uppercase tracking-wider backdrop-blur-sm justify-between">
                                <span>Staff Member</span>
                                <span className="bg-gray-100 px-2 py-0.5 rounded-full text-[10px] text-gray-600 font-bold border border-gray-200 shadow-sm">{filteredEmployees.length}</span>
                            </div>

                            {/* Employee List */}
                            <div className="overflow-y-hidden hover:overflow-y-auto custom-scrollbar flex-1 bg-white">
                                {filteredEmployees.length > 0 ? (
                                    filteredEmployees.map((emp, idx) => (
                                        <div
                                            key={emp.id}
                                            className={`h-16 border-b border-gray-50 flex items-center px-4 transition-all group cursor-pointer 
                          ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'} 
                          hover:bg-emerald-50/40 border-l-4 border-l-transparent hover:border-l-emerald-500`}
                                        >
                                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 ring-2 ring-white shadow-sm flex items-center justify-center text-gray-500 mr-3 overflow-hidden flex-shrink-0">
                                                {emp.avatar_url ? (
                                                    <img src={emp.avatar_url} alt="" className="w-full h-full object-cover" />
                                                ) : (
                                                    <span className="text-xs font-bold">{getInitials(emp["First Name"], emp["Last Name"])}</span>
                                                )}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="text-sm font-semibold text-gray-900 truncate group-hover:text-emerald-700 transition-colors">
                                                    {emp["First Name"]} {emp["Last Name"]}
                                                </div>
                                                <div className="text-[10px] text-gray-500 truncate flex items-center gap-1.5 mt-0.5">
                                                    <div className={`w-1.5 h-1.5 rounded-full ${emp["Employee Type"] ? 'bg-emerald-400' : 'bg-gray-300'}`}></div>
                                                    <span className="truncate">{emp["Job Title"] || emp["Employee Type"] || 'Staff Member'}</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-64 text-center p-6">
                                        <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mb-3">
                                            <Search className="w-6 h-6 text-gray-300" />
                                        </div>
                                        <h3 className="text-sm font-semibold text-gray-900">No staff found</h3>
                                        <p className="text-xs text-gray-500 mt-1 max-w-[150px] mx-auto">Try adjusting your search filters or clearing the search.</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* 2. Scrollable Timeline Grid */}
                        <div className="flex-1 overflow-auto bg-white relative custom-scrollbar" ref={scrollContainerRef}>
                            <div className="min-w-max">

                                {/* Fixed Date Header */}
                                <div className="flex h-14 border-b border-gray-200 bg-white sticky top-0 z-10 shadow-sm">
                                    {daysInMonth.map(day => {
                                        const isToday = isSameDay(day, new Date());
                                        const isWeekendDay = isWeekend(day);

                                        return (
                                            <div
                                                key={day.toISOString()}
                                                className={`flex-shrink-0 w-14 flex flex-col items-center justify-center border-r border-gray-100 relative group transition-colors duration-300
                          ${isWeekendDay ? 'bg-gray-50/80' : 'bg-white'}
                        `}
                                            >
                                                {/* Today Marker Line */}
                                                {isToday && <div className="absolute top-0 w-full h-1 bg-emerald-500 z-20 shadow-sm"></div>}

                                                <span className={`text-[9px] uppercase font-bold mb-0.5 tracking-wider ${isToday ? 'text-emerald-600' : 'text-gray-400'}`}>
                                                    {format(day, 'EEE')}
                                                </span>
                                                <div className={`
                          w-7 h-7 flex items-center justify-center rounded-full text-sm font-bold transition-all duration-300
                          ${isToday ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-200 scale-110 ring-2 ring-emerald-50' : 'text-gray-700 group-hover:bg-gray-100'}
                        `}>
                                                    {format(day, 'd')}
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>

                                {/* Timeline Rows */}
                                <div className="relative">
                                    {/* Background Grid Lines */}
                                    <div className="absolute inset-0 flex pointer-events-none">
                                        {daysInMonth.map((day, i) => (
                                            <div
                                                key={`grid-${i}`}
                                                className={`flex-shrink-0 w-14 border-r border-gray-100 h-full ${isWeekend(day) ? 'bg-gray-50/50' : ''}`}
                                            />
                                        ))}
                                    </div>

                                    {/* Employee Rows */}
                                    {filteredEmployees.map((emp, idx) => (
                                        <div key={emp.id} className={`h-16 border-b border-gray-50 relative flex items-center group
                        ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/20'}`}
                                        >
                                            {/* Render Leave Bars (Gantt Style) */}
                                            <div className="absolute inset-0 w-full h-full pointer-events-none z-10">
                                                <div className="relative w-full h-full">
                                                    {getLeaveBars(emp["Employee Number"]).map((bar: any) => {
                                                        const style = STATUS_STYLES[bar.Status as keyof typeof STATUS_STYLES] || STATUS_STYLES.DEFAULT;
                                                        const leftPos = bar.startOffset * 3.5; // 3.5rem = w-14
                                                        const width = bar.duration * 3.5;

                                                        return (
                                                            <div
                                                                key={bar.id}
                                                                className={`
                                      absolute top-1/2 transform -translate-y-1/2 h-10 rounded-lg
                                      ${style.bg} ${style.shadow} border-y-[1px] border-white/10 ${style.border} 
                                      flex items-center px-1.5 z-20 pointer-events-auto cursor-pointer
                                      hover:brightness-105 transition-all hover:scale-[1.02] hover:shadow-lg shadow-sm
                                    `}
                                                                style={{
                                                                    left: `${leftPos}rem`,
                                                                    width: `${width}rem`,
                                                                    marginLeft: '3px',
                                                                    marginRight: '3px'
                                                                }}
                                                                title={`${bar["Leave Type"]} - ${bar.Status}\n${format(parseISO(bar["Start Date"]), 'MMM d')} - ${format(parseISO(bar["End Date"]), 'MMM d')}`}
                                                            >
                                                                <div className="flex flex-col leading-none overflow-hidden w-full">
                                                                    <div className="flex items-center justify-between mb-0.5">
                                                                        <span className="text-[8px] font-bold text-white/80 uppercase tracking-wider">{bar.Status.slice(0, 3)}</span>
                                                                    </div>
                                                                    <span className="text-[10px] font-bold text-white whitespace-nowrap overflow-hidden text-ellipsis truncate w-full">
                                                                        {bar["Leave Type"].split(' ')[0]}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>

                                            {/* Interactive Click Grid */}
                                            {daysInMonth.map((day, i) => (
                                                <div
                                                    key={`cell-${i}`}
                                                    className="flex-shrink-0 w-14 h-full z-0 hover:bg-emerald-500/5 hover:border-r hover:border-emerald-200 cursor-cell transition-colors duration-75 border-transparent border-r box-border"
                                                    title={`Schedule leave for ${emp["First Name"]}`}
                                                    onClick={() => {
                                                        console.log(`Assign leave for ${emp["First Name"]} on ${format(day, 'yyyy-MM-dd')}`);
                                                    }}
                                                />
                                            ))}
                                        </div>
                                    ))}
                                </div>

                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* --- Footer Legend --- */}
            <div className="p-4 border-t border-gray-200 bg-white text-xs text-gray-500 flex items-center justify-between shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.02)] z-20">
                <div className="flex gap-6">
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded bg-emerald-500 shadow-sm ring-1 ring-emerald-200"></div>
                        <span className="font-medium">Approved Leave</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded bg-amber-400 shadow-sm ring-1 ring-amber-200"></div>
                        <span className="font-medium">Pending Approval</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded bg-rose-400 shadow-sm ring-1 ring-rose-200"></div>
                        <span className="font-medium">Rejected</span>
                    </div>
                </div>
                <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100 shadow-sm">
                    <Plus className="w-3.5 h-3.5" />
                    <span className="font-bold tracking-tight">Click any cell to assign</span>
                </div>
            </div>
        </div>
    );
};

export default LeaveScheduler;
