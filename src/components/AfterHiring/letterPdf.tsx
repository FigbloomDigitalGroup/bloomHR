import type { ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import OfferLetter from './OfferLetter';
import { letterPdfBlob } from '../../lib/offers';

// A letter as a PDF file, rendered off screen: the same OfferLetter as on screen, so the copy kept in the archive is
// the letter people saw. For when there is no letter on screen to turn into a PDF (sending from the offer list, an
// acceptance noticed later).

export async function renderLetterPdf(props: Omit<ComponentProps<typeof OfferLetter>, 'ref'>): Promise<Blob> {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, { position: 'fixed', left: '-10000px', top: '0', width: '800px', pointerEvents: 'none' });
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(<OfferLetter {...props} />));
    return await letterPdfBlob(host.firstElementChild as HTMLElement);
  } finally {
    root.unmount();
    host.remove();
  }
}
