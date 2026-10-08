import { useEffect, useSyncExternalStore } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../../lib/supabase';
import { useMyCompanies } from '../../../hooks/useMyCompanies';

// Who is online: everyone with the app open announces their (lower-case) email on their company's presence channel,
// and drops off when they close it or lose connection. One channel per browser tab, shared by every screen.
let channel: RealtimeChannel | null = null;
let channelKey = '';
let online: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((l) => l());

function stop() {
  if (channel) supabase.removeChannel(channel);
  channel = null;
  channelKey = '';
  online = new Set();
  notify();
}

function start(tenantId: string, email: string) {
  const key = `${tenantId}:${email}`;
  if (channelKey === key) return;
  stop();
  channelKey = key;
  const ch = supabase.channel(`presence:${tenantId}`, { config: { presence: { key: email } } });
  ch.on('presence', { event: 'sync' }, () => {
    online = new Set(Object.keys(ch.presenceState()));
    notify();
  }).subscribe((status) => {
    if (status === 'SUBSCRIBED') ch.track({ since: new Date().toISOString() });
  });
  channel = ch;
}

supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') stop();
});

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Announces the signed-in person as online in their current company and returns the emails of everyone online. */
export function useOnlinePeople(): ReadonlySet<string> {
  const { data: companies } = useMyCompanies();
  const tenantId = companies?.find((c) => c.is_current)?.tenant_id;

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      const email = data.session?.user?.email?.toLowerCase();
      if (!cancelled && email) start(tenantId, email);
    });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  return useSyncExternalStore(subscribe, () => online);
}

export const isOnline = (people: ReadonlySet<string>, email?: string | null) =>
  !!email && people.has(email.toLowerCase());
