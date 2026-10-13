import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import FigbloomLoader from './FigbloomLoader';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
});
