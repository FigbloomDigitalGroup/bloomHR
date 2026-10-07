import { ReactNode, useEffect, useMemo, useState } from 'react';
import { ConfigProvider } from 'antd';
import { THEME_CHANGED } from './applyTheme';
import { AntdSurfaces, buildAntdTheme } from './antdTheme';
import { rgbToHex } from './color';

/** A colour variable currently on the page (the person's chosen theme), as hex. */
function cssVarHex(name: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const parts = raw.split(/\s+/).map(Number);
  return parts.length === 3 && parts.every((n) => Number.isFinite(n)) ? rgbToHex(parts as [number, number, number]) : fallback;
}

const currentBrandHex = () => cssVarHex('--brand', '#17402A');
const currentSurfaces = (): AntdSurfaces => {
  const dark = document.documentElement.dataset.page === 'dark';
  return {
    page: cssVarHex('--page', '#F6F8F6'),
    surface: cssVarHex('--surface', '#FFFFFF'),
    line: cssVarHex('--line', '#E2E6E2'),
    text: cssVarHex('--ink', '#16201A'),
    textSecondary: dark ? cssVarHex('--text-500', '#5F6B62') : '#5F6B62',
    textTertiary: cssVarHex('--subtle', '#9CA3A0'),
    dark,
  };
};

/** antd components (date pickers, selects, tables) take their colours from here, so they follow the chosen theme. */
export default function ThemedConfigProvider({ children }: { children: ReactNode }) {
  const [brand, setBrand] = useState(currentBrandHex);
  const [surfaces, setSurfaces] = useState(currentSurfaces);
  useEffect(() => {
    const update = () => {
      setBrand(currentBrandHex());
      setSurfaces(currentSurfaces());
    };
    window.addEventListener(THEME_CHANGED, update);
    return () => window.removeEventListener(THEME_CHANGED, update);
  }, []);
  const theme = useMemo(() => buildAntdTheme(brand, surfaces), [brand, surfaces]);
  return <ConfigProvider theme={theme}>{children}</ConfigProvider>;
}
