import { type ReactNode, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Crop, Download, FileDown, Printer } from 'lucide-react';
import { Button } from '../UI';
import StaffIdCard from './StaffIdCard';
import PhotoFramer from './PhotoFramer';
import type { LetterBranding } from '../../lib/offers';
import { type PhotoFraming, type StaffIdCardData, type StaffIdCardSettings, framingOf, fullName } from '../../lib/staffIdCards';
import { cardFileName, downloadCardPdf, downloadCardPng, facesIn, printCards } from '../../lib/staffIdCardExport';

type Busy = 'png' | 'pdf' | 'print' | null;

const withFraming = (card: StaffIdCardData, f: PhotoFraming): StaffIdCardData => ({ ...card, photo_x: f.x, photo_y: f.y, photo_zoom: f.zoom });

/**
 * One card, front and back, with Download PNG, Download PDF and Print. `actions` adds buttons (Reissue...). With
 * `onCardChange`, a card with a photo also gets Adjust photo, to move and zoom the photo in its hexagon.
 */
export default function StaffIdCardViewer({
  card,
  branding,
  settings,
  actions,
  onCardChange,
}: {
  card: StaffIdCardData;
  branding: LetterBranding;
  settings: StaffIdCardSettings;
  actions?: ReactNode;
  onCardChange?: (card: StaffIdCardData) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<Busy>(null);
  // while adjusting the photo, the card shows where it is being moved to
  const [framing, setFraming] = useState<PhotoFraming | null>(null);
  const shown = framing ? withFraming(card, framing) : card;
  const fileName = cardFileName(fullName(card), card.employee_number);

  const run = (which: Exclude<Busy, null>) => async () => {
    if (!ref.current) return;
    setBusy(which);
    try {
      const [faces] = await facesIn(ref.current);
      if (!faces) throw new Error('The card is not ready yet.');
      if (which === 'png') await downloadCardPng(faces, fileName);
      if (which === 'pdf') await downloadCardPdf(faces, fileName);
      if (which === 'print') printCards([faces], `ID card - ${fullName(card)}`);
    } catch (e) {
      toast.error((e as Error).message || 'Something went wrong with the card.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div ref={ref}>
        <StaffIdCard card={shown} branding={branding} settings={settings} />
      </div>
      {!card.is_active && (
        <p className="m-0 text-center text-[12px] font-semibold text-status-danger">
          This person is not a current employee: scanning the card says “Not active”.
        </p>
      )}
      {framing && card.photo_url ? (
        <PhotoFramer
          employeeId={card.employee_id}
          photoUrl={card.photo_url}
          framing={framing}
          onChange={setFraming}
          onCancel={() => setFraming(null)}
          onSaved={(f) => {
            onCardChange?.(withFraming(card, f));
            setFraming(null);
          }}
        />
      ) : (
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="secondary" onClick={run('png')} disabled={!!busy} icon={<Download className="w-3.5 h-3.5" />}>
            {busy === 'png' ? 'Making image…' : 'Download PNG'}
          </Button>
          <Button variant="secondary" onClick={run('pdf')} disabled={!!busy} icon={<FileDown className="w-3.5 h-3.5" />}>
            {busy === 'pdf' ? 'Making PDF…' : 'Download PDF'}
          </Button>
          <Button onClick={run('print')} disabled={!!busy} icon={<Printer className="w-3.5 h-3.5" />}>
            Print
          </Button>
          {onCardChange && card.photo_url && (
            <Button variant="secondary" onClick={() => setFraming(framingOf(card))} disabled={!!busy} icon={<Crop className="w-3.5 h-3.5" />}>
              Adjust photo
            </Button>
          )}
          {actions}
        </div>
      )}
    </div>
  );
}
