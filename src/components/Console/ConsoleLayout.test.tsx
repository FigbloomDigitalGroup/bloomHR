import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));

import ConsoleLayout from './ConsoleLayout';

afterEach(cleanup);

const renderLayout = () =>
  render(
    <MemoryRouter initialEntries={['/platform/schools']}>
      <ConsoleLayout email="ops@figbloom.org" role="owner" onSignOut={() => undefined}>
        <p>page</p>
      </ConsoleLayout>
    </MemoryRouter>
  );

describe('the console menu', () => {
  it('groups pages by product and, with two products, names each one', () => {
    renderLayout();
    const products = screen.getByRole('navigation', { name: 'Console' });
    const hr = within(products).getByText('Figbloom HR').parentElement as HTMLElement;
    const schools = within(products).getByText('Figbloom Schools').parentElement as HTMLElement;
    expect(within(hr).getByRole('link', { name: 'Organisations' }).getAttribute('href')).toBe('/platform/organisations');
    expect(within(hr).getByRole('link', { name: 'Statutory rates' }).getAttribute('href')).toBe('/platform/rates');
    expect(within(schools).getAllByRole('link').map((a) => a.textContent)).toEqual(['Schools']);
    expect(within(schools).getByRole('link', { name: 'Schools' }).getAttribute('href')).toBe('/platform/schools');
    // Staff is Figbloom's own, apart from the products
    expect(within(products).queryByRole('link', { name: 'Staff' })).toBeNull();
    expect(within(screen.getByRole('navigation', { name: 'Figbloom' })).getByRole('link', { name: 'Staff' })).toBeTruthy();
  });
});
