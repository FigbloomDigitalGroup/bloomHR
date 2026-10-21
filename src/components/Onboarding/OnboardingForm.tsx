import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle2, CloudOff, Loader2, Send, UploadCloud, User } from 'lucide-react';
import { Button, Card, StatusPill } from '../UI';
import { AmountField, Section, SelectField, TextField, YesNoField } from './Fields';
import DocumentsSection from './DocumentsSection';
import RefereesSection from './RefereesSection';
import HealthSection from './HealthSection';
import AgreementsSection from './AgreementsSection';
import BankBranchFields from './BankBranchFields';
import StillToProvide from './StillToProvide';
import {
  type Contact,
  type OnboardingRecord,
  emptyContact,
  errorMessage,
  loadMyOnboarding,
  saveMyOnboarding,
  statusLabel,
  statusTone,
  submitMyOnboarding,
} from '../../lib/onboarding';
import { IDENTITY_TYPES, RESIDENCY_OPTIONS, fieldProblem, needsShaNumber, taxNumberLabel, taxNumberPlaceholder } from '../../lib/onboardingValidation';
import type { EmployeeRecord } from '../../lib/profileCompleteness';
import { uploadEmployeeAvatar } from '../../lib/avatarStorage';
import { supabase } from '../../lib/supabase';
import FigbloomLoader from '../UI/FigbloomLoader';
import { useAutosave } from '../../hooks/useAutosave';
import { useFormDraft } from '../../hooks/useFormDraft';

// The employee's part of onboarding (staff portal): personal, identity and statutory, tax claims, bank, emergency
// contact and next of kin. They save as they go and submit to HR once the company's essentials are in; the rest
// (documents, referees, policies...) can follow after approval without sending the record back (20261021700000).
//
// Until HR approves, it saves itself a moment after they stop typing (a number not complete yet waits until it is).
// Once approved, a change goes back to HR for review, so they save it themselves. Either way what is typed is kept in
// the tab (useFormDraft), so a refresh doesn't lose it.

const SEXES = ['Female', 'Male', 'Intersex'] as const;
const MARITAL = ['Single', 'Married', 'Divorced', 'Widowed', 'Separated'] as const;

const CAN_SUBMIT = ['draft', 'invited', 'changes_requested'];
// the numbers the database refuses until complete (fieldProblem says when)
const CHECKED_FIELDS = ['Tax PIN', 'ID Number', 'Mobile Number', 'NSSF Number', 'SHIF Number'];

interface FormState {
  values: EmployeeRecord;
  emergency: Contact;
  nextOfKin: Contact;
}

const timeText = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function StatusBanner({ record }: { record: OnboardingRecord }) {
  const status = String(record.employee['onboarding_status'] ?? 'draft');
  const comment = record.employee['onboarding_review_comment'];
  const message: Record<string, string> = {
    draft: 'Fill in your details below and submit them to HR.',
    invited: 'Fill in your details below and submit them to HR.',
    submitted: 'HR is reviewing your details. You can still correct them while you wait.',
    changes_requested: 'HR sent your details back. Make the changes below and submit again.',
    approved: 'HR has approved your details. Adding anything still to provide is fine, but changing your ID, tax, SHA or NSSF numbers, phone, residency, disability or bank details once given sends them back to HR for review, and you are not paid until HR approves again.',
  };
  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-center gap-3">
        <StatusPill label={statusLabel(status)} tone={statusTone(status)} />
        <p className="text-sm text-ink flex-1 min-w-[200px]">{message[status] ?? message.draft}</p>
      </div>
      {status === 'changes_requested' && comment ? (
        <p className="mt-3 rounded-lg bg-orange-tint px-3 py-2 text-sm text-ink">
          <span className="font-medium">HR’s comment: </span>
          {String(comment)}
        </p>
      ) : null}
    </Card>
  );
}

function ContactFields({ title, value, onChange }: { title: string; value: Contact; onChange: (c: Contact) => void }) {
  const set = (key: keyof Contact) => (v: string) => onChange({ ...value, [key]: v });
  return (
    <Section title={title}>
      <TextField label="Full name" required value={value.full_name} onChange={set('full_name')} />
      <TextField label="Relationship to you" required value={value.relationship} onChange={set('relationship')} />
      <TextField label="Phone number" type="tel" required value={value.phone_number} onChange={set('phone_number')}
        error={fieldProblem('Mobile Number', value.phone_number)} />
      <TextField label="Alternative phone number" type="tel" value={value.alternative_phone} onChange={set('alternative_phone')}
        error={fieldProblem('Mobile Number', value.alternative_phone)} />
      <TextField label="Physical address" value={value.physical_address} onChange={set('physical_address')} />
      <TextField label="Email" type="email" value={value.email} onChange={set('email')} />
    </Section>
  );
}

export default function OnboardingForm() {
  const [record, setRecord] = useState<OnboardingRecord | null | undefined>(undefined);
  const [values, setValues] = useState<EmployeeRecord>({});
  const [emergency, setEmergency] = useState<Contact>(emptyContact());
  const [nextOfKin, setNextOfKin] = useState<Contact>(emptyContact());
  const [busy, setBusy] = useState<'save' | 'submit' | 'photo' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // the form as the server has it (set on loading and after each autosave), and how many times it was loaded
  const [serverForm, setServerForm] = useState<FormState | null>(null);
  const [generation, setGeneration] = useState(0);
  // the employee's country (their branch's, FIG-905): Tanzania and Uganda ask for a TIN and no SHA number
  const [country, setCountry] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const { data } = await supabase.rpc('my_holiday_country');
        if (live) setCountry(typeof data === 'string' ? data : null);
      } catch {
        // Kenya's details until it loads
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  const askSha = needsShaNumber(country);

  const load = useCallback(async () => {
    try {
      const r = await loadMyOnboarding();
      setRecord(r);
      if (r) {
        setValues(r.employee);
        setEmergency(r.emergency);
        setNextOfKin(r.nextOfKin);
        setServerForm({ values: r.employee, emergency: r.emergency, nextOfKin: r.nextOfKin });
        setGeneration((g) => g + 1);
      }
    } catch (err) {
      setRecord(null);
      toast.error(errorMessage(err, 'Could not load your details.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // after a document or referee changes: the status and what is still needed, without touching unsaved edits
  const refresh = useCallback(async () => {
    try {
      const r = await loadMyOnboarding();
      if (r) setRecord(r);
    } catch {
      // the next save or reload shows it
    }
  }, []);

  const set = (field: string) => (value: unknown) => setValues((v) => ({ ...v, [field]: value }));
  const problemOf = (field: string) => fieldProblem(field, values[field], values, country);
  const hasFormatProblems = useMemo(
    () => CHECKED_FIELDS.some((f) => fieldProblem(f, values[f], values, country)),
    [values, country]
  );

  const form = useMemo<FormState>(() => ({ values, emergency, nextOfKin }), [values, emergency, nextOfKin]);
  const myNumber = record ? String(record.employee['Employee Number']) : null;
  const approved = record ? String(record.employee['onboarding_status'] ?? 'draft') === 'approved' : false;

  const draft = useFormDraft<FormState>(myNumber && serverForm ? `onboarding:${myNumber}` : null, form, serverForm ?? form, (d) => {
    setValues(d.values);
    setEmergency(d.emergency);
    setNextOfKin(d.nextOfKin);
  });

  // what autosave sends: a number not complete yet keeps what the server has until it is
  const saveable = useMemo<FormState>(() => {
    const v = { ...values };
    for (const f of CHECKED_FIELDS) {
      if (fieldProblem(f, v[f], v, country)) v[f] = record?.employee[f] ?? null;
    }
    return { values: v, emergency, nextOfKin };
  }, [values, emergency, nextOfKin, country, record]);

  const autosave = useAutosave<FormState>(saveable, async (f) => {
    if (!myNumber) return;
    try {
      await saveMyOnboarding(myNumber, f.values, f.emergency, f.nextOfKin);
    } catch (err) {
      throw new Error(errorMessage(err, 'Your details were not saved.'));
    }
    setServerForm(f);
    void refresh();
  }, { enabled: Boolean(record) && !approved && busy === null, generation });

  if (record === undefined) {
    return (
      <div className="flex justify-center py-16">
        <FigbloomLoader label="Loading your form" />
      </div>
    );
  }
  if (record === null) {
    return (
      <Card className="m-6 text-sm text-ink">
        Your login is not linked to an employee record yet. Ask HR to check that the work email on your record is the email
        you sign in with.
      </Card>
    );
  }

  const employeeNumber = String(record.employee['Employee Number']);
  const status = String(record.employee['onboarding_status'] ?? 'draft');
  const canSubmit = CAN_SUBMIT.includes(status);
  const photo = values['Profile Image'] ? String(values['Profile Image']) : null;

  const save = async () => {
    await saveMyOnboarding(employeeNumber, values, emergency, nextOfKin);
  };

  const onSave = async () => {
    setBusy('save');
    setProblem(null);
    try {
      await save();
      toast.success('Your details are saved');
      await load();
    } catch (err) {
      setProblem(errorMessage(err, 'Your details were not saved.'));
    } finally {
      setBusy(null);
    }
  };

  const onSubmit = async () => {
    setBusy('submit');
    setProblem(null);
    try {
      await save();
      await submitMyOnboarding();
      toast.success('Sent to HR for review');
      await load();
    } catch (err) {
      setProblem(errorMessage(err, 'Your details could not be submitted.'));
      await load().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  };

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setBusy('photo');
    try {
      const url = await uploadEmployeeAvatar(file, employeeNumber);
      const { error } = await supabase.from('employees').update({ 'Profile Image': url }).eq('Employee Number', employeeNumber);
      if (error) throw error;
      setValues((v) => ({ ...v, 'Profile Image': url }));
      toast.success('Photo saved');
    } catch (err) {
      toast.error(errorMessage(err, 'The photo was not saved.'));
    } finally {
      setBusy(null);
    }
  };

  const byBank = /bank/i.test(String(values['payment_method'] ?? ''));

  return (
    <div className="p-4 sm:p-6 max-w-4xl">
      <h2 className="text-lg font-semibold text-ink mb-1">Onboarding</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Your details for payroll and the tax and social security returns. Fields marked * are needed; the lists below say
        what HR needs now, before you can submit, and what can come later, after you are approved and paid.
      </p>

      <StatusBanner record={record} />

      {draft.restoredAt !== null && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-ink flex-1 min-w-[200px]">
              We kept what you typed before the page reloaded (last change at {timeText(draft.restoredAt)}).
              {approved ? ' Save it to keep it.' : ''}
            </p>
            <Button variant="secondary" onClick={draft.discard}>Discard it</Button>
            <Button variant="secondary" onClick={draft.dismiss}>OK</Button>
          </div>
        </Card>
      )}

      {status !== 'approved' && record.missing.essentialsEmployee.length > 0 && (
        <Card className="mb-4">
          <p className="text-sm font-medium text-ink">Needed now, before you can submit</p>
          <p className="text-sm text-muted-foreground mt-1">{record.missing.essentialsEmployee.join(', ')}</p>
        </Card>
      )}

      {record.missing.followUps.length > 0 && (
        <Card className="mb-4">
          <p className="text-sm font-medium text-ink">{status === 'approved' ? 'Still to provide' : 'Can follow later'}</p>
          <p className="text-xs text-muted-foreground mt-0.5 mb-2">
            {status === 'approved'
              ? 'You are approved and on payroll. Add these when you can, below (documents, referees, policies) or in the Documents tab; it does not send your details back to HR.'
              : 'You can submit without these and add them after HR approves you.'}
          </p>
          <StillToProvide followUps={record.missing.followUps} />
        </Card>
      )}

      <Card className="space-y-6">
        <section className="flex items-center gap-4">
          {photo ? (
            <img src={photo} alt="Your photo" className="h-16 w-16 rounded-full object-cover border border-border" />
          ) : (
            <div className="h-16 w-16 rounded-full bg-secondary flex items-center justify-center">
              <User className="h-7 w-7 text-muted-foreground" />
            </div>
          )}
          <label className="inline-flex items-center gap-2 text-sm text-brand cursor-pointer">
            {busy === 'photo' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            {photo ? 'Change your photo' : 'Upload a recent photo'}
            <input type="file" accept="image/*" className="hidden" disabled={busy !== null}
              onChange={(e) => void onPhoto(e.target.files?.[0])} />
          </label>
        </section>

        <Section title="Personal details">
          <TextField label="Surname" required value={values['Last Name']} onChange={set('Last Name')} />
          <TextField label="First name" required value={values['First Name']} onChange={set('First Name')} />
          <TextField label="Other names" value={values['Middle Name']} onChange={set('Middle Name')} />
          <TextField label="Preferred name" value={values['preferred_name']} onChange={set('preferred_name')} hint="What colleagues call you" />
          <TextField label="Date of birth" type="date" required value={values['Date of Birth']} onChange={set('Date of Birth')} />
          <SelectField label="Sex" required value={values['Gender']} options={SEXES} onChange={set('Gender')} />
          <TextField label="Nationality" required value={values['nationality']} onChange={set('nationality')} placeholder="Kenyan" />
          <SelectField label="Marital status" value={values['Marital Status']} options={MARITAL} onChange={set('Marital Status')} />
          <TextField label="Current residential address" required value={values['residential_address']} onChange={set('residential_address')} />
          <TextField label="Permanent address" value={values['permanent_address']} onChange={set('permanent_address')} hint="If different from where you live now" />
          <TextField label="Personal email" type="email" required value={values['Personal Email']} onChange={set('Personal Email')} />
          <TextField label="Mobile number" type="tel" required value={values['Mobile Number']} onChange={set('Mobile Number')}
            error={problemOf('Mobile Number')} hint="Used for SMS and M-Pesa salary payments"
            disabled={status === 'approved' && Boolean(record.employee['Mobile Number'])} />
        </Section>

        <Section title="Identity and statutory numbers" description="As they appear on your documents.">
          <SelectField label="Identity type" required value={values['Type of Identification']} options={IDENTITY_TYPES} onChange={set('Type of Identification')} />
          <TextField label="ID / passport number" required value={values['ID Number']} onChange={set('ID Number')} error={problemOf('ID Number')} />
          <TextField label={taxNumberLabel(country)} required value={values['Tax PIN']} onChange={set('Tax PIN')} error={problemOf('Tax PIN')} placeholder={taxNumberPlaceholder(country)} />
          {askSha && <TextField label="SHA number" required value={values['SHIF Number']} onChange={set('SHIF Number')} error={problemOf('SHIF Number')} />}
          <TextField label="NSSF number" required value={values['NSSF Number']} onChange={set('NSSF Number')} error={problemOf('NSSF Number')} />
          <SelectField label="Residency (for tax)" required value={values['kra_residency']} options={RESIDENCY_OPTIONS} onChange={set('kra_residency')} />
        </Section>

        <Section title="Tax exemptions and reliefs">
          <YesNoField label="Are you a person with a disability (PWD) with a KRA exemption certificate?" required
            value={values['is_pwd'] as boolean | null | undefined} onChange={set('is_pwd')} />
          {values['is_pwd'] === true ? (
            <TextField label="Exemption certificate number" required value={values['Disability Cert No']} onChange={set('Disability Cert No')}
              hint="You will upload a copy of the certificate with your documents" />
          ) : <div />}
          <AmountField label="Mortgage interest you claim (per month)" value={values['mortgage_interest']} onChange={set('mortgage_interest')}
            hint="Leave blank if you don’t claim it. You will upload the lender’s statement" />
          <AmountField label="Life / health insurance premiums (per month)" value={values['insurance_premium']} onChange={set('insurance_premium')}
            hint="For insurance relief. Leave blank if none. You will upload the policy" />
        </Section>

        <Section title="Bank details" description={byBank ? 'Your salary is paid to this account.' : 'Fill these in if you have a bank account; HR decides how your salary is paid.'}>
          <BankBranchFields values={values} required={byBank} onChange={(changes) => setValues((v) => ({ ...v, ...changes }))} />
          <TextField label="Account name" required={byBank} value={values['account_number_name']} onChange={set('account_number_name')} />
          <TextField label="Account number" required={byBank} value={values['Account Number']} onChange={set('Account Number')} />
          <TextField label="Bank paybill number" value={values['bank_paybill']} onChange={set('bank_paybill')} />
        </Section>

        <ContactFields title="Emergency contact" value={emergency} onChange={setEmergency} />
        <ContactFields title="Next of kin" value={nextOfKin} onChange={setNextOfKin} />

        <section className="border-t border-border pt-5">
          <h3 className="text-sm font-semibold text-ink">Referees</h3>
          <p className="text-xs text-muted-foreground mt-0.5 mb-3">People who can speak about your work. Add more than one if you can.</p>
          <RefereesSection employeeId={String(record.employee['id'])} onChanged={() => void refresh()} />
        </section>

        <section className="border-t border-border pt-5">
          <h3 className="text-sm font-semibold text-ink">Documents</h3>
          <p className="text-xs text-muted-foreground mt-0.5 mb-3">Upload clear copies. Files are saved as soon as you upload them.</p>
          <DocumentsSection employeeId={String(record.employee['id'])} onChanged={() => void refresh()}
            identityType={values['Type of Identification'] ? String(values['Type of Identification']) : null} />
        </section>

        <section className="border-t border-border pt-5">
          <h3 className="text-sm font-semibold text-ink">Company policies and agreements</h3>
          <p className="text-xs text-muted-foreground mt-0.5 mb-3">Read each one and tick to accept it. Your tick is recorded as your signature.</p>
          <AgreementsSection onChanged={() => void refresh()} />
        </section>

        <section className="border-t border-border pt-5">
          <h3 className="text-sm font-semibold text-ink">Health (optional)</h3>
          <p className="text-xs text-muted-foreground mt-0.5 mb-3">Only if you want to share it. It is not needed to complete onboarding.</p>
          <HealthSection employeeId={String(record.employee['id'])} />
        </section>

        {problem && (
          <p role="alert" className="rounded-lg bg-orange-tint px-3 py-2 text-sm text-status-danger">{problem}</p>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
          <Button variant="secondary" onClick={() => void onSave()} disabled={busy !== null || hasFormatProblems}
            icon={busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}>
            Save
          </Button>
          {canSubmit && (
            <Button onClick={() => void onSubmit()} disabled={busy !== null || hasFormatProblems}
              icon={busy === 'submit' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}>
              Submit to HR
            </Button>
          )}
          {!approved && (
            <p className="m-0 text-xs text-muted-foreground inline-flex items-center gap-1.5" role="status" aria-live="polite">
              {autosave.state === 'saving' && <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving...</>}
              {autosave.state === 'saved' && autosave.savedAt !== null && (
                <>Saved at {timeText(autosave.savedAt)}{hasFormatProblems ? ' (a number that isn’t complete yet saves when it is)' : ''}</>
              )}
              {autosave.state === 'error' && (
                <span className="inline-flex items-center gap-1.5 text-status-danger">
                  <CloudOff className="h-3.5 w-3.5" /> Not saved: {autosave.error} What you typed is kept on this page.
                </span>
              )}
              {autosave.state === 'idle' && 'Your changes save as you type'}
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
