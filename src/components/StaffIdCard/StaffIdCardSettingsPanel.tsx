import { useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '../UI';
import { type StaffIdCardSettings, saveCardSettings } from '../../lib/staffIdCards';
import { loadMySignature } from '../../lib/signatures';

/**
 * What every card in the company shows (the 'staff-id-cards' module): the date of birth (off by default, it's
 * personal data) and the authorised signatory on the back. The signature is the signer's own drawn signature (My
 * signature, as on letters), copied onto the cards so everyone's card can show it.
 */
export default function StaffIdCardSettingsPanel({
  settings,
  onSaved,
}: {
  settings: StaffIdCardSettings;
  onSaved: (s: StaffIdCardSettings) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);

  const save = async (next: StaffIdCardSettings) => {
    setSaving(true);
    try {
      const saved = await saveCardSettings(next);
      setDraft(saved);
      onSaved(saved);
      toast.success('Card settings saved');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const useMySignature = async () => {
    try {
      const signature = await loadMySignature();
      if (!signature) {
        toast.error('Draw your signature first (My signature, on the letter screens), then use it here.');
        return;
      }
      setDraft((d) => ({ ...d, signature }));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const input = 'w-full rounded-tile border border-border bg-white px-3 py-2 text-[12.5px]';
  return (
    <div className="space-y-3 rounded-tile border border-border bg-background p-4 text-[12.5px]">
      <p className="m-0 font-semibold text-ink">Card settings (every card in the company)</p>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={draft.show_date_of_birth}
          onChange={(e) => setDraft((d) => ({ ...d, show_date_of_birth: e.target.checked }))}
        />
        Show the date of birth on the front
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-muted-foreground">Signatory’s name</span>
          <input className={input} value={draft.signatory_name ?? ''} maxLength={120}
            onChange={(e) => setDraft((d) => ({ ...d, signatory_name: e.target.value }))} />
        </label>
        <label className="block">
          <span className="mb-1 block text-muted-foreground">Signatory’s title</span>
          <input className={input} value={draft.signatory_title ?? ''} maxLength={120} placeholder="e.g. HR Manager"
            onChange={(e) => setDraft((d) => ({ ...d, signatory_title: e.target.value }))} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {draft.signature ? (
          <img src={draft.signature} alt="Signature on the cards" className="h-10 rounded border border-border bg-white px-2" />
        ) : (
          <span className="text-muted-foreground">No signature on the cards</span>
        )}
        <Button variant="secondary" onClick={useMySignature}>Use my signature</Button>
        {draft.signature && (
          <Button variant="ghost" onClick={() => setDraft((d) => ({ ...d, signature: null }))}>Remove signature</Button>
        )}
      </div>
      <div className="flex justify-end">
        <Button onClick={() => save(draft)} disabled={saving}>{saving ? 'Saving…' : 'Save card settings'}</Button>
      </div>
    </div>
  );
}
