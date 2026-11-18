import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Card } from '../UI';
import { loadCompanyProfile } from '../../lib/companyProfile';
import { DEFAULT_LOAN_FORM_SETTINGS, lenderDetails, type LoanFormSettings } from '../../lib/loanForm';
import { loadLoanFormSettings, saveLoanFormSettings } from '../../lib/loanFormApi';

// The loan form's settings: who the lender on it is (empty: the company itself, from its profile; or an outside lender
// the company's staff borrow from through payroll), the late payment charge and what happens to the balance on death
// or permanent incapacity (both only printed on the form), and whether payout waits for the signed form.

const inputClass = 'w-full rounded-tile border border-border bg-white px-3 py-2 text-[12.5px] text-ink outline-none focus:border-brand disabled:bg-secondary';

type TextKey = Exclude<keyof LoanFormSettings, 'late_charge_percent' | 'require_signed_form' | 'term_rates'>;

export default function LoanFormSettingsCard({ canEdit, className = '' }: { canEdit: boolean; className?: string }) {
  const [saved, setSaved] = useState<LoanFormSettings | null>(null);
  const [form, setForm] = useState<LoanFormSettings>(DEFAULT_LOAN_FORM_SETTINGS);
  const [late, setLate] = useState('');
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([loadLoanFormSettings(), loadCompanyProfile().catch(() => null)])
      .then(([s, company]) => {
        if (!live) return;
        setSaved(s);
        setForm(s);
        setLate(s.late_charge_percent === null ? '' : String(s.late_charge_percent));
        setCompanyName(lenderDetails(DEFAULT_LOAN_FORM_SETTINGS, company).name);
      })
      .catch(() => toast.error('Could not load the loan form settings'));
    return () => {
      live = false;
    };
  }, []);

  if (!saved) return null;

  const lateValue = late.trim() === '' ? null : Number(late);
  const problem = lateValue !== null && !(lateValue >= 0 && lateValue <= 100) ? 'The late payment charge must be between 0% and 100%, or empty for none.' : null;
  const next: LoanFormSettings = { ...form, late_charge_percent: lateValue };
  const changed = JSON.stringify(next) !== JSON.stringify(saved);

  const save = async () => {
    setBusy(true);
    try {
      await saveLoanFormSettings(next);
      setSaved(next);
      toast.success('Loan form settings saved');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const text = (key: TextKey, labelText: string, hint: string, placeholder = '', wide = false) => (
    <label className={`block ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="block text-[12px] font-semibold text-ink mb-1">{labelText}</span>
      <input className={inputClass} value={form[key] ?? ''} disabled={!canEdit} placeholder={placeholder} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
      <span className="block mt-1 text-[11px] text-muted-foreground">{hint}</span>
    </label>
  );

  return (
    <Card className={className}>
      <h2 className="m-0 text-[14px] font-bold text-ink">Loan form</h2>
      <p className="mt-0.5 mb-3.5 text-[12px] text-muted-foreground">
        The agreement each borrower signs: the application, key facts statement, terms, salary deduction authority and approval. These change the forms
        made from now on; signed copies already uploaded stay as they are.
      </p>

      <label className="flex items-start gap-2 mb-4">
        <input
          type="checkbox"
          className="mt-0.5 accent-brand"
          checked={form.require_signed_form}
          disabled={!canEdit}
          onChange={(e) => setForm({ ...form, require_signed_form: e.target.checked })}
        />
        <span className="text-[12.5px] text-ink">
          Pay out only after HR accepts the signed form
          <span className="block text-[11px] text-muted-foreground">Applies to loans approved from now on. Finance sees a loan in Payments to make once its signed form is accepted.</span>
        </span>
      </label>

      <h3 className="m-0 mb-2 text-[13px] font-bold text-ink">Lender on the form</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {text('lender_name', 'Lender’s name', `Leave empty when the company lends itself: the form then shows ${companyName || 'the company'}'s details from the company profile.`, companyName ?? '', true)}
        {text('lender_licence', 'Licence line under the name', 'Optional. For example: CBK-licensed digital credit provider', '', true)}
        {text('lender_address', 'Physical address', 'For example: 3rd Floor, Enterprise Road, Industrial Area, Nairobi')}
        {text('lender_postal_address', 'Postal address', 'For example: P.O. Box 12345-00100, Nairobi')}
        {text('lender_phone', 'Phone', 'For example: +254 700 000 000')}
        {text('lender_email', 'Email', 'For example: info@lender.co.ke')}
        {text('complaints_email', 'Complaints and data requests email', 'Printed in the terms. Empty: the email above.')}
      </div>

      <h3 className="mt-5 mb-2 text-[13px] font-bold text-ink">Terms printed on the form</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-[12px] font-semibold text-ink mb-1">Late payment charge (% of the overdue amount, once)</span>
          <input className={inputClass} type="number" min={0} max={100} step="0.1" value={late} disabled={!canEdit} placeholder="None" onChange={(e) => setLate(e.target.value)} />
          <span className="block mt-1 text-[11px] text-muted-foreground">For example 10. Empty: the form says no late charge applies. Payroll does not charge it.</span>
        </label>
        {text(
          'incapacity_terms',
          'If the borrower dies or is permanently incapacitated',
          'What happens to the balance still owed (term 8 of the form). For example: the balance is recovered from terminal dues, and any remainder is written off.'
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-[12px] text-red-600" role="status">
          {problem}
        </span>
        {canEdit && (
          <Button onClick={() => void save()} disabled={busy || !changed || !!problem}>
            {busy ? 'Saving...' : 'Save form settings'}
          </Button>
        )}
      </div>
    </Card>
  );
}
