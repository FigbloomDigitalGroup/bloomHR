import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { ApiError } from '../../lib/adminApi';
import { Button, Modal } from '../UI';
import { clearPendingHandoff, handoffApi, loadPendingHandoff, safeNext, type PendingPreview } from '../../lib/platformHandoff';

// pages where the person is still signing in: ask once they are in
const SIGNING_IN = ['/login', '/mfa', '/update-password', '/join', '/create-company', '/handoff', '/auth/callback', '/offer'];

type State =
  | { kind: 'idle' }
  | { kind: 'ask'; pending: string; preview: PendingPreview }
  | { kind: 'wrong'; message: string }
  | { kind: 'working'; pending: string; preview: PendingPreview };

/**
 * After someone who came from Figbloom Schools signs in to HR normally (password, an accepted invitation, ...): asks
 * them to connect their Schools account to this HR login, and does it (POST /api/platform/handoff/link). The backend
 * links only a member of that same school's HR company; anyone else is told so and nothing is linked.
 */
export default function HandoffLinker({ userId, email, pathname }: { userId: string | null; email: string; pathname: string }) {
  const [state, setState] = useState<State>({ kind: 'idle' });

  useEffect(() => {
    if (!userId || SIGNING_IN.includes(pathname)) return;
    const pending = loadPendingHandoff();
    if (!pending) return;
    let live = true;
    handoffApi.preview(pending).then(
      (preview) => live && setState({ kind: 'ask', pending, preview }),
      (err) => {
        if (!live) return;
        if (err instanceof ApiError && err.code === 'wrong_company') {
          setState({ kind: 'wrong', message: err.message });
          return;
        }
        if (err instanceof ApiError && (err.status === 401 || err.status === 0)) return; // try again on the next page
        clearPendingHandoff();
        if (err instanceof ApiError && err.status !== 503) toast.error(err.message);
      }
    );
    return () => {
      live = false;
    };
  }, [userId, pathname]);

  const notNow = () => {
    clearPendingHandoff();
    setState({ kind: 'idle' });
  };

  const connect = async () => {
    if (state.kind !== 'ask') return;
    setState({ kind: 'working', pending: state.pending, preview: state.preview });
    try {
      const r = await handoffApi.link(state.pending);
      clearPendingHandoff();
      toast.success('Your Figbloom Schools account is connected. Next time HR & Payroll opens HR straight away.');
      // a full load, so every screen starts from the school's company
      window.location.assign(safeNext(r.return_to));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'wrong_company') {
        setState({ kind: 'wrong', message: err.message });
        return;
      }
      clearPendingHandoff();
      setState({ kind: 'idle' });
      toast.error((err as Error).message);
    }
  };

  const signInAnother = async () => {
    // keep the pending handoff: the right login can still connect it
    setState({ kind: 'idle' });
    await supabase.auth.signOut({ scope: 'local' });
  };

  if (state.kind === 'wrong') {
    return (
      <Modal open onClose={notNow} title="Not connected" size="md">
        <p className="text-[13px] text-ink">{state.message}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={notNow}>Not now</Button>
          <Button onClick={signInAnother}>Sign in with another account</Button>
        </div>
      </Modal>
    );
  }

  if (state.kind === 'ask' || state.kind === 'working') {
    const { preview } = state;
    const company = preview.company_name || 'your school';
    return (
      <Modal open onClose={notNow} title="Connect your Figbloom Schools account?" size="md" closeOnBackdrop={false}>
        <div className="space-y-3 text-[13px] text-ink">
          <p className="m-0">
            Connect the Figbloom Schools account{preview.person_name ? <> of <strong>{preview.person_name}</strong></> : null} at{' '}
            <strong>{company}</strong> to this HR login, <strong>{email}</strong>. After that, HR &amp; Payroll in Figbloom
            Schools opens HR without a password.
          </p>
          <p className="m-0 text-[12px] text-muted-foreground">
            Only connect it if you just clicked HR &amp; Payroll in Figbloom Schools yourself. You can remove the
            connection any time under Appearance, Connected accounts.
          </p>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={notNow} disabled={state.kind === 'working'}>Not now</Button>
          <Button onClick={connect} disabled={state.kind === 'working'}>
            {state.kind === 'working' ? 'Connecting…' : 'Connect'}
          </Button>
        </div>
      </Modal>
    );
  }

  return null;
}
