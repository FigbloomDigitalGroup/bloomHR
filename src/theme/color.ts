// Small colour maths for the theme engine: hex <-> rgb/hsl, contrast, mixing.

export type RGB = [number, number, number];

const clamp = (n: number, lo = 0, hi = 255) => Math.min(hi, Math.max(lo, n));

/** '#abc' or '#aabbcc' (case-insensitive) -> [r, g, b]; null when it is not a colour. */
export function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((v) => Math.round(clamp(v)).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Space separated, as the CSS variables hold them: "23 64 42". */
export const rgbTriplet = ([r, g, b]: RGB): string => `${Math.round(r)} ${Math.round(g)} ${Math.round(b)}`;

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance([r, g, b]: RGB): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Mix `a` toward `b` by `t` (0 = a, 1 = b). */
export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export const WHITE: RGB = [255, 255, 255];
export const BLACK: RGB = [0, 0, 0];
export const INK: RGB = [22, 32, 26]; // the app's text colour

/** White or dark text, whichever reads better on `bg`. */
export function readableOn(bg: RGB): RGB {
  return contrast(bg, WHITE) >= contrast(bg, INK) ? WHITE : INK;
}

/** A colour for buttons and highlights: darkened until white text on it is comfortably readable (4.5:1). */
export function ensureWhiteTextReadable(color: RGB): RGB {
  let c = color;
  for (let i = 0; i < 20 && contrast(c, WHITE) < 4.5; i++) c = mix(c, BLACK, 0.08);
  return c;
}

/** Hue/saturation/lightness in the "148 47% 17%" form the shadcn variables use. */
export function rgbToHslString([r, g, b]: RGB): string {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
  }
  return `${h} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}
