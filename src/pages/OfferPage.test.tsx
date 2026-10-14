import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import OfferPage from './OfferPage';

const offer = (status = 'sent') => ({
  title: 'Offer of employment', body: 'Dear {{candidate_name}},\n\nWelcome to {{company_name}} as {{job_title}}.',
  candidate_first_name: 'Jane', candidate_last_name: 'Wanjiku', job_title: 'Accountant', job_group: null,
  basic_salary: '50000.00', house_allowance: '0', travel_allowance: '0', other_allowances: '0',
  start_date: '2026-11-02', expiry_date: '2026-10-30', sent_at: '2026-10-14T08:00:00Z', status, responded_at: null,
  company: { name: 'Favor Farm', logo_url: null, primary_color: '#123456' },
});

const open = (token = 'a'.repeat(64)) =>
  render(
    <MemoryRouter initialEntries={[`/offer?token=${token}`]}>
      <OfferPage />
    </MemoryRouter>
  );

beforeEach(() => rpc.mockReset());
afterEach(() => cleanup());

describe('OfferPage (public)', () => {
  it('shows the one offer the token opens, on the company’s letterhead', async () => {
    rpc.mockResolvedValue({ data: offer(), error: null });
    open();
    expect(await screen.findByText(/Dear Jane Wanjiku,/)).toBeTruthy();
    expect(screen.getByText('Favor Farm')).toBeTruthy();
    expect(screen.getByText(/Welcome to Favor Farm as Accountant/)).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith('offer_by_token', { p_token: 'a'.repeat(64) });
    expect(screen.getByText(/Please reply by/)).toBeTruthy();
  });

  it('says so when the link is not valid', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    open('bad');
    expect(await screen.findByText('This offer link is not valid')).toBeTruthy();
    expect(screen.queryByText('Accept offer')).toBeNull();
  });

  it('accepting sends the answer once and shows it', async () => {
    rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'offer_by_token' ? { data: offer(), error: null } : { data: 'accepted', error: null }));
    open();
    fireEvent.click(await screen.findByText('Accept offer'));
    expect(await screen.findByText(/You accepted this offer/)).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith('respond_to_offer', { p_token: 'a'.repeat(64), p_accept: true, p_reason: null });
    expect(screen.queryByText('Accept offer')).toBeNull();
  });

  it('declining asks for an optional reason', async () => {
    rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'offer_by_token' ? { data: offer(), error: null } : { data: 'declined', error: null }));
    open();
    fireEvent.click(await screen.findByText('Decline'));
    fireEvent.change(screen.getByLabelText(/tell us why/), { target: { value: ' Took another job ' } });
    fireEvent.click(screen.getByText('Decline offer'));
    expect(await screen.findByText('You declined this offer.')).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith('respond_to_offer', { p_token: 'a'.repeat(64), p_accept: false, p_reason: 'Took another job' });
  });

  it('an expired or answered offer can only be read', async () => {
    rpc.mockResolvedValue({ data: offer('expired'), error: null });
    open();
    expect(await screen.findByText(/This offer has expired/)).toBeTruthy();
    expect(screen.queryByText('Accept offer')).toBeNull();
    expect(screen.getByText('Download PDF')).toBeTruthy();
  });

  it('shows the database’s refusal (e.g. it expired meanwhile)', async () => {
    rpc.mockImplementation((fn: string) =>
      Promise.resolve(fn === 'offer_by_token' ? { data: offer(), error: null } : { data: null, error: { message: 'This offer expired on 13 October 2026' } }));
    open();
    fireEvent.click(await screen.findByText('Accept offer'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/expired on 13 October/));
  });
});
