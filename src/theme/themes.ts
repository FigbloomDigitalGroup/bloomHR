import { BLACK, INK, RGB, WHITE, contrast, ensureWhiteTextReadable, hexToRgb, mix, readableOn, rgbToHex, rgbToHslString, rgbTriplet } from './color';

/** What a person chooses: the sidebar colour, the accent (buttons, links, highlights) and a small highlight dot. */
export interface ThemeChoice {
  sidebar: string;
  accent: string;
  highlight: string;
}

export interface ThemePreset extends ThemeChoice {
  id: string;
  name: string;
}

export const DEFAULT_HIGHLIGHT = '#F26A1B';

export const PRESETS: ThemePreset[] = [
  { id: 'forest', name: 'Forest', sidebar: '#17402A', accent: '#17402A', highlight: '#F26A1B' },
  { id: 'ocean', name: 'Ocean (blue & navy)', sidebar: '#0B2545', accent: '#1F5FBF', highlight: '#F59E0B' },
  { id: 'midnight', name: 'Midnight', sidebar: '#111827', accent: '#4F46E5', highlight: '#F472B6' },
  { id: 'aubergine', name: 'Aubergine', sidebar: '#3F0E40', accent: '#611F69', highlight: '#ECB22E' },
  { id: 'teal', name: 'Teal', sidebar: '#0F3D3E', accent: '#0F766E', highlight: '#F59E0B' },
  { id: 'rose', name: 'Rosewood', sidebar: '#4A1D2B', accent: '#BE185D', highlight: '#FBBF24' },
  { id: 'charcoal', name: 'Charcoal & amber', sidebar: '#1F2328', accent: '#B45309', highlight: '#F59E0B' },
  { id: 'mist', name: 'Mist (grey & off-white)', sidebar: '#F1F2F4', accent: '#4B5563', highlight: '#2563EB' },
  { id: 'sand', name: 'Sand', sidebar: '#F5F0E8', accent: '#8A5A2B', highlight: '#C2410C' },
  { id: 'sky', name: 'Sky (white & blue)', sidebar: '#EAF2FB', accent: '#1D4ED8', highlight: '#F26A1B' },
];

export const DEFAULT_PRESET = PRESETS[0];

/** Every CSS variable the app reads. The first eight are "r g b" triplets, the last two shadcn "h s% l%". */
export interface ThemeVars {
  '--brand': string;
  '--brand-dark': string;
  '--tint': string;
  '--highlight': string;
  '--shell': string;
  '--shell-fg': string;
  '--shell-active': string;
  '--shell-active-fg': string;
  '--primary': string;
  '--ring': string;
}

/**
 * Works out every colour the app needs from the three the person picks, so any choice stays readable:
 * buttons are darkened until white text reads on them, sidebar text flips between white and dark, and the
 * active menu item is a white pill (on a light sidebar its text takes the accent colour).
 */
export function deriveVars(choice: ThemeChoice): ThemeVars | null {
  const sidebar = hexToRgb(choice.sidebar);
  const accentRaw = hexToRgb(choice.accent);
  const highlight = hexToRgb(choice.highlight || DEFAULT_HIGHLIGHT) ?? (hexToRgb(DEFAULT_HIGHLIGHT) as RGB);
  if (!sidebar || !accentRaw) return null;

  const brand = ensureWhiteTextReadable(accentRaw);
  const shellFg = readableOn(sidebar);
  const lightShell = shellFg === INK;
  return {
    '--brand': rgbTriplet(brand),
    '--brand-dark': rgbTriplet(mix(brand, BLACK, 0.18)),
    '--tint': rgbTriplet(mix(brand, WHITE, 0.88)),
    '--highlight': rgbTriplet(highlight),
    '--shell': rgbTriplet(sidebar),
    '--shell-fg': rgbTriplet(shellFg),
    '--shell-active': rgbTriplet(WHITE),
    '--shell-active-fg': rgbTriplet(lightShell ? brand : sidebar),
    '--primary': rgbToHslString(brand),
    '--ring': rgbToHslString(brand),
  };
}

/** How readable the sidebar text is on the sidebar colour. */
export function sidebarContrast(sidebarHex: string): number {
  const bg = hexToRgb(sidebarHex);
  return bg ? contrast(bg, readableOn(bg)) : 0;
}

export const choiceFromPreset = (p: ThemePreset): ThemeChoice => ({ sidebar: p.sidebar, accent: p.accent, highlight: p.highlight });

/** The preset a choice matches exactly, if any. */
export const presetFor = (choice: ThemeChoice): ThemePreset | undefined =>
  PRESETS.find(
    (p) =>
      p.sidebar.toUpperCase() === choice.sidebar.toUpperCase() &&
      p.accent.toUpperCase() === choice.accent.toUpperCase() &&
      p.highlight.toUpperCase() === choice.highlight.toUpperCase()
  );

/** A saved choice with every colour checked and normalised, or null if it is not usable. */
export function sanitizeChoice(value: unknown): ThemeChoice | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const norm = (x: unknown) => {
    const rgb = typeof x === 'string' ? hexToRgb(x) : null;
    return rgb ? rgbToHex(rgb) : null;
  };
  const sidebar = norm(v.sidebar);
  const accent = norm(v.accent);
  const highlight = norm(v.highlight) ?? DEFAULT_HIGHLIGHT;
  return sidebar && accent ? { sidebar, accent, highlight } : null;
}
