import { beforeEach, describe, expect, it, vi } from 'vitest';

const listeners = vi.hoisted(() => [] as ((event: string) => void)[]);
vi.mock('./supabase', () => ({
  supabase: { auth: { onAuthStateChange: (cb: (event: string) => void) => { listeners.push(cb); return { data: { subscription: { unsubscribe: () => {} } } }; } } },
}));

import { clearFormDrafts, forgetFormDraftsOnSignOut, readFormDraft, removeFormDraft, writeFormDraft } from './formDraft';

beforeEach(() => sessionStorage.clear());

describe('form drafts', () => {
  it('keeps a draft in this tab only', () => {
    writeFormDraft('onboarding:E1', { a: 1 }, 1000);
    expect(readFormDraft('onboarding:E1')).toEqual({ at: 1000, data: { a: 1 } });
    expect(localStorage.getItem('formDraft:onboarding:E1')).toBeNull();
    removeFormDraft('onboarding:E1');
    expect(readFormDraft('onboarding:E1')).toBeNull();
  });

  it('ignores something unreadable', () => {
    sessionStorage.setItem('formDraft:x', '{nope');
    expect(readFormDraft('x')).toBeNull();
  });

  it('signing out forgets every draft, and nothing else', () => {
    writeFormDraft('onboarding:E1', { a: 1 });
    writeFormDraft('bio:E1', { b: 2 });
    sessionStorage.setItem('isMFAProcess', 'true');
    forgetFormDraftsOnSignOut();
    listeners.forEach((l) => l('TOKEN_REFRESHED'));
    expect(readFormDraft('bio:E1')).not.toBeNull();
    listeners.forEach((l) => l('SIGNED_OUT'));
    expect(readFormDraft('onboarding:E1')).toBeNull();
    expect(readFormDraft('bio:E1')).toBeNull();
    expect(sessionStorage.getItem('isMFAProcess')).toBe('true');
    clearFormDrafts();
  });
});
