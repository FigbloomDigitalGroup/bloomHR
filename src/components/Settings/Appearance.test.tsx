import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
const saveMyTheme = vi.hoisted(() => vi.fn());
vi.mock('../../lib/preferences', () => ({ saveMyTheme }));
vi.mock('./ProfilePicture', () => ({ default: () => null }));

import Appearance from './Appearance';
import { loadStoredTheme, resetTheme } from '../../theme/applyTheme';

const rootVar = (name: string) => document.documentElement.style.getPropertyValue(name);

beforeEach(() => {
  saveMyTheme.mockReset();
  localStorage.clear();
  resetTheme();
});
afterEach(() => cleanup());

describe('Appearance', () => {
  it('starts on the default theme', () => {
    render(<Appearance />);
    expect(screen.getByRole('button', { name: /Forest/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('choosing a theme changes the colours at once and remembers it', () => {
    render(<Appearance />);
    fireEvent.click(screen.getByRole('button', { name: /Ocean/ }));
    expect(rootVar('--shell')).toBe('11 37 69'); // navy sidebar
    expect(screen.getByRole('button', { name: /Ocean/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /Forest/ }).getAttribute('aria-pressed')).toBe('false');
    expect(loadStoredTheme()?.sidebar).toBe('#0B2545');
    expect(saveMyTheme).toHaveBeenCalledWith(expect.objectContaining({ sidebar: '#0B2545' })); // and on the account
  });

  it('a light two-tone theme switches the sidebar text to dark', () => {
    render(<Appearance />);
    fireEvent.click(screen.getByRole('button', { name: /Mist/ }));
    expect(rootVar('--shell-fg')).not.toBe('255 255 255');
    expect(document.documentElement.dataset.shell).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: /Midnight/ }));
    expect(rootVar('--shell-fg')).toBe('255 255 255');
    expect(document.documentElement.dataset.shell).toBe('dark');
  });

  it('custom colours apply live and are labelled Custom', () => {
    render(<Appearance />);
    fireEvent.change(screen.getByLabelText('Sidebar colour'), { target: { value: '#112233' } });
    expect(rootVar('--shell')).toBe('17 34 51');
    expect(screen.getByText(/^Custom/)).toBeTruthy();
    expect(loadStoredTheme()).toMatchObject({ sidebar: '#112233' });
  });

  it('a pale accent is darkened so button text stays readable', () => {
    render(<Appearance />);
    fireEvent.change(screen.getByLabelText('Accent colour'), { target: { value: '#FFFF00' } });
    const [r, g, b] = rootVar('--brand').split(' ').map(Number);
    expect(r + g + b).toBeLessThan(255 + 255 + 0); // darker than the pure yellow they picked
  });

  it('reset returns to the default and forgets the saved choice', () => {
    render(<Appearance />);
    fireEvent.click(screen.getByRole('button', { name: /Rosewood/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    expect(rootVar('--shell')).toBe('');
    expect(loadStoredTheme()).toBeNull();
    expect(saveMyTheme).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('button', { name: /Forest/ }).getAttribute('aria-pressed')).toBe('true');
  });
});
