import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));

import VerifyStaffIdPage from './VerifyStaffIdPage';

// The public check behind a staff ID card's QR code (/verify/<token>): no sign-in, and only whether the holder is a
// current employee, their name, photo, job title and company.

const TOKEN = '0123456789abcdef0123456789abcdef';
const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/verify/:token" element={<VerifyStaffIdPage />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => rpc.mockReset());
afterEach(cleanup);

describe('verify page', () => {
  it('shows a current employee as Active, with their name, photo, job title and company', async () => {
    rpc.mockResolvedValue({
      data: [{ company_name: 'Acme Ltd', company_logo_url: 'https://cdn/logo.png', full_name: 'Esther Wanjiru',
        photo_url: 'https://cdn/e1.png', job_title: 'Accountant', is_active: true }],
      error: null,
    });
    at(`/verify/${TOKEN}`);
    expect(await screen.findByRole('heading', { name: 'Esther Wanjiru' })).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith('verify_staff_id_card', { p_token: TOKEN });
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.queryByText('Not active')).toBeNull();
    expect(screen.getByText('Accountant')).toBeTruthy();
    expect(screen.getByText('Acme Ltd')).toBeTruthy();
    expect(screen.getByAltText('Photo of Esther Wanjiru').getAttribute('src')).toBe('https://cdn/e1.png');
  });

  it('shows someone who has left as Not active, with initials when there is no photo', async () => {
    rpc.mockResolvedValue({
      data: [{ company_name: 'Acme Ltd', company_logo_url: null, full_name: 'Eric Two', photo_url: null, job_title: null, is_active: false }],
      error: null,
    });
    at(`/verify/${TOKEN}`);
    expect(await screen.findByText('Not active')).toBeTruthy();
    expect(screen.getByText('ET')).toBeTruthy();
  });

  it('says a reissued or made-up card is not valid', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    at('/verify/whatever');
    expect(await screen.findByRole('heading', { name: 'This card is not valid' })).toBeTruthy();
  });

  it('says when the check itself failed', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'network' } });
    at(`/verify/${TOKEN}`);
    expect(await screen.findByText(/Could not check this card right now/)).toBeTruthy();
  });
});
