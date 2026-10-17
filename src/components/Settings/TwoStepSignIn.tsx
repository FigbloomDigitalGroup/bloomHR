import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Lock } from 'lucide-react';
import { Card, Button } from '../UI';
import { loadTwoStepPeople, loadTwoStepSettings, resetTwoStep, saveTwoStepSettings, type TwoStepMethod, type TwoStepMode, type TwoStepPerson, type TwoStepSettings } from '../../lib/mfaApi';

const MODES: { id: TwoStepMode; label: string; hint: string }[] = [
  { id: 'off', label: 'Off', hint: 'Everyone signs in with their password only.' },
  { id: 'privileged', label: 'Admins, HR and payroll', hint: 'Admins, HR and checkers also enter a code sent to them.' },
  { id: 'everyone', label: 'Everyone', hint: 'Every person enters a code sent to them.' },
];
const METHODS: { id: TwoStepMethod; label: string; hint: string }[] = [
  { id: 'email', label: 'Email', hint: 'To the email they sign in with.' },
  { id: 'sms', label: 'SMS', hint: 'To their registered MFA number (email if they have none).' },
];

/**
 * The company's two-step sign-in (FIG-834): off, on for admins, HR and payroll, or on for everyone; codes by email or
 * SMS. Only an ADMIN changes it (the database checks); others see what is set.
 */
export default function TwoStepSignInCard({ className = '' }: { className?: string }) {
  const [saved, setSaved] = useState<TwoStepSettings | null>(null);
  const [mode, setMode] = useState<TwoStepMode>('off');
  const [method, setMethod] = useState<TwoStepMethod>('email');
  const [busy, setBusy] = useState(false);
  // people who turned it on for themselves (FIG-891), for the admin
  const [people, setPeople] = useState<TwoStepPerson[]>([]);

  const show = (s: TwoStepSettings) => {
    setSaved(s);
    setMode(s.mode);
    setMethod(s.method);
  };

  useEffect(() => {
    let live = true;
    loadTwoStepSettings().then((s) => {
      if (live && s) show(s);
      if (live && s?.can_edit) loadTwoStepPeople().then((p) => live && setPeople(p));
    });
    return () => {
      live = false;
    };
  }, []);

  if (!saved) return null;

  const changed = mode !== saved.mode || method !== saved.method;
  const on = saved.mode !== 'off';
  const summary = !on
    ? 'Off: password only'
    : `On for ${saved.mode === 'everyone' ? 'everyone' : 'admins, HR and payroll'}, by ${saved.method === 'sms' ? 'SMS' : 'email'}`;

  const save = async () => {
    setBusy(true);
    try {
      show(await saveTwoStepSettings(mode, method));
      toast.success('Two-step sign-in saved');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={className}>
      <div className="flex items-start gap-3">
        <div className={`w-[38px] h-[38px] shrink-0 rounded-tile flex items-center justify-center ${on ? 'bg-green-tint text-brand' : 'bg-secondary text-muted-foreground'}`}>
          <Lock className="w-[17px] h-[17px]" strokeWidth={1.8} />
        </div>
        <div className="min-w-0">
          <h2 className="m-0 text-[13.5px] font-bold text-ink">Two-step sign-in</h2>
          <p className="m-0 text-[11.5px] text-muted-foreground max-w-[560px]">
            After their password, people enter a 6-digit code sent to them. It stops someone who learns a password from signing in.
          </p>
          <p className={`m-0 mt-1 text-[11px] font-semibold ${on ? 'text-brand' : 'text-subtle'}`} role="status">{summary}</p>
        </div>
      </div>

      {saved.can_edit && (
        <>
          <div role="radiogroup" aria-label="Who enters a code" className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {MODES.map((m) => (
              <label
                key={m.id}
                className={`flex cursor-pointer items-start gap-2.5 rounded-card border bg-white p-3 transition-colors hover:bg-secondary ${mode === m.id ? 'border-brand ring-2 ring-brand/30' : 'border-border'}`}
              >
                <input type="radio" name="two-step-mode" value={m.id} checked={mode === m.id} onChange={() => setMode(m.id)} className="mt-0.5 accent-brand" />
                <span>
                  <span className="block text-[12.5px] font-semibold text-ink">{m.label}</span>
                  <span className="block text-[11.5px] text-muted-foreground">{m.hint}</span>
                </span>
              </label>
            ))}
          </div>

          {mode !== 'off' && (
            <div role="radiogroup" aria-label="How codes are sent" className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {METHODS.map((m) => (
                <label
                  key={m.id}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-card border bg-white p-3 transition-colors hover:bg-secondary ${method === m.id ? 'border-brand ring-2 ring-brand/30' : 'border-border'}`}
                >
                  <input type="radio" name="two-step-method" value={m.id} checked={method === m.id} onChange={() => setMethod(m.id)} className="mt-0.5 accent-brand" />
                  <span>
                    <span className="block text-[12.5px] font-semibold text-ink">{m.label}</span>
                    <span className="block text-[11.5px] text-muted-foreground">{m.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <Button onClick={() => void save()} disabled={busy || !changed}>
              {busy ? 'Saving...' : 'Save'}
            </Button>
          </div>

          <div className="mt-4 border-t border-border pt-3">
            <p className="m-0 text-[12px] font-semibold text-ink">People who turned it on for themselves ({people.length})</p>
            {people.length === 0 ? (
              <p className="m-0 mt-1 text-[11.5px] text-muted-foreground">Anyone can, from their own settings or profile.</p>
            ) : (
              <ul className="m-0 mt-2 p-0 list-none flex flex-col gap-1.5">
                {people.map((p) => (
                  <li key={p.user_id} className="flex items-center justify-between gap-3 text-[12px] text-ink">
                    <span className="min-w-0 truncate">{p.name || p.email} <span className="text-muted-foreground">· {p.method === 'sms' ? 'SMS' : 'email'}</span></span>
                    <Button
                      variant="ghost"
                      onClick={async () => {
                        try {
                          await resetTwoStep(p.user_id);
                          setPeople((prev) => prev.filter((x) => x.user_id !== p.user_id));
                          toast.success(`Reset for ${p.name || p.email}`);
                        } catch (e) {
                          toast.error((e as Error).message);
                        }
                      }}
                    >
                      Reset
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <p className="m-0 mt-1 text-[11px] text-muted-foreground">Reset turns it off for someone who lost their phone or email, and removes their registered SMS number.</p>
          </div>
        </>
      )}
    </Card>
  );
}
