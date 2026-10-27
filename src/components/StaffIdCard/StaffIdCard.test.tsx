import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import StaffIdCard, { StaffIdCardBack, StaffIdCardFront } from './StaffIdCard';
import { wrapText } from './cardText';
import { code128Bars, encodeCode128 } from '../../lib/code128';
import { cardExpiry, initials, parseRecordDate, type StaffIdCardData, DEFAULT_CARD_SETTINGS } from '../../lib/staffIdCards';
import { sheetPages } from '../../lib/staffIdCardExport';

// The staff ID card (20261027400000): portrait, front and back, in the company's colours; the details, the photo or
// initials, a barcode of the employee number, the terms, dates, signatory and the QR code that verifies it.

const card: StaffIdCardData = {
  employee_id: 'e1', employee_number: 'MCL-000123', first_name: 'Esther', middle_name: null, last_name: 'Wanjiru',
  job_title: 'Accountant', department: 'Finance', branch: 'Nairobi', work_phone: '+254 712 345678', work_email: 'esther@acme.co',
  date_of_birth: null, date_joined: '2024-03-01', contract_end_date: null, photo_url: null, is_active: true,
  token: '0123456789abcdef0123456789abcdef', issued_at: '2026-10-27T08:00:00Z',
};
const branding = {
  name: 'Acme Ltd', tagline: 'We build', logo_url: 'https://cdn/logo.png', primary_color: '#0F766E', secondary_color: '#F59E0B',
  address_line1: 'Plot 7, Mombasa Road', city: 'Nairobi', country: 'Kenya', phone: '+254 20 123456', email: 'hello@acme.co',
};
// the words as read: each SVG text piece (line, bold part) apart, spaces tidied
const text = (el: Element) =>
  Array.from(el.querySelectorAll('text'))
    .map((t) => (t.children.length ? Array.from(t.children).map((c) => c.textContent).join(' ') : t.textContent))
    .join(' ')
    .replace(/\s+/g, ' ');

afterEach(cleanup);

describe('the front', () => {
  it('shows the company, the name (first name bold), job title and details, initials without a photo, and the barcode', () => {
    const { container } = render(<StaffIdCardFront card={card} branding={branding} settings={DEFAULT_CARD_SETTINGS} />);
    const svg = screen.getByRole('img', { name: 'Staff ID card of Esther Wanjiru, front' });
    expect(text(svg)).toContain('Acme Ltd');
    expect(text(svg)).toContain('We build');
    const first = Array.from(container.querySelectorAll('tspan')).find((t) => t.textContent === 'Esther');
    expect(first?.getAttribute('font-weight')).toBe('800');
    expect(text(svg)).toContain('ACCOUNTANT');
    for (const v of ['ID NO', ': MCL-000123', 'DEPARTMENT', ': Finance', 'PHONE', ': +254 712 345678', 'EMAIL', ': esther@acme.co']) {
      expect(text(svg)).toContain(v);
    }
    expect(text(svg)).not.toContain('DOB');
    expect(text(svg)).toContain('EW'); // initials in the hexagon
    expect(container.querySelector('[data-card-image="photo"]')).toBeNull();
    expect(container.querySelector('[data-card-image="logo"]')?.getAttribute('href')).toBe('https://cdn/logo.png');
    const barcode = container.querySelector('[data-barcode]')!;
    expect(barcode.getAttribute('data-barcode')).toBe('MCL-000123');
    expect(barcode.querySelectorAll('rect')).toHaveLength(code128Bars('MCL-000123').bars.length);
  });

  it('shows the photo in the hexagon when there is one, and the date of birth only when the company turns it on', () => {
    const withPhoto = { ...card, photo_url: 'https://cdn/e1.png', date_of_birth: '1995-05-05' };
    const { container } = render(
      <StaffIdCardFront card={withPhoto} branding={branding} settings={{ ...DEFAULT_CARD_SETTINGS, show_date_of_birth: true }} />,
    );
    const photo = container.querySelector('[data-card-image="photo"]')!;
    expect(photo.getAttribute('href')).toBe('https://cdn/e1.png');
    expect(photo.getAttribute('clip-path')).toMatch(/^url\(#photo-[A-Za-z0-9_-]+\)$/);
    expect(text(container)).toContain('DOB');
    expect(text(container)).toContain(': 05 May 1995');
  });

  it('puts a long name on two lines: the first name, then the rest', () => {
    const { container } = render(
      <StaffIdCardFront card={{ ...card, first_name: 'Maximilian', middle_name: 'Kipchoge', last_name: 'Ochieng-Odhiambo' }}
        branding={branding} settings={DEFAULT_CARD_SETTINGS} />,
    );
    const spans = Array.from(container.querySelectorAll('tspan')).map((t) => t.textContent);
    expect(spans).toContain('Maximilian');
    expect(spans).toContain('Kipchoge Ochieng-Odhiambo');
  });
});

describe('the back', () => {
  it('has the terms, the dates, the signatory, the QR code and the company’s contacts', () => {
    const settings = { ...DEFAULT_CARD_SETTINGS, signatory_name: 'Hana Hr', signatory_title: 'HR Manager', signature: 'data:image/png;base64,AAA=' };
    const { container } = render(<StaffIdCardBack card={card} branding={branding} settings={settings} origin="https://hr.example" />);
    const all = text(container);
    expect(all).toContain('This card is the property of Acme Ltd and must be returned on leaving.');
    expect(all).toContain('Carry it at all times at work');
    expect(all).toContain('If found, please return to Acme Ltd, Plot 7, Mombasa Road, Nairobi, Kenya.');
    expect(all).toContain('Joined Date: 01 Mar 2024');
    expect(all).toContain('Expiry Date: 27 Oct 2028');
    expect(all).toContain('Hana Hr');
    expect(all).toContain('HR Manager');
    expect(container.querySelector('image[href^="data:image/png"]')).toBeTruthy();
    expect(all).toContain('Scan to verify');
    expect(container.querySelectorAll('svg svg')).toHaveLength(1); // the QR code
    expect(all).toContain('Tel: +254 20 123456');
    expect(all).toContain('hello@acme.co');
  });

  it('shows both faces together', () => {
    render(<StaffIdCard card={card} branding={branding} settings={DEFAULT_CARD_SETTINGS} />);
    expect(screen.getAllByRole('img', { name: /Staff ID card of Esther Wanjiru/ })).toHaveLength(2);
  });
});

describe('what the card works out', () => {
  it('expires two years after issue, or when the contract ends if that is sooner', () => {
    expect(cardExpiry(card)?.toISOString().slice(0, 10)).toBe('2028-10-27');
    expect(cardExpiry({ ...card, contract_end_date: '30/06/2027' })?.toISOString().slice(0, 10)).toBe('2027-06-30');
    expect(cardExpiry({ ...card, contract_end_date: '2030-01-01' })?.toISOString().slice(0, 10)).toBe('2028-10-27');
  });

  it('reads record dates day-first, and makes initials', () => {
    expect(parseRecordDate('01/03/2024')?.toISOString().slice(0, 10)).toBe('2024-03-01');
    expect(parseRecordDate('not a date')).toBeNull();
    expect(initials({ first_name: 'esther', last_name: null })).toBe('E');
    expect(initials({ first_name: null, last_name: null })).toBe('?');
  });

  it('wraps the terms at spaces', () => {
    expect(wrapText('one two three four', 9)).toEqual(['one two', 'three', 'four']);
  });

  it('encodes Code 128 B: start, data, checksum, stop', () => {
    const widths = encodeCode128('A');
    // start B (211214), "A" = 33 (111323), checksum (104 + 33) % 103 = 34 (131123), stop (2331112)
    expect(widths.join('')).toBe('211214' + '111323' + '131123' + '2331112');
    expect(code128Bars('A').width).toBe(11 * 3 + 13);
  });

  it('lays nine cards to an A4 page, fronts then backs, the backs mirrored for printing both sides', () => {
    const cards = Array.from({ length: 10 }, (_, i) => ({ front: `F${i}`, back: `B${i}` }));
    const pages = sheetPages(cards);
    expect(pages).toHaveLength(4);
    expect(pages[0]).toEqual(['F0', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8']);
    expect(pages[1]).toEqual(['B2', 'B1', 'B0', 'B5', 'B4', 'B3', 'B8', 'B7', 'B6']);
    expect(pages[2]).toEqual(['F9', null, null]);
    expect(pages[3]).toEqual([null, null, 'B9']);
    expect(sheetPages([{ front: 'F', back: 'B' }])).toEqual([['F', 'B']]);
  });
});
