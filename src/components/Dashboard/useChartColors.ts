import { useEffect, useState } from 'react';
import { BLACK, RGB, WHITE, contrast, luminance, mix, rgbToHex } from '../../theme/color';
import { THEME_CHANGED } from '../../theme/applyTheme';

// The dashboard charts' colours, read from the person's theme (src/theme) so the charts follow their palette and page
// colour. A theme colour that would be too faint on the card (a dark accent on a dark page) is stepped lighter or
// darker until it stands out at least 3:1, so a bar never disappears into its background.

export interface ChartColors {
  /** the one data colour: the theme's accent */
  accent: string;
  /** the second series (leavers): the theme's highlight colour */
  second: string;
  /** de-emphasis marks (a sparkline's history) */
  muted: string;
  /** the card the chart sits on */
  surface: string;
  /** hairline gridlines */
  grid: string;
  /** axis labels */
  axis: string;
}

const DEFAULTS: Record<string, RGB> = {
  '--brand': [23, 64, 42],
  '--highlight': [242, 106, 27],
  '--surface': [255, 255, 255],
  '--line': [229, 231, 235],
  '--text-400': [156, 163, 175],
  '--text-500': [107, 114, 128],
};

function readVar(styles: CSSStyleDeclaration | null, name: string): RGB {
  const raw = styles?.getPropertyValue(name).trim() ?? '';
  const parts = raw.split(/[\s,]+/).map(Number);
  return parts.length === 3 && parts.every((n) => Number.isFinite(n)) ? (parts as RGB) : DEFAULTS[name];
}

/** `color`, stepped toward white (dark card) or black (light card) until it is at least 3:1 on `surface`. */
export function standOut(color: RGB, surface: RGB, min = 3): RGB {
  const toward = luminance(surface) < 0.2 ? WHITE : BLACK;
  let c = color;
  for (let t = 0.1; contrast(c, surface) < min && t <= 0.9; t += 0.1) c = mix(color, toward, t);
  return c;
}

export function chartColorsFrom(styles: CSSStyleDeclaration | null): ChartColors {
  const surface = readVar(styles, '--surface');
  return {
    accent: rgbToHex(standOut(readVar(styles, '--brand'), surface)),
    second: rgbToHex(standOut(readVar(styles, '--highlight'), surface)),
    muted: rgbToHex(readVar(styles, '--text-400')),
    surface: rgbToHex(surface),
    grid: rgbToHex(readVar(styles, '--line')),
    axis: rgbToHex(readVar(styles, '--text-500')),
  };
}

const read = () => chartColorsFrom(typeof window === 'undefined' ? null : window.getComputedStyle(document.documentElement));

export default function useChartColors(): ChartColors {
  const [colors, setColors] = useState<ChartColors>(read);
  useEffect(() => {
    const update = () => setColors(read());
    window.addEventListener(THEME_CHANGED, update);
    return () => window.removeEventListener(THEME_CHANGED, update);
  }, []);
  return colors;
}
