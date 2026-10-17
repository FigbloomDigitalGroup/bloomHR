import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ShieldCheck } from 'lucide-react';
import { Card, Button } from '../UI';
import { loadMyTwoStep, saveMyTwoStep, type MyTwoStep, type TwoStepMethod } from '../../lib/mfaApi';

/**
 * A person's own two-step sign-in (FIG-891): anyone can ask for a code at every sign-in, by email or SMS. When their
 * company asks it of them, it shows as on and can't be turned off (the database checks).
 */
export default function MyTwoStepCard({ className = '' }: { className?: string }) {
  const [saved, setSaved] = useState<MyTwoStep | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [method, setMethod] = useState<TwoStepMethod>('email');
  const [busy, setBusy] = useState(false);

  const show = (s: MyTwoStep) => {
    setSaved(s);
    setEnabled(s.enabled);
    setMethod(s.method);
  };

  useEffect(() => {
    let live = true;
    loadMyTwoStep().then((s) => {
      if (live && s) show(s);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!saved) return null;

  const changed = enabled !== saved.enabled || (enabled && method !== saved.method);

  const save = async () => {
    setBusy(true);
    try {
      show(await saveMyTwoStep(enabled, method));
      toast.success(enabled ? 'You will be asked for a code when you sign in' : 'Two-step sign-in turned off for you');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={className}>
      <div className="flex items-start gap-3">
        <div className={`w-[38px] h-[38px] shrink-0 rounded-tile flex items-center justify-center ${saved.enabled ? 'bg-green-tint text-brand' : 'bg-secondary text-muted-foreground'}`}>
          <ShieldCheck className="w-[17px] h-[17px]" strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-[13.5px] font-bold text-ink">My sign-in code</h2>
          <p className="m-0 text-[11.5px] text-muted-foreground max-w-[560px]">
            Ask for a 6-digit code after your password every time you sign in, so nobody who learns your password can get in.
          </p>
          {saved.company_requires ? (
            <p className="m-0 mt-2 text-[12px] text-brand font-semibold" role="status">On: your company asks for a code when you sign in.</p>
          ) : (
            <>
              <label className="mt-3 flex items-center gap-2 text-[12.5px] text-ink">
                <input type="checkbox" className="accent-brand" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                Ask for a code when I sign in
              </label>
              {enabled && (
                <div role="radiogroup" aria-label="Send my code by" className="mt-2 flex flex-wrap gap-4 text-[12px] text-ink">
                  {(['email', 'sms'] as TwoStepMethod[]).map((m) => (
                    <label key={m} className="flex items-center gap-1.5">
                      <input type="radio" name="my-two-step-method" className="accent-brand" checked={method === m} onChange={() => setMethod(m)} />
                      {m === 'email' ? 'Email' : 'SMS (to my registered number; email if I have none)'}
                    </label>
                  ))}
                </div>
              )}
              <div className="mt-3 flex justify-end">
                <Button onClick={() => void save()} disabled={busy || !changed}>{busy ? 'Saving...' : 'Save'}</Button>
              </div>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
