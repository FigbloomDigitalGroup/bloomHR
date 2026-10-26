import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

import OfferLetter from './OfferLetter';
import { imagesLoaded, type LetterBranding } from '../../lib/offers';

const BRANDING: LetterBranding = {
  name: 'Acme Ltd', logo_url: 'https://cdn/logo.png', tagline: 'We build', primary_color: '#112233',
  address_line1: 'Acme House', city: 'Nairobi', country: 'Kenya', phone: '+254 712 345678', email: 'hr@acme.co',
};

const renderLetter = (branding: LetterBranding) =>
  render(<OfferLetter branding={branding} title="Offer of employment" text={'Dear Jane,\n\nWelcome.'} date="2026-10-15" />);

afterEach(() => cleanup());

describe('OfferLetter letterhead', () => {
  it('without an uploaded letterhead, shows the one made from the profile (logo, name, address)', () => {
    renderLetter(BRANDING);
    const letter = within(screen.getByTestId('offer-letter'));
    expect((letter.getByAltText('Acme Ltd logo') as HTMLImageElement).crossOrigin).toBe('anonymous');
    expect(letter.getByText('Acme Ltd')).toBeTruthy();
    expect(letter.getByText('We build')).toBeTruthy();
    expect(letter.getByText(/Acme House, Nairobi, Kenya/)).toBeTruthy();
    expect(letter.queryByTestId('letterhead-header')).toBeNull();
    expect(letter.queryByTestId('letterhead-footer')).toBeNull();
  });

  it('an uploaded header replaces the generated block; the date and title stay', () => {
    renderLetter({ ...BRANDING, letterhead_header_url: 'https://cdn/header.png' });
    const letter = within(screen.getByTestId('offer-letter'));
    const header = letter.getByTestId('letterhead-header') as HTMLImageElement;
    expect(header.src).toBe('https://cdn/header.png');
    expect(header.crossOrigin).toBe('anonymous');
    expect(letter.queryByAltText('Acme Ltd logo')).toBeNull();
    expect(letter.queryByText('We build')).toBeNull();
    expect(letter.queryByText(/Acme House/)).toBeNull();
    expect(letter.getByRole('heading', { name: 'Offer of employment' })).toBeTruthy();
    expect(letter.getByText(/15 October 2026/)).toBeTruthy();
    expect(letter.queryByTestId('letterhead-footer')).toBeNull();
  });

  it('an uploaded footer is shown at the bottom', () => {
    renderLetter({ ...BRANDING, letterhead_footer_url: 'https://cdn/footer.png' });
    const letter = screen.getByTestId('offer-letter');
    const footer = within(letter).getByTestId('letterhead-footer') as HTMLImageElement;
    expect(footer.src).toBe('https://cdn/footer.png');
    expect(footer.crossOrigin).toBe('anonymous');
    expect(letter.lastElementChild).toBe(footer);
    // the header is still the generated one
    expect(within(letter).getByAltText('Acme Ltd logo')).toBeTruthy();
  });
});

describe('the signature', () => {
  const text = 'Dear Jane,\n\nYours sincerely,\n\n{{signature}}\nMary Hr\nHR Officer';

  it('a {{signature}} line is the drawn signature, between the sign-off and the name', () => {
    render(<OfferLetter branding={BRANDING} title="Letter" text={text} signature="data:image/png;base64,AAA" />);
    const letter = within(screen.getByTestId('offer-letter'));
    expect((letter.getByTestId('letter-signature') as HTMLImageElement).src).toBe('data:image/png;base64,AAA');
    expect(letter.getByText('Mary Hr')).toBeTruthy();
    expect(letter.getByText('HR Officer')).toBeTruthy();
    expect(letter.queryByText(/\{\{signature\}\}/)).toBeNull();
  });

  it('without a signature the line is left as space to sign by hand', () => {
    render(<OfferLetter branding={BRANDING} title="Letter" text={text} />);
    const letter = within(screen.getByTestId('offer-letter'));
    expect(letter.queryByTestId('letter-signature')).toBeNull();
    expect(letter.queryByText(/\{\{signature\}\}/)).toBeNull();
    expect(letter.getByText('Mary Hr')).toBeTruthy();
  });
});

describe('imagesLoaded (before the PDF is made)', () => {
  it('waits for images still loading, and gives up after the timeout', async () => {
    const box = document.createElement('div');
    const img = document.createElement('img');
    Object.defineProperty(img, 'complete', { value: false });
    box.appendChild(img);
    let done = false;
    const wait = imagesLoaded(box).then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    img.dispatchEvent(new Event('load'));
    await wait;
    expect(done).toBe(true);

    const stuck = document.createElement('img');
    Object.defineProperty(stuck, 'complete', { value: false });
    box.replaceChildren(stuck);
    await imagesLoaded(box, 5); // never loads: resolves anyway
  });
});
