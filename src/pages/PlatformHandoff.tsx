import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import AuthShell, { authLinkClass } from '../components/Company/AuthShell';
import { LoaderBlock } from '../components/UI/FigbloomLoader';
import { readArrival, savePendingHandoff, statusMessage, type HandoffArrival } from '../lib/platformHandoff';

/**
 * Where the backend sends a browser arriving from Figbloom Schools (GET /api/platform/handoff):
 *   #token_hash=&next=   a linked person: the one-time sign-in token is verified here, then `next` (a path on this site)
 *   #connect=            the first time: the pending id is kept and HR's normal sign-in opens with the "connect" note
 *   ?status=             a page saying why not (switched off, no access, expired, ...)
 * The fragment is cleared from the address straight away.
 */
export default function PlatformHandoff() {
  const [arrival] = useState<HandoffArrival>(() => readArrival(window.location.search, window.location.hash));
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // the token or pending id must not stay in the address bar or the history
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname + window.location.search);

    if (arrival.kind === 'signin') {
      supabase.auth.verifyOtp({ token_hash: arrival.tokenHash, type: 'email' }).then(({ error }) => {
        if (error) {
          setFailed(true);
          return;
        }
        // a full load, so every screen starts from the company the person was switched into
        window.location.assign(arrival.next);
      }, () => setFailed(true));
    } else if (arrival.kind === 'connect') {
      savePendingHandoff(arrival.pending);
      supabase.auth.getSession().then(({ data }) => {
        // signed in already: the app asks to connect this login; otherwise HR's sign-in, with the note
        window.location.assign(data.session ? '/' : '/login');
      });
    }
  }, [arrival]);

  if (arrival.kind === 'status' || failed) {
    const { title, body } = arrival.kind === 'status' && !failed
      ? statusMessage(arrival.status, arrival.from)
      : statusMessage('invalid');
    return (
      <AuthShell title={title} subtitle={body}>
        <a href="/login" className={authLinkClass}>
          Go to Figbloom HR sign-in
        </a>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Opening Figbloom HR…">
      <LoaderBlock label={arrival.kind === 'signin' ? 'Signing you in' : 'One moment'} compact />
    </AuthShell>
  );
}
