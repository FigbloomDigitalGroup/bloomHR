import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const inviteEmployee = vi.hoisted(() => vi.fn());
vi.mock('../../lib/employeeInvite', () => ({ inviteEmployee }));

import InviteStatus from './InviteStatus';
import type { InviteOutcome } from '../../lib/employeeInvite';

const show = (initial: InviteOutcome) =>
  render(
    <MemoryRouter>
      <InviteStatus initial={initial} />
    </MemoryRouter>
  );

afterEach(() => {
  cleanup();
  inviteEmployee.mockReset();
});

describe('InviteStatus', () => {
  it('confirms the invitation was emailed', () => {
    show({ status: 'sent', email: 'new@co.com' });
    expect(screen.getByText('Invitation sent to new@co.com')).toBeTruthy();
  });

  it('says nothing was needed for someone already in the company', () => {
    show({ status: 'member', email: 'old@co.com' });
    expect(screen.getByText(/already has access to this company/)).toBeTruthy();
  });

  it('offers the link to send by hand, and sends again on request', async () => {
    inviteEmployee.mockResolvedValue({ status: 'sent', email: 'new@co.com' });
    show({ status: 'not-emailed', email: 'new@co.com', link: 'https://hr/join?token=t', reason: 'Email is not set up' });
    expect(screen.getByText('The invitation email to new@co.com did not go out')).toBeTruthy();
    expect((screen.getByLabelText('Invitation link') as HTMLInputElement).value).toBe('https://hr/join?token=t');

    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    await waitFor(() => expect(screen.getByText('Invitation sent to new@co.com')).toBeTruthy());
    expect(inviteEmployee).toHaveBeenCalledWith('new@co.com');
  });

  it('points to who can invite when the person adding the employee may not', () => {
    show({ status: 'failed', email: 'new@co.com', reason: 'Only an administrator or HR can invite people' });
    expect(screen.getByText('No invitation was sent to new@co.com')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Invite people' }).getAttribute('href')).toBe('/invite-people');
    expect(screen.queryByRole('button', { name: /Try again/ })).toBeNull();
  });
});
