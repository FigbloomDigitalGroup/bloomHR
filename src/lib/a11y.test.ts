import { beforeEach, describe, expect, it } from 'vitest';
import { A11Y_KEY, DEFAULT_A11Y, applyA11y, loadA11y, saveA11y } from './a11y';

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="root"></div>';
  applyA11y(DEFAULT_A11Y);
});

describe('a11y preferences', () => {
  it('defaults when nothing is stored or the stored value is junk', () => {
    expect(loadA11y()).toEqual(DEFAULT_A11Y);
    localStorage.setItem(A11Y_KEY, '{not json');
    expect(loadA11y()).toEqual(DEFAULT_A11Y);
    localStorage.setItem(A11Y_KEY, JSON.stringify({ textScale: 9, bold: 'yes' }));
    expect(loadA11y()).toEqual(DEFAULT_A11Y);
  });

  it('saves, reloads and applies to the page', () => {
    saveA11y({ textScale: 1.3, bold: true, contrast: true, reduceMotion: true });
    expect(loadA11y()).toEqual({ textScale: 1.3, bold: true, contrast: true, reduceMotion: true });
    const html = document.documentElement;
    expect(html.style.getPropertyValue('--ui-zoom')).toBe('1.3');
    expect(document.getElementById('root')!.style.zoom).toBe('1.3');
    for (const a of ['data-a11y-bold', 'data-a11y-contrast', 'data-a11y-reduce-motion']) expect(html.hasAttribute(a)).toBe(true);
  });

  it('removes everything again on reset', () => {
    saveA11y({ textScale: 1.5, bold: true, contrast: true, reduceMotion: true });
    saveA11y(DEFAULT_A11Y);
    expect(document.getElementById('root')!.style.zoom).toBe('');
    expect(document.documentElement.hasAttribute('data-a11y-bold')).toBe(false);
  });
});
