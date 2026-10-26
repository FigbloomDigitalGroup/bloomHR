import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { PenLine } from 'lucide-react';
import { Button, Card } from '../UI';
import { confirmDialog } from '../../lib/confirmDialog';
import { clearMySignature, loadMySignature, saveMySignature } from '../../lib/signatures';
import SignaturePad from './SignaturePad';

/**
 * The signed-in person's signature: draw it once and it is kept (only they can see it) and put on the letters they send.
 * `bare` drops the card, for use inside another screen; `onChange` hears the saved signature (a data: URL) or null.
 */
export default function MySignature({ bare = false, onChange }: { bare?: boolean; onChange?: (signature: string | null) => void }) {
  const [signature, setSignature] = useState<string | null | undefined>(undefined);
  const [drawing, setDrawing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadMySignature().then(
      (s) => {
        setSignature(s);
        onChange?.(s);
      },
      (err) => {
        setSignature(null);
        toast.error((err as Error).message);
      }
    );
    // load once; onChange is a callback from the parent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (png: Blob) => {
    setBusy(true);
    try {
      const saved = await saveMySignature(png);
      setSignature(saved);
      onChange?.(saved);
      setDrawing(false);
      toast.success('Signature saved');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!(await confirmDialog({ title: 'Remove your signature?', message: 'Letters you send after this have an empty space to sign by hand. Letters already sent keep it.', confirmLabel: 'Remove', tone: 'danger' }))) return;
    setBusy(true);
    try {
      await clearMySignature();
      setSignature(null);
      onChange?.(null);
      toast.success('Signature removed');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <>
      {signature === undefined ? (
        <p className="m-0 text-[12px] text-muted-foreground">Loading your signature…</p>
      ) : drawing ? (
        <SignaturePad onSave={save} onCancel={() => setDrawing(false)} busy={busy} />
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          {signature ? (
            <img src={signature} alt="Your signature" className="h-16 w-auto max-w-[240px] object-contain rounded-lg border border-border bg-white px-3 py-1" />
          ) : (
            <p className="m-0 text-[12.5px] text-muted-foreground">You have not drawn a signature yet.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant={signature ? 'secondary' : 'primary'} onClick={() => setDrawing(true)} disabled={busy} icon={<PenLine className="h-4 w-4" />}>
              {signature ? 'Draw a new one' : 'Draw your signature'}
            </Button>
            {signature && <Button variant="ghost" onClick={() => void remove()} disabled={busy}>Remove</Button>}
          </div>
        </div>
      )}
    </>
  );

  if (bare) return body;
  return (
    <Card className="mb-4">
      <h2 className="m-0 text-[14px] font-bold text-ink">My signature</h2>
      <p className="mt-0.5 mb-3.5 text-[12px] text-muted-foreground">
        Draw it once with your mouse, finger or pen. It goes on the letters you send (where a template says {'{{signature}}'}); only you can see it here.
      </p>
      {body}
    </Card>
  );
}
