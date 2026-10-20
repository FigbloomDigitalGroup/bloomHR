import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { AlertTriangle, BookOpen, Download, FileText, HeartPulse, Paperclip, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { Button, Card, EmployeePicker, EmptyState, Modal, PageHeader, StatusPill } from '../UI';
import type { StatusTone } from '../UI';
import FigbloomLoader from '../UI/FigbloomLoader';
import { money } from '../../lib/payroll/currency';
import { loadCompanyProfile } from '../../lib/companyProfile';
import {
  STATUS_STEPS,
  caseDeadlines,
  coverState,
  dayKeyOf,
  daysOffWork,
  estimateCompensation,
  nextDeadline,
  statusLabel,
  type CaseDeadline,
  type WibaCover,
  type WorkInjuryCase,
  type WorkInjuryKind,
  type WorkInjuryStatus,
} from '../../lib/workInjury';
import { WORK_INJURY_RULES, rulesFor, type WorkInjuryCountry } from '../../lib/workInjuryRules';
import {
  addCaseDocument,
  loadCaseDocuments,
  loadEmployeeReportDetails,
  loadIncident,
  loadMonthlyEarnings,
  loadWibaCover,
  loadWorkInjuryCases,
  openCaseDocument,
  removeCaseDocument,
  saveWibaCover,
  saveWorkInjuryCase,
  type CaseDocument,
  type CaseFields,
} from '../../lib/workInjuryApi';
import { downloadWorkInjuryReport } from '../../lib/workInjuryPdf';

const inputClass = 'w-full rounded-tile border border-border bg-white px-3 py-2 text-[12.5px] text-ink outline-none focus:border-brand';
const labelClass = 'block text-[11px] font-semibold text-ink mb-1.5';

const STATUS_TONE: Record<WorkInjuryStatus, StatusTone> = {
  reported: 'info',
  notified: 'purple',
  claim_lodged: 'warning',
  assessed: 'warning',
  paid: 'success',
  closed: 'neutral',
};

const DEADLINE_CLASS: Record<CaseDeadline['state'], string> = {
  done: 'text-status-success',
  overdue: 'text-status-danger font-semibold',
  soon: 'text-orange-text-alt font-semibold',
  due: 'text-ink',
};

const GUIDE = 'A guide, not legal advice.';

/** A case as the form edits it: every field as text. */
interface Draft {
  id: string | null;
  incident_report_id: string | null;
  employee_number: string;
  kind: WorkInjuryKind;
  is_fatal: boolean;
  occurred_at: string; // datetime-local
  employer_notified_on: string;
  place: string;
  what_happened: string;
  injury_nature: string;
  body_parts: string;
  witnesses: string;
  first_aid: string;
  hospital: string;
  doctor: string;
  on_duty: boolean;
  stopped_work_on: string;
  returned_to_work_on: string;
  days_off: string;
  incapacity_percent: string;
  monthly_earnings: string;
  medical_costs: string;
  status: WorkInjuryStatus;
  authority_notified_on: string;
  authority_reference: string;
  claim_lodged_on: string;
  insurer_claim_number: string;
  assessed_amount: string;
  paid_amount: string;
  notes: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${dayKeyOf(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const numOrNull = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Number(s));
const textOrNull = (s: string) => s.trim() || null;

const emptyDraft = (): Draft => ({
  id: null, incident_report_id: null, employee_number: '', kind: 'accident', is_fatal: false,
  occurred_at: toLocalInput(new Date().toISOString()), employer_notified_on: dayKeyOf(new Date()),
  place: '', what_happened: '', injury_nature: '', body_parts: '', witnesses: '', first_aid: '', hospital: '', doctor: '',
  on_duty: true, stopped_work_on: '', returned_to_work_on: '', days_off: '', incapacity_percent: '', monthly_earnings: '',
  medical_costs: '', status: 'reported', authority_notified_on: '', authority_reference: '', claim_lodged_on: '',
  insurer_claim_number: '', assessed_amount: '', paid_amount: '', notes: '',
});

const draftOf = (c: WorkInjuryCase): Draft => ({
  id: c.id, incident_report_id: c.incident_report_id, employee_number: c.employee_number, kind: c.kind, is_fatal: c.is_fatal,
  occurred_at: toLocalInput(c.occurred_at), employer_notified_on: str(c.employer_notified_on), place: str(c.place),
  what_happened: str(c.what_happened), injury_nature: str(c.injury_nature), body_parts: str(c.body_parts),
  witnesses: str(c.witnesses), first_aid: str(c.first_aid), hospital: str(c.hospital), doctor: str(c.doctor),
  on_duty: c.on_duty, stopped_work_on: str(c.stopped_work_on), returned_to_work_on: str(c.returned_to_work_on),
  days_off: str(c.days_off), incapacity_percent: str(c.incapacity_percent), monthly_earnings: str(c.monthly_earnings),
  medical_costs: str(c.medical_costs), status: c.status, authority_notified_on: str(c.authority_notified_on),
  authority_reference: str(c.authority_reference), claim_lodged_on: str(c.claim_lodged_on),
  insurer_claim_number: str(c.insurer_claim_number), assessed_amount: str(c.assessed_amount), paid_amount: str(c.paid_amount),
  notes: str(c.notes),
});

const fieldsOf = (d: Draft): CaseFields => ({
  incident_report_id: d.incident_report_id,
  employee_number: d.employee_number,
  kind: d.kind,
  is_fatal: d.is_fatal,
  occurred_at: new Date(d.occurred_at).toISOString(),
  employer_notified_on: d.employer_notified_on || null,
  place: textOrNull(d.place),
  what_happened: textOrNull(d.what_happened),
  injury_nature: textOrNull(d.injury_nature),
  body_parts: textOrNull(d.body_parts),
  witnesses: textOrNull(d.witnesses),
  first_aid: textOrNull(d.first_aid),
  hospital: textOrNull(d.hospital),
  doctor: textOrNull(d.doctor),
  on_duty: d.on_duty,
  stopped_work_on: d.stopped_work_on || null,
  returned_to_work_on: d.returned_to_work_on || null,
  days_off: numOrNull(d.days_off),
  incapacity_percent: numOrNull(d.incapacity_percent),
  monthly_earnings: numOrNull(d.monthly_earnings),
  medical_costs: numOrNull(d.medical_costs),
  status: d.status,
  authority_notified_on: d.authority_notified_on || null,
  authority_reference: textOrNull(d.authority_reference),
  claim_lodged_on: d.claim_lodged_on || null,
  insurer_claim_number: textOrNull(d.insurer_claim_number),
  assessed_amount: numOrNull(d.assessed_amount),
  paid_amount: numOrNull(d.paid_amount),
  notes: textOrNull(d.notes),
});

// ---------------------------------------------------------------------------------------------
// "How this works"
// ---------------------------------------------------------------------------------------------
export function HowItWorks({ initialCountry = 'Kenya' }: { initialCountry?: string }) {
  const start = WORK_INJURY_RULES.some((r) => r.country === initialCountry) ? (initialCountry as WorkInjuryCountry) : 'Kenya';
  const [country, setCountry] = useState<WorkInjuryCountry>(start);
  const rules = rulesFor(country, dayKeyOf(new Date()));
  const countries = [...new Set(WORK_INJURY_RULES.map((r) => r.country))];
  return (
    <Card>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="m-0 text-[14px] font-bold text-ink flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-brand" /> How this works
        </h2>
        <div className="flex gap-1.5" role="tablist" aria-label="Country">
          {countries.map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={c === country}
              onClick={() => setCountry(c)}
              className={`px-3 py-1.5 rounded-pill text-[11px] font-semibold border ${c === country ? 'bg-brand text-white border-brand' : 'bg-white text-ink border-border'}`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
      <p className="m-0 mb-2 text-[11px] text-muted-foreground">{rules.act}. Compensation is paid by: {rules.payer}.</p>
      <ol className="m-0 pl-5 space-y-1.5 text-xs text-ink">
        {rules.howItWorks.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <div className="mt-3">
        <div className="text-[10px] font-bold uppercase text-subtle mb-1">Deadlines</div>
        <ul className="m-0 pl-5 space-y-1 text-xs text-ink">
          {rules.deadlines.map((d) => (
            <li key={d.code}>
              {d.label}: within {d.hours ? `${d.hours} hours of the accident` : `${d.days} days of ${d.from === 'accident' ? 'the accident' : 'the employer hearing of it'}`}
              <span className="text-subtle"> ({d.citation}{d.verified ? '' : ' — check this'})</span>
            </li>
          ))}
        </ul>
      </div>
      {rules.notes.map((n) => (
        <p key={n} className="m-0 mt-2 text-[11px] text-muted-foreground">{n}</p>
      ))}
      <p className="m-0 mt-3 text-[11px] font-semibold text-subtle">{GUIDE}</p>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// the company's cover
// ---------------------------------------------------------------------------------------------
function CoverCard({ cover, onSaved }: { cover: WibaCover | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<WibaCover>({ insurer_name: '', policy_number: '', cover_start: '', cover_expiry: '', dosh_registration_no: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const state = coverState(cover, dayKeyOf(new Date()));
  const tone = state.state === 'ok' ? 'text-status-success' : state.state === 'expiring' ? 'text-orange-text-alt' : 'text-status-danger';

  const open = () => {
    setDraft({
      insurer_name: cover?.insurer_name ?? '', policy_number: cover?.policy_number ?? '', cover_start: cover?.cover_start ?? '',
      cover_expiry: cover?.cover_expiry ?? '', dosh_registration_no: cover?.dosh_registration_no ?? '', notes: cover?.notes ?? '',
    });
    setEditing(true);
  };
  const save = async () => {
    setBusy(true);
    try {
      await saveWibaCover({
        insurer_name: textOrNull(draft.insurer_name ?? ''), policy_number: textOrNull(draft.policy_number ?? ''),
        cover_start: draft.cover_start || null, cover_expiry: draft.cover_expiry || null,
        dosh_registration_no: textOrNull(draft.dosh_registration_no ?? ''), notes: textOrNull(draft.notes ?? ''),
      });
      toast.success('Insurance details saved');
      setEditing(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The insurance details were not saved.');
    } finally {
      setBusy(false);
    }
  };
  const field = (key: keyof WibaCover, label: string, type = 'text') => (
    <div>
      <label htmlFor={`cover-${key}`} className={labelClass}>{label}</label>
      <input id={`cover-${key}`} type={type} className={inputClass} value={draft[key] ?? ''} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
    </div>
  );

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="m-0 text-[14px] font-bold text-ink flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-brand" /> Work injury insurance
          </h2>
          <p className={`m-0 mt-1 text-xs ${tone}`} data-testid="cover-state">{state.message}</p>
          {cover?.dosh_registration_no && <p className="m-0 mt-1 text-[11px] text-muted-foreground">DOSH workplace registration: {cover.dosh_registration_no}</p>}
        </div>
        <Button variant="secondary" onClick={open}>{cover ? 'Edit' : 'Add insurance'}</Button>
      </div>
      <Modal open={editing} onClose={() => !busy && setEditing(false)} title="Work injury insurance" size="xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {field('insurer_name', 'Insurer')}
          {field('policy_number', 'Policy number')}
          {field('cover_start', 'Cover from', 'date')}
          {field('cover_expiry', 'Cover until', 'date')}
          {field('dosh_registration_no', 'DOSH workplace registration no.')}
          {field('notes', 'Notes')}
        </div>
        <p className="m-0 mt-3 text-[11px] text-muted-foreground">In Kenya every employer must insure its employees under WIBA (s.7). In Tanzania the cover is the company&apos;s WCF registration.</p>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? 'Saving...' : 'Save'}</Button>
        </div>
      </Modal>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// one case
// ---------------------------------------------------------------------------------------------
function Estimate({ draft, country, currency }: { draft: Draft; country: string | null; currency: string | null }) {
  const rules = rulesFor(country, (draft.occurred_at || dayKeyOf(new Date())).slice(0, 10));
  const today = dayKeyOf(new Date());
  const counted = daysOffWork(draft.stopped_work_on || null, draft.returned_to_work_on || null, today);
  const days = draft.days_off.trim() !== '' ? Number(draft.days_off) : counted;
  const estimate = estimateCompensation(
    { monthlyEarnings: numOrNull(draft.monthly_earnings), daysOff: days, incapacityPercent: numOrNull(draft.incapacity_percent), isFatal: draft.is_fatal, medicalCosts: numOrNull(draft.medical_costs) },
    rules.compensation,
  );
  return (
    <div className="rounded-xl border border-border bg-background p-3" aria-label="Compensation estimate">
      <div className="text-[12px] font-bold text-ink mb-1">Compensation estimate</div>
      <p className="m-0 mb-2 text-[11px] text-orange-text-alt font-semibold">
        An estimate only: the {rules.authority} assesses the claim and the {rules.compensation ? 'insurer' : 'fund'} pays. Nothing here is added to payroll.
      </p>
      {estimate.missing ? (
        <p className="m-0 text-xs text-muted-foreground">{estimate.missing}</p>
      ) : (
        <table className="w-full text-xs">
          <tbody>
            {estimate.lines.map((l) => (
              <tr key={l.code} className="border-b border-border last:border-0 align-top">
                <td className="py-1.5 pr-2">
                  <div className="font-semibold text-ink">{l.label}</div>
                  <div className="text-[11px] text-muted-foreground">{l.working}</div>
                  <div className="text-[10px] text-subtle">{l.citation}</div>
                </td>
                <td className="py-1.5 text-right whitespace-nowrap font-semibold">{money(l.amount, currency)}</td>
              </tr>
            ))}
            <tr>
              <td className="pt-2 font-bold text-ink">Estimated total</td>
              <td className="pt-2 text-right font-bold whitespace-nowrap" data-testid="estimate-total">{money(estimate.total, currency)}</td>
            </tr>
          </tbody>
        </table>
      )}
      {estimate.caveats.length > 0 && (
        <ul className="m-0 mt-2 pl-4 text-[10.5px] text-subtle space-y-0.5">
          {estimate.caveats.map((c) => <li key={c}>{c}</li>)}
          {rules.compensation && !rules.compensation.verified && <li>The section numbers and formulas are our reading of the Act: check them.</li>}
        </ul>
      )}
    </div>
  );
}

function CaseFiles({ caseId }: { caseId: string }) {
  const [docs, setDocs] = useState<CaseDocument[]>([]);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const reload = useCallback(() => {
    loadCaseDocuments(caseId).then(setDocs).catch(() => setDocs([]));
  }, [caseId]);
  useEffect(reload, [reload]);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      await addCaseDocument(caseId, file, label);
      setLabel('');
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The file was not uploaded.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <div className="text-[12px] font-bold text-ink mb-1.5 flex items-center gap-1.5"><Paperclip className="w-3.5 h-3.5" /> Documents</div>
      <p className="m-0 mb-2 text-[11px] text-muted-foreground">Medical reports, the signed DOSH form, police abstract, receipts.</p>
      {docs.length > 0 && (
        <ul className="m-0 mb-2 p-0 list-none space-y-1">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 text-xs">
              <button type="button" className="text-brand underline text-left" onClick={() => openCaseDocument(d).catch((e: Error) => toast.error(e.message))}>
                {d.label ? `${d.label} — ` : ''}{d.file_name}
              </button>
              <button type="button" aria-label={`Remove ${d.file_name}`} className="text-subtle hover:text-status-danger"
                onClick={() => removeCaseDocument(d).then(reload).catch((e: Error) => toast.error(e.message))}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2 items-center">
        <input aria-label="What the file is" placeholder="What is it? (e.g. Medical report)" className={`${inputClass} !w-56`} value={label} onChange={(e) => setLabel(e.target.value)} />
        <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-tile border border-border text-[12px] font-semibold cursor-pointer bg-white">
          <Plus className="w-3.5 h-3.5" /> {busy ? 'Uploading...' : 'Add a file'}
          <input type="file" className="hidden" disabled={busy} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
      </div>
    </div>
  );
}

function CaseEditor({ initial, saved, cover, onClose, onSaved }: {
  initial: Draft;
  saved: WorkInjuryCase | null;
  cover: WibaCover | null;
  onClose: () => void;
  onSaved: (c: WorkInjuryCase) => void;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const now = new Date();
  const country = saved?.country ?? null;
  const rules = rulesFor(country, (draft.occurred_at || dayKeyOf(now)).slice(0, 10));
  const deadlines = draft.occurred_at
    ? caseDeadlines({
      country, occurred_at: new Date(draft.occurred_at).toISOString(), employer_notified_on: draft.employer_notified_on || null,
      is_fatal: draft.is_fatal, authority_notified_on: draft.authority_notified_on || null, claim_lodged_on: draft.claim_lodged_on || null,
    }, now, rules)
    : [];

  const pickEmployee = async (number: string) => {
    set('employee_number', number);
    if (number && !draft.monthly_earnings) {
      const earnings = await loadMonthlyEarnings(number);
      if (earnings) setDraft((d) => (d.monthly_earnings ? d : { ...d, monthly_earnings: String(earnings) }));
    }
  };

  const save = async () => {
    if (!draft.employee_number) return toast.error('Choose the injured employee');
    if (!draft.occurred_at) return toast.error('Enter when it happened');
    setBusy(true);
    try {
      const result = await saveWorkInjuryCase(draft.id, fieldsOf(draft));
      toast.success(draft.id ? 'Case saved' : 'Work injury case opened');
      setDraft(draftOf(result));
      onSaved(result);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The case was not saved.');
    } finally {
      setBusy(false);
    }
  };

  const downloadReport = async () => {
    if (!saved) return;
    try {
      const [profile, employee] = await Promise.all([loadCompanyProfile().catch(() => null), loadEmployeeReportDetails(saved.employee_number)]);
      const address = profile ? [profile.address_line1, profile.address_line2, profile.city, profile.postal_code].filter(Boolean).join(', ') : null;
      downloadWorkInjuryReport(saved, {
        name: profile?.company_name ?? null, address, phone: profile?.official_phone ?? null, email: profile?.official_email ?? null,
        registrationNo: profile?.registration_no ?? null, businessType: profile?.industry || profile?.business_type || null,
      }, cover, employee);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The report could not be made.');
    }
  };

  const text = (key: keyof Draft, label: string, rows = 0, type = 'text') => (
    <div className={rows ? 'sm:col-span-2' : ''}>
      <label htmlFor={`case-${key}`} className={labelClass}>{label}</label>
      {rows ? (
        <textarea id={`case-${key}`} rows={rows} className={inputClass} value={String(draft[key] ?? '')} onChange={(e) => set(key, e.target.value as never)} />
      ) : (
        <input id={`case-${key}`} type={type} className={inputClass} value={String(draft[key] ?? '')} onChange={(e) => set(key, e.target.value as never)} />
      )}
    </div>
  );

  return (
    <Modal open onClose={() => !busy && onClose()} title={draft.id ? 'Work injury case' : 'New work injury case'} size="4xl" closeOnBackdrop={false}>
      <div className="space-y-5">
        {deadlines.length > 0 && (
          <div className="rounded-xl border border-border p-3" aria-label="Deadlines">
            <div className="text-[12px] font-bold text-ink mb-1.5">Deadlines ({rules.country})</div>
            <ul className="m-0 p-0 list-none space-y-1">
              {deadlines.map((d) => (
                <li key={d.rule.code} className={`text-xs ${DEADLINE_CLASS[d.state]}`}>
                  {d.message}
                  <span className="text-[10px] text-subtle font-normal"> &middot; {d.rule.citation}{d.rule.verified ? '' : ' (check this)'}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <section>
          <h3 className="m-0 mb-2 text-[13px] font-bold text-ink">The accident</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <EmployeePicker label="Injured employee" value={draft.employee_number} required fallbackLabel={saved?.employee_name ?? undefined}
                onChange={(e) => pickEmployee(e?.employeeNumber ?? '')} />
            </div>
            <div>
              <label htmlFor="case-kind" className={labelClass}>What kind</label>
              <select id="case-kind" className={inputClass} value={draft.kind} onChange={(e) => set('kind', e.target.value as WorkInjuryKind)}>
                <option value="accident">Accident at work</option>
                <option value="occupational_disease">Occupational disease</option>
              </select>
            </div>
            <div className="flex items-end gap-4 text-xs">
              <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={draft.is_fatal} onChange={(e) => set('is_fatal', e.target.checked)} /> The employee died</label>
              <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={draft.on_duty} onChange={(e) => set('on_duty', e.target.checked)} /> On duty at the time</label>
            </div>
            {text('occurred_at', 'When it happened', 0, 'datetime-local')}
            {text('employer_notified_on', 'When the employer was told', 0, 'date')}
            {text('place', 'Where (place, machine or vehicle)')}
            {text('witnesses', 'Witnesses (names, phone numbers)')}
            {text('what_happened', 'What happened', 3)}
          </div>
        </section>

        <section>
          <h3 className="m-0 mb-2 text-[13px] font-bold text-ink flex items-center gap-1.5"><HeartPulse className="w-4 h-4" /> The injury and treatment</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {text('injury_nature', 'Nature and extent of the injury', 2)}
            {text('body_parts', 'Part(s) of the body')}
            {text('first_aid', 'First aid given (by whom)')}
            {text('hospital', 'Hospital or clinic')}
            {text('doctor', 'Doctor')}
            {text('stopped_work_on', 'Stopped work on', 0, 'date')}
            {text('returned_to_work_on', 'Back at work on', 0, 'date')}
          </div>
          <p className="m-0 mt-2 text-[11px] text-muted-foreground">
            Days off for a work injury are paid under the Act, not taken from the employee&apos;s annual or sick leave. The leave
            system doesn&apos;t know about this case: if the days are recorded in Time Off, don&apos;t let them reduce the leave balance.
          </p>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 content-start">
            <h3 className="m-0 text-[13px] font-bold text-ink sm:col-span-2">For the estimate</h3>
            {text('monthly_earnings', 'Monthly earnings (incl. regular allowances)', 0, 'number')}
            {text('days_off', 'Days off work (blank: counted from the dates)', 0, 'number')}
            {text('incapacity_percent', 'Permanent incapacity % (from the doctor)', 0, 'number')}
            {text('medical_costs', 'Medical costs so far', 0, 'number')}
          </div>
          <Estimate draft={draft} country={country} currency={saved?.currency ?? null} />
        </section>

        <section>
          <h3 className="m-0 mb-2 text-[13px] font-bold text-ink">The claim</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="case-status" className={labelClass}>Status</label>
              <select id="case-status" className={inputClass} value={draft.status} onChange={(e) => set('status', e.target.value as WorkInjuryStatus)}>
                {STATUS_STEPS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            {text('authority_notified_on', `Reported to ${rules.authority} on`, 0, 'date')}
            {text('authority_reference', `${rules.authority} reference`)}
            {text('claim_lodged_on', 'Claim lodged on', 0, 'date')}
            {text('insurer_claim_number', 'Insurer claim number')}
            {text('assessed_amount', 'Amount assessed', 0, 'number')}
            {text('paid_amount', 'Amount paid', 0, 'number')}
            {text('notes', 'Notes', 2)}
          </div>
        </section>

        <section>
          <h3 className="m-0 mb-2 text-[13px] font-bold text-ink">Checklist</h3>
          <ul className="m-0 pl-5 space-y-1 text-xs text-ink">
            {rules.checklist.map((item) => (
              <li key={item.code}>{item.label}{item.citation && <span className="text-subtle"> ({item.citation}{item.verified ? '' : ', check this'})</span>}</li>
            ))}
          </ul>
          <p className="m-0 mt-2 text-[11px] font-semibold text-subtle">{GUIDE}</p>
        </section>

        {saved && <CaseFiles caseId={saved.id} />}

        <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-4">
          <div>
            {saved && (
              <Button variant="secondary" icon={<Download className="w-3.5 h-3.5" />} onClick={downloadReport}>
                Accident report (PDF)
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>Close</Button>
            <Button onClick={save} disabled={busy}>{busy ? 'Saving...' : draft.id ? 'Save' : 'Open case'}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------------------------------
/**
 * Work injuries (WIBA): accidents at work and occupational disease. HR opens a case from an incident report (or on its
 * own), follows the legal deadlines for the employee's country, keeps the files, estimates the compensation and prints
 * the employer's report. Same people as incident reports (the Incidents module).
 */
export default function WorkInjuries() {
  const [params, setParams] = useSearchParams();
  const [cases, setCases] = useState<WorkInjuryCase[]>([]);
  const [cover, setCover] = useState<WibaCover | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ draft: Draft; saved: WorkInjuryCase | null } | null>(null);

  const reload = useCallback(async () => {
    try {
      const [list, c] = await Promise.all([loadWorkInjuryCases(), loadWibaCover()]);
      setCases(list);
      setCover(c);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load the work injury cases.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  // opened from an incident report: ?incident=<id> (an existing case for it opens instead)
  const incidentId = params.get('incident');
  useEffect(() => {
    if (!incidentId || loading) return;
    const existing = cases.find((c) => c.incident_report_id === incidentId);
    setParams({}, { replace: true });
    if (existing) {
      setEditing({ draft: draftOf(existing), saved: existing });
      return;
    }
    loadIncident(incidentId).then((r) => {
      const draft = emptyDraft();
      if (r) {
        draft.incident_report_id = r.id;
        draft.employee_number = r.is_anonymous ? '' : r.employee_number || '';
        draft.kind = r.incident_type === 'occupational_disease' ? 'occupational_disease' : 'accident';
        if (r.incident_date) draft.occurred_at = `${r.incident_date.slice(0, 10)}T09:00`;
        draft.employer_notified_on = r.created_at.slice(0, 10);
        draft.place = r.location || '';
        draft.witnesses = r.witnesses || '';
        draft.what_happened = [r.title, r.description].filter(Boolean).join('\n\n');
      }
      setEditing({ draft, saved: null });
    });
  }, [incidentId, loading, cases, setParams]);

  const now = useMemo(() => new Date(), []);
  const open = cases.filter((c) => c.status !== 'closed' && c.status !== 'paid');
  const overdue = open.filter((c) => caseDeadlines(c, now).some((d) => d.state === 'overdue')).length;

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <FigbloomLoader label="Loading work injury cases" />
      </div>
    );
  }

  return (
    <div className="space-y-[18px]">
      <PageHeader
        title="Work injuries (WIBA)"
        subtitle="Accidents at work and occupational disease: report on time, keep the files, follow the claim."
        actions={<Button icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setEditing({ draft: emptyDraft(), saved: null })}>New case</Button>}
      />

      <CoverCard cover={cover} onSaved={reload} />

      {overdue > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-status-danger/30 bg-orange-tint-alt px-4 py-3 text-xs text-status-danger font-semibold" role="alert">
          <AlertTriangle className="w-4 h-4" /> {overdue === 1 ? 'One case has' : `${overdue} cases have`} an overdue report.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-[18px] items-start">
        <div>
          {cases.length === 0 ? (
            <Card>
              <EmptyState
                className="py-12"
                icon={<FileText size={20} />}
                title="No work injury cases"
                description="Open one from an incident report about an injury, or with New case."
              />
            </Card>
          ) : (
            <div className="flex flex-col gap-2.5">
              {cases.map((c) => {
                const next = nextDeadline(caseDeadlines(c, now));
                return (
                  <Card key={c.id} padding="none" className="!rounded-xl hover:border-brand/40 transition-colors">
                    <button type="button" className="w-full text-left p-4" onClick={() => setEditing({ draft: draftOf(c), saved: c })}
                      aria-label={`Open the case of ${c.employee_name || c.employee_number}`}>
                      <div className="flex items-center flex-wrap gap-2 mb-1.5">
                        <StatusPill label={statusLabel(c.status).toUpperCase()} tone={STATUS_TONE[c.status] || 'neutral'} />
                        {c.is_fatal && <StatusPill label="FATAL" tone="danger" />}
                        <span className="text-[11px] text-subtle">{c.kind === 'occupational_disease' ? 'Occupational disease' : 'Accident'} &middot; {c.country || 'Kenya'}</span>
                      </div>
                      <div className="text-[13px] font-bold text-ink">{c.employee_name || c.employee_number}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {new Date(c.occurred_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        {c.place ? ` · ${c.place}` : ''}
                      </div>
                      {next && <div className={`mt-1.5 text-xs ${DEADLINE_CLASS[next.state]}`}>{next.message}</div>}
                    </button>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
        <HowItWorks />
      </div>

      {editing && (
        <CaseEditor
          key={editing.saved?.id ?? 'new'}
          initial={editing.draft}
          saved={editing.saved}
          cover={cover}
          onClose={() => setEditing(null)}
          onSaved={(c) => {
            setEditing({ draft: draftOf(c), saved: c });
            setCases((list) => [c, ...list.filter((x) => x.id !== c.id)].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)));
          }}
        />
      )}
    </div>
  );
}
