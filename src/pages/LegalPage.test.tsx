import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import LegalPage from './LegalPage';
import { PRIVACY, TERMS } from '../lib/legal';
import { SITE } from '../lib/landing';

afterEach(() => {
  cleanup();
  document.title = '';
});

describe('the legal pages', () => {
  it('show the Privacy Policy with a heading for every section', () => {
    render(<LegalPage kind="privacy" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeTruthy();
    for (const section of PRIVACY.sections) expect(screen.getByRole('heading', { level: 2, name: section.heading })).toBeTruthy();
    expect(document.title).toBe(`Privacy Policy | ${SITE.name}`);
  });

  it('show the Terms of Service, and link to the other page and back home', () => {
    render(<LegalPage kind="terms" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeTruthy();
    for (const section of TERMS.sections) expect(screen.getByRole('heading', { level: 2, name: section.heading })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Privacy Policy' }).getAttribute('href')).toBe('/privacy');
    expect(screen.getAllByRole('link', { name: /Figbloom HR/ }).some((link) => link.getAttribute('href') === '/')).toBe(true);
  });
});
