import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getUnreadCount } from '../lib/mailboxApi';

// The new-mail count on the "Email Portal" sidebar item (FIG-1205, PR 3 of 3).
//
// Only for people with the My mailbox module who have connected a mailbox: whether they have is read from their own
// user_mailboxes row (RLS lets the owner see it; one cheap database count, no mail server), and without one /unread is
// never called. With one, /unread (an IMAP STATUS on the server) is asked at most every 2 minutes, only while the tab is
// visible. The last answer is kept in this browser for those 2 minutes, so page loads, reloads and other tabs reuse it
// instead of asking the mail server again. After an error (or the rate limit) the wait doubles, up to 30 minutes.
// The mailbox screen tells the badge when the count changes there (reading, marking, deleting) or the mailbox is
// connected or disconnected, through the window event below.

export const UNREAD_POLL_MS = 2 * 60 * 1000;
export const UNREAD_MAX_BACKOFF_MS = 30 * 60 * 1000;
export const MAILBOX_EVENT = 'bloom:mailbox';

export interface MailboxEventDetail {
  connected?: boolean;
  unread?: number;
}

/** Tells the badge what changed: the mailbox connected or not, or INBOX's unread count now. */
export function notifyMailbox(detail: MailboxEventDetail) {
  window.dispatchEvent(new CustomEvent<MailboxEventDetail>(MAILBOX_EVENT, { detail }));
}

const cacheKey = (who: string) => `bloom:mailbox-unread:${who}`;

function readCache(who: string): { unread: number; at: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(cacheKey(who)) || 'null');
    return v && typeof v.unread === 'number' && typeof v.at === 'number' ? v : null;
  } catch {
    return null;
  }
}

function writeCache(who: string, unread: number) {
  try {
    localStorage.setItem(cacheKey(who), JSON.stringify({ unread, at: Date.now() }));
  } catch {
    // private window: no cache, it just asks again next time
  }
}

/** Whether the signed-in person has connected a mailbox in their current company (their own row, by RLS). */
async function hasConnectedMailbox() {
  const { count, error } = await supabase.from('user_mailboxes').select('user_id', { count: 'exact', head: true });
  return !error && (count || 0) > 0;
}

/** INBOX's unread count for the badge: 0 when off, not connected, or not known yet. */
export function useMailboxUnread(enabled: boolean, who: string | undefined) {
  const [connected, setConnected] = useState(false);
  const [unread, setUnread] = useState(0);

  // step 1: is there a mailbox at all (no mail server is asked for this)
  useEffect(() => {
    if (!enabled || !who) {
      setConnected(false);
      return;
    }
    let live = true;
    hasConnectedMailbox()
      .then((c) => live && setConnected(c))
      .catch(() => live && setConnected(false));
    const onChange = (e: Event) => {
      const d = (e as CustomEvent<MailboxEventDetail>).detail || {};
      if (typeof d.connected === 'boolean') setConnected(d.connected);
      if (typeof d.unread === 'number' && d.unread >= 0) {
        writeCache(who, d.unread);
        setUnread(d.unread);
      }
    };
    window.addEventListener(MAILBOX_EVENT, onChange);
    return () => {
      live = false;
      window.removeEventListener(MAILBOX_EVENT, onChange);
    };
  }, [enabled, who]);

  // step 2: ask now and then, while the tab is visible
  useEffect(() => {
    if (!enabled || !who || !connected) {
      setUnread(0);
      return;
    }
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    let failures = 0;

    const schedule = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(tick, Math.max(1000, ms));
    };

    async function tick() {
      if (!live || busy || document.visibilityState === 'hidden') return; // picked up again when the tab shows
      const cached = readCache(who!);
      const age = cached ? Date.now() - cached.at : Infinity;
      if (cached && age < UNREAD_POLL_MS) {
        setUnread(cached.unread);
        schedule(UNREAD_POLL_MS - age);
        return;
      }
      busy = true;
      try {
        const res = await getUnreadCount();
        if (!live) return;
        failures = 0;
        if (!res.connected) {
          setConnected(false);
          return;
        }
        writeCache(who!, res.unread);
        setUnread(res.unread);
        schedule(UNREAD_POLL_MS);
      } catch {
        if (!live) return;
        failures += 1;
        schedule(Math.min(UNREAD_POLL_MS * 2 ** failures, UNREAD_MAX_BACKOFF_MS));
      } finally {
        busy = false;
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') clearTimeout(timer);
      else if (failures === 0) tick();
      else schedule(Math.min(UNREAD_POLL_MS * 2 ** failures, UNREAD_MAX_BACKOFF_MS));
    };

    tick();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      live = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, who, connected]);

  return unread;
}
