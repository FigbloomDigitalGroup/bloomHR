import { AmountField, SelectField } from './Fields';
import { KRA_EMPLOYEE_TYPES } from '../../lib/onboardingValidation';

// HR's part of onboarding on the add and edit employee pages: the KRA type of employee, cash allowances, non-cash
// benefits and pension-type contributions, each a monthly amount (they feed the KRA P10 and NSSF returns).

const AMOUNTS: [field: string, label: string, hint?: string][] = [
  ['house_allowance', 'House allowance'],
  ['travel_allowance', 'Travel allowance'],
  ['hardship', 'Hardship allowance'],
  ['other_cash_allowances', 'Other cash allowances'],
  ['car_benefit', 'Car benefit', 'Value of a company car, per month'],
  ['meals_benefit', 'Meals', 'Value of meals provided, per month'],
  ['non_cash_benefit', 'Other non-cash benefits'],
  ['housing_benefit', 'Housing benefit', 'Value of housing provided (not a cash house allowance)'],
  ['other_benefits', 'Other benefits'],
  ['other_pension_contribution', 'Other pension contribution', 'Registered pension scheme, per month'],
  ['post_retirement_medical_fund', 'Post-retirement medical fund'],
  ['nssf_voluntary_contribution', 'NSSF voluntary contribution'],
];

interface Props {
  values: Record<string, unknown>;
  onChange: (field: string, value: unknown) => void;
  disabled?: boolean;
  /** fields set by the employee's job group, shown but not editable */
  locked?: string[];
}

export default function EmployerPayFields({ values, onChange, disabled, locked = [] }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4">
      <SelectField
        label="Type of employee (KRA)"
        required
        value={values['kra_employee_type']}
        options={KRA_EMPLOYEE_TYPES}
        onChange={(v) => onChange('kra_employee_type', v || null)}
        hint="Primary: this is their main job. Secondary: they have a main job elsewhere"
        disabled={disabled}
      />
      {AMOUNTS.map(([field, label, hint]) => (
        <AmountField key={field} label={label}
          hint={locked.includes(field) ? 'Set by the job group' : hint ?? 'Per month; leave blank if none'} value={values[field]}
          onChange={(v) => onChange(field, v)} disabled={disabled || locked.includes(field)} />
      ))}
    </div>
  );
}
