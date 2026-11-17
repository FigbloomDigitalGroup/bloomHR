import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BadgeCheck, BadgeX, ShieldQuestion } from 'lucide-react';
import { type VerifiedCard, verifyStaffIdCard } from '../lib/staffIdCards';
import { LoaderBlock } from '../components/UI/FigbloomLoader';

// What scanning a staff ID card's QR code opens (/verify/<token>, migration 20261027400000). No sign-in: a guard at a
// gate or a customer can check that the holder works for the company now. It shows only whether they are a current
// employee, their name, photo and job title, and the company; nothing else about them.

type State = { status: 'loading' } | { status: 'found'; card: VerifiedCard } | { status: 'unknown' } | { status: 'error'; message: string };

const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((w) => w.charAt(0)).filter((_, i, all) => i === 0 || i === all.length - 1).join('').toUpperCase();

export default function VerifyStaffIdPage() {
  const { token = '' } = useParams<{ token: string }>();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    verifyStaffIdCard(token.trim().toLowerCase())
      .then((card) => live && setState(card ? { status: 'found', card } : { status: 'unknown' }))
      .catch((e) => live && setState({ status: 'error', message: (e as Error).message }));
    return () => {
      live = false;
    };
  }, [token]);

  return (
    <div className="min-h-screen bg-page text-ink flex items-start justify-center px-4 py-10">
      <main className="w-full max-w-sm rounded-2xl border border-border bg-white p-6 shadow-sm text-center">
        <p className="m-0 mb-4 text-[11px] font-bold uppercase tracking-wider text-subtle">Staff ID check</p>
        {state.status === 'loading' && <LoaderBlock label="Checking the card" />}
        {state.status === 'error' && (
          <p className="text-[13px] text-status-danger">Could not check this card right now. Try again in a moment.</p>
        )}
        {state.status === 'unknown' && (
          <div className="space-y-2">
            <ShieldQuestion className="mx-auto h-12 w-12 text-status-danger" aria-hidden="true" />
            <h1 className="m-0 text-lg font-bold">This card is not valid</h1>
            <p className="m-0 text-[13px] text-muted-foreground">
              No staff ID card matches this code. It may have been replaced by a newer card. Do not accept it.
            </p>
          </div>
        )}
        {state.status === 'found' && (
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-2">
              {state.card.company_logo_url && (
                <img src={state.card.company_logo_url} alt="" className="h-9 w-9 rounded-tile object-contain" />
              )}
              <span className="text-[15px] font-bold">{state.card.company_name}</span>
            </div>
            {state.card.photo_url ? (
              <img src={state.card.photo_url} alt={`Photo of ${state.card.full_name}`} className="mx-auto h-28 w-28 rounded-full object-cover border border-border" />
            ) : (
              <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-full bg-secondary text-3xl font-bold text-brand" aria-hidden="true">
                {initialsOf(state.card.full_name)}
              </div>
            )}
            <div>
              <h1 className="m-0 text-xl font-bold">{state.card.full_name}</h1>
              {state.card.job_title && <p className="m-0 mt-0.5 text-[13px] text-muted-foreground">{state.card.job_title}</p>}
            </div>
            {state.card.is_active ? (
              <div className="flex items-center justify-center gap-2 rounded-xl bg-green-tint px-4 py-3 text-status-success" role="status">
                <BadgeCheck className="h-6 w-6" aria-hidden="true" />
                <span className="text-base font-bold">Active</span>
                <span className="text-[12.5px]">current employee</span>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 rounded-xl bg-orange-tint px-4 py-3 text-status-danger" role="status">
                <BadgeX className="h-6 w-6" aria-hidden="true" />
                <span className="text-base font-bold">Not active</span>
                <span className="text-[12.5px]">not a current employee</span>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
