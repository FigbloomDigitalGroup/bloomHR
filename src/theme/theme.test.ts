import { beforeEach, describe, expect, it } from 'vitest';
import { contrast, hexToRgb, readableOn, rgbToHex, rgbToHslString, WHITE, ensureWhiteTextReadable } from './color';
import { DEFAULT_PRESET, PRESETS, deriveVars, presetFor, sanitizeChoice, choiceFromPreset } from './themes';
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
