import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import FigbloomLoader, { LoaderBlock } from './FigbloomLoader';
import { ARRIVING_KEY } from '../../lib/arriving';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  sessionStorage.clear();
});

describe('FigbloomLoader', () => {
  it('announces that something is loading, with the logo and its label', () => {
    const { container } = render(<FigbloomLoader />);
    expect(screen.getByRole('status').textContent).toMatch(/^Getting things ready\.\.\.$/);
    expect(container.querySelector('.fb-arc')).toBeTruthy();
    expect(container.querySelector('.fb-leaf')).toBeTruthy();
  });

  it('covers the whole screen while a page or the app loads', () => {
    const { container } = render(<FigbloomLoader fullScreen label="Loading payroll" />);
    expect((container.firstChild as HTMLElement).className).toMatch(/fixed inset-0/);
    expect(screen.getByRole('status').textContent).toMatch(/^Loading payroll/);
  });

  it('is named by its label, for screen readers and tests', () => {
    render(<FigbloomLoader label="Loading payroll" />);
    expect(screen.getByRole('status', { name: 'Loading payroll' }).getAttribute('aria-live')).toBe('polite');
  });

  it('has a small version for a card or part of a page', () => {
    const { container } = render(<FigbloomLoader label="Loading" compact />);
    expect(screen.getByRole('status').className).toMatch(/fb-loader--compact/);
    expect((container.querySelector('svg') as SVGElement).style.width).toBe('56px');
  });

  it('LoaderBlock centres it in a page’s content area, or in a card when compact', () => {
    const page = render(<LoaderBlock label="Loading employees" />);
    expect((page.container.firstChild as HTMLElement).className).toMatch(/min-h-\[60vh\]/);
    expect(page.getByRole('status', { name: 'Loading employees' }).querySelector('.fb-leaf')).toBeTruthy();
    page.unmount();
    const card = render(<LoaderBlock label="Loading loans" compact />);
    expect((card.container.firstChild as HTMLElement).className).not.toMatch(/min-h-\[60vh\]/);
    expect(card.getByRole('status', { name: 'Loading loans' }).className).toMatch(/fb-loader--compact/);
  });

  it('fades in when nothing was loading, and carries straight on from a loader that just went', () => {
    const t = 1_000_000; // long after the earlier tests' loaders (and the next one comes at the same moment)
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    const first = render(<FigbloomLoader label="Opening the page" />);
    expect(first.getByRole('status').className).toMatch(/fb-loader--fade-in/);
    first.unmount();
    const next = render(<FigbloomLoader label="Loading payroll" />);
    expect(next.getByRole('status').className).not.toMatch(/fb-loader--fade-in/);
    expect(next.getByRole('status').style.getPropertyValue('--fb-phase')).toMatch(/^-?\d+(\.\d+)?ms$/);
  });

  describe('arriving from another Figbloom product (fb-arriving)', () => {
    it('a full-screen loader says "Opening Figbloom HR" instead of its own words, opaque and without fading in', () => {
      sessionStorage.setItem(ARRIVING_KEY, '1');
      vi.spyOn(performance, 'now').mockImplementation(() => 5_000_000); // nothing loading just before: it would fade in
      const { container } = render(<FigbloomLoader fullScreen label="Loading your workspace" />);
      const status = screen.getByRole('status', { name: 'Opening Figbloom HR' });
      expect(status.textContent).toMatch(/^Opening Figbloom HR\.\.\.$/);
      expect(status.className).not.toMatch(/fb-loader--fade-in/);
      expect((container.firstChild as HTMLElement).className).toMatch(/(^|\s)bg-page(\s|$)/);
    });

    it('leaves loaders inside a page alone, and full-screen ones too once the flag is gone', () => {
      sessionStorage.setItem(ARRIVING_KEY, '1');
      render(<LoaderBlock label="Loading employees" />);
      expect(screen.getByRole('status', { name: 'Loading employees' })).toBeTruthy();
      cleanup();
      sessionStorage.clear();
      const { container } = render(<FigbloomLoader fullScreen label="Loading your workspace" />);
      expect(screen.getByRole('status', { name: 'Loading your workspace' })).toBeTruthy();
      expect((container.firstChild as HTMLElement).className).toMatch(/bg-page\/90/);
    });

    it('clears the flag once a real page shows (no full-screen loader for a moment), not between two loaders', () => {
      vi.useFakeTimers();
      sessionStorage.setItem(ARRIVING_KEY, '1');
      document.title = 'Opening Figbloom HR';
      const first = render(<FigbloomLoader fullScreen />);
      first.unmount();
      const next = render(<FigbloomLoader fullScreen label="Loading your workspace" />);
      act(() => vi.advanceTimersByTime(2000));
      expect(sessionStorage.getItem(ARRIVING_KEY)).toBe('1');
      expect(next.getByRole('status', { name: 'Opening Figbloom HR' })).toBeTruthy();
      next.unmount(); // the dashboard (or the sign-in form) is on screen
      act(() => vi.advanceTimersByTime(700));
      expect(sessionStorage.getItem(ARRIVING_KEY)).toBeNull();
      expect(document.title).toBe('Figbloom HR');
    });

    it('never breaks a normal load when session storage is blocked', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      render(<FigbloomLoader fullScreen label="Loading your workspace" />);
      expect(screen.getByRole('status', { name: 'Loading your workspace' })).toBeTruthy();
    });
  });
});
