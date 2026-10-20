import { describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('./supabase', () => ({ supabase: { rpc } }));

import {
  companyRoomName,
  daysUntilNextCode,
  fetchCompanyMeetingSecret,
  meetingPeriod,
  normalizeMeetingCode,
  periodMeetingCode,
} from './meetingRooms';

const ACME = 'a'.repeat(32) + '0123456789abcdef0123456789abcdef';
const GLOBEX = 'b'.repeat(32) + 'fedcba9876543210fedcba9876543210';

describe('company meeting rooms', () => {
  it('the same code opens a different room in each company', async () => {
    const code = periodMeetingCode(new Date('2026-10-20T09:00:00Z'));
    expect(await companyRoomName(ACME, code)).not.toBe(await companyRoomName(GLOBEX, code));
    expect(await companyRoomName(ACME, 'weekly sync')).not.toBe(await companyRoomName(GLOBEX, 'weekly sync'));
  });

  it('the same room for everyone in a company, whatever the case and spaces typed', async () => {
    const room = await companyRoomName(ACME, 'Weekly Sync');
    expect(await companyRoomName(ACME, ' weekly sync ')).toBe(room);
    expect(await companyRoomName(ACME, 'weeklysync')).toBe(room);
    expect(room).toMatch(/^bloomhr-[0-9a-f]{32}$/);
    // and it gives away neither the code nor the secret
    expect(room).not.toContain('weekly');
    expect(room).not.toContain(ACME.slice(0, 8));
  });

  it("this week's room is the same all period and changes with the period", async () => {
    const mon = new Date('2026-10-20T08:00:00Z');
    const later = new Date('2026-10-20T17:00:00Z');
    const next = new Date(mon.getTime() + daysUntilNextCode(mon) * 86400000);
    expect(periodMeetingCode(later)).toBe(periodMeetingCode(mon));
    expect(meetingPeriod(next)).toBe(meetingPeriod(mon) + 1);
    expect(await companyRoomName(ACME, periodMeetingCode(next))).not.toBe(await companyRoomName(ACME, periodMeetingCode(mon)));
  });

  it('keeps the suggested code people already know (same labels as before)', () => {
    // 2024-01-01 is period 0
    expect(periodMeetingCode(new Date('2024-01-02T00:00:00Z'))).toBe('quick-red-team-00');
    expect(daysUntilNextCode(new Date('2024-01-01T00:00:00Z'))).toBe(5);
    expect(normalizeMeetingCode('  A B  c ')).toBe('abc');
  });

  it('refuses without a secret or a code (never a shared public room)', async () => {
    await expect(companyRoomName('', 'x')).rejects.toThrow();
    await expect(companyRoomName(ACME, '   ')).rejects.toThrow();
  });

  it("asks the database for the caller's company secret and refuses a missing one", async () => {
    rpc.mockResolvedValueOnce({ data: ACME, error: null });
    await expect(fetchCompanyMeetingSecret()).resolves.toBe(ACME);
    expect(rpc).toHaveBeenCalledWith('company_meeting_secret');
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(fetchCompanyMeetingSecret()).rejects.toThrow();
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Sign in to a company to use video calls' } });
    await expect(fetchCompanyMeetingSecret()).rejects.toBeTruthy();
  });
});
