import type { ThemeConfig } from 'antd';

// Mirrors the Tailwind tokens in tailwind.config.js (see FIG-527) so antd
// components (DatePicker, Select, Table, etc.) match the rest of the app.
export const buildAntdTheme = (brandHex: string = '#17402A'): ThemeConfig => ({
  token: {
    colorPrimary: brandHex,
    colorLink: brandHex,
    colorSuccess: '#2E7D4F',
    colorWarning: '#F26A1B',
    colorError: '#C0392B',
    colorInfo: '#1F4E79',
    colorText: '#16201A',
    colorTextSecondary: '#5F6B62',
    colorTextTertiary: '#9CA3A0',
    colorBorder: '#E2E6E2',
    colorBorderSecondary: '#E2E6E2',
    colorBgLayout: '#F6F8F6',
    colorBgContainer: '#FFFFFF',
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
