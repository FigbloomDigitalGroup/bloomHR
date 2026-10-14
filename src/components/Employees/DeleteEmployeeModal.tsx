import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Loader2, Trash2, X } from 'lucide-react';
import { type DeleteCheck, checkDeleteEmployee, deleteEmployee } from '../../lib/employeeDelete';
import FigbloomLoader from '../UI/FigbloomLoader';

// Confirms deleting an employee: says what goes with them (or why they can't be deleted), asks for their employee
// number to be typed, and lets an administrator also remove their login from the company.

interface Props {
  employeeId: string;
  isAdmin: boolean;
  onClose: () => void;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function DeleteEmployeeModal({ employeeId, isAdmin, onClose }: Props) {
  const navigate = useNavigate();
  const [check, setCheck] = useState<DeleteCheck | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [removeLogin, setRemoveLogin] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    checkDeleteEmployee(employeeId).then(setCheck, (err) => setProblem(err instanceof Error ? err.message : 'Could not check this employee.'));
  }, [employeeId]);

  const remove = async () => {
    if (!check) return;
    setBusy(true);
    try {
      const r = await deleteEmployee(employeeId, isAdmin && removeLogin);
      toast.success(`${check.name || check.employee_number} was deleted${r.loginRemoved ? ', and their login removed from the company' : ''}`);
      if (r.loginProblem) toast.error(`Their login was kept: ${r.loginProblem}`, { duration: 8000 });
      else if (r.loginKept) toast('Their login was kept. An administrator can remove it under Settings.', { duration: 8000 });
      navigate('/employees');
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'The employee was not deleted.');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto" role="dialog" aria-label="Delete employee">
      <div className="bg-white rounded-[10px] border border-border shadow-lg w-full max-w-md overflow-y-auto max-h-[90vh]">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Delete employee</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 text-muted-foreground hover:text-ink"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4 space-y-3 text-sm text-ink">
          {!check && !problem && <FigbloomLoader label="Checking" size={48} />}
          {check?.blocked ? (
            <p className="rounded-lg bg-orange-tint px-3 py-2">{check.blocked}</p>
          ) : check ? (
            <>
              <p>
                This permanently deletes <span className="font-semibold">{check.name || check.employee_number}</span> ({check.employee_number})
                and everything that belongs to them: contacts, next of kin, referees, {plural(check.documents, 'document')},{' '}
                {plural(check.leave_applications, 'leave application')}, onboarding and health records, and draft payslips. Pending
                invitations are cancelled. This can&apos;t be undone.
              </p>
              <p className="text-xs text-muted-foreground">For someone who has left, use Terminate instead: it keeps their history.</p>
              {check.has_login && (isAdmin ? (
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1" checked={removeLogin} onChange={(e) => setRemoveLogin(e.target.checked)} />
                  <span>Also remove their login from the company (it is deleted if they belong to no other company), so the email can be invited again</span>
                </label>
              ) : (
                <p className="text-xs text-muted-foreground">They have a login, which stays. An administrator can remove it under Settings.</p>
              ))}
              <label className="block">
                <span className="block text-xs font-medium mb-1">Type <span className="font-mono">{check.employee_number}</span> to confirm</span>
                <input value={typed} onChange={(e) => setTyped(e.target.value)} className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                  aria-label="Employee number to confirm" />
              </label>
            </>
          ) : null}
          {problem && <p role="alert" className="text-status-danger">{problem}</p>}
        </div>
        <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-muted-foreground">Cancel</button>
          {check && !check.blocked && (
            <button type="button" disabled={busy || typed.trim() !== check.employee_number} onClick={() => void remove()}
              className="inline-flex items-center gap-2 rounded-lg bg-status-danger px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete employee
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
