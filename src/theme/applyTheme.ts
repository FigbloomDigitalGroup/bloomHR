import { DEFAULT_PRESET, ThemeChoice, choiceFromPreset, deriveVars, sanitizeChoice } from './themes';

const STORAGE_KEY = 'figbloom_theme';

/** Put a theme on the page by setting the colour variables the whole app reads. */
export function applyTheme(choice: ThemeChoice, root: HTMLElement = document.documentElement): boolean {
  const vars = deriveVars(choice);
  if (!vars) return false;
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  root.dataset.shell = vars['--shell-fg'] === '255 255 255' ? 'dark' : 'light';
  return true;
}

/** Back to the built-in colours (the defaults in index.css). */
export function resetTheme(root: HTMLElement = document.documentElement): void {
  for (const name of ['--brand', '--brand-dark', '--tint', '--highlight', '--shell', '--shell-fg', '--shell-active', '--shell-active-fg', '--primary', '--ring']) {
    root.style.removeProperty(name);
  }
  delete root.dataset.shell;
}

/** The theme saved in this browser, or null. (Storage can be unavailable or hold rubbish: both mean "none".) */
export function loadStoredTheme(): ThemeChoice | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeChoice(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveStoredTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
  } catch {
    /* the theme still applies for this visit */
  }
}

export function clearStoredTheme(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** Run once before the app renders, so the page never flashes the default colours. */
export function applyStoredTheme(): void {
  const stored = loadStoredTheme();
  if (stored) applyTheme(stored);
}

/** The choice currently in force: the saved one, or the default preset. */
export const currentChoice = (): ThemeChoice => loadStoredTheme() ?? choiceFromPreset(DEFAULT_PRESET);
