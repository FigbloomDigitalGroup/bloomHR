import { type ReactNode, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Crop, Download, FileDown, Printer } from 'lucide-react';
import { Button } from '../UI';
import StaffIdCard from './StaffIdCard';
import PhotoFramer from './PhotoFramer';
import type { LetterBranding } from '../../lib/offers';
import {
  type CardLayout,
  type PhotoFraming,
  type StaffIdCardData,
  type StaffIdCardSettings,
  forLayout,
  framingOf,
  fullName,
  withFraming,
} from '../../lib/staffIdCards';
import { cardFileName, downloadCardPdf, downloadCardPng, facesIn, printCards } from '../../lib/staffIdCardExport';

type Busy = 'png' | 'pdf' | 'print' | null;

const TITLES: Record<CardLayout, string> = { portrait: 'Portrait', landscape: 'Landscape' };

/**
 * One card, front and back, shown portrait and, below it, landscape: each with Download PNG, Download PDF and Print,
 * so people take whichever they want. `actions` adds buttons (Reissue...) under both. With `onCardChange`, a card with
 * a photo also gets Adjust photo on each layout, to move and zoom the photo in that card's hexagon (each layout keeps
 * its own framing).
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
  return (
    <div className="space-y-6">
      {(['portrait', 'landscape'] as CardLayout[]).map((layout) => (
        <LayoutCard key={layout} layout={layout} card={card} branding={branding} settings={settings} onCardChange={onCardChange} />
      ))}
      {!card.is_active && (
        <p className="m-0 text-center text-[12px] font-semibold text-status-danger">
          This person is not a current employee: scanning the card says “Not active”.
        </p>
      )}
      {actions && <div className="flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}

function LayoutCard({
  layout,
  card,
  branding,
  settings,
  onCardChange,
}: {
  layout: CardLayout;
  card: StaffIdCardData;
  branding: LetterBranding;
  settings: StaffIdCardSettings;
  onCardChange?: (card: StaffIdCardData) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<Busy>(null);
  // while adjusting the photo, the card shows where it is being moved to
  const [framing, setFraming] = useState<PhotoFraming | null>(null);
  const shown = framing ? withFraming(card, framing, layout) : card;
  const title = TITLES[layout];
  const fileName = cardFileName(`${fullName(card)}${layout === 'landscape' ? ' landscape' : ''}`, card.employee_number);

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
    <section className="space-y-3" aria-label={`${title} card`}>
      <p className="m-0 text-center text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div ref={ref}>
        <StaffIdCard card={shown} branding={branding} settings={settings} layout={layout} />
      </div>
      {framing && card.photo_url ? (
        <PhotoFramer
          employeeId={card.employee_id}
          photoUrl={card.photo_url}
          framing={framing}
          layout={layout}
          onChange={setFraming}
          onCancel={() => setFraming(null)}
          onSaved={(f) => {
            onCardChange?.(withFraming(card, f, layout));
            setFraming(null);
          }}
        />
      ) : (
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="secondary" onClick={run('png')} disabled={!!busy} icon={<Download className="w-3.5 h-3.5" />}
            aria-label={`Download PNG (${title.toLowerCase()})`}>
            {busy === 'png' ? 'Making image…' : 'Download PNG'}
          </Button>
          <Button variant="secondary" onClick={run('pdf')} disabled={!!busy} icon={<FileDown className="w-3.5 h-3.5" />}
            aria-label={`Download PDF (${title.toLowerCase()})`}>
            {busy === 'pdf' ? 'Making PDF…' : 'Download PDF'}
          </Button>
          <Button onClick={run('print')} disabled={!!busy} icon={<Printer className="w-3.5 h-3.5" />} aria-label={`Print (${title.toLowerCase()})`}>
            Print
          </Button>
          {onCardChange && card.photo_url && (
            <Button
              variant="secondary"
              onClick={() => setFraming(framingOf(forLayout(card, layout)))}
              disabled={!!busy}
              icon={<Crop className="w-3.5 h-3.5" />}
              aria-label={`Adjust photo (${title.toLowerCase()})`}
            >
              Adjust photo
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
