import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Card, PageHeader } from '../UI';
import { usePermissions } from '../../hooks/usePermissions';
import { supabase } from '../../lib/supabase';
import { loadBranches, type Branch } from '../../lib/branches';
import { letterheadFileError, loadCompanyIdentity, uploadLetterheadImage, type CompanyIdentity } from '../../lib/companyProfile';
import {
  DEFAULT_DESIGN,
  designError,
  loadBranchContacts,
  loadPayslipDesign,
  payslipEmployer,
  saveBranchContacts,
  savePayslipDesign,
  type BranchContacts,
  type EmployerProfile,
  type LetterheadMode,
  type PayslipDesign,
} from '../../lib/payslipDesign';
import { clearPayslipExtrasCache, loadPayslipExtras, payslipCountry, type PayslipExtras } from '../../lib/payslipExtras';
import { PayslipDocument } from './PayslipDocument';

// Payslip design (FIG-814): how the company's payslips look, for everyone with the payslip-design module. The
// letterhead (the logo and name, the letterhead uploaded for offer letters, or one uploaded for payslips), the address
// and contacts (each branch may have its own), the footer, a heading colour, and which optional sections show. The
// preview is a real recent payslip (or a sample when there is none), drawn by the same PayslipDocument the admin
// screen, the staff portal and both PDFs use. Staff never edit payslips; they only see the result.

/* eslint-disable @typescript-eslint/no-explicit-any -- payslip rows are untyped */

/** A payslip to preview when the company has none yet. */
export const SAMPLE_PAYSLIP: Record<string, any> = {
  employee_id: 'EMP-0001', employee_name: 'Jane Wanjiku (sample)', position: 'Accountant', department: 'Finance', jobGroup: 'G5', branch: 'Head office',
  pay_period: new Date().toISOString().slice(0, 7), country: 'Kenya', currency: 'KES', payment_method: 'Bank Transfer', bank_name: 'Sample Bank', account_number: '0123456789',
  basic_salary: 80000, house_allowance: 10000, transport_allowance: 5000, medical_allowance: 0, other_allowances: 0, per_diem: 0,
  gross_pay: 95000, paye_tax: 17633.25, nssf_deduction: 4320, nhif_deduction: 2612.5, housing_levy: 1425, tax_relief: 2400, nita_levy: 50,
  total_deductions: 25990.75, net_pay: 69009.25, taxable_pay: 86642.5,
  tax_details: {
    not_taxed: [], taxable_benefits: [], tax_before_reliefs: 20033.25,
    before_tax: [{ key: 'nssf', label: 'NSSF', amount: 4320 }, { key: 'shif', label: 'SHIF', amount: 2612.5 }, { key: 'ahl', label: 'Housing levy (AHL)', amount: 1425 }],
    reliefs: [{ key: 'personal', label: 'Personal relief', amount: 2400 }],
  },
};

const inputClass =
  'w-full rounded-tile border border-border bg-white px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-brand disabled:bg-secondary';

const LETTERHEADS: { value: LetterheadMode; label: string; hint: string }[] = [
  { value: 'logo', label: 'Logo and company name', hint: 'From Settings > Company profile' },
  { value: 'company', label: 'The company letterhead', hint: 'The letterhead uploaded for offer letters (Company profile)' },
  { value: 'own', label: 'A letterhead for payslips', hint: 'Upload a PNG or JPG, the width of an A4 page' },
];

const SECTIONS: { key: keyof PayslipDesign; label: string; hint?: string }[] = [
  { key: 'show_employer_contributions', label: 'Employer contributions', hint: 'NSSF, housing levy, NITA, SDL, WCF paid on top of pay' },
  { key: 'show_ytd', label: 'Year to date', hint: 'Totals for the tax year' },
  { key: 'show_bank_details', label: 'Bank and M-Pesa details' },
  { key: 'show_leave_balance', label: 'Leave balance', hint: 'Shown once the payslip carries leave balances' },
];

export function PayslipDesignForm({
  design,
  onChange,
  canEdit,
  countries,
  onUpload,
  uploading,
}: {
  design: PayslipDesign;
  onChange: (d: PayslipDesign) => void;
  canEdit: boolean;
  countries: string[];
  onUpload: (file: File) => void;
  uploading: boolean;
}) {
  const set = <K extends keyof PayslipDesign>(k: K, v: PayslipDesign[K]) => onChange({ ...design, [k]: v });
  return (
    <div className="space-y-4 text-xs">
      <fieldset disabled={!canEdit} className="space-y-1.5">
        <legend className="font-bold text-ink mb-1">Letterhead</legend>
        {LETTERHEADS.map((l) => (
          <label key={l.value} className="flex items-start gap-2">
            <input type="radio" name="letterhead" className="mt-0.5" checked={design.letterhead === l.value} onChange={() => set('letterhead', l.value)} />
            <span>
              <span className="font-semibold text-ink">{l.label}</span>
              <span className="block text-[11px] text-muted-foreground">{l.hint}</span>
            </span>
          </label>
        ))}
        {design.letterhead === 'own' && (
          <div className="pl-6 space-y-1">
            {design.letterhead_url && <img src={design.letterhead_url} alt="Payslip letterhead" className="max-h-16 border border-border" />}
            <input
              type="file"
              accept="image/png,image/jpeg"
              aria-label="Upload a payslip letterhead"
              disabled={!canEdit || uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUpload(f);
                e.target.value = '';
              }}
            />
          </div>
        )}
      </fieldset>

      <fieldset disabled={!canEdit} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <legend className="font-bold text-ink mb-1 col-span-full">Address and contacts</legend>
        <p className="col-span-full text-[11px] text-muted-foreground">Blank uses the company profile. A branch can have its own, below.</p>
        <label className="col-span-full">
          <span className="block font-semibold mb-0.5">Address</span>
          <textarea className={inputClass} rows={2} maxLength={300} value={design.address ?? ''} onChange={(e) => set('address', e.target.value || null)} />
        </label>
        <label>
          <span className="block font-semibold mb-0.5">Phone</span>
          <input className={inputClass} maxLength={50} value={design.phone ?? ''} onChange={(e) => set('phone', e.target.value || null)} />
        </label>
        <label>
          <span className="block font-semibold mb-0.5">Email</span>
          <input className={inputClass} type="email" maxLength={200} value={design.email ?? ''} onChange={(e) => set('email', e.target.value || null)} />
        </label>
        <label className="col-span-full">
          <span className="block font-semibold mb-0.5">Website</span>
          <input className={inputClass} maxLength={200} value={design.website ?? ''} onChange={(e) => set('website', e.target.value || null)} />
        </label>
      </fieldset>

      <fieldset disabled={!canEdit} className="space-y-2">
        <legend className="font-bold text-ink mb-1">Employer tax numbers</legend>
        {countries.map((c) => (
          <label key={c} className="block">
            <span className="block font-semibold mb-0.5">{c} ({c === 'Kenya' ? 'KRA PIN' : 'TIN'})</span>
            <input
              className={inputClass}
              maxLength={30}
              placeholder={c === 'Kenya' ? 'Blank: the employer KRA PIN in Payroll settings' : ''}
              value={design.employer_tax_numbers[c] ?? ''}
              onChange={(e) => set('employer_tax_numbers', { ...design.employer_tax_numbers, [c]: e.target.value })}
            />
          </label>
        ))}
      </fieldset>

      <fieldset disabled={!canEdit} className="space-y-2">
        <legend className="font-bold text-ink mb-1">Footer and colour</legend>
        <label className="block">
          <span className="block font-semibold mb-0.5">Footer text</span>
          <textarea
            className={inputClass}
            rows={2}
            maxLength={500}
            placeholder="This payslip is confidential. Payroll queries: payroll@company.com"
            value={design.footer_text ?? ''}
            onChange={(e) => set('footer_text', e.target.value || null)}
          />
        </label>
        <label className="flex items-center gap-2">
          <span className="font-semibold">Heading colour</span>
          <input type="color" aria-label="Heading colour" value={design.brand_color ?? '#111827'} onChange={(e) => set('brand_color', e.target.value)} />
          {design.brand_color && (
            <button type="button" className="text-[11px] underline text-muted-foreground" onClick={() => set('brand_color', null)}>
              Use black
            </button>
          )}
        </label>
      </fieldset>

      <fieldset disabled={!canEdit} className="space-y-1.5">
        <legend className="font-bold text-ink mb-1">Sections</legend>
        <p className="text-[11px] text-muted-foreground">Statutory deductions and net pay always show.</p>
        {SECTIONS.map((s) => (
          <label key={s.key} className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={Boolean(design[s.key])} onChange={(e) => set(s.key, e.target.checked as never)} aria-label={s.label} />
            <span>
              <span className="font-semibold text-ink">{s.label}</span>
              {s.hint && <span className="block text-[11px] text-muted-foreground">{s.hint}</span>}
            </span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}

function BranchContactsEditor({ branches, contacts, canEdit, onSaved }: { branches: Branch[]; contacts: BranchContacts[]; canEdit: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState<BranchContacts | null>(null);
  const [busy, setBusy] = useState(false);
  if (branches.length === 0) return null;
  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await saveBranchContacts(editing);
      toast.success('Saved the branch contacts.');
      setEditing(null);
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <h2 className="text-sm font-bold text-ink">Branch addresses and contacts</h2>
      <p className="text-[11.5px] text-muted-foreground mb-2">A branch’s own details go on its staff’s payslips. Blank: the branch address, else the company’s.</p>
      <div className="divide-y divide-border text-xs">
        {branches.map((b) => {
          const c = contacts.find((x) => x.branch_id === b.id);
          const open = editing?.branch_id === b.id;
          return (
            <div key={b.id} className="py-2" data-testid={`branch-contacts-${b.name}`}>
              <div className="flex items-center justify-between gap-2">
                <span>
                  <span className="font-semibold text-ink">{b.name}</span> <span className="text-muted-foreground">{b.country}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {c ? [c.address, c.phone, c.email, c.website].filter(Boolean).join(' · ') : 'Uses the company’s'}
                  </span>
                </span>
                {canEdit && !open && (
                  <Button variant="secondary" onClick={() => setEditing(c ?? { branch_id: b.id, address: null, phone: null, email: null, website: null })}>
                    Edit
                  </Button>
                )}
              </div>
              {open && editing && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                  {(['address', 'phone', 'email', 'website'] as const).map((k) => (
                    <label key={k} className={k === 'address' ? 'col-span-full' : ''}>
                      <span className="block font-semibold mb-0.5 capitalize">{k}</span>
                      <input className={inputClass} aria-label={`${b.name} ${k}`} value={editing[k] ?? ''} onChange={(e) => setEditing({ ...editing, [k]: e.target.value || null })} />
                    </label>
                  ))}
                  <div className="col-span-full flex gap-2">
                    <Button onClick={() => void save()} disabled={busy}>Save</Button>
                    <Button variant="secondary" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** The most recent payslip the person can read, to preview the design on. */
async function loadRecentPayslip(): Promise<Record<string, any> | null> {
  const { data, error } = await supabase.from('salary_history').select('*').order('pay_period', { ascending: false }).limit(1).maybeSingle();
  return error ? null : (data as Record<string, any> | null);
}

export default function PayslipDesignPage() {
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  const canEdit = !permissionsLoading && hasPermission('payslip-design');
  const [saved, setSaved] = useState<PayslipDesign | null>(null);
  const [design, setDesign] = useState<PayslipDesign>(DEFAULT_DESIGN);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [contacts, setContacts] = useState<BranchContacts[]>([]);
  const [identity, setIdentity] = useState<CompanyIdentity | null>(null);
  const [profile, setProfile] = useState<EmployerProfile | null>(null);
  const [preview, setPreview] = useState<Record<string, any> | null>(null);
  const [extras, setExtras] = useState<PayslipExtras | null>(null);
  const [kraPin, setKraPin] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [d, bs, cs, id, prof, recent] = await Promise.all([
        loadPayslipDesign(),
        loadBranches().catch(() => [] as Branch[]),
        loadBranchContacts(),
        loadCompanyIdentity().catch(() => null),
        Promise.resolve(supabase.from('company_profile').select('*').maybeSingle()).then((r) => (r.error ? null : (r.data as EmployerProfile | null))).catch(() => null),
        loadRecentPayslip().catch(() => null),
      ]);
      void Promise.resolve(supabase.rpc('company_tax_details'))
        .then((r) => {
          const row = (Array.isArray(r.data) ? r.data[0] : r.data) as { employer_kra_pin?: string | null } | undefined;
          if (live && !r.error) setKraPin(row?.employer_kra_pin ?? null);
        })
        .catch(() => undefined);
      if (!live) return;
      setSaved(d);
      setDesign(d);
      setBranches(bs);
      setContacts(cs);
      setIdentity(id);
      setProfile(prof);
      const record = recent ?? SAMPLE_PAYSLIP;
      setPreview(record);
      if (recent) loadPayslipExtras(recent, id).then((e) => live && setExtras(e)).catch(() => undefined);
    })();
    return () => {
      live = false;
    };
  }, []);

  const countries = useMemo(() => {
    const cs = [...new Set(branches.filter((b) => b.active).map((b) => b.country))];
    return cs.length ? cs : ['Kenya'];
  }, [branches]);

  // the preview follows the form as it is typed: the employer block worked out from the unsaved design
  const previewRecord = preview ?? SAMPLE_PAYSLIP;
  const previewExtras: PayslipExtras = useMemo(() => {
    const country = payslipCountry(previewRecord);
    const employer = payslipEmployer({
      design,
      profile,
      identity,
      branch: null,
      branchContacts: null,
      country,
      employerKraPin: kraPin,
    });
    return { ...(extras ?? {}), design, employer: { ...employer, address: employer.address ?? extras?.employer?.address ?? null } };
  }, [design, profile, identity, extras, previewRecord, kraPin]);

  const dirty = saved !== null && JSON.stringify(saved) !== JSON.stringify(design);
  const problem = designError(design);

  const save = async () => {
    setBusy(true);
    try {
      const next = await savePayslipDesign(design);
      setSaved(next);
      setDesign(next);
      clearPayslipExtrasCache();
      toast.success('Saved the payslip design.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    const err = letterheadFileError(file);
    if (err) {
      toast.error(err);
      return;
    }
    setUploading(true);
    try {
      const url = await uploadLetterheadImage(file);
      setDesign((d) => ({ ...d, letterhead: 'own', letterhead_url: url }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Payslip design"
        subtitle="How payslips look on screen, in the staff portal, and in downloaded and emailed PDFs"
        actions={
          canEdit && (
            <>
              {dirty && <Button variant="secondary" onClick={() => saved && setDesign(saved)} disabled={busy}>Undo changes</Button>}
              <Button onClick={() => void save()} disabled={busy || !dirty || !!problem}>Save design</Button>
            </>
          )
        }
      />
      {!canEdit && !permissionsLoading && (
        <p className="text-xs text-muted-foreground mb-3">You can see the payslip design; changing it needs the Payslip design module.</p>
      )}
      {problem && dirty && <p className="text-xs text-status-danger mb-3" role="alert">{problem}</p>}
      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 items-start">
        <div className="space-y-4">
          <Card>
            <PayslipDesignForm design={design} onChange={setDesign} canEdit={canEdit} countries={countries} onUpload={(f) => void upload(f)} uploading={uploading} />
          </Card>
          <BranchContactsEditor branches={branches.filter((b) => b.active)} contacts={contacts} canEdit={canEdit} onSaved={() => void loadBranchContacts().then(setContacts).then(clearPayslipExtrasCache)} />
        </div>
        <div className="min-w-0" data-testid="payslip-design-preview">
          <div className="text-[11px] text-muted-foreground mb-1">
            Preview: {preview && preview !== SAMPLE_PAYSLIP ? `${preview.employee_name}’s payslip for ${preview.pay_period}` : 'a sample payslip (no payslips yet)'}
          </div>
          <div className="bg-gray-50 p-2 rounded-tile border border-border overflow-x-auto">
            <PayslipDocument record={previewRecord} companyInfo={identity} extras={previewExtras} design={design} />
          </div>
        </div>
      </div>
    </div>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */
