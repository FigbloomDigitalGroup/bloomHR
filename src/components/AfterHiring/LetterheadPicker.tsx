import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { ImagePlus, Trash2 } from 'lucide-react';
import { Button } from '../UI';
import { letterheadFileError, setCompanyLetterhead, uploadLetterheadImage } from '../../lib/companyProfile';
import type { LetterBranding } from '../../lib/offers';

// The company's letterhead, set from a letter screen: a header image across the top of every letter (in place of the
// one made from the logo and name) and an optional footer image. They are the company's, used on offer and exit
// letters alike, and the same as on Settings > Company profile.

type Part = 'header' | 'footer';
const LABEL: Record<Part, string> = { header: 'Header', footer: 'Footer' };

export default function LetterheadPicker({ branding, onChange }: { branding: LetterBranding; onChange: (branding: LetterBranding) => void }) {
  const [busy, setBusy] = useState<Part | null>(null);
  const inputs = { header: useRef<HTMLInputElement>(null), footer: useRef<HTMLInputElement>(null) };
  const url = (part: Part) => (part === 'header' ? branding.letterhead_header_url : branding.letterhead_footer_url) ?? null;

  const save = async (part: Part, next: string | null) => {
    const saved = await setCompanyLetterhead(part === 'header' ? next : url('header'), part === 'footer' ? next : url('footer'));
    onChange({ ...branding, ...saved });
  };

  const pick = async (part: Part, file?: File) => {
    if (inputs[part].current) inputs[part].current.value = '';
    if (!file) return;
    const problem = letterheadFileError(file);
    if (problem) return void toast.error(problem);
    setBusy(part);
    try {
      await save(part, await uploadLetterheadImage(file));
      toast.success(`Letterhead ${LABEL[part].toLowerCase()} saved for all letters`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (part: Part) => {
    setBusy(part);
    try {
      await save(part, null);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <p className="text-xs font-medium text-ink mb-1">Letterhead</p>
      <p className="m-0 mb-2 text-[11px] text-subtle">
        Your designed letterhead as images, the width of the page (PNG or JPG, up to 2 MB). Without a header, letters use one made
        from your logo and company name. It applies to every letter.
      </p>
      <div className="space-y-2">
        {(['header', 'footer'] as const).map((part) => (
          <div key={part} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <span className="w-14 text-[12px] font-semibold text-ink">{LABEL[part]}</span>
            {url(part) ? (
              <img src={url(part) as string} alt={`Letterhead ${part}`} className="h-10 max-w-[180px] flex-1 object-contain object-left" />
            ) : (
              <span className="flex-1 text-[11.5px] text-muted-foreground">{part === 'header' ? 'None: made from your logo and name' : 'None'}</span>
            )}
            <input ref={inputs[part]} type="file" accept="image/png,image/jpeg" className="sr-only" aria-label={`Upload a letterhead ${part}`}
              onChange={(e) => void pick(part, e.target.files?.[0])} />
            <Button variant="secondary" disabled={busy !== null} onClick={() => inputs[part].current?.click()} icon={<ImagePlus className="h-4 w-4" />}>
              {busy === part ? 'Saving…' : url(part) ? 'Change' : 'Upload'}
            </Button>
            {url(part) && (
              <Button variant="ghost" disabled={busy !== null} aria-label={`Remove the letterhead ${part}`} onClick={() => void remove(part)}
                icon={<Trash2 className="h-4 w-4" />}>{''}</Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
