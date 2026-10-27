import type { LetterBranding } from '../../lib/offers';

// Text helpers for the staff ID card's SVG faces (SVG text does not wrap by itself).

/** Splits text into lines of at most about `max` characters, at spaces. */
export function wrapText(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && (line + ' ' + word).length > max) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The company's postal address on one line. */
export const companyAddress = (b: LetterBranding) =>
  [b.address_line1, b.address_line2, b.city, b.postal_code, b.country].map((v) => (v ?? '').trim()).filter(Boolean).join(', ');
