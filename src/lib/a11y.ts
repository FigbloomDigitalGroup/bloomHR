/**
 * Per-device display preferences (text size, bolder text, higher contrast, reduced motion), the same options as in
 * Figbloom Schools. Kept in localStorage rather than on the person's account: it is a property of the screen and the
 * eyes in front of it, it has to apply on the sign-in page before anyone is known, and a shared computer should not
 * carry one person's 150% text over to the next.
 *
 * Text size is CSS `zoom` on #root, not a root font-size: sizes in the app are authored in px, so rem scaling would
 * change nothing. zoom scales `100vh` as well, which is why h-screen/min-h-screen are redefined against --ui-zoom in
 * index.css.
 */

export const TEXT_SCALES = [
  { value: 1, label: 'Default' },
  { value: 1.15, label: 'Large' },
  { value: 1.3, label: 'Larger' },
  { value: 1.5, label: 'Largest' },
] as const;

export interface A11yPrefs {
  textScale: number;
  bold: boolean;
  contrast: boolean;
  reduceMotion: boolean;
}

export const DEFAULT_A11Y: A11yPrefs = { textScale: 1, bold: false, contrast: false, reduceMotion: false };

export const A11Y_KEY = 'figbloom.a11y';
export const A11Y_CHANGED = 'figbloom-a11y-changed';

export function loadA11y(): A11yPrefs {
  try {
    const raw = localStorage.getItem(A11Y_KEY);
    if (!raw) return DEFAULT_A11Y;
    const p = JSON.parse(raw) as Partial<A11yPrefs>;
    return {
      textScale: TEXT_SCALES.some((s) => s.value === p.textScale) ? (p.textScale as number) : 1,
      bold: p.bold === true,
      contrast: p.contrast === true,
      reduceMotion: p.reduceMotion === true,
    };
  } catch {
    return DEFAULT_A11Y;
  }
}

/** Put the preferences on the page: text size on #root, the other three as attributes the stylesheet reads. */
export function applyA11y(prefs: A11yPrefs): void {
  const html = document.documentElement;
  html.style.setProperty('--ui-zoom', String(prefs.textScale));
  const root = document.getElementById('root');
  if (root) root.style.zoom = prefs.textScale === 1 ? '' : String(prefs.textScale);
  html.toggleAttribute('data-a11y-bold', prefs.bold);
  html.toggleAttribute('data-a11y-contrast', prefs.contrast);
  html.toggleAttribute('data-a11y-reduce-motion', prefs.reduceMotion);
  window.dispatchEvent(new Event(A11Y_CHANGED));
}

export function saveA11y(prefs: A11yPrefs): void {
  try {
    localStorage.setItem(A11Y_KEY, JSON.stringify(prefs));
  } catch {
    // private window / blocked storage: the change still applies for this visit
  }
  applyA11y(prefs);
}

export const isDefaultA11y = (prefs: A11yPrefs): boolean =>
  prefs.textScale === DEFAULT_A11Y.textScale &&
  prefs.bold === DEFAULT_A11Y.bold &&
  prefs.contrast === DEFAULT_A11Y.contrast &&
  prefs.reduceMotion === DEFAULT_A11Y.reduceMotion;
