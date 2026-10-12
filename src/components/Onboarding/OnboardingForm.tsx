import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle2, Loader2, Send, UploadCloud, User } from 'lucide-react';
import { Button, Card, StatusPill } from '../UI';
import { AmountField, Section, SelectField, TextField, YesNoField } from './Fields';
import DocumentsSection from './DocumentsSection';
import RefereesSection from './RefereesSection';
import HealthSection from './HealthSection';
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
import { IDENTITY_TYPES, RESIDENCY_OPTIONS, fieldProblem } from '../../lib/onboardingValidation';
import type { EmployeeRecord } from '../../lib/profileCompleteness';
import { uploadEmployeeAvatar } from '../../lib/avatarStorage';
import { supabase } from '../../lib/supabase';

// The employee's part of onboarding (staff portal): personal, identity and statutory, tax claims, bank, emergency
// contact and next of kin. They save as they go and submit to HR when it is complete.

const SEXES = ['Female', 'Male', 'Intersex'] as const;
const MARITAL = ['Single', 'Married', 'Divorced', 'Widowed', 'Separated'] as const;

const CAN_SUBMIT = ['draft', 'invited', 'changes_requested'];

function StatusBanner({ record }: { record: OnboardingRecord }) {
  const status = String(record.employee['onboarding_status'] ?? 'draft');
  const comment = record.employee['onboarding_review_comment'];
  const message: Record<string, string> = {
    draft: 'Fill in your details below and submit them to HR.',
    invited: 'Fill in your details below and submit them to HR.',
    submitted: 'HR is reviewing your details. You can still correct them while you wait.',
    changes_requested: 'HR sent your details back. Make the changes below and submit again.',
    approved: 'HR has approved your details. Changing your ID, KRA, SHA or NSSF numbers, phone, residency, disability or bank details sends them back to HR for review, and you are not paid until HR approves again.',
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

  const load = useCallback(async () => {
    try {
      const r = await loadMyOnboarding();
      setRecord(r);
      if (r) {
        setValues(r.employee);
        setEmergency(r.emergency);
        setNextOfKin(r.nextOfKin);
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
  const problemOf = (field: string) => fieldProblem(field, values[field], values);
  const hasFormatProblems = useMemo(
    () => ['Tax PIN', 'ID Number', 'Mobile Number', 'NSSF Number', 'SHIF Number'].some((f) => fieldProblem(f, values[f], values)),
    [values]
  );

  if (record === undefined) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-brand" aria-label="Loading" />
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
        Your details for payroll and the KRA, SHA and NSSF returns. Fields marked * are required.
      </p>

      <StatusBanner record={record} />

      {record.missing.employee.length > 0 && (
        <Card className="mb-4">
          <p className="text-sm font-medium text-ink">Still needed before you can submit</p>
          <p className="text-sm text-muted-foreground mt-1">{record.missing.employee.join(', ')}</p>
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
          <TextField label="KRA PIN" required value={values['Tax PIN']} onChange={set('Tax PIN')} error={problemOf('Tax PIN')} placeholder="A123456789B" />
          <TextField label="SHA number" required value={values['SHIF Number']} onChange={set('SHIF Number')} error={problemOf('SHIF Number')} />
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
          <TextField label="Bank name" required={byBank} value={values['Bank']} onChange={set('Bank')} />
          <TextField label="Branch name" required={byBank} value={values['Bank Branch']} onChange={set('Bank Branch')} />
          <TextField label="Account name" required={byBank} value={values['account_number_name']} onChange={set('account_number_name')} />
          <TextField label="Account number" required={byBank} value={values['Account Number']} onChange={set('Account Number')} />
          <TextField label="Bank code" value={values['bank_code']} onChange={set('bank_code')} />
          <TextField label="Branch code" value={values['branch_code']} onChange={set('branch_code')} />
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
          <DocumentsSection employeeId={String(record.employee['id'])} onChanged={() => void refresh()} />
        </section>

        <section className="border-t border-border pt-5">
          <h3 className="text-sm font-semibold text-ink">Health (optional)</h3>
          <p className="text-xs text-muted-foreground mt-0.5 mb-3">Only if you want to share it. It is not needed to complete onboarding.</p>
          <HealthSection employeeId={String(record.employee['id'])} />
        </section>

        {problem && (
          <p role="alert" className="rounded-lg bg-orange-tint px-3 py-2 text-sm text-status-danger">{problem}</p>
        )}

        <div className="flex flex-wrap gap-3 border-t border-border pt-5">
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
        </div>
      </Card>
    </div>
  );
}
