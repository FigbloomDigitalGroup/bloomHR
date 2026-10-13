import { supabase } from './supabase';

// Whether the signed-in employee's notifications are also emailed to them (FIG-771). On unless they turned it off;
// warnings, suspensions and payslips are emailed either way (notification_preferences, migration 20261013800000).

async function myEmployeeId(): Promise<string | null> {
  const { data: auth } = await supabase.auth.getUser();
  const email = auth.user?.email;
  if (!email) return null;
  const { data } = await supabase.from('employees').select('id').eq('Work Email', email).maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

/** Whether they get emails; null when they aren't linked to an employee record. */
export async function loadEmailNotifications(): Promise<boolean | null> {
  const id = await myEmployeeId();
  if (!id) return null;
  const { data, error } = await supabase.from('notification_preferences').select('email').eq('employee_id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { email?: boolean } | null)?.email ?? true;
}

export async function saveEmailNotifications(on: boolean): Promise<void> {
  const id = await myEmployeeId();
  if (!id) throw new Error('Your login is not linked to an employee record.');
  const { error } = await supabase
    .from('notification_preferences')
    .upsert({ employee_id: id, email: on, updated_at: new Date().toISOString() }, { onConflict: 'employee_id' });
  if (error) throw new Error(error.message);
}
