import { useEffect, useState } from 'react';
import { loadBranding, type LetterBranding } from '../../lib/offers';
import { type StaffIdCardSettings, DEFAULT_CARD_SETTINGS, loadCardSettings } from '../../lib/staffIdCards';

/** The company's look (logo, name, colours, contacts, as on its letters) and its card settings. */
export function useCardLook() {
  const [branding, setBranding] = useState<LetterBranding | null>(null);
  const [settings, setSettings] = useState<StaffIdCardSettings>(DEFAULT_CARD_SETTINGS);
  useEffect(() => {
    let live = true;
    Promise.all([loadBranding().catch(() => ({ name: 'Your company' }) as LetterBranding), loadCardSettings()]).then(([b, s]) => {
      if (!live) return;
      setBranding(b);
      setSettings(s);
    });
    return () => {
      live = false;
    };
  }, []);
  return { branding, settings, setSettings, loading: !branding };
}
