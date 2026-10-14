import { describe, expect, it } from 'vitest';
import { canCreateChannels } from './permissions';

describe('canCreateChannels', () => {
  it('is for roles with the create-channels module, whatever the role is called', () => {
    expect(canCreateChannels((m) => m === 'create-channels')).toBe(true);
    expect(canCreateChannels((m) => ['teams', 'dashboard'].includes(m))).toBe(false);
    expect(canCreateChannels(() => false)).toBe(false);
  });
});
