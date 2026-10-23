import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button, Card, EmployeePicker, TabBar } from '../UI';
import { usePermissions } from '../../hooks/usePermissions';
import { MODULES, moduleInfo } from '../../lib/modules';
import {
  APPROVAL_KINDS,
  APPROVER_MODULES,
  APPROVER_ROLES,
  APPROVER_TYPES,
  ApprovalKind,
  ApprovalStep,
  ApprovalWorkflow,
  AlternateType,
  ApproverType,
  chainPreview,
  loadApprovalWorkflow,
  saveApprovalWorkflow,
  stepError,
} from '../../lib/approvals';

const inputClass = 'w-full rounded-tile border border-border bg-white px-3 py-2 text-[12.5px] text-ink outline-none focus:border-brand disabled:bg-secondary';
const labelClass = 'block text-[11.5px] font-semibold text-ink mb-1';
const MAX_STEPS = 10;

interface StepEditorProps {
  step: ApprovalStep;
  index: number;
  count: number;
  canEdit: boolean;
  departmentHeads: boolean;
  onChange: (step: ApprovalStep) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}

function StepEditor({ step, index, count, canEdit, departmentHeads, onChange, onMove, onRemove }: StepEditorProps) {
  const set = (patch: Partial<ApprovalStep>) => onChange({ ...step, ...patch });
  const n = index + 1;
  // the department head is offered only where the company's departments are set up
  const types = APPROVER_TYPES.filter((t) => t.id !== 'department_head' || departmentHeads || step.approver_type === 'department_head');
  const problem = stepError(step);

  return (
    <li className="rounded-tile border border-border p-3 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-bold text-ink">Step {n}</span>
        {canEdit && (
          <div className="flex items-center gap-1">
            <Button variant="ghost" className="!px-2" aria-label={`Move step ${n} up`} disabled={index === 0} onClick={() => onMove(-1)}>
              <ArrowUp className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" className="!px-2" aria-label={`Move step ${n} down`} disabled={index === count - 1} onClick={() => onMove(1)}>
              <ArrowDown className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" className="!px-2" aria-label={`Remove step ${n}`} disabled={count === 1} onClick={onRemove}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor={`step-${n}-type`}>Who approves</label>
          <select
            id={`step-${n}-type`}
            className={inputClass}
            value={step.approver_type}
            disabled={!canEdit}
            onChange={(e) => set({ approver_type: e.target.value as ApproverType })}
          >
            {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <p className="m-0 mt-1 text-[11px] text-muted-foreground">{APPROVER_TYPES.find((t) => t.id === step.approver_type)?.hint}</p>
        </div>

        {step.approver_type === 'role' && (
          <div>
            <label className={labelClass} htmlFor={`step-${n}-role`}>Role</label>
            <select
              id={`step-${n}-role`}
              className={inputClass}
              value={step.approver_role || ''}
              disabled={!canEdit}
              onChange={(e) => set({ approver_role: e.target.value || null })}
            >
              <option value="">Choose a role</option>
              {APPROVER_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        )}
        {step.approver_type === 'module' && (
          <div>
            <label className={labelClass} htmlFor={`step-${n}-module`}>Anyone who can</label>
            <select
              id={`step-${n}-module`}
              className={inputClass}
              value={step.approver_module || ''}
              disabled={!canEdit}
              onChange={(e) => set({ approver_module: e.target.value || null })}
            >
              <option value="">Choose</option>
              {[...APPROVER_MODULES, ...MODULES.map((m) => m.id).filter((id) => !APPROVER_MODULES.includes(id))].map((id) => (
                <option key={id} value={id}>{moduleInfo(id)?.name ?? id}</option>
              ))}
            </select>
          </div>
        )}
        {step.approver_type === 'person' && (
          <EmployeePicker
            id={`step-${n}-person`}
            label="Person"
            value={step.approver_employee_number}
            fallbackLabel={step.approver_name || undefined}
            disabled={!canEdit}
            onChange={(e) => set({ approver_employee_number: e?.employeeNumber ?? null, approver_name: e?.fullName ?? null })}
          />
        )}

        <div>
          <label className={labelClass} htmlFor={`step-${n}-label`}>Name shown (optional)</label>
          <input
            id={`step-${n}-label`}
            className={inputClass}
            value={step.label || ''}
            maxLength={60}
            placeholder="e.g. CTO"
            disabled={!canEdit}
            onChange={(e) => set({ label: e.target.value })}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor={`step-${n}-alt`}>Alternate approver (optional)</label>
          <select
            id={`step-${n}-alt`}
            className={inputClass}
            value={step.alternate_type || ''}
            disabled={!canEdit}
            onChange={(e) => set({ alternate_type: (e.target.value || null) as AlternateType | null })}
          >
            <option value="">None</option>
            <option value="role">Anyone with a role</option>
            <option value="person">A named person</option>
          </select>
        </div>
        {step.alternate_type === 'role' && (
          <div>
            <label className={labelClass} htmlFor={`step-${n}-alt-role`}>Alternate’s role</label>
            <select
              id={`step-${n}-alt-role`}
              className={inputClass}
              value={step.alternate_role || ''}
              disabled={!canEdit}
              onChange={(e) => set({ alternate_role: e.target.value || null })}
            >
              <option value="">Choose a role</option>
              {APPROVER_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        )}
        {step.alternate_type === 'person' && (
          <EmployeePicker
            id={`step-${n}-alt-person`}
            label="Alternate"
            value={step.alternate_employee_number}
            fallbackLabel={step.alternate_name || undefined}
            disabled={!canEdit}
            onChange={(e) => set({ alternate_employee_number: e?.employeeNumber ?? null, alternate_name: e?.fullName ?? null })}
          />
        )}
      </div>

      <label className="flex items-center gap-2 text-[12px] text-ink">
        <input
          type="checkbox"
          checked={step.skip_if_requester ?? true}
          disabled={!canEdit}
          onChange={(e) => set({ skip_if_requester: e.target.checked })}
        />
        Skip this step when the approver is the person asking
      </label>
      {problem && <p className="m-0 text-[11.5px] text-status-danger">{problem}</p>}
    </li>
  );
}

/**
 * Settings > Approval workflows: per kind of request, the ordered steps it goes through before it is approved.
 * ADMIN and people with Settings change them; others who open Settings read them.
 */
export default function ApprovalWorkflowsCard({ className = '' }: { className?: string }) {
  const { hasAnyPermission, loading: permissionsLoading } = usePermissions();
  const canEdit = !permissionsLoading && hasAnyPermission(['settings']);
  const [kind, setKind] = useState<ApprovalKind>('leave');
  const [saved, setSaved] = useState<ApprovalWorkflow | null>(null);
  const [steps, setSteps] = useState<ApprovalStep[]>([]);
  const [adminsCanAct, setAdminsCanAct] = useState(true);
  // told when a request is finally approved or rejected, without being a step ("the manager approves, HR is told")
  const [notifyRoles, setNotifyRoles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setSaved(null);
    loadApprovalWorkflow(kind).then((w) => {
      if (!live || !w) return;
      setSaved(w);
      setSteps(w.steps);
      setAdminsCanAct(w.admins_can_act);
      setNotifyRoles(w.notify_roles ?? []);
    });
    return () => {
      live = false;
    };
  }, [kind]);

  const kindInfo = APPROVAL_KINDS.find((k) => k.id === kind)!;
  const problems = steps.map(stepError).filter(Boolean);

  const move = (i: number, by: -1 | 1) =>
    setSteps((prev) => {
      const next = [...prev];
      [next[i], next[i + by]] = [next[i + by], next[i]];
      return next;
    });

  const save = async () => {
    setBusy(true);
    try {
      await saveApprovalWorkflow(kind, steps, adminsCanAct, notifyRoles);
      toast.success(`${kindInfo.label} approvals saved`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={className}>
      <h2 className="m-0 text-[14px] font-bold text-ink">Approval workflows</h2>
      <p className="m-0 mt-0.5 text-[11.5px] text-muted-foreground">
        Who approves each kind of request, in order. A request moves to the next step once its approver approves; a
        rejection at any step ends it. Requests already on their way keep the steps they started with.
      </p>

      <TabBar
        className="mt-3"
        items={APPROVAL_KINDS.map((k) => ({ id: k.id, label: k.label }))}
        activeId={kind}
        onChange={(id) => setKind(id as ApprovalKind)}
      />

      {!kindInfo.inUse && (
        <p className="m-0 mt-3 text-[11.5px] text-muted-foreground">
          {kindInfo.label} requests do not go through workflows yet: what you set here will apply once they do.
        </p>
      )}

      {saved && (
        <div className="mt-3 flex flex-col gap-3">
          <p className="m-0 text-[12.5px] font-semibold text-ink break-words" data-testid="approval-preview">{chainPreview(kind, steps)}</p>
          <ol className="m-0 p-0 list-none flex flex-col gap-3">
            {steps.map((s, i) => (
              <StepEditor
                key={i}
                step={s}
                index={i}
                count={steps.length}
                canEdit={canEdit}
                departmentHeads={saved.department_head_available}
                onChange={(step) => setSteps((prev) => prev.map((p, j) => (j === i ? step : p)))}
                onMove={(by) => move(i, by)}
                onRemove={() => setSteps((prev) => prev.filter((_, j) => j !== i))}
              />
            ))}
          </ol>
          <label className="flex items-center gap-2 text-[12px] text-ink">
            <input type="checkbox" checked={adminsCanAct} disabled={!canEdit} onChange={(e) => setAdminsCanAct(e.target.checked)} />
            Admins may approve or reject at any step
          </label>
          <fieldset className="m-0 p-0 border-0">
            <legend className="text-[12px] font-semibold text-ink mb-1">Also tell, when a request is approved or rejected</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {APPROVER_ROLES.map((r) => (
                <label key={r} className="flex items-center gap-1.5 text-[12px] text-ink">
                  <input
                    type="checkbox"
                    checked={notifyRoles.includes(r)}
                    disabled={!canEdit}
                    onChange={(e) => setNotifyRoles((prev) => (e.target.checked ? [...prev, r] : prev.filter((x) => x !== r)))}
                  />
                  {r}
                </label>
              ))}
            </div>
            <p className="m-0 mt-1 text-[11px] text-muted-foreground">
              They get a notification (and an email) with the decision, without having to approve: for example, the line
              manager approves and HR is told.
            </p>
          </fieldset>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                icon={<Plus className="w-3 h-3" strokeWidth={2.2} />}
                disabled={steps.length >= MAX_STEPS}
                onClick={() => setSteps((prev) => [...prev, { approver_type: 'role', approver_role: 'HR', skip_if_requester: true }])}
              >
                Add step
              </Button>
              <Button onClick={save} disabled={busy || problems.length > 0 || steps.length === 0}>Save</Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
