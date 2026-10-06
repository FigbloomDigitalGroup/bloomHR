import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { theme as antdThemeApi } from 'antd';
import ThemedConfigProvider from './ThemedConfigProvider';
import { buildAntdTheme } from './antdTheme';
import { applyTheme, resetTheme } from './applyTheme';
import { PRESETS, choiceFromPreset } from './themes';

afterEach(() => {
  cleanup();
  resetTheme();
});

function Probe() {
  const { token } = antdThemeApi.useToken();
  return <span data-testid="primary">{token.colorPrimary}</span>;
}

describe('antd follows the chosen theme', () => {
  it('builds a theme around the given brand colour, keeping the rest of the look', () => {
    const t = buildAntdTheme('#1F5FBF');
    expect(t.token?.colorPrimary).toBe('#1F5FBF');
    expect(t.token?.colorLink).toBe('#1F5FBF');
    expect(t.token?.fontFamily).toContain('Figtree');
  });

  it('uses the default green until a theme is chosen, then switches live', () => {
    render(
      <ThemedConfigProvider>
        <Probe />
      </ThemedConfigProvider>
    );
    // jsdom has no stylesheet, so the variable is unset and the default applies
    expect(screen.getByTestId('primary').textContent?.toUpperCase()).toBe('#17402A');
    act(() => {
      applyTheme(choiceFromPreset(PRESETS[1])); // Ocean
    });
    expect(screen.getByTestId('primary').textContent?.toUpperCase()).toBe('#1F5FBF');
  });
});
