import { supabase } from './supabase';

// Kenyan banks and branches with their clearing codes (banks / bank_branches, from the Kenya Bankers Association's
// list). Employee records keep the names ("Bank", "Bank Branch") and the codes (bank_code, branch_code).

export interface Bank {
  code: string;
  name: string;
}

export interface Branch {
  code: string;
  name: string;
}

let banksCache: Promise<Bank[]> | null = null;

/** Every open bank, by name (loaded once). */
export function loadBanks(): Promise<Bank[]> {
  banksCache ??= (async () => {
    const { data, error } = await supabase.from('banks').select('code, name').eq('open', true).order('name');
    if (error) {
      banksCache = null;
      throw new Error(error.message || 'Could not load the list of banks.');
    }
    return (data ?? []) as Bank[];
  })();
  return banksCache;
}

/** A bank's branches, by name. */
export async function loadBranches(bankCode: string): Promise<Branch[]> {
  if (!/^\d{2}$/.test(bankCode)) return [];
  const { data, error } = await supabase.from('bank_branches').select('branch_code, name').eq('bank_code', bankCode).order('name');
  if (error) throw new Error(error.message || 'Could not load the branches.');
  return (data ?? []).map((b: { branch_code: string; name: string }) => ({ code: b.branch_code, name: b.name }));
}

/** The employee-record changes for choosing a bank: its name and code, and no branch yet. Null clears all four. */
export const bankChoice = (bank: Bank | null) => ({
  Bank: bank?.name ?? null,
  bank_code: bank?.code ?? null,
  'Bank Branch': null,
  branch_code: null,
});

/** The employee-record changes for choosing a branch. */
export const branchChoice = (branch: Branch | null) => ({
  'Bank Branch': branch?.name ?? null,
  branch_code: branch?.code ?? null,
});
