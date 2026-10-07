import { beforeEach, describe, expect, it } from 'vitest';
import { contrast, hexToRgb, readableOn, rgbToHex, rgbToHslString, rgbTriplet, WHITE, ensureWhiteTextReadable } from './color';
import { DEFAULT_PAGE, DEFAULT_PRESET, PAGE_PRESETS, PRESETS, derivePageVars, deriveVars, isDarkPage, presetFor, sanitizeChoice, choiceFromPreset } from './themes';
import { applyStoredTheme, applyTheme, clearStoredTheme, currentChoice, loadStoredTheme, resetTheme, saveStoredTheme } from './applyTheme';

beforeEach(() => {
  localStorage.clear();
  resetTheme();
});

describe('colour maths', () => {
  it('reads and writes hex, long and short', () => {
    expect(hexToRgb('#17402A')).toEqual([23, 64, 42]);
    expect(hexToRgb('fff')).toEqual([255, 255, 255]);
    expect(rgbToHex([23, 64, 42])).toBe('#17402A');
    expect(hexToRgb('not a colour')).toBeNull();
    expect(hexToRgb('#12345')).toBeNull();
  });

  it('picks readable text for light and dark backgrounds', () => {
    expect(readableOn(hexToRgb('#111827')!)).toEqual(WHITE);
    expect(readableOn(hexToRgb('#F1F2F4')!)).not.toEqual(WHITE);
  });

  it('darkens a pale accent until white text reads on it', () => {
    const pale = hexToRgb('#F5D90A')!;
    expect(contrast(pale, WHITE)).toBeLessThan(4.5);
    expect(contrast(ensureWhiteTextReadable(pale), WHITE)).toBeGreaterThanOrEqual(4.5);
  });

  it('matches the shadcn hsl form of the default brand colour', () => {
    expect(rgbToHslString(hexToRgb('#17402A')!)).toBe('148 47% 17%');
  });
});

describe('presets', () => {
  it('the default preset reproduces the colours the app shipped with', () => {
    const v = deriveVars(choiceFromPreset(DEFAULT_PRESET))!;
    expect(v['--brand']).toBe('23 64 42');
    expect(v['--shell']).toBe('23 64 42');
    expect(v['--shell-fg']).toBe('255 255 255');
    expect(v['--shell-active-fg']).toBe('23 64 42');
    expect(v['--highlight']).toBe('242 106 27');
    expect(v['--primary']).toBe('148 47% 17%');
  });

  it('every preset stays readable: sidebar text, and white text on buttons', () => {
    for (const p of PRESETS) {
      const v = deriveVars(choiceFromPreset(p))!;
      const rgb = (t: string) => t.split(' ').map(Number) as [number, number, number];
      expect(contrast(rgb(v['--shell']), rgb(v['--shell-fg'])), `${p.id} sidebar text`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(rgb(v['--brand']), WHITE), `${p.id} button text`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(rgb(v['--shell-active']), rgb(v['--shell-active-fg'])), `${p.id} active item`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('has light and dark sidebars, and unique ids', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    const shellFgs = PRESETS.map((p) => deriveVars(choiceFromPreset(p))!['--shell-fg']);
    expect(shellFgs).toContain('255 255 255'); // dark sidebars
    expect(shellFgs.some((f) => f !== '255 255 255')).toBe(true); // light sidebars (dark text)
  });

  it('finds the preset a choice matches', () => {
    expect(presetFor(choiceFromPreset(PRESETS[1]))?.id).toBe('ocean');
    expect(presetFor({ sidebar: '#000000', accent: '#FFFFFF', highlight: '#FF0000' })).toBeUndefined();
  });

  it('rejects colours it cannot read', () => {
    expect(deriveVars({ sidebar: 'blue', accent: '#fff', highlight: '#f00' })).toBeNull();
  });
});

describe('saved themes', () => {
  it('normalises what it loads and drops rubbish', () => {
    expect(sanitizeChoice({ sidebar: '#abc', accent: '1f5fbf', highlight: 'nope' })).toEqual({
      sidebar: '#AABBCC',
      accent: '#1F5FBF',
      highlight: '#F26A1B',
    });
    expect(sanitizeChoice({ sidebar: 'red' })).toBeNull();
    expect(sanitizeChoice('x')).toBeNull();
    expect(sanitizeChoice(null)).toBeNull();
  });

  it('applies a theme to the page, and resets', () => {
    expect(applyTheme(choiceFromPreset(PRESETS[1]))).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--shell')).toBe('11 37 69');
    resetTheme();
    expect(document.documentElement.style.getPropertyValue('--shell')).toBe('');
  });

  it('does not touch the page for a bad choice', () => {
    expect(applyTheme({ sidebar: 'x', accent: 'y', highlight: 'z' })).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--brand')).toBe('');
  });

  it('remembers the choice and re-applies it on the next load', () => {
    saveStoredTheme(choiceFromPreset(PRESETS[2]));
    expect(loadStoredTheme()).toEqual(choiceFromPreset(PRESETS[2]));
    applyStoredTheme();
    expect(document.documentElement.style.getPropertyValue('--shell')).toBe('17 24 39');
    clearStoredTheme();
    expect(loadStoredTheme()).toBeNull();
    expect(currentChoice()).toEqual(choiceFromPreset(DEFAULT_PRESET));
  });

  it('ignores corrupt saved data', () => {
    localStorage.setItem('figbloom_theme', '{not json');
    expect(loadStoredTheme()).toBeNull();
    localStorage.setItem('figbloom_theme', JSON.stringify({ sidebar: 'red' }));
    expect(loadStoredTheme()).toBeNull();
  });
});

describe('page colours', () => {
  const rgb = (t: string) => t.split(' ').map(Number) as [number, number, number];
  const INK_RGB: [number, number, number] = [22, 32, 26];

  it('every page preset keeps the main and secondary text readable on the page and on cards', () => {
    for (const p of PAGE_PRESETS) {
      const v = derivePageVars(p.page)!;
      for (const bg of ['--page', '--surface'] as const) {
        expect(contrast(rgb(v[bg]), rgb(v['--ink'])), `${p.id} ${bg} main text`).toBeGreaterThanOrEqual(7);
        expect(contrast(rgb(v[bg]), rgb(v['--text-500'])), `${p.id} ${bg} secondary text`).toBeGreaterThanOrEqual(4); // the app's grey-500 on its own default page is about 4.4
      }
    }
    expect(new Set(PAGE_PRESETS.map((p) => p.id)).size).toBe(PAGE_PRESETS.length);
  });

  it('uses the picked colour itself as the page, light or dark', () => {
    for (const hex of ['#F5EFE6', '#000000', '#1E3A8A', '#0F172A', '#FDE68A']) {
      expect(derivePageVars(hex)!['--page'], hex).toBe(rgb(rgbTriplet(hexToRgb(hex)!)).join(' '));
    }
  });

  it('turns the text light on a dark page, and keeps it dark on a light one', () => {
    const dark = derivePageVars('#000000')!;
    expect(contrast(rgb(dark['--ink']), [0, 0, 0])).toBeGreaterThanOrEqual(12);
    expect(rgb(dark['--ink'])[0]).toBeGreaterThan(200);
    expect(isDarkPage('#000000')).toBe(true);
    const light = derivePageVars('#F5EFE6')!;
    expect(light['--ink']).toBe(INK_RGB.join(' '));
    expect(isDarkPage('#F5EFE6')).toBe(false);
  });

  it('only adjusts a colour no text reads well on (a mid grey), and just enough', () => {
    const v = derivePageVars('#808080')!;
    const page = rgb(v['--page']);
    expect(page.join(' ')).not.toBe('128 128 128');
    expect(Math.max(contrast(page, WHITE), contrast(page, INK_RGB))).toBeGreaterThanOrEqual(4.5);
  });

  it('cards sit a step off the page: paler on a light page, lighter on a dark one', () => {
    const sum = (t: string) => rgb(t).reduce((a, b) => a + b, 0);
    const light = derivePageVars('#F5EFE6')!;
    expect(sum(light['--surface'])).toBeGreaterThan(sum(light['--page']));
    expect(sum(light['--line'])).toBeLessThan(sum(light['--page']));
    const dark = derivePageVars('#121614')!;
    expect(sum(dark['--surface'])).toBeGreaterThan(sum(dark['--page']));
    expect(sum(dark['--line'])).toBeGreaterThan(sum(dark['--page']));
  });

  it('applies a page colour, and switching back to white restores the built-in colours exactly', () => {
    const root = document.documentElement;
    applyTheme({ ...choiceFromPreset(DEFAULT_PRESET), page: '#F5EFE6' });
    expect(root.style.getPropertyValue('--page')).not.toBe('');
    expect(root.style.getPropertyValue('--background')).not.toBe('');
    applyTheme({ ...choiceFromPreset(DEFAULT_PRESET), page: DEFAULT_PAGE });
    expect(root.style.getPropertyValue('--page')).toBe('');
    expect(root.style.getPropertyValue('--surface')).toBe('');
    applyTheme({ ...choiceFromPreset(DEFAULT_PRESET), page: '#000000' });
    expect(root.dataset.page).toBe('dark');
    applyTheme({ ...choiceFromPreset(DEFAULT_PRESET), page: '#ECF5EF' });
    expect(root.dataset.page).toBeUndefined();
    resetTheme();
    expect(root.style.getPropertyValue('--page')).toBe('');
  });

  it('keeps the page colour when switching sidebar themes, and saves it', () => {
    expect(choiceFromPreset(PRESETS[1], '#ECF5EF').page).toBe('#ECF5EF');
    expect(presetFor(choiceFromPreset(PRESETS[1], '#ECF5EF'))?.id).toBe('ocean');
    expect(sanitizeChoice({ sidebar: '#abc', accent: '#123456', highlight: '#f00', page: 'ecf5ef' })?.page).toBe('#ECF5EF');
    expect(sanitizeChoice({ sidebar: '#abc', accent: '#123456', highlight: '#f00', page: 'nope' })).not.toHaveProperty('page');
  });
});
