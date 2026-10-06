import { describe, expect, it } from 'vitest';
import { canCreateChannels } from './permissions';

describe('canCreateChannels', () => {
  it('is for administrators, HR and managers, whatever the letter case', () => {
    for (const role of ['ADMIN', 'HR', 'MANAGER', 'admin', 'Hr', 'manager']) expect(canCreateChannels(role), role).toBe(true);
  });

  it('is not for staff or the other roles, or for nobody', () => {
    for (const role of ['STAFF', 'CHECKER', 'REGIONAL', 'OPERATIONS', '', null, undefined]) expect(canCreateChannels(role), String(role)).toBe(false);
  });
});
