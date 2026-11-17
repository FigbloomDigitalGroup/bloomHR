import { ReactNode, useMemo, useState } from 'react';
import { Loader2, Save, Send } from 'lucide-react';
import { Button, Modal } from '../UI';
import OfferLetter from './OfferLetter';
import MySignature from '../Signature/MySignature';
import LetterheadPicker from './LetterheadPicker';
import { formatKsh } from '../../lib/jobGroups';
import {
  OFFER_PLACEHOLDERS,
  type LetterBranding,
  type Offer,
  type OfferFields,
  type OfferJobGroup,
  type OfferTemplate,
  blankOffer,
  fillPlaceholders,
  offerErrors,
  offerValues,
  payFromOfferGroup,
  unknownPlaceholders,
} from '../../lib/offers';

import { confirmDialog } from '../../lib/confirmDialog';
// Writing an offer: the candidate, the job and its pay (a job group fills the pay from its current rate), the dates,
// and the letter (from a template, editable), with the letter previewed beside the form as the candidate will see it.

export const inputClass = 'w-full rounded-lg border border-border px-3 py-2 text-sm bg-white text-ink';

export function Field({ label, error, children, hint }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-ink mb-1">{label}</span>
      {children}
      {hint && !error && <span className="block text-[11px] text-muted-foreground mt-0.5">{hint}</span>}
      {error && <span className="block text-[11px] text-status-danger mt-0.5">{error}</span>}
    </label>
  );
}

interface OfferEditorProps {
  /** the draft being edited; null for a new offer */
  offer: Offer | null;
  /** a new offer's starting values (e.g. from a job application) */
  initial?: Partial<OfferFields>;
  templates: OfferTemplate[];
  groups: OfferJobGroup[];
  branding: LetterBranding;
  onClose: () => void;
  /** saved; `send` when HR chose Save and send */
  onSave: (fields: OfferFields, send: boolean) => Promise<void>;
  /** the sender's drawn signature, shown where the letter says {{signature}} and kept on the offer when it is sent */
  signature?: string | null;
  onSignature?: (signature: string | null) => void;
  /** the letterhead changed from this screen */
  onBranding?: (branding: LetterBranding) => void;
}

const amount = (v: string) => (v.trim() === '' ? 0 : Number(v));

export default function OfferEditor({ offer, initial, templates, groups, branding, onClose, onSave, signature, onSignature, onBranding }: OfferEditorProps) {
  const [fields, setFields] = useState<OfferFields>(() => {
    if (offer) {
      const {
        id: _id, status: _s, sent_at: _a, viewed_at: _v, responded_at: _r, decline_reason: _d, employee_id: _e, created_at: _c,
        signature: _sig, signed_by: _sb, candidate_signature: _cs, ...rest
      } = offer;
      return rest;
    }
    const template = templates.find((t) => t.is_default && t.active) ?? templates.find((t) => t.active) ?? null;
    return { ...blankOffer(template), ...initial };
  });
  const [busy, setBusy] = useState<'save' | 'send' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [tried, setTried] = useState<'save' | 'send' | null>(null);

  const set = <K extends keyof OfferFields>(key: K, value: OfferFields[K]) => setFields((f) => ({ ...f, [key]: value }));
  const group = groups.find((g) => g.id === fields.job_group_id);
  const groupPay = payFromOfferGroup(group, fields.basic_salary);
  const payLocked = Boolean(groupPay);
  const bandNote = group?.effective_from && group.basic_salary === null ? `Band ${formatKsh(group.basic_min)} – ${formatKsh(group.basic_max)}` : undefined;

  const chooseGroup = (id: string) => {
    const g = groups.find((x) => x.id === id);
    const pay = payFromOfferGroup(g, fields.basic_salary);
    setFields((f) => ({ ...f, job_group_id: id || null, ...(pay ?? {}) }));
  };

  const chooseTemplate = async (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    if (fields.body.trim() && fields.body !== templates.find((x) => x.id === fields.template_id)?.body
        && !(await confirmDialog({ title: 'Replace your letter?', message: 'The letter you have written is replaced with this template.', confirmLabel: 'Replace' }))) return;
    setFields((f) => ({ ...f, template_id: t.id, title: t.title, body: t.body }));
  };

  const errors = tried ? offerErrors(fields, tried === 'send') : {};
  const unknown = unknownPlaceholders(`${fields.title}\n${fields.body}`);
  const text = useMemo(
    () => fillPlaceholders(fields.body, offerValues(fields, { companyName: branding.name, jobGroup: group?.name ?? null })),
    [fields, branding.name, group?.name]
  );
  const title = fillPlaceholders(fields.title, offerValues(fields, { companyName: branding.name, jobGroup: group?.name ?? null }));

  const save = async (send: boolean) => {
    setTried(send ? 'send' : 'save');
    setProblem(null);
    if (Object.keys(offerErrors(fields, send)).length > 0) {
      setProblem('Fix the fields marked below.');
      return;
    }
    setBusy(send ? 'send' : 'save');
    try {
      await onSave(payLocked && groupPay ? { ...fields, ...groupPay } : fields, send);
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open onClose={onClose} title={offer ? 'Edit offer' : 'New offer'} size="7xl" closeOnBackdrop={false}
      className="bg-white rounded-2xl shadow-xl p-4 sm:p-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] mt-2">
        <div className="space-y-4 min-w-0">
          <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Candidate</legend>
            <Field label="First name" error={errors.candidate_first_name}>
              <input className={inputClass} value={fields.candidate_first_name} onChange={(e) => set('candidate_first_name', e.target.value)} />
            </Field>
            <Field label="Last name">
              <input className={inputClass} value={fields.candidate_last_name ?? ''} onChange={(e) => set('candidate_last_name', e.target.value)} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Email (the offer is sent here)" error={errors.candidate_email}>
                <input type="email" className={inputClass} value={fields.candidate_email ?? ''} onChange={(e) => set('candidate_email', e.target.value)} />
              </Field>
            </div>
          </fieldset>

          <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Job and pay (monthly)</legend>
            <div className="sm:col-span-2">
              <Field label="Job title" error={errors.job_title}>
                <input className={inputClass} value={fields.job_title} onChange={(e) => set('job_title', e.target.value)} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Job group" hint={groups.length === 0 ? 'No job groups set up: type the pay below' : payLocked ? 'The pay comes from the group’s current rate' : group ? 'This group has no amounts yet: type the pay' : undefined}>
                <select className={inputClass} value={fields.job_group_id ?? ''} onChange={(e) => chooseGroup(e.target.value)} aria-label="Job group">
                  <option value="">No job group</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.code === g.name ? g.code : `${g.code} · ${g.name}`}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Basic salary (KSh)" error={errors.basic_salary} hint={bandNote}>
              <input type="number" min={0} className={inputClass} value={fields.basic_salary} aria-label="Basic salary"
                disabled={payLocked && group?.basic_salary !== null}
                onChange={(e) => set('basic_salary', amount(e.target.value))} />
            </Field>
            <Field label="House allowance (KSh)" error={errors.house_allowance}>
              <input type="number" min={0} className={inputClass} value={fields.house_allowance} disabled={payLocked}
                onChange={(e) => set('house_allowance', amount(e.target.value))} />
            </Field>
            <Field label="Travel allowance (KSh)" error={errors.travel_allowance}>
              <input type="number" min={0} className={inputClass} value={fields.travel_allowance} disabled={payLocked}
                onChange={(e) => set('travel_allowance', amount(e.target.value))} />
            </Field>
            <Field label="Other allowances (KSh)" error={errors.other_allowances}>
              <input type="number" min={0} className={inputClass} value={fields.other_allowances} disabled={payLocked}
                onChange={(e) => set('other_allowances', amount(e.target.value))} />
            </Field>
            <Field label="Start date" error={errors.start_date}>
              <input type="date" className={inputClass} value={fields.start_date ?? ''} onChange={(e) => set('start_date', e.target.value || null)} />
            </Field>
            <Field label="Reply by" error={errors.expiry_date}>
              <input type="date" className={inputClass} value={fields.expiry_date ?? ''} onChange={(e) => set('expiry_date', e.target.value || null)} />
            </Field>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Letter</legend>
            {templates.length > 0 && (
              <Field label="Template">
                <select className={inputClass} value={fields.template_id ?? ''} onChange={(e) => chooseTemplate(e.target.value)} aria-label="Template">
                  {!fields.template_id && <option value="">Choose a template</option>}
                  {templates.filter((t) => t.active || t.id === fields.template_id).map((t) => (
                    <option key={t.id} value={t.id}>{t.title}{t.is_default ? ' (default)' : ''}</option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Title" error={errors.title}>
              <input className={inputClass} value={fields.title} onChange={(e) => set('title', e.target.value)} />
            </Field>
            <Field label="Text" error={errors.body}>
              <textarea className={`${inputClass} font-mono text-[12.5px]`} rows={12} value={fields.body} aria-label="Letter text"
                onChange={(e) => set('body', e.target.value)} />
            </Field>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Placeholders you can use</summary>
              <ul className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-3">
                {OFFER_PLACEHOLDERS.map((p) => (
                  <li key={p.key}><code>{`{{${p.key}}}`}</code> {p.label}</li>
                ))}
              </ul>
            </details>
            {unknown.length > 0 && (
              <p className="text-xs text-orange-text-alt">Not a known placeholder: {unknown.map((k) => `{{${k}}}`).join(', ')}</p>
            )}
            {onSignature && (
              <div>
                <p className="text-xs font-medium text-ink mb-1">Your signature</p>
                <MySignature bare onChange={onSignature} />
                {!/\{\{\s*signature\s*\}\}/i.test(fields.body) && (
                  <p className="mt-1 mb-0 text-[11px] text-subtle">Add a {'{{signature}}'} line to the text to sign the letter.</p>
                )}
              </div>
            )}
            {onBranding && <LetterheadPicker branding={branding} onChange={onBranding} />}
          </fieldset>
        </div>

        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Preview</p>
          <div className="bg-secondary rounded-xl p-2 sm:p-4 overflow-x-auto">
            <OfferLetter branding={branding} title={title} text={text} signature={signature} />
          </div>
        </div>
      </div>

      <div className="mt-5 pt-4 border-t border-border flex flex-wrap items-center justify-end gap-2">
        {problem && <p role="alert" className="text-sm text-status-danger mr-auto">{problem}</p>}
        <Button variant="ghost" onClick={onClose} disabled={busy !== null}>Cancel</Button>
        <Button variant="secondary" disabled={busy !== null} onClick={() => void save(false)}
          icon={busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}>
          Save draft
        </Button>
        <Button disabled={busy !== null} onClick={() => void save(true)}
          icon={busy === 'send' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}>
          Save and send
        </Button>
      </div>
    </Modal>
  );
}
