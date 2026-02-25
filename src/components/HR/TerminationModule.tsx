import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    XCircle, Search, X, Loader2, CheckCircle,
    AlertTriangle, Calendar, Mail, Send
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

type TerminationType = 'Voluntary' | 'Dismissal' | 'Contract End' | 'Redundancy';

interface Termination {
    id: number;
    "Employee Number": string;
    termination_date: string;
    termination_type: TerminationType;
    termination_reason: string | null;
    document_url: string | null;
    final_payroll_status: string;
    clearance_status: string;
    is_archived: boolean;
    performed_by: string | null;
    created_at: string;
    employee_name?: string;
    job_title?: string;
    branch?: string;
    work_email?: string;
}

interface Interview {
    id?: number;
    "Employee Number": string;
    interview_date: string;
    interviewer: string;
    interview_notes: string;
    is_completed: boolean;
    employee_name?: string;
}

interface Employee {
    "Employee Number": string;
    "First Name": string | null;
    "Last Name": string | null;
    "Job Title": string | null;
    Branch: string | null;
    "Work Email": string | null;
}

export default function TerminationModule({ onRefresh }: { onRefresh?: () => void }) {
    const [terminations, setTerminations] = useState<Termination[]>([]);
    const [interviews, setInterviews] = useState<Interview[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [activeView, setActiveView] = useState<'terminations' | 'interviews'>('terminations');

    // Termination modal
    const [showTermModal, setShowTermModal] = useState(false);
    const [showInterviewModal, setShowInterviewModal] = useState(false);
    const [showEmailModal, setShowEmailModal] = useState(false);
    const [selectedTermination, setSelectedTermination] = useState<Termination | null>(null);
    const [saving, setSaving] = useState(false);

    const [termForm, setTermForm] = useState({
        employeeNumber: '', termination_date: new Date().toISOString().split('T')[0],
        termination_type: 'Voluntary' as TerminationType, termination_reason: ''
    });

    const [intForm, setIntForm] = useState({
        employeeNumber: '', interview_date: '', interviewer: '', interview_notes: ''
    });

    const [emailBody, setEmailBody] = useState('');
    const [emailSubject, setEmailSubject] = useState('');

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [termRes, intRes, empRes] = await Promise.all([
                supabase.from('hr_terminations').select('*').order('termination_date', { ascending: false }),
                supabase.from('hr_termination_interviews').select('*').order('created_at', { ascending: false }),
                supabase.from('employees').select('"Employee Number", "First Name", "Last Name", "Job Title", "Branch", "Work Email"')
            ]);

            const emps = (empRes.data || []) as Employee[];
            setEmployees(emps);

            const enrichEmp = (empNum: string) => {
                const emp = emps.find(e => e['Employee Number'] === empNum);
                return {
                    employee_name: emp ? `${emp['First Name']} ${emp['Last Name']}` : empNum,
                    job_title: emp?.['Job Title'] || '—',
                    branch: emp?.['Branch'] || '—',
                    work_email: emp?.['Work Email'] || ''
                };
            };

            setTerminations((termRes.data || []).map(t => ({ ...t, ...enrichEmp(t['Employee Number']) })));
            setInterviews((intRes.data || []).map(i => ({ ...i, ...enrichEmp(i['Employee Number']) })));
        } catch (err) {
            console.error(err);
            toast.error('Failed to load termination data');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    const generateDismissalEmail = (term: Termination) => {
        const subject = `Notice of Termination – ${term.employee_name}`;
        const body = `Dear ${term.employee_name},

We regret to inform you that your employment with the company has been terminated effective ${term.termination_date}.

Termination Type: ${term.termination_type}
${term.termination_reason ? `Reason: ${term.termination_reason}` : ''}

Please ensure all company assets are returned by your last working day. HR will be in touch regarding your final settlement and clearance.

Regards,
Human Resources Department`;
        setEmailSubject(subject);
        setEmailBody(body);
        setSelectedTermination(term);
        setShowEmailModal(true);
    };

    const handleSaveTermination = async () => {
        if (!termForm.employeeNumber || !termForm.termination_date || !termForm.termination_reason) {
            toast.error('Please fill all required fields');
            return;
        }
        setSaving(true);
        try {
            await supabase.from('hr_terminations').insert({
                "Employee Number": termForm.employeeNumber,
                termination_date: termForm.termination_date,
                termination_type: termForm.termination_type,
                termination_reason: termForm.termination_reason,
                final_payroll_status: 'Pending',
                clearance_status: 'Pending',
                is_archived: false,
                performed_by: 'HR Admin'
            });

            // Log history
            await supabase.from('hr_lifecycle_history').insert({
                "Employee Number": termForm.employeeNumber,
                event_type: 'termination',
                event_date: new Date().toISOString(),
                new_value: { termination_type: termForm.termination_type, date: termForm.termination_date },
                notes: termForm.termination_reason,
                performed_by: 'HR Admin'
            });

            toast.success('Termination recorded successfully');
            setShowTermModal(false);
            setTermForm({ employeeNumber: '', termination_date: new Date().toISOString().split('T')[0], termination_type: 'Voluntary', termination_reason: '' });
            fetchData();
            onRefresh?.();
        } catch (err) {
            toast.error('Failed to record termination');
        } finally {
            setSaving(false);
        }
    };

    const handleSaveInterview = async () => {
        if (!intForm.employeeNumber || !intForm.interview_date || !intForm.interviewer) {
            toast.error('Please fill all required fields');
            return;
        }
        setSaving(true);
        try {
            await supabase.from('hr_termination_interviews').upsert({
                "Employee Number": intForm.employeeNumber,
                interview_date: intForm.interview_date,
                interviewer: intForm.interviewer,
                interview_notes: intForm.interview_notes,
                is_completed: false
            });
            toast.success('Interview scheduled successfully');
            setShowInterviewModal(false);
            setIntForm({ employeeNumber: '', interview_date: '', interviewer: '', interview_notes: '' });
            fetchData();
        } catch (err) {
            toast.error('Failed to schedule interview');
        } finally {
            setSaving(false);
        }
    };

    const handleMarkInterviewComplete = async (id: number) => {
        try {
            await supabase.from('hr_termination_interviews').update({ is_completed: true }).eq('id', id);
            toast.success('Interview marked as completed');
            fetchData();
        } catch (err) {
            toast.error('Failed to update interview');
        }
    };

    const handleSendEmail = async () => {
        if (!selectedTermination) return;
        setSaving(true);
        try {
            await supabase.from('hr_dismissal_emails').insert({
                "Employee Number": selectedTermination['Employee Number'],
                email_subject: emailSubject,
                email_body: emailBody,
                sent_at: new Date().toISOString(),
                is_sent: true
            });
            toast.success('Dismissal email stored in employee record');
            setShowEmailModal(false);
        } catch (err) {
            toast.error('Failed to save email');
        } finally {
            setSaving(false);
        }
    };

    const handleUpdateStatus = async (id: number, field: 'final_payroll_status' | 'clearance_status', value: string) => {
        try {
            await supabase.from('hr_terminations').update({ [field]: value }).eq('id', id);
            toast.success('Status updated');
            fetchData();
        } catch (err) {
            toast.error('Failed to update status');
        }
    };

    const typeColors: Record<string, string> = {
        'Voluntary': 'bg-blue-100 text-blue-700 border-blue-200',
        'Dismissal': 'bg-red-100 text-red-700 border-red-200',
        'Contract End': 'bg-gray-100 text-gray-700 border-gray-200',
        'Redundancy': 'bg-orange-100 text-orange-700 border-orange-200',
    };

    const filteredTerms = terminations.filter(t =>
        !search || t.employee_name?.toLowerCase().includes(search.toLowerCase()) || t['Employee Number'].toLowerCase().includes(search.toLowerCase())
    );
    const filteredInterviews = interviews.filter(i =>
        !search || i.employee_name?.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h2 className="text-lg font-bold text-gray-900">Termination Module</h2>
                    <p className="text-xs text-gray-500">Manage employee terminations, exit interviews, dismissal emails and post-termination actions</p>
                </div>
                <div className="flex gap-2">
                    <button onClick={() => setShowInterviewModal(true)}
                        className="flex items-center gap-2 px-3 py-2 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">
                        <Calendar className="w-3.5 h-3.5" /> Schedule Interview
                    </button>
                    <button onClick={() => setShowTermModal(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 transition-colors">
                        <XCircle className="w-3.5 h-3.5" /> New Termination
                    </button>
                </div>
            </div>

            {/* View Tabs */}
            <div className="bg-white border border-gray-200 rounded-xl p-1 flex gap-1 w-fit">
                {[{ id: 'terminations', label: 'Terminations' }, { id: 'interviews', label: 'Exit Interviews' }].map(v => (
                    <button key={v.id} onClick={() => setActiveView(v.id as typeof activeView)}
                        className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${activeView === v.id ? 'bg-red-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                        {v.label}
                        {v.id === 'interviews' && interviews.filter(i => !i.is_completed).length > 0 && (
                            <span className="ml-1.5 px-1.5 py-0.5 bg-amber-500 text-white text-[10px] rounded-full">
                                {interviews.filter(i => !i.is_completed).length}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* Search */}
            <div className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type="text" placeholder="Search employee..." value={search} onChange={e => setSearch(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400" />
                </div>
            </div>

            {loading ? (
                <div className="flex items-center justify-center h-40">
                    <Loader2 className="w-6 h-6 animate-spin text-red-500" />
                </div>
            ) : (
                <AnimatePresence mode="wait">
                    {activeView === 'terminations' ? (
                        <motion.div key="terminations" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
                            {filteredTerms.length === 0 ? (
                                <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
                                    <XCircle className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                                    <p className="text-sm text-gray-500">No termination records found</p>
                                </div>
                            ) : filteredTerms.map(t => (
                                <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                                    className="bg-white border border-gray-200 rounded-xl p-4">
                                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                                        <div className="flex items-start gap-3">
                                            <div className="w-9 h-9 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0">
                                                <XCircle className="w-4 h-4 text-red-600" />
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <p className="text-sm font-semibold text-gray-900">{t.employee_name}</p>
                                                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${typeColors[t.termination_type] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                                                        {t.termination_type}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-gray-500 mt-0.5">{t['Employee Number']} · {t.job_title} · {t.branch}</p>
                                                <p className="text-xs text-gray-600 mt-1">{t.termination_reason}</p>
                                                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                                                    <p className="text-[10px] text-gray-400 flex items-center gap-1">
                                                        <Calendar className="w-3 h-3" /> {t.termination_date}
                                                    </p>
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-[10px] text-gray-400">Payroll:</span>
                                                        <select value={t.final_payroll_status} onChange={e => handleUpdateStatus(t.id, 'final_payroll_status', e.target.value)}
                                                            className="text-[10px] border border-gray-200 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-red-400">
                                                            <option>Pending</option><option>Processed</option><option>On Hold</option>
                                                        </select>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-[10px] text-gray-400">Clearance:</span>
                                                        <select value={t.clearance_status} onChange={e => handleUpdateStatus(t.id, 'clearance_status', e.target.value)}
                                                            className="text-[10px] border border-gray-200 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-red-400">
                                                            <option>Pending</option><option>Cleared</option><option>Partial</option>
                                                        </select>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        {t.termination_type === 'Dismissal' && (
                                            <button onClick={() => generateDismissalEmail(t)}
                                                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 transition-colors flex-shrink-0">
                                                <Mail className="w-3 h-3" /> Generate Email
                                            </button>
                                        )}
                                    </div>
                                </motion.div>
                            ))}
                        </motion.div>
                    ) : (
                        <motion.div key="interviews" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
                            {filteredInterviews.length === 0 ? (
                                <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
                                    <Calendar className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                                    <p className="text-sm text-gray-500">No exit interviews found</p>
                                </div>
                            ) : filteredInterviews.map(i => (
                                <motion.div key={i.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                                    className={`bg-white border rounded-xl p-4 ${!i.is_completed ? 'border-amber-200 bg-amber-50/20' : 'border-gray-200'}`}>
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-start gap-3">
                                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${i.is_completed ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                                                <Calendar className={`w-4 h-4 ${i.is_completed ? 'text-emerald-600' : 'text-amber-600'}`} />
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <p className="text-sm font-semibold text-gray-900">{i.employee_name}</p>
                                                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border
                            ${i.is_completed ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-amber-100 text-amber-700 border-amber-200'}`}>
                                                        {i.is_completed ? 'Completed' : 'Scheduled'}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-gray-500 mt-0.5">Interviewer: {i.interviewer}</p>
                                                <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                                                    <Calendar className="w-3 h-3" /> {i.interview_date}
                                                </p>
                                                {i.interview_notes && (
                                                    <p className="text-xs text-gray-600 mt-1 italic">"{i.interview_notes}"</p>
                                                )}
                                            </div>
                                        </div>
                                        {!i.is_completed && i.id && (
                                            <button onClick={() => handleMarkInterviewComplete(i.id!)}
                                                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors flex-shrink-0">
                                                <CheckCircle className="w-3 h-3" /> Mark Complete
                                            </button>
                                        )}
                                    </div>
                                </motion.div>
                            ))}
                        </motion.div>
                    )}
                </AnimatePresence>
            )}

            {/* Termination Modal */}
            {showTermModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
                        <div className="flex items-center justify-between mb-5">
                            <h3 className="text-sm font-bold text-gray-900">Record Termination</h3>
                            <button onClick={() => setShowTermModal(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                                <X className="w-4 h-4 text-gray-500" />
                            </button>
                        </div>
                        <div className="space-y-3">
                            <div>
                                <label className="text-xs font-medium text-gray-700 block mb-1">Employee *</label>
                                <select value={termForm.employeeNumber} onChange={e => setTermForm(f => ({ ...f, employeeNumber: e.target.value }))}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-red-400">
                                    <option value="">Select employee...</option>
                                    {employees.map(e => (
                                        <option key={e['Employee Number']} value={e['Employee Number']}>
                                            {e['First Name']} {e['Last Name']} ({e['Employee Number']})
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-700 block mb-1">Termination Date *</label>
                                <input type="date" value={termForm.termination_date} onChange={e => setTermForm(f => ({ ...f, termination_date: e.target.value }))}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-red-400" />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-700 block mb-1">Termination Type *</label>
                                <select value={termForm.termination_type} onChange={e => setTermForm(f => ({ ...f, termination_type: e.target.value as TerminationType }))}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-red-400">
                                    {['Voluntary', 'Dismissal', 'Contract End', 'Redundancy'].map(t => <option key={t}>{t}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-700 block mb-1">Reason *</label>
                                <textarea rows={3} value={termForm.termination_reason} onChange={e => setTermForm(f => ({ ...f, termination_reason: e.target.value }))}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
                                    placeholder="State the reason for termination..." />
                            </div>
                            {termForm.termination_type === 'Dismissal' && (
                                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
                                    <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                                    <p className="text-[10px] text-amber-700">A dismissal email can be generated after saving this record.</p>
                                </div>
                            )}
                        </div>
                        <div className="flex gap-2 mt-5">
                            <button onClick={() => setShowTermModal(false)}
                                className="flex-1 py-2 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">Cancel</button>
                            <button onClick={handleSaveTermination} disabled={saving}
                                className="flex-1 py-2 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-1">
                                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                                Record Termination
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}

            {/* Interview Modal */}
            {showInterviewModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
                        <div className="flex items-center justify-between mb-5">
                            <h3 className="text-sm font-bold text-gray-900">Schedule Exit Interview</h3>
                            <button onClick={() => setShowInterviewModal(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                                <X className="w-4 h-4 text-gray-500" />
                            </button>
                        </div>
                        <div className="space-y-3">
                            <div>
                                <label className="text-xs font-medium text-gray-700 block mb-1">Employee *</label>
                                <select value={intForm.employeeNumber} onChange={e => setIntForm(f => ({ ...f, employeeNumber: e.target.value }))}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500">
                                    <option value="">Select employee...</option>
                                    {employees.map(e => (
                                        <option key={e['Employee Number']} value={e['Employee Number']}>
                                            {e['First Name']} {e['Last Name']} ({e['Employee Number']})
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-700 block mb-1">Interview Date *</label>
                                <input type="datetime-local" value={intForm.interview_date} onChange={e => setIntForm(f => ({ ...f, interview_date: e.target.value }))}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500" />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-700 block mb-1">Interviewer *</label>
                                <input type="text" value={intForm.interviewer} onChange={e => setIntForm(f => ({ ...f, interviewer: e.target.value }))}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500" placeholder="Name of interviewer" />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-700 block mb-1">Interview Notes</label>
                                <textarea rows={3} value={intForm.interview_notes} onChange={e => setIntForm(f => ({ ...f, interview_notes: e.target.value }))}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none" />
                            </div>
                        </div>
                        <div className="flex gap-2 mt-5">
                            <button onClick={() => setShowInterviewModal(false)}
                                className="flex-1 py-2 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">Cancel</button>
                            <button onClick={handleSaveInterview} disabled={saving}
                                className="flex-1 py-2 text-xs bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-1">
                                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Calendar className="w-3.5 h-3.5" />}
                                Schedule
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}

            {/* Dismissal Email Modal */}
            {showEmailModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-5">
                            <h3 className="text-sm font-bold text-gray-900">Generate Dismissal Email</h3>
                            <button onClick={() => setShowEmailModal(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                                <X className="w-4 h-4 text-gray-500" />
                            </button>
                        </div>
                        <div className="space-y-3">
                            <div>
                                <label className="text-xs font-medium text-gray-700 block mb-1">Subject</label>
                                <input type="text" value={emailSubject} onChange={e => setEmailSubject(e.target.value)}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-red-400" />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-700 block mb-1">Email Body (editable)</label>
                                <textarea rows={12} value={emailBody} onChange={e => setEmailBody(e.target.value)}
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-red-400 resize-none font-mono" />
                            </div>
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
                                <Mail className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                                <p className="text-[10px] text-blue-700">This email will be stored in the employee's record. Edit as needed before saving.</p>
                            </div>
                        </div>
                        <div className="flex gap-2 mt-5">
                            <button onClick={() => setShowEmailModal(false)}
                                className="flex-1 py-2 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">Cancel</button>
                            <button onClick={handleSendEmail} disabled={saving}
                                className="flex-1 py-2 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-1">
                                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                                Save to Record
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </div>
    );
}
