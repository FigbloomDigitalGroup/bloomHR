import { ReactNode, useEffect, useMemo, useState } from 'react';
import { ConfigProvider } from 'antd';
import { THEME_CHANGED } from './applyTheme';
import { buildAntdTheme } from './antdTheme';
import { rgbToHex } from './color';

/** The brand colour currently on the page (the person's chosen theme), as hex. */
function currentBrandHex(): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim();
  const parts = raw.split(/\s+/).map(Number);
  return parts.length === 3 && parts.every((n) => Number.isFinite(n)) ? rgbToHex(parts as [number, number, number]) : '#17402A';
}

/** antd components (date pickers, selects, tables) take their colours from here, so they follow the chosen theme. */
export default function ThemedConfigProvider({ children }: { children: ReactNode }) {
  const [brand, setBrand] = useState(currentBrandHex);
  useEffect(() => {
    const update = () => setBrand(currentBrandHex());
    window.addEventListener(THEME_CHANGED, update);
    return () => window.removeEventListener(THEME_CHANGED, update);
  }, []);
  const theme = useMemo(() => buildAntdTheme(brand), [brand]);
  return <ConfigProvider theme={theme}>{children}</ConfigProvider>;
}
