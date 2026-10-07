import { BLACK, INK, RGB, WHITE, contrast, ensureWhiteTextReadable, hexToRgb, mix, readableOn, rgbToHex, rgbToHslString, rgbTriplet } from './color';

/**
 * What a person chooses: the sidebar colour, the accent (buttons, links, highlights), a small highlight dot, and
 * optionally a page colour for the white areas (missing = the built-in white).
 */
export interface ThemeChoice {
  sidebar: string;
  accent: string;
  highlight: string;
  page?: string;
}

/** A ready-made colour for the white areas of every page (backgrounds, cards, borders). */
export interface PagePreset {
  id: string;
  name: string;
  page: string;
}

export const DEFAULT_PAGE = '#F6F8F6';

export const PAGE_PRESETS: PagePreset[] = [
  { id: 'white', name: 'White', page: DEFAULT_PAGE },
  { id: 'mist', name: 'Cool grey', page: '#EEF1F5' },
  { id: 'sand', name: 'Warm sand', page: '#F5EFE6' },
  { id: 'mint', name: 'Mint', page: '#ECF5EF' },
  { id: 'sky', name: 'Sky', page: '#EBF2FB' },
  { id: 'lavender', name: 'Lavender', page: '#F1EEF8' },
  { id: 'blush', name: 'Blush', page: '#F8EEEE' },
  { id: 'dark', name: 'Dark', page: '#121614' },
  { id: 'navy', name: 'Navy night', page: '#0F172A' },
  { id: 'black', name: 'Black', page: '#000000' },
];

export const pagePresetFor = (page: string | undefined): PagePreset | undefined =>
  PAGE_PRESETS.find((p) => p.page.toUpperCase() === (page || DEFAULT_PAGE).toUpperCase());

/**
 * The page-colour variables: the surfaces (page, cards, inset and hover greys, borders), the text greys that sit on
 * them, and the shadcn "h s% l%" variables that describe the same colours. All but the shadcn ones are "r g b".
 */
export interface PageVars {
  '--page': string;
  '--surface': string;
  '--surface-sunken': string;
  '--surface-muted': string;
  '--surface-strong': string;
  '--surface-stronger': string;
  '--line': string;
  '--line-soft': string;
  '--line-strong': string;
  '--text-300': string;
  '--text-400': string;
  '--text-500': string;
  '--text-600': string;
  '--text-700': string;
  '--text-800': string;
  '--text-900': string;
  '--text-black': string;
  '--ink': string;
  '--subtle': string;
  '--background': string;
  '--foreground': string;
  '--card': string;
  '--card-foreground': string;
  '--popover': string;
  '--popover-foreground': string;
  '--secondary': string;
  '--secondary-foreground': string;
  '--muted': string;
  '--muted-foreground': string;
  '--border': string;
  '--input': string;
}

export const PAGE_VAR_NAMES: (keyof PageVars)[] = [
  '--page', '--surface', '--surface-sunken', '--surface-muted', '--surface-strong', '--surface-stronger',
  '--line', '--line-soft', '--line-strong',
  '--text-300', '--text-400', '--text-500', '--text-600', '--text-700', '--text-800', '--text-900', '--text-black',
  '--ink', '--subtle',
  '--background', '--foreground', '--card', '--card-foreground', '--popover', '--popover-foreground',
  '--secondary', '--secondary-foreground', '--muted', '--muted-foreground', '--border', '--input',
];

/** The contrast below which a page colour is adjusted: the WCAG minimum for body text. */
export const MIN_PAGE_CONTRAST = 4.5;

/**
 * The page colour as picked: the text is what adapts (light on dark pages, dark on light ones). Only a colour that
 * no text reads well on (a mid grey, say) is nudged, just far enough: lighter under dark text, or darker under light.
 */
export function readablePage(color: RGB): RGB {
  const dark = readableOn(color) === WHITE;
  const text = dark ? WHITE : INK;
  const toward = dark ? BLACK : WHITE;
  let c = color;
  for (let i = 0; i < 40 && contrast(c, text) < MIN_PAGE_CONTRAST; i++) c = mix(c, toward, 0.04);
  return c;
}

/** Whether a page colour gets light text (a dark page) rather than the usual dark text. */
export function isDarkPage(pageHex: string | undefined): boolean {
  const rgb = pageHex ? hexToRgb(pageHex) : null;
  return !!rgb && readableOn(readablePage(rgb)) === WHITE;
}

/**
 * Every page colour from the one picked: cards, inset and hover greys and borders, plus the text greys. On a light
 * page cards are lighter and borders darker, with the usual dark text; on a dark page cards are a step lighter than
 * the page and the text turns light, so any colour stays readable.
 */
export function derivePageVars(pageHex: string): PageVars | null {
  const raw = hexToRgb(pageHex);
  if (!raw) return null;
  const page = readablePage(raw);
  const dark = readableOn(page) === WHITE;

  // surfaces: on a light page cards go toward white and greys toward the text colour; on a dark page everything
  // raised is a little lighter than the page
  const step = (t: number) => (dark ? mix(page, WHITE, t) : mix(page, INK, t));
  // cards stay close to the page colour: a small step paler on a light page, a small step lighter on a dark one
  const surface = dark ? mix(page, WHITE, 0.06) : mix(page, WHITE, 0.35);
  const sunken = dark ? mix(page, WHITE, 0.03) : mix(page, WHITE, 0.15);
  const muted = step(dark ? 0.1 : 0.02);
  const strong = step(dark ? 0.16 : 0.07);
  const stronger = step(dark ? 0.22 : 0.13);
  const line = step(dark ? 0.16 : 0.09);
  const lineSoft = step(dark ? 0.1 : 0.035);
  const lineStrong = step(dark ? 0.24 : 0.16);

  // text: the usual greys on a light page; on a dark page light greys tinted by the page, strongest first
  const text = (light: RGB, darkT: number): RGB => (dark ? mix(WHITE, page, darkT) : light);
  const t900 = text([17, 24, 39], 0.04);
  const t800 = text([31, 41, 55], 0.08);
  const t700 = text([55, 65, 81], 0.16);
  const t600 = text([75, 85, 99], 0.26);
  const t500 = text([107, 114, 128], 0.38);
  const t400 = text([156, 163, 175], 0.48);
  const t300 = text([209, 213, 219], 0.55);
  const ink = text(INK, 0.04);
  const subtle = text([156, 163, 160], 0.48);
  const black = text(BLACK, 0);
  const mutedInk: RGB = dark ? t500 : [95, 107, 98];

  return {
    '--page': rgbTriplet(page),
    '--surface': rgbTriplet(surface),
    '--surface-sunken': rgbTriplet(sunken),
    '--surface-muted': rgbTriplet(muted),
    '--surface-strong': rgbTriplet(strong),
    '--surface-stronger': rgbTriplet(stronger),
    '--line': rgbTriplet(line),
    '--line-soft': rgbTriplet(lineSoft),
    '--line-strong': rgbTriplet(lineStrong),
    '--text-300': rgbTriplet(t300),
    '--text-400': rgbTriplet(t400),
    '--text-500': rgbTriplet(t500),
    '--text-600': rgbTriplet(t600),
    '--text-700': rgbTriplet(t700),
    '--text-800': rgbTriplet(t800),
    '--text-900': rgbTriplet(t900),
    '--text-black': rgbTriplet(black),
    '--ink': rgbTriplet(ink),
    '--subtle': rgbTriplet(subtle),
    '--background': rgbToHslString(page),
    '--foreground': rgbToHslString(ink),
    '--card': rgbToHslString(surface),
    '--card-foreground': rgbToHslString(ink),
    '--popover': rgbToHslString(surface),
    '--popover-foreground': rgbToHslString(ink),
    '--secondary': rgbToHslString(sunken),
    '--secondary-foreground': rgbToHslString(ink),
    '--muted': rgbToHslString(muted),
    '--muted-foreground': rgbToHslString(mutedInk),
    '--border': rgbToHslString(line),
    '--input': rgbToHslString(line),
  };
}

/** Whether a choice has its own page colour (anything other than the built-in white). */
export const hasCustomPage = (choice: ThemeChoice): boolean =>
  !!choice.page && choice.page.toUpperCase() !== DEFAULT_PAGE.toUpperCase();

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

/** A preset's colours; `page` keeps the person's page colour when they switch sidebar themes. */
export const choiceFromPreset = (p: ThemePreset, page?: string): ThemeChoice => ({
  sidebar: p.sidebar,
  accent: p.accent,
  highlight: p.highlight,
  ...(page ? { page } : {}),
});

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
  const page = norm(v.page);
  if (!sidebar || !accent) return null;
  return page ? { sidebar, accent, highlight, page } : { sidebar, accent, highlight };
}
