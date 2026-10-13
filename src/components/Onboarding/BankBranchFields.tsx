import { useEffect, useState } from 'react';
import SearchableDropdown from '../UI/SearchableDropdown';
import { type Bank, type Branch, bankChoice, branchChoice, loadBanks, loadBranches } from '../../lib/banks';

// Bank and branch picked from the Kenya Bankers Association's list, which fills in the bank and branch codes bank
// files need. Renders two grid cells (bank, branch). An older record's typed name that isn't on the list still shows.

interface Props {
  values: Record<string, unknown>;
  /** the fields to change: Bank, bank_code, "Bank Branch", branch_code */
  onChange: (changes: Record<string, string | null>) => void;
  required?: boolean;
  disabled?: boolean;
}

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export default function BankBranchFields({ values, onChange, required, disabled }: Props) {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const bankCode = text(values['bank_code']);

  useEffect(() => {
    loadBanks().then(setBanks, () => setBanks([]));
  }, []);

  useEffect(() => {
    loadBranches(bankCode).then(setBranches, () => setBranches([]));
  }, [bankCode]);

  const label = (title: string, code: string) => (
    <span className="block text-xs font-medium text-ink mb-1">
      {title}
      {required && <span className="text-status-danger"> *</span>}
      {code && <span className="ml-2 font-normal text-muted-foreground">code {code}</span>}
    </span>
  );

  return (
    <>
      <div>
        {label('Bank', bankCode)}
        <SearchableDropdown
          options={banks.map((b) => ({ label: b.name, value: b.code }))}
          // an older record without a code shows the name it was typed with
          value={bankCode || text(values['Bank'])}
          placeholder="Choose the bank"
          disabled={disabled}
          onChange={(code) => onChange(bankChoice(code === 'all' ? null : banks.find((b) => b.code === code) ?? null))}
        />
      </div>
      <div>
        {label('Branch', text(values['branch_code']))}
        <SearchableDropdown
          options={branches.map((b) => ({ label: b.name, value: b.code }))}
          value={text(values['branch_code']) || text(values['Bank Branch'])}
          placeholder={bankCode ? 'Choose the branch' : 'Choose the bank first'}
          disabled={disabled || !bankCode}
          onChange={(code) => onChange(branchChoice(code === 'all' ? null : branches.find((b) => b.code === code) ?? null))}
        />
      </div>
    </>
  );
}
