import { beforeEach, describe, expect, it, vi } from 'vitest';

const createInvitation = vi.fn();
const emailInvitation = vi.fn();

vi.mock('./companyApi', () => ({
  companyApi: { createInvitation: (...a: unknown[]) => createInvitation(...a), emailInvitation: (...a: unknown[]) => emailInvitation(...a) },
  inviteLink: (token: string) => `https://hr.example/join?token=${token}`,
}));

import { inviteEmployee, normaliseWorkEmail, sendInvitations, summariseInvites, workEmailProblem } from './employeeInvite';

beforeEach(() => {
  createInvitation.mockReset().mockResolvedValue({ invitation_id: 'i1', token: 'tok', expires_at: '2026-10-16' });
  emailInvitation.mockReset().mockResolvedValue({ ok: true, sentTo: 'x' });
});

describe('normaliseWorkEmail', () => {
  it('saves the address the way logins have it', () => {
    expect(normaliseWorkEmail('  Achieng.Otieno@Figbloom.ORG ')).toBe('achieng.otieno@figbloom.org');
    expect(normaliseWorkEmail(undefined)).toBe('');
  });
});

describe('inviteEmployee', () => {
  it('invites the work email as staff and emails the link', async () => {
    await expect(inviteEmployee('New.Hire@Figbloom.org')).resolves.toEqual({ status: 'sent', email: 'new.hire@figbloom.org' });
    expect(createInvitation).toHaveBeenCalledWith('new.hire@figbloom.org', 'STAFF');
    expect(emailInvitation).toHaveBeenCalledWith('tok');
  });

  it('keeps the link to send by hand when the email does not go out', async () => {
    emailInvitation.mockRejectedValue(new Error('Email is not set up'));
    await expect(inviteEmployee('a@b.co')).resolves.toEqual({
      status: 'not-emailed',
      email: 'a@b.co',
      link: 'https://hr.example/join?token=tok',
      reason: 'Email is not set up',
    });
  });

  it('says so when the person is already in the company', async () => {
    createInvitation.mockRejectedValue(new Error('That person is already in this company.'));
    await expect(inviteEmployee('a@b.co')).resolves.toEqual({ status: 'member', email: 'a@b.co' });
    expect(emailInvitation).not.toHaveBeenCalled();
  });

  it('reports why no invitation was made', async () => {
    createInvitation.mockRejectedValue(new Error('Only an administrator or HR can invite people'));
    await expect(inviteEmployee('a@b.co')).resolves.toEqual({
      status: 'failed',
      email: 'a@b.co',
      reason: 'Only an administrator or HR can invite people',
    });
  });
});

describe('workEmailProblem', () => {
  it('accepts a valid address in any case', () => {
    expect(workEmailProblem(' Jane.Doe@Co.com ')).toBeNull();
  });

  it('explains a missing or invalid address', () => {
    expect(workEmailProblem('')).toBe('no work email (the invitation to join is sent there)');
    expect(workEmailProblem(null)).toBe('no work email (the invitation to join is sent there)');
    expect(workEmailProblem('jane@co')).toBe('work email "jane@co" is not a valid address');
  });
});

describe('sendInvitations', () => {
  it('sends each invitation with its role, one after another, and reports progress', async () => {
    createInvitation.mockImplementation(async (email: string) => {
      if (email === 'old@co.com') throw new Error('That person is already in this company.');
      return { invitation_id: email, token: `tok-${email}`, expires_at: '' };
    });
    emailInvitation.mockImplementation(async (token: string) => {
      if (token === 'tok-down@co.com') throw new Error('Rate limited');
      return { ok: true };
    });
    const progress: string[] = [];
    const outcomes = await sendInvitations(
      [
        { email: 'A@co.com', role: 'STAFF' },
        { email: 'old@co.com', role: 'STAFF' },
        { email: 'down@co.com', role: 'HR' },
      ],
      (done, total) => progress.push(`${done}/${total}`),
      0
    );
    expect(createInvitation.mock.calls).toEqual([
      ['a@co.com', 'STAFF'],
      ['old@co.com', 'STAFF'],
      ['down@co.com', 'HR'],
    ]);
    expect(progress).toEqual(['1/3', '2/3', '3/3']);
    const summary = summariseInvites(outcomes);
    expect(summary.sent).toBe(1);
    expect(summary.members).toBe(1);
    expect(summary.notSent).toEqual([
      { status: 'not-emailed', email: 'down@co.com', link: 'https://hr.example/join?token=tok-down@co.com', reason: 'Rate limited' },
    ]);
  });
});
