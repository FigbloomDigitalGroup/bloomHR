import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * Signing a contract by drawing (FIG-1232): the contract HR sent (a PDF) with a signature page added at the end, and a
 * line at the foot of every page saying who signed it and when. The original pages are not changed otherwise, and the
 * signature page names the original file's SHA-256, so anyone can check which contract was signed.
 */

export interface ContractSigner {
  name: string;
  employeeNumber: string;
  title: string;
  signedAt: Date;
  /** the drawn signature, a PNG */
  signature: Uint8Array;
  /** SHA-256 (hex) of the contract HR sent */
  originalSha256: string;
}

const INK = rgb(0.12, 0.16, 0.22);
const MUTED = rgb(0.42, 0.45, 0.5);

/** "20 Nov 2026, 09:41" in the signer's own time. */
export const signedWhen = (d: Date) =>
  d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// the standard PDF fonts only draw WinAnsi characters: anything else (emoji, other scripts) becomes "?" rather than failing
const WIN_ANSI_EXTRA = String.fromCharCode(0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2026);
const winAnsi = (s: string) =>
  Array.from(s, (ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.includes(ch) ? ch : '?';
  }).join('');

/** Breaks text into lines no wider than `width` at this font size. */
function wrap(text: string, width: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= width || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The signed contract: the original PDF's bytes in, the signed PDF's bytes out. */
export async function signContractPdf(original: Uint8Array | ArrayBuffer, signer: ContractSigner): Promise<Uint8Array> {
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(original, { updateMetadata: false });
  } catch {
    throw new Error('This contract file could not be read, so it cannot be signed here. Download it, sign it and upload the signed copy instead.');
  }
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const image = await pdf.embedPng(signer.signature);
  const name = winAnsi(signer.name.trim() || signer.employeeNumber);
  const when = signedWhen(signer.signedAt);
  const title = winAnsi(signer.title);

  // a line at the foot of every original page
  const originals = pdf.getPages();
  const footer = winAnsi(`Signed electronically by ${name} (${signer.employeeNumber}) on ${when}. Signature on the last page.`);
  originals.forEach((page) => {
    const { width } = page.getSize();
    const size = 7;
    const text = footer.length > 150 ? `${footer.slice(0, 147)}...` : footer;
    page.drawText(text, { x: Math.max(12, (width - font.widthOfTextAtSize(text, size)) / 2), y: 12, size, font, color: MUTED });
  });

  // the signature page, A4 or the contract's own page size
  const first = originals[0]?.getSize() ?? { width: 595.28, height: 841.89 };
  const page = pdf.addPage([first.width, first.height]);
  const margin = 56;
  const usable = first.width - margin * 2;
  let y = first.height - margin;
  const line = (text: string, opts: { size?: number; bold?: boolean; color?: typeof INK; gap?: number } = {}) => {
    const size = opts.size ?? 11;
    const f = opts.bold ? bold : font;
    for (const l of wrap(text, usable, (s) => f.widthOfTextAtSize(s, size))) {
      y -= size + 4;
      page.drawText(l, { x: margin, y, size, font: f, color: opts.color ?? INK });
    }
    y -= opts.gap ?? 0;
  };

  line('Signature', { size: 18, bold: true, gap: 10 });
  line(`I, ${name}, have read the contract "${title}" on the previous ${originals.length === 1 ? 'page' : `${originals.length} pages`} and agree to its terms.`, { gap: 24 });

  // the signature, at most 240 x 90 points, keeping its shape
  const scale = Math.min(240 / image.width, 90 / image.height, 1);
  const w = image.width * scale;
  const h = image.height * scale;
  y -= h;
  page.drawImage(image, { x: margin, y, width: w, height: h });
  y -= 6;
  page.drawLine({ start: { x: margin, y }, end: { x: margin + 260, y }, thickness: 0.75, color: MUTED });
  y -= 4;
  line(name, { bold: true });
  line(`Employee number ${signer.employeeNumber}`, { size: 10, color: MUTED });
  line(`Signed ${when}`, { size: 10, color: MUTED, gap: 30 });

  line('Drawn in the Figbloom HR staff portal while signed in to the employee\'s own account.', { size: 8, color: MUTED });
  line(`SHA-256 of the contract as sent: ${signer.originalSha256}`, { size: 8, color: MUTED });

  pdf.setModificationDate(signer.signedAt);
  return pdf.save();
}
