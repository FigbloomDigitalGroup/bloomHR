import { useEffect, useState } from 'react';
import { IdCard } from 'lucide-react';
import { EmptyState, PageHeader } from '../UI';
import { LoaderBlock } from '../UI/FigbloomLoader';
import StaffIdCardViewer from '../StaffIdCard/StaffIdCardViewer';
import { useCardLook } from '../StaffIdCard/useCardLook';
import { type StaffIdCardData, loadMyStaffIdCard } from '../../lib/staffIdCards';

/** The staff portal's "My ID card": the employee's own staff ID card, to show on the phone, download or print. */
export default function MyIdCard() {
  const { branding, settings } = useCardLook();
  const [card, setCard] = useState<StaffIdCardData | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadMyStaffIdCard()
      .then((c) => live && setCard(c))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="My ID card" subtitle="Your staff ID card. Show it on your phone, or download or print it." />
      {error ? (
        <p className="text-status-danger text-[12.5px]">{error}</p>
      ) : card === undefined || !branding ? (
        <LoaderBlock label="Loading your ID card" />
      ) : card === null ? (
        <EmptyState icon={<IdCard className="w-6 h-6" />} title="No ID card yet" description="Your login is not linked to an employee record in this company. Ask HR." />
      ) : (
        <StaffIdCardViewer card={card} branding={branding} settings={settings} />
      )}
    </div>
  );
}
