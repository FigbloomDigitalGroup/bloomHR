import { useState, useEffect, useCallback } from 'react';
import { DollarSign, Search, Download, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

interface PayrollRecord {
    id?: number;
    "Employee Number": string;
    month?: string;
    year?: number;
    basic_salary?: number;
    gross_salary?: number;
    net_salary?: number;
    total_deductions?: number;
    paye?: number;
    nssf?: number;
    nhif?: number;
    created_at?: string;
    // From employees table
    "First Name"?: string | null;
    "Last Name"?: string | null;
    "Job Title"?: string | null;
    "Branch"?: string | null;
    "Basic Salary"?: number | null;
}

interface GroupedEmployee {
    "Employee Number": string;
    name: string;
    jobTitle: string;
    branch: string;
    records: PayrollRecord[];
    currentSalary: number | null;
    expanded: boolean;
}

export default function PayrollHistoryModule() {
    const [employees, setEmployees] = useState<GroupedEmployee[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [expandedEmp, setExpandedEmp] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const { data: emps, error: empErr } = await supabase
                .from('employees')
                .select('"Employee Number", "First Name", "Last Name", "Job Title", "Branch", "Basic Salary"')
                .order('"Employee Number"', { ascending: true });

            if (empErr) throw empErr;

            // Build grouped structure from employee data (payroll records from PayrollDashboard)
            const grouped: GroupedEmployee[] = (emps || []).map(e => ({
                "Employee Number": e['Employee Number'],
                name: `${e['First Name'] || ''} ${e['Last Name'] || ''}`.trim(),
                jobTitle: e['Job Title'] || '—',
                branch: e['Branch'] || '—',
                records: [],
                currentSalary: e['Basic Salary'],
                expanded: false,
            }));

            setEmployees(grouped);
        } catch (err) {
            console.error(err);
            toast.error('Failed to load payroll data');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    const filtered = employees.filter(e =>
        !search || e.name.toLowerCase().includes(search.toLowerCase()) || e['Employee Number'].toLowerCase().includes(search.toLowerCase())
    );

    const handleExport = () => {
        const csvContent = [
            ['Employee Number', 'Name', 'Job Title', 'Branch', 'Basic Salary'],
            ...filtered.map(e => [e['Employee Number'], e.name, e.jobTitle, e.branch, e.currentSalary ?? ''])
        ].map(row => row.join(',')).join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `payroll_history_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('Payroll report downloaded');
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h2 className="text-lg font-bold text-gray-900">Payroll History</h2>
                    <p className="text-xs text-gray-500">Full payroll history, salary revisions, allowances and deductions per employee</p>
                </div>
                <button onClick={handleExport}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700 transition-colors">
                    <Download className="w-3.5 h-3.5" /> Export Report
                </button>
            </div>

            {/* Search */}
            <div className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type="text" placeholder="Search employee..." value={search} onChange={e => setSearch(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500" />
                </div>
            </div>

            {loading ? (
                <div className="flex items-center justify-center h-40">
                    <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
                </div>
            ) : (
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="bg-gray-50 border-b border-gray-200">
                                <th className="text-left px-4 py-3 font-semibold text-gray-600">Employee</th>
                                <th className="text-left px-4 py-3 font-semibold text-gray-600">Job Title</th>
                                <th className="text-left px-4 py-3 font-semibold text-gray-600">Branch</th>
                                <th className="text-right px-4 py-3 font-semibold text-gray-600">Basic Salary</th>
                                <th className="px-4 py-3"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="py-12 text-center text-gray-400">
                                        <DollarSign className="w-8 h-8 mx-auto mb-2 opacity-30" />
                                        No records found
                                    </td>
                                </tr>
                            ) : filtered.map(emp => (
                                <>
                                    <tr key={emp['Employee Number']}
                                        className="hover:bg-gray-50 cursor-pointer"
                                        onClick={() => setExpandedEmp(expandedEmp === emp['Employee Number'] ? null : emp['Employee Number'])}>
                                        <td className="px-4 py-3">
                                            <div>
                                                <p className="font-semibold text-gray-900">{emp.name}</p>
                                                <p className="text-gray-400">{emp['Employee Number']}</p>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-gray-600">{emp.jobTitle}</td>
                                        <td className="px-4 py-3 text-gray-600">{emp.branch}</td>
                                        <td className="px-4 py-3 text-right font-semibold text-gray-900">
                                            {emp.currentSalary ? `KES ${emp.currentSalary.toLocaleString()}` : '—'}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <button className="text-gray-400">
                                                {expandedEmp === emp['Employee Number'] ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                            </button>
                                        </td>
                                    </tr>
                                    {expandedEmp === emp['Employee Number'] && (
                                        <tr key={`${emp['Employee Number']}-detail`}>
                                            <td colSpan={5} className="px-4 py-3 bg-gray-50">
                                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-white border border-gray-100 rounded-lg">
                                                    <div className="text-center p-2">
                                                        <p className="text-[10px] text-gray-500 uppercase mb-1">Basic Salary</p>
                                                        <p className="text-sm font-bold text-gray-900">KES {emp.currentSalary?.toLocaleString() ?? '—'}</p>
                                                    </div>
                                                    <div className="text-center p-2">
                                                        <p className="text-[10px] text-gray-500 uppercase mb-1">Employee</p>
                                                        <p className="text-sm font-bold text-gray-900">{emp['Employee Number']}</p>
                                                    </div>
                                                    <div className="text-center p-2">
                                                        <p className="text-[10px] text-gray-500 uppercase mb-1">Branch</p>
                                                        <p className="text-sm font-bold text-gray-900">{emp.branch}</p>
                                                    </div>
                                                    <div className="text-center p-2">
                                                        <p className="text-[10px] text-gray-500 uppercase mb-1">Position</p>
                                                        <p className="text-sm font-bold text-gray-900">{emp.jobTitle}</p>
                                                    </div>
                                                </div>
                                                <p className="text-[10px] text-gray-400 mt-2 text-center">
                                                    Full payroll breakdown available in the Payroll module
                                                </p>
                                            </td>
                                        </tr>
                                    )}
                                </>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
