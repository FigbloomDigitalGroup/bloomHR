import type { ReactNode } from 'react';
import type { OnboardingRecord, Contact } from '../../lib/onboarding';

// Everything an onboarding record holds, read-only: what HR reviews and what the printed form shows.

const text = (value: unknown) => (value === null || value === undefined || String(value).trim() === '' ? '—' : String(value));
const yesNo = (value: unknown) => (value === true ? 'Yes' : value === false ? 'No' : '—');
const money = (value: unknown) => {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? `KSh ${n.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : '—';
};

function Group({ title, rows }: { title: string; rows: [string, ReactNode][] }) {
  return (
    <section className="break-inside-avoid">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{title}</h3>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 border-b border-border/60 py-1 text-sm">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-ink text-right">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const contactRows = (c: Contact): [string, ReactNode][] => [
  ['Full name', text(c.full_name)],
  ['Relationship', text(c.relationship)],
  ['Phone', text(c.phone_number)],
  ['Alternative phone', text(c.alternative_phone)],
  ['Physical address', text(c.physical_address)],
];

export default function OnboardingSummary({ record, showPay = true }: { record: OnboardingRecord; showPay?: boolean }) {
  const e = record.employee;
  return (
    <div className="space-y-6">
      <Group
        title="Personal"
        rows={[
          ['Surname', text(e['Last Name'])],
          ['First name', text(e['First Name'])],
          ['Other names', text(e['Middle Name'])],
          ['Preferred name', text(e['preferred_name'])],
          ['Date of birth', text(e['Date of Birth'])],
          ['Sex', text(e['Gender'])],
          ['Nationality', text(e['nationality'])],
          ['Marital status', text(e['Marital Status'])],
          ['Residential address', text(e['residential_address'])],
          ['Permanent address', text(e['permanent_address'])],
          ['Personal email', text(e['Personal Email'])],
          ['Mobile number', text(e['Mobile Number'])],
        ]}
      />
      <Group
        title="Identity and statutory"
        rows={[
          ['Identity type', text(e['Type of Identification'])],
          ['ID / passport number', text(e['ID Number'])],
          ['KRA PIN', text(e['Tax PIN'])],
          ['SHA number', text(e['SHIF Number'])],
          ['NSSF number', text(e['NSSF Number'])],
          ['Residency', text(e['kra_residency'])],
          ['Person with disability', yesNo(e['is_pwd'])],
          ['Exemption certificate', text(e['Disability Cert No'])],
          ['Mortgage interest (monthly)', money(e['mortgage_interest'])],
          ['Insurance premiums (monthly)', money(e['insurance_premium'])],
        ]}
      />
      <Group
        title="Bank and payroll"
        rows={[
          ['Payment method', text(e['payment_method'])],
          ['Bank', text(e['Bank'])],
          ['Branch', text(e['Bank Branch'])],
          ['Account name', text(e['account_number_name'])],
          ['Account number', text(e['Account Number'])],
          ['Bank code', text(e['bank_code'])],
          ['Branch code', text(e['branch_code'])],
          ['Bank paybill', text(e['bank_paybill'])],
        ]}
      />
      <Group title="Emergency contact" rows={contactRows(record.emergency)} />
      <Group title="Next of kin" rows={contactRows(record.nextOfKin)} />
      {showPay && (
        <Group
          title="Employment and pay (entered by HR)"
          rows={[
            ['Payroll number', text(e['Payroll Number'])],
            ['Position', text(e['Job Title'])],
            ['Type of employee (KRA)', text(e['kra_employee_type'])],
            ['Basic salary', money(e['Basic Salary'])],
            ['House allowance', money(e['house_allowance'])],
            ['Travel allowance', money(e['travel_allowance'])],
            ['Hardship allowance', money(e['hardship'])],
            ['Other cash allowances', money(e['other_cash_allowances'])],
            ['Car benefit', money(e['car_benefit'])],
            ['Meals', money(e['meals_benefit'])],
            ['Non-cash benefit', money(e['non_cash_benefit'])],
            ['Housing benefit', money(e['housing_benefit'])],
            ['Other benefits', money(e['other_benefits'])],
            ['Other pension contribution', money(e['other_pension_contribution'])],
            ['Post-retirement medical fund', money(e['post_retirement_medical_fund'])],
            ['NSSF voluntary contribution', money(e['nssf_voluntary_contribution'])],
          ]}
        />
      )}
    </div>
  );
}
