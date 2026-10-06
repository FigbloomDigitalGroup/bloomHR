import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AccessibilityButton } from './AccessibilityModal';
import { DEFAULT_A11Y, applyA11y, loadA11y } from '../../lib/a11y';

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  applyA11y(DEFAULT_A11Y);
});

describe('AccessibilityButton', () => {
  it('opens the dialog, applies choices at once, and closes with Escape', () => {
    render(<AccessibilityButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Accessibility' }));
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: /Larger/ }));
    expect(loadA11y().textScale).toBe(1.3);
    fireEvent.click(screen.getByRole('switch', { name: /Higher contrast/ }));
    expect(document.documentElement.hasAttribute('data-a11y-contrast')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Reset accessibility' }));
    expect(loadA11y()).toEqual(DEFAULT_A11Y);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
