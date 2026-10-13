import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import FigbloomLoader from './FigbloomLoader';

afterEach(cleanup);

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
});
