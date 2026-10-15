import { ReactNode, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Building2, ChevronRight, ImagePlus, RotateCcw, Trash2 } from 'lucide-react';
import { Card, Button, PageHeader } from '../UI';
import FigbloomLoader from '../UI/FigbloomLoader';
import { usePermissions } from '../../hooks/usePermissions';
import { COMPANY_PROFILE_SAVED } from '../Dashboard/GetStarted';
import { saveEmployerPin } from '../../lib/p9';
import {
  BUSINESS_TYPES,
  COUNTRIES,
  CURRENCIES,
  CompanyProfileFields,
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SECONDARY_COLOR,
  HEX_PATTERN,
  INDUSTRIES,
  LETTERHEAD_TYPES,
  MONTHS,
  WEEK_DAYS,
  loadCompanyAdmin,
  loadCompanyProfile,
  loadEmployerPinForProfile,
  letterheadFileError,
  logoFileError,
  profileErrors,
  saveCompanyProfile,
  uploadCompanyLogo,
  uploadLetterheadImage,
} from '../../lib/companyProfile';

const inputClass =
  'w-full rounded-tile border border-border bg-white px-3 py-2 text-[12.5px] text-ink outline-none focus:border-brand disabled:bg-secondary disabled:text-muted-foreground';
const KRA_PIN = /^[AP]\d{9}[A-Z]$/;

const EMPTY: CompanyProfileFields = {
  company_name: '', tagline: null, logo_url: null, primary_color: null, secondary_color: null, description: null,
  registration_no: null, business_type: null, industry: null, country: 'Kenya', base_currency: 'KES',
  official_phone: null, official_email: null, website: null, address_line1: null, address_line2: null, city: null,
  postal_code: null, fiscal_year_start_month: 1, week_start_day: 'monday', letterhead_header_url: null, letterhead_footer_url: null,
};

const fieldsOf = (p: CompanyProfileFields & { tenant_id?: string }): CompanyProfileFields => {
  const { tenant_id: _key, ...rest } = p;
  void _key;
  const out = { ...EMPTY };
  for (const k of Object.keys(EMPTY) as (keyof CompanyProfileFields)[]) {
    if (rest[k] !== undefined) (out as Record<string, unknown>)[k] = rest[k];
  }
  return out;
};

function Field({ label, hint, error, children, className = '', group = false }: {
  label: string; hint?: string; error?: string; children: ReactNode; className?: string;
  /** several controls (each names itself): a div, so a tap on the label doesn't land on the first one */
  group?: boolean;
}) {
  const Tag = group ? 'div' : 'label';
  return (
    <Tag className={`block min-w-0 ${className}`}>
      <span className="block text-[12px] font-semibold text-ink mb-1">{label}</span>
      {children}
      {error ? (
        <span className="block mt-1 text-[11px] text-red-600" role="alert">{error}</span>
      ) : hint ? (
        <span className="block mt-1 text-[11px] text-muted-foreground">{hint}</span>
      ) : null}
    </Tag>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <Card>
      <h2 className="m-0 text-[14px] font-bold text-ink">{title}</h2>
      <p className="mt-0.5 mb-3.5 text-[12px] text-muted-foreground">{hint}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
    </Card>
  );
}

function ColorField({ label, hint, value, fallback, error, disabled, onChange }: {
  label: string; hint: string; value: string | null; fallback: string; error?: string; disabled: boolean; onChange: (v: string | null) => void;
}) {
  const shown = value ?? fallback;
  return (
    <Field label={label} hint={hint} error={error} group>
      <span className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={HEX_PATTERN.test(shown) ? shown : fallback}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-9 w-11 shrink-0 cursor-pointer rounded-tile border border-border bg-white p-0.5 disabled:cursor-not-allowed"
        />
        <input className={`${inputClass} font-mono`} aria-label={`${label} hex`} value={shown} disabled={disabled} maxLength={7} onChange={(e) => onChange(e.target.value)} />
        <Button variant="ghost" disabled={disabled || value === null} onClick={() => onChange(null)} icon={<RotateCcw className="w-3 h-3" />} className="shrink-0">
          Reset to default
        </Button>
      </span>
    </Field>
  );
}

/** A letterhead image picked but not saved yet: the file and its preview (an object URL). */
interface PickedImage {
  file: File;
  preview: string;
}

/** One letterhead image (header or footer): a wide preview, Upload/Change and Remove. */
function LetterheadImage({ label, hint, url, picked, error, disabled, onPick, onRemove }: {
  label: string; hint: string; url: string | null; picked: PickedImage | null; error: string; disabled: boolean;
  onPick: (file: File | undefined) => void; onRemove: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const shown = picked?.preview ?? url;
  return (
    <div className="sm:col-span-2 min-w-0">
      <span className="block text-[12px] font-semibold text-ink mb-1">{label}</span>
      <div className="w-full min-h-[64px] rounded-card border border-border bg-secondary flex items-center justify-center overflow-hidden">
        {shown ? (
          <img src={shown} alt={`${label} preview`} className="block w-full h-auto" />
        ) : (
          <span className="text-[11.5px] text-subtle">No image: offer letters use the generated letterhead</span>
        )}
      </div>
      <input
        ref={ref}
        type="file"
        accept={LETTERHEAD_TYPES.join(',')}
        className="hidden"
        aria-label={`${label} file`}
        onChange={(e) => {
          onPick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {!disabled && (
        <span className="mt-2 flex flex-wrap items-center gap-2">
          <Button variant="secondary" icon={<ImagePlus className="w-3.5 h-3.5" />} onClick={() => ref.current?.click()}>
            {shown ? `Change ${label.toLowerCase()}` : `Upload ${label.toLowerCase()}`}
          </Button>
          {shown && (
            <Button variant="ghost" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={onRemove}>
              Remove {label.toLowerCase()}
            </Button>
          )}
        </span>
      )}
      <p className={`mt-1 mb-0 text-[11px] ${error ? 'text-red-600' : 'text-muted-foreground'}`} role={error ? 'alert' : undefined}>
        {error || hint}
      </p>
    </div>
  );
}

/**
 * Settings > Company profile: the company's brand, business details, contact details, address and calendar.
 * Everyone in the company can open it; ADMIN and people with Settings change it. The employer KRA PIN is payroll's
 * (company_payroll_settings): shown here, and changed here only by people with Payroll.
 */
export default function CompanyProfilePage() {
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  const canEdit = !permissionsLoading && hasPermission('settings');
  const canEditPin = !permissionsLoading && hasPermission('payroll');

  const [saved, setSaved] = useState<CompanyProfileFields | null>(null);
  const [form, setForm] = useState<CompanyProfileFields>(EMPTY);
  const [loadError, setLoadError] = useState('');
  const [admin, setAdmin] = useState<{ full_name: string; email: string } | null>(null);
  const [pin, setPin] = useState('');
  const [savedPin, setSavedPin] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoError, setLogoError] = useState('');
  const [header, setHeader] = useState<PickedImage | null>(null);
  const [footer, setFooter] = useState<PickedImage | null>(null);
  const [headerError, setHeaderError] = useState('');
  const [footerError, setFooterError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    loadCompanyProfile()
      .then((p) => {
        if (!live) return;
        const f = p ? fieldsOf(p) : EMPTY;
        setSaved(f);
        setForm(f);
      })
      .catch((e: Error) => live && setLoadError(e.message));
    loadCompanyAdmin().then((a) => live && setAdmin(a));
    loadEmployerPinForProfile().then((p) => {
      if (!live) return;
      setPin(p);
      setSavedPin(p);
    });
    return () => {
      live = false;
    };
  }, []);

  // the preview's object URL goes when it is replaced or the page closes
  useEffect(() => () => {
    if (logoPreview) URL.revokeObjectURL(logoPreview);
  }, [logoPreview]);
  useEffect(() => () => {
    if (header) URL.revokeObjectURL(header.preview);
  }, [header]);
  useEffect(() => () => {
    if (footer) URL.revokeObjectURL(footer.preview);
  }, [footer]);

  if (loadError) {
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="Company profile" />
        <Card><p className="m-0 text-[12.5px] text-red-600" role="alert">{loadError}</p></Card>
      </div>
    );
  }
  if (!saved) {
    return (
      <div className="p-4 sm:p-6">
        <Card className="flex items-center justify-center !p-8"><FigbloomLoader label="Loading company profile" /></Card>
      </div>
    );
  }

  const set = <K extends keyof CompanyProfileFields>(k: K, v: CompanyProfileFields[K]) => setForm((f) => ({ ...f, [k]: v }));
  const text = (k: keyof CompanyProfileFields) => ({
    value: (form[k] as string | null) ?? '',
    disabled: !canEdit,
    onChange: (e: { target: { value: string } }) => set(k, e.target.value as never),
  });

  const errors = profileErrors(form);
  const cleanPin = pin.replace(/\s/g, '').toUpperCase();
  const pinChanged = canEditPin && cleanPin !== savedPin;
  const pinError = pinChanged && cleanPin && !KRA_PIN.test(cleanPin) ? 'A KRA PIN is a letter, 9 digits and a letter, like P051234567X' : undefined;
  const changed = JSON.stringify(form) !== JSON.stringify(saved) || !!logoFile || !!header || !!footer || pinChanged;
  const invalid = Object.keys(errors).length > 0 || !!pinError || !!logoError || !!headerError || !!footerError;

  const pickLogo = (file: File | undefined) => {
    if (!file) return;
    const problem = logoFileError(file);
    setLogoError(problem ?? '');
    if (problem) return;
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  };

  const pickLetterhead = (file: File | undefined, setPicked: (p: PickedImage | null) => void, setError: (e: string) => void) => {
    if (!file) return;
    const problem = letterheadFileError(file);
    setError(problem ?? '');
    if (problem) return;
    setPicked({ file, preview: URL.createObjectURL(file) });
  };

  const save = async () => {
    setBusy(true);
    try {
      let fields = form;
      if (logoFile) fields = { ...fields, logo_url: await uploadCompanyLogo(logoFile) };
      if (header) fields = { ...fields, letterhead_header_url: await uploadLetterheadImage(header.file) };
      if (footer) fields = { ...fields, letterhead_footer_url: await uploadLetterheadImage(footer.file) };
      if (pinChanged && cleanPin) setSavedPin(await saveEmployerPin(cleanPin));
      if (canEdit) {
        const p = fieldsOf(await saveCompanyProfile(fields));
        setSaved(p);
        setForm(p);
      }
      setLogoFile(null);
      setLogoPreview(null);
      setHeader(null);
      setFooter(null);
      window.dispatchEvent(new Event(COMPANY_PROFILE_SAVED)); // the top bar and the "Get started" checklist look again
      toast.success('Company profile saved');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const logo = logoPreview ?? form.logo_url;

  return (
    <div className="p-4 sm:p-6 max-w-5xl">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[11.5px] text-muted-foreground mb-2">
        <Link to="/settings" className="hover:text-brand">Settings</Link>
        <ChevronRight className="w-3 h-3" />
        <span>Company profile</span>
      </nav>
      <PageHeader
        title="Company profile"
        subtitle={canEdit ? 'Your organisation’s details, used across the app and on documents.' : 'Only an admin or someone with Settings can change these.'}
        actions={(canEdit || canEditPin) && (
          <>
            <Button variant="secondary" disabled={busy || !changed} onClick={() => { setForm(saved); setPin(savedPin); setLogoFile(null); setLogoPreview(null); setLogoError(''); setHeader(null); setFooter(null); setHeaderError(''); setFooterError(''); }}>
              Discard
            </Button>
            <Button onClick={() => void save()} disabled={busy || !changed || (canEdit && invalid) || (!canEdit && !!pinError)}>
              {busy ? 'Saving...' : 'Save changes'}
            </Button>
          </>
        )}
      />

      <div className="space-y-4">
        <Section title="Brand identity" hint="Shown in the top bar and on payslips and documents.">
          <div className="sm:col-span-2 flex flex-wrap items-center gap-4">
            <div className="w-20 h-20 shrink-0 rounded-card border border-border bg-secondary flex items-center justify-center overflow-hidden">
              {logo ? <img src={logo} alt="Company logo preview" className="w-full h-full object-contain" /> : <Building2 className="w-8 h-8 text-subtle" />}
            </div>
            <div className="min-w-0">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                className="hidden"
                aria-label="Logo file"
                onChange={(e) => pickLogo(e.target.files?.[0])}
              />
              {canEdit && (
                <Button variant="secondary" icon={<ImagePlus className="w-3.5 h-3.5" />} onClick={() => fileRef.current?.click()}>
                  {logo ? 'Change logo' : 'Upload logo'}
                </Button>
              )}
              <p className={`mt-1 mb-0 text-[11px] ${logoError ? 'text-red-600' : 'text-muted-foreground'}`} role={logoError ? 'alert' : undefined}>
                {logoError || 'PNG, JPG, SVG or WebP, up to 2 MB. A square image works best.'}
              </p>
            </div>
          </div>
          <Field label="Company name" error={errors.company_name}>
            <input className={inputClass} maxLength={120} {...text('company_name')} />
          </Field>
          <Field label="Tagline" hint="A short line under the name on payslips" error={errors.tagline}>
            <input className={inputClass} maxLength={120} {...text('tagline')} />
          </Field>
          <ColorField
            label="Primary colour" hint="Used on documents and templates" value={form.primary_color} fallback={DEFAULT_PRIMARY_COLOR}
            error={errors.primary_color} disabled={!canEdit} onChange={(v) => set('primary_color', v)}
          />
          <ColorField
            label="Secondary colour" hint="Documents and templates only" value={form.secondary_color} fallback={DEFAULT_SECONDARY_COLOR}
            error={errors.secondary_color} disabled={!canEdit} onChange={(v) => set('secondary_color', v)}
          />
          <Field label="Description" hint="What the company does, in a few lines" error={errors.description} className="sm:col-span-2">
            <textarea className={`${inputClass} min-h-[84px]`} maxLength={1000} {...text('description')} />
          </Field>
        </Section>

        <Section title="Offer letter letterhead" hint="Your own designed letterhead for offer letters. Without one, letters use a letterhead made from your logo, name, address and colours.">
          <LetterheadImage
            label="Header"
            hint="PNG or JPG, up to 2 MB. The full width of an A4 page works best, about 2480 × 400 px. It replaces the logo, name and address at the top."
            url={form.letterhead_header_url}
            picked={header}
            error={headerError}
            disabled={!canEdit}
            onPick={(f) => pickLetterhead(f, setHeader, setHeaderError)}
            onRemove={() => { setHeader(null); setHeaderError(''); set('letterhead_header_url', null); }}
          />
          <LetterheadImage
            label="Footer"
            hint="Optional. PNG or JPG, up to 2 MB, about 2480 × 250 px. Shown at the bottom of the letter."
            url={form.letterhead_footer_url}
            picked={footer}
            error={footerError}
            disabled={!canEdit}
            onPick={(f) => pickLetterhead(f, setFooter, setFooterError)}
            onRemove={() => { setFooter(null); setFooterError(''); set('letterhead_footer_url', null); }}
          />
        </Section>

        <Section title="Business details" hint="How the company is registered.">
          <Field label="Registration number" hint="From the business registration certificate">
            <input className={inputClass} maxLength={40} {...text('registration_no')} />
          </Field>
          <Field label="Employer KRA PIN" hint={canEditPin ? 'Shown on P9s; the same PIN payroll uses' : 'Kept by payroll; ask someone with Payroll to change it'} error={pinError}>
            <input className={`${inputClass} font-mono uppercase`} value={pin} disabled={!canEditPin} maxLength={11} placeholder="P051234567X" onChange={(e) => setPin(e.target.value)} />
          </Field>
          <Field label="Business type">
            <select className={inputClass} {...text('business_type')}>
              <option value="">Choose...</option>
              {BUSINESS_TYPES.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </Field>
          <Field label="Industry">
            <select className={inputClass} {...text('industry')}>
              <option value="">Choose...</option>
              {INDUSTRIES.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </Field>
          <Field label="Country" error={errors.country}>
            <select className={inputClass} {...text('country')}>
              {[...new Set([form.country, ...COUNTRIES])].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Base currency">
            <select className={inputClass} {...text('base_currency')}>
              {[...new Set([form.base_currency, ...CURRENCIES])].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </Section>

        <Section title="Contact information" hint="How people reach the company.">
          <Field label="Official phone" error={errors.official_phone}>
            <input className={inputClass} type="tel" inputMode="tel" placeholder="+254 712 345678" {...text('official_phone')} />
          </Field>
          <Field label="Official email" error={errors.official_email}>
            <input className={inputClass} type="email" placeholder="hello@company.co.ke" {...text('official_email')} />
          </Field>
          <Field label="Website" hint="https:// is added if you leave it out" error={errors.website} className="sm:col-span-2">
            <input className={inputClass} type="url" inputMode="url" placeholder="https://company.co.ke" {...text('website')} />
          </Field>
          <Field label="Admin name" hint="The person who created the company">
            <input className={inputClass} value={admin?.full_name ?? ''} disabled readOnly />
          </Field>
          <Field label="Admin email">
            <input className={inputClass} value={admin?.email ?? ''} disabled readOnly />
          </Field>
        </Section>

        <Section title="Physical address" hint="Where the company is based.">
          <Field label="Address line 1" className="sm:col-span-2">
            <input className={inputClass} maxLength={120} placeholder="Building, street" {...text('address_line1')} />
          </Field>
          <Field label="Address line 2" className="sm:col-span-2">
            <input className={inputClass} maxLength={120} placeholder="Floor, suite (optional)" {...text('address_line2')} />
          </Field>
          <Field label="City / town">
            <input className={inputClass} maxLength={60} {...text('city')} />
          </Field>
          <Field label="Postal code">
            <input className={inputClass} maxLength={20} {...text('postal_code')} />
          </Field>
        </Section>

        <Section title="Fiscal & calendar" hint="When the company’s year and week start.">
          <Field label="Fiscal year starts in">
            <select
              className={inputClass}
              value={form.fiscal_year_start_month}
              disabled={!canEdit}
              onChange={(e) => set('fiscal_year_start_month', Number(e.target.value))}
            >
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </Field>
          <Field label="Week starts on">
            <select className={inputClass} {...text('week_start_day')}>
              {WEEK_DAYS.map((d) => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
            </select>
          </Field>
        </Section>
      </div>
    </div>
  );
}
