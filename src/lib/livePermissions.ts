import type { QueryClient } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { queryKeys } from './queryClient';

/**
 * Reload the signed-in person's permissions as soon as their role changes, for the whole app: a module ticked or
 * unticked on Roles & Permissions (role_permissions), a company role renamed or rebased (company_roles), or the person
 * moved to another role (their own user_profiles row). Before, the permissions were read once when the page opened, so
 * someone given "Manage projects" only saw the button after a refresh.
 *
 * The database decides which changes reach whom (realtime follows each table's read policies: the company's own
 * roles, and only your own profile); any change just marks the permissions stale, and the screens showing them reload.
 */
export function refreshPermissionsOnRoleChange(client: QueryClient): () => void {
  let channel: RealtimeChannel | null = null;
  let watching: string | null = null;

  const stop = () => {
    if (channel) void supabase.removeChannel(channel);
    channel = null;
    watching = null;
  };
  const reload = () => {
    void client.invalidateQueries({ queryKey: queryKeys.myPermissions, refetchType: 'all' });
  };

  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    const userId = event === 'SIGNED_OUT' ? null : session?.user?.id ?? null;
    if (userId === watching) return;
    stop();
    if (!userId) return;
    watching = userId;
    channel = supabase
      .channel(`my-permissions-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'role_permissions' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'company_roles' }, reload)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'user_profiles', filter: `user_id=eq.${userId}` }, reload)
      .subscribe();
  });

  return () => {
    subscription.unsubscribe();
    stop();
  };
}
