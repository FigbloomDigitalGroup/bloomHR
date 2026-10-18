import { describe, expect, it } from 'vitest';
import { canCreateChannels } from './permissions';

const holding = (modules: string[]) => (m: string) => modules.includes(m);

describe('canCreateChannels', () => {
  it('is for whoever holds Create chat channels, whatever their role is called', () => {
    expect(canCreateChannels(holding(['teams', 'chat-channels']))).toBe(true);
    expect(canCreateChannels(() => true)).toBe(true); // administrators hold every module
  });

  it('is not for anyone without it', () => {
    expect(canCreateChannels(holding(['teams']))).toBe(false);
    expect(canCreateChannels(holding([]))).toBe(false);
  });

  it('keeps the system roles as they were: HR and managers yes; staff, checkers, regional and operations no', () => {
    const DEFAULTS: Record<string, string[]> = {
      HR: ['teams', 'chat-channels', 'hr-admin'],
      MANAGER: ['teams', 'chat-channels', 'team-work'],
      STAFF: ['dashboard', 'task-manager', 'teams'],
      CHECKER: ['teams', 'payroll', 'settings'],
      REGIONAL: ['teams', 'employee-edit'],
      OPERATIONS: ['teams', 'sms', 'recruitment'],
    };
    expect(canCreateChannels(holding(DEFAULTS.HR))).toBe(true);
    expect(canCreateChannels(holding(DEFAULTS.MANAGER))).toBe(true);
    for (const r of ['STAFF', 'CHECKER', 'REGIONAL', 'OPERATIONS']) expect(canCreateChannels(holding(DEFAULTS[r])), r).toBe(false);
  });
});
