import { supabase } from './supabase';
import { adminApi } from './adminApi';

// Deleting an employee (20261013300000): for records added by mistake or test data. Someone with payslips in an
// approved month can't be deleted (terminate them instead). Their uploaded files are removed from storage, and an
// administrator can also remove their login from the company.

export interface DeleteCheck {
  employee_number: string;
  name: string;
  /** why it can't be deleted, or null */
  blocked: string | null;
  has_login: boolean;
  documents: number;
  leave_applications: number;
}

const fail = (err: unknown, fallback: string): never => {
  const message = (err as { message?: unknown } | null)?.message;
  throw new Error(typeof message === 'string' && message ? message : fallback);
};

/** What deleting this employee would do, deleting nothing. */
export async function checkDeleteEmployee(employeeId: string): Promise<DeleteCheck> {
  const { data, error } = await supabase.rpc('delete_employee', { p_employee: employeeId, p_confirm: false });
  if (error) fail(error, 'Could not check this employee.');
  return data as DeleteCheck;
}

export interface DeleteResult {
  /** their login was removed from the company */
  loginRemoved: boolean;
  /** they have a login that was kept (not asked to remove, or it could not be) */
  loginKept: boolean;
  /** why removing the login failed, if it did */
  loginProblem?: string;
}

/** Deletes the employee, removes their files from storage, and (if asked, admins only) their login from the company. */
export async function deleteEmployee(employeeId: string, removeLogin: boolean): Promise<DeleteResult> {
  const { data, error } = await supabase.rpc('delete_employee', { p_employee: employeeId, p_confirm: true });
  if (error) fail(error, 'The employee was not deleted.');
  const result = data as { login_user_id: string | null; files: string[] };
  // best effort: the files are no longer linked to anything either way
  if (result.files?.length) await supabase.storage.from('documents').remove(result.files);
  if (!result.login_user_id) return { loginRemoved: false, loginKept: false };
  if (!removeLogin) return { loginRemoved: false, loginKept: true };
  try {
    await adminApi.deleteUser(result.login_user_id);
    return { loginRemoved: true, loginKept: false };
  } catch (err) {
    return { loginRemoved: false, loginKept: true, loginProblem: err instanceof Error ? err.message : 'The login could not be removed.' };
  }
}
