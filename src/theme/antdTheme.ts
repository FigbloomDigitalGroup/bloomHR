import { theme as antdThemes, type ThemeConfig } from 'antd';

// Mirrors the Tailwind tokens in tailwind.config.js (see FIG-527) so antd
// components (DatePicker, Select, Table, etc.) match the rest of the app.
/** The page colours antd needs (see the page palette in src/theme/themes.ts); defaults are the built-in white. */
export interface AntdSurfaces {
  page: string;
  surface: string;
  line: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  dark: boolean;
}

const DEFAULT_SURFACES: AntdSurfaces = {
  page: '#F6F8F6',
  surface: '#FFFFFF',
  line: '#E2E6E2',
  text: '#16201A',
  textSecondary: '#5F6B62',
  textTertiary: '#9CA3A0',
  dark: false,
};

export const buildAntdTheme = (brandHex: string = '#17402A', surfaces: AntdSurfaces = DEFAULT_SURFACES): ThemeConfig => ({
  // on a dark page colour antd's own dark styling (hover states, disabled fields, shadows) is the base
  algorithm: surfaces.dark ? antdThemes.darkAlgorithm : antdThemes.defaultAlgorithm,
  token: {
    colorPrimary: brandHex,
    colorLink: brandHex,
    colorSuccess: '#2E7D4F',
    colorWarning: '#F26A1B',
    colorError: '#C0392B',
    colorInfo: '#1F4E79',
    colorText: surfaces.text,
    colorTextSecondary: surfaces.textSecondary,
    colorTextTertiary: surfaces.textTertiary,
    colorBorder: surfaces.line,
    colorBorderSecondary: surfaces.line,
    colorBgLayout: surfaces.page,
    colorBgContainer: surfaces.surface,
    colorBgElevated: surfaces.surface,
    borderRadius: 10,
    borderRadiusLG: 14,
    borderRadiusSM: 8,
    fontFamily: "'Figtree', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif",
  },
  components: {
    Button: {
      borderRadius: 9,
      controlHeight: 36,
      fontWeight: 600,
    },
    Input: {
      borderRadius: 8,
      controlHeight: 36,
    },
    Select: {
      borderRadius: 8,
      controlHeight: 36,
    },
    Card: {
      borderRadiusLG: 14,
    },
    Tag: {
      borderRadiusSM: 999,
    },
  },
});

/** The default (Forest) look; see ThemedConfigProvider for the one that follows each person's chosen theme. */
export const antdTheme = buildAntdTheme();
