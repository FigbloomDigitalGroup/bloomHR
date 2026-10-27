import { type ReactNode, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Download, FileDown, Printer } from 'lucide-react';
import { Button } from '../UI';
import StaffIdCard from './StaffIdCard';
import type { LetterBranding } from '../../lib/offers';
import { type StaffIdCardData, type StaffIdCardSettings, fullName } from '../../lib/staffIdCards';
import { cardFileName, downloadCardPdf, downloadCardPng, facesIn, printCards } from '../../lib/staffIdCardExport';

type Busy = 'png' | 'pdf' | 'print' | null;

/** One card, front and back, with Download PNG, Download PDF and Print. `actions` adds buttons (Reissue...). */
export default function StaffIdCardViewer({
  card,
  branding,
  settings,
  actions,
}: {
  card: StaffIdCardData;
  branding: LetterBranding;
  settings: StaffIdCardSettings;
  actions?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<Busy>(null);
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
        <StaffIdCard card={card} branding={branding} settings={settings} />
      </div>
      {!card.is_active && (
        <p className="m-0 text-center text-[12px] font-semibold text-status-danger">
          This person is not a current employee: scanning the card says “Not active”.
        </p>
      )}
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
        {actions}
      </div>
    </div>
  );
}
