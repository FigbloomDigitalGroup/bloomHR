import { jsPDF } from 'jspdf';
import { saveAs } from 'file-saver';

// Downloading and printing staff ID cards (components/StaffIdCard). Each face is an SVG; to become a PNG, a PDF page
// or a printed card it is drawn as an image, and an SVG drawn as an image can't load anything from elsewhere, so the
// photo and logo are first copied into it (as data: URLs). An image that can't be fetched is left out: the photo's
// initials, drawn underneath it, then show instead.

/** The card's size in millimetres (ISO/IEC 7810 ID-1, portrait). */
export const CARD_MM = { w: 54, h: 85.6 };
/** The card's size in millimetres, portrait or landscape (the company's Card settings). */
export const cardMm = (landscape?: boolean) => (landscape ? { w: CARD_MM.h, h: CARD_MM.w } : CARD_MM);
/** Pixels per millimetre for the PNG and PDF: about 600 dpi, sharp enough to print. */
const PX_PER_MM = 24;

export interface CardFaces {
  front: string;
  back: string;
  /** a landscape card (85.6 x 54 mm); portrait when left out */
  landscape?: boolean;
}

/** Whether a drawn face is landscape: wider than it is tall. */
const isLandscape = (svg: SVGSVGElement) => {
  const [, , w, h] = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
  return w > h;
};

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/** Images already fetched in this page, by address (a department's cards share one logo). */
const fetched = new Map<string, Promise<string | null>>();
function fetchAsDataUrl(url: string): Promise<string | null> {
  if (!fetched.has(url)) {
    fetched.set(
      url,
      fetch(url, { mode: 'cors' })
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
        .then(toDataUrl)
        .catch(() => {
          fetched.delete(url); // try again next time
          return null;
        }),
    );
  }
  return fetched.get(url)!;
}

/** One face as standalone SVG markup, its images copied in, sized in millimetres. */
export async function faceMarkup(svg: SVGSVGElement): Promise<string> {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.removeAttribute('style');
  copy.removeAttribute('class');
  const mm = cardMm(isLandscape(svg));
  copy.setAttribute('width', `${mm.w}mm`);
  copy.setAttribute('height', `${mm.h}mm`);
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('font-family', svg.style.fontFamily || 'sans-serif');
  for (const img of Array.from(copy.querySelectorAll('image'))) {
    const href = img.getAttribute('href') || img.getAttribute('xlink:href') || '';
    if (!href || href.startsWith('data:')) continue;
    const data = await fetchAsDataUrl(href);
    if (data) img.setAttribute('href', data);
    else img.remove();
  }
  return new XMLSerializer().serializeToString(copy);
}

/** Front and back of every card in an element (the faces carry data-card-face), in order. */
export async function facesIn(el: HTMLElement): Promise<CardFaces[]> {
  const svgs = Array.from(el.querySelectorAll<SVGSVGElement>('svg[data-card-face]'));
  const out: CardFaces[] = [];
  for (let i = 0; i + 1 < svgs.length; i += 2) {
    out.push({ front: await faceMarkup(svgs[i]), back: await faceMarkup(svgs[i + 1]), landscape: isLandscape(svgs[i]) });
  }
  return out;
}

/** Draws SVG markup into an image the given size in pixels. */
function svgImage(markup: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The card could not be drawn.'));
    };
    img.src = url;
  });
}

/** One face as a PNG data: URL, at print resolution. */
async function facePng(markup: string, mm: { w: number; h: number }): Promise<string> {
  const img = await svgImage(markup);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(mm.w * PX_PER_MM);
  canvas.height = Math.round(mm.h * PX_PER_MM);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot make the image.');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

/** A safe file name from a person's name and number: "id-card-esther-one-E1". */
export const cardFileName = (name: string, number: string) =>
  `id-card-${`${name} ${number}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

/** The card as one PNG: front and back side by side, as on screen. */
export async function downloadCardPng(faces: CardFaces, fileName: string) {
  const [front, back] = await Promise.all([svgImage(faces.front), svgImage(faces.back)]);
  const mm = cardMm(faces.landscape);
  const w = Math.round(mm.w * PX_PER_MM);
  const h = Math.round(mm.h * PX_PER_MM);
  const gap = Math.round(6 * PX_PER_MM);
  const canvas = document.createElement('canvas');
  canvas.width = w * 2 + gap;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot make the image.');
  ctx.drawImage(front, 0, 0, w, h);
  ctx.drawImage(back, w + gap, 0, w, h);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The image could not be made.');
  saveAs(blob, `${fileName}.png`);
}

/** The card as a PDF the card's own size: page 1 the front, page 2 the back. */
export async function downloadCardPdf(faces: CardFaces, fileName: string) {
  const mm = cardMm(faces.landscape);
  const orientation = faces.landscape ? 'landscape' : 'portrait';
  const [front, back] = await Promise.all([facePng(faces.front, mm), facePng(faces.back, mm)]);
  const pdf = new jsPDF({ orientation, unit: 'mm', format: [mm.w, mm.h] });
  pdf.addImage(front, 'PNG', 0, 0, mm.w, mm.h);
  pdf.addPage([mm.w, mm.h], orientation);
  pdf.addImage(back, 'PNG', 0, 0, mm.w, mm.h);
  pdf.save(`${fileName}.pdf`);
}

// ---------------------------------------------------------------------------------------------
// printing on A4
// ---------------------------------------------------------------------------------------------

/** Portrait cards to an A4 page: 3 across, 3 down, 8 mm apart so each can be cut out with a margin to spare. */
export const SHEET = { cols: 3, rows: 3, gapMm: 8 };
/** Landscape cards to an A4 page: 2 across, 4 down, 8 mm apart. */
export const LANDSCAPE_SHEET = { cols: 2, rows: 4, gapMm: 8 };
/** The A4 layout for portrait or landscape cards. */
export const sheetFor = (landscape?: boolean) => (landscape ? LANDSCAPE_SHEET : SHEET);

/**
 * The pages to print, in order. One card: front and back side by side on one page. Several: a page of fronts, then
 * a page of their backs with each row reversed, so printing both sides (flip on the long edge) puts every back
 * behind its own front.
 */
export function sheetPages(cards: CardFaces[]): (string | null)[][] {
  if (cards.length === 1) return [[cards[0].front, cards[0].back]];
  const sheet = sheetFor(cards[0]?.landscape);
  const PER_PAGE = sheet.cols * sheet.rows;
  const pages: (string | null)[][] = [];
  for (let start = 0; start < cards.length; start += PER_PAGE) {
    const chunk = cards.slice(start, start + PER_PAGE);
    const slots = (pick: (c: CardFaces) => string) =>
      Array.from({ length: PER_PAGE }, (_, i) => (chunk[i] ? pick(chunk[i]) : null));
    const fronts = slots((c) => c.front);
    const backs = slots((c) => c.back);
    const mirrored: (string | null)[] = [];
    for (let r = 0; r < sheet.rows; r++) mirrored.push(...backs.slice(r * sheet.cols, (r + 1) * sheet.cols).reverse());
    // a last page with only a row or two leaves out the empty rows below
    const rowsUsed = Math.ceil(chunk.length / sheet.cols);
    pages.push(fronts.slice(0, rowsUsed * sheet.cols), mirrored.slice(0, rowsUsed * sheet.cols));
  }
  return pages;
}

/** The printable document: A4 pages, each card at its true size with a dashed cutting line. */
export function sheetHtml(cards: CardFaces[], title: string): string {
  const pages = sheetPages(cards);
  const sheet = sheetFor(cards[0]?.landscape);
  const mm = cardMm(cards[0]?.landscape);
  // one card prints front and back side by side (two landscape cards fit across A4 too)
  const cols = cards.length === 1 ? 2 : sheet.cols;
  const slot = (markup: string | null) => `<div class="slot${markup ? '' : ' empty'}">${markup ?? ''}</div>`;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { width: 210mm; height: 297mm; display: flex; align-items: center; justify-content: center; page-break-after: always; break-after: page; }
    .page:last-child { page-break-after: auto; break-after: auto; }
    .grid { display: grid; grid-template-columns: repeat(${cols}, ${mm.w}mm); gap: ${sheet.gapMm}mm; }
    .slot { width: ${mm.w}mm; height: ${mm.h}mm; outline: 0.2mm dashed #9ca3af; outline-offset: 0.6mm; }
    .slot.empty { outline: none; }
    .slot svg { display: block; width: ${mm.w}mm; height: ${mm.h}mm; }
  </style></head><body>${pages.map((p) => `<div class="page"><div class="grid">${p.map(slot).join('')}</div></div>`).join('')}</body></html>`;
}

/** Opens the browser's print dialog for the cards, from a hidden frame so the app stays as it is. */
export function printCards(cards: CardFaces[], title = 'Staff ID cards') {
  if (cards.length === 0) return;
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(frame);
  const remove = () => frame.remove();
  const win = frame.contentWindow;
  const doc = frame.contentDocument ?? win?.document;
  if (!win || !doc) {
    remove();
    throw new Error('This browser cannot print from here.');
  }
  doc.open();
  doc.write(sheetHtml(cards, title));
  doc.close();
  win.addEventListener('afterprint', () => setTimeout(remove, 0));
  // the SVGs need a moment to be laid out before the print dialog takes its copy
  setTimeout(() => {
    win.focus();
    win.print();
    setTimeout(remove, 60_000);
  }, 300);
}
