import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Clock } from 'lucide-react';
import { Card, Button } from '../UI';
import { STAY_SIGNED_IN_OPTIONS, loadStaySignedIn, saveStaySignedIn, type StaySignedIn } from '../../lib/mfaApi';

const label = (minutes: number) => STAY_SIGNED_IN_OPTIONS.find((o) => o.minutes === minutes)?.label ?? `${minutes} minutes`;

/**
 * How long people stay signed in (migration 20261026100000): how long someone can be away from every tab before they
 * are signed out, and how long a sign-in code lasts before it is asked again (never under 12 hours). Only people whose
 * role has Sign-in security change it (the database checks); others see what is set.
 */
export default function StaySignedInCard({ className = '' }: { className?: string }) {
  const [saved, setSaved] = useState<StaySignedIn | null>(null);
  const [minutes, setMinutes] = useState(10080);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    loadStaySignedIn().then((s) => {
      if (live && s) {
        setSaved(s);
        setMinutes(s.minutes);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  if (!saved) return null;

  const save = async () => {
    setBusy(true);
    try {
      const s = await saveStaySignedIn(minutes);
      setSaved(s);
      setMinutes(s.minutes);
      toast.success('Saved: it applies from the next time each person signs in or reloads');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={className}>
      <div className="flex items-start gap-3">
        <div className="w-[38px] h-[38px] shrink-0 rounded-tile flex items-center justify-center bg-green-tint text-brand">
          <Clock className="w-[17px] h-[17px]" strokeWidth={1.8} />
        </div>
        <div className="min-w-0">
          <h2 className="m-0 text-[13.5px] font-bold text-ink">Stay signed in</h2>
          <p className="m-0 text-[11.5px] text-muted-foreground max-w-[560px]">
            How long someone can be away before they are signed out, and how long a two-step code lasts before it is asked
            again (at least 12 hours). Shorter is safer on shared computers; longer means fewer sign-ins.
          </p>
          <p className="m-0 mt-1 text-[11px] font-semibold text-brand" role="status">Signed out after {label(saved.minutes)} away</p>
        </div>
      </div>

      {saved.can_edit && (
        <>
          <div role="radiogroup" aria-label="Stay signed in for" className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {STAY_SIGNED_IN_OPTIONS.map((o) => (
              <label
                key={o.minutes}
                className={`flex cursor-pointer items-center gap-2.5 rounded-card border bg-white p-3 transition-colors hover:bg-secondary ${minutes === o.minutes ? 'border-brand ring-2 ring-brand/30' : 'border-border'}`}
              >
                <input type="radio" name="stay-signed-in" value={o.minutes} checked={minutes === o.minutes} onChange={() => setMinutes(o.minutes)} className="accent-brand" />
                <span className="text-[12.5px] font-semibold text-ink">{o.label}</span>
              </label>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <Button onClick={() => void save()} disabled={busy || minutes === saved.minutes}>
              {busy ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
