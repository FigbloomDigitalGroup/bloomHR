import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { RefreshCw, Settings2 } from 'lucide-react';
import { Button, Modal } from '../UI';
import { LoaderBlock } from '../UI/FigbloomLoader';
import StaffIdCardViewer from './StaffIdCardViewer';
import StaffIdCardSettingsPanel from './StaffIdCardSettingsPanel';
import { useCardLook } from './useCardLook';
import { type StaffIdCardData, fullName, loadStaffIdCards, regenerateStaffIdCard } from '../../lib/staffIdCards';
import { confirmDialog } from '../../lib/confirmDialog';

/**
 * An employee's ID card from their profile (the 'staff-id-cards' module): view, download, print, and reissue it when
 * a card is lost (the old card's QR code then stops working).
 */
export default function StaffIdCardDialog({ employeeId, open, onClose }: { employeeId: string; open: boolean; onClose: () => void }) {
  const { branding, settings, setSettings } = useCardLook();
  const [card, setCard] = useState<StaffIdCardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [reissuing, setReissuing] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setError(null);
    loadStaffIdCards([employeeId])
      .then(([c]) => {
        if (!live) return;
        if (c) setCard(c);
        else setError('This employee was not found.');
      })
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [employeeId, open]);

  const reissue = async () => {
    if (!card) return;
    const ok = await confirmDialog({
      title: 'Reissue this card?',
      message: `${fullName(card)} gets a new card with a new QR code. The old card stops verifying straight away: print the new one and take the old one back.`,
      confirmLabel: 'Reissue card',
      tone: 'danger',
    });
    if (!ok) return;
    setReissuing(true);
    try {
      const fresh = await regenerateStaffIdCard(card.employee_id);
      setCard({ ...card, ...fresh });
      toast.success('Card reissued: the old one no longer verifies');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setReissuing(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Staff ID card" size="3xl">
      {error ? (
        <p className="text-status-danger text-[12.5px]">{error}</p>
      ) : !card || !branding ? (
        <LoaderBlock label="Loading the card" />
      ) : (
        <div className="space-y-4">
          <StaffIdCardViewer
            card={card}
            branding={branding}
            settings={settings}
            actions={
              <>
                <Button variant="secondary" onClick={reissue} disabled={reissuing} icon={<RefreshCw className="w-3.5 h-3.5" />}>
                  {reissuing ? 'Reissuing…' : 'Reissue card'}
                </Button>
                <Button variant="ghost" onClick={() => setShowSettings((v) => !v)} icon={<Settings2 className="w-3.5 h-3.5" />}>
                  Card settings
                </Button>
              </>
            }
          />
          {showSettings && <StaffIdCardSettingsPanel settings={settings} onSaved={setSettings} />}
        </div>
      )}
    </Modal>
  );
}
