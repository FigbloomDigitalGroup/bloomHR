import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  row: null as { theme: unknown; avatar_url: string | null } | null,
  error: null as unknown,
  upsert: vi.fn(),
}));

vi.mock('./supabase', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: mocks.user } }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: mocks.row, error: mocks.error }) }) }),
      upsert: (...args: unknown[]) => {
        mocks.upsert(...args);
        return Promise.resolve({ error: mocks.error });
      },
    }),
  },
}));

import { fetchMyPreferences, saveMyTheme, syncThemeWithAccount } from './preferences';
import { loadStoredTheme, resetTheme, saveStoredTheme } from '../theme/applyTheme';
import { choiceFromPreset, PRESETS } from '../theme/themes';

const ocean = choiceFromPreset(PRESETS.find((p) => p.id === 'ocean')!);
const rosewood = choiceFromPreset(PRESETS.find((p) => p.id === 'rose')!);

beforeEach(() => {
  mocks.user = { id: 'u1' };
  mocks.row = null;
  mocks.error = null;
  mocks.upsert.mockReset();
  localStorage.clear();
  resetTheme();
});

describe('preferences', () => {
  it('reads the saved theme and picture, dropping a theme that is rubbish', async () => {
    mocks.row = { theme: ocean, avatar_url: 'https://x/a.png' };
    expect(await fetchMyPreferences()).toEqual({ theme: ocean, avatarUrl: 'https://x/a.png' });
    mocks.row = { theme: { sidebar: 'red' }, avatar_url: null };
    expect((await fetchMyPreferences())?.theme).toBeNull();
  });

  it('is quiet when the table is missing or nobody is signed in', async () => {
    mocks.error = { message: 'relation "user_preferences" does not exist' };
    expect(await fetchMyPreferences()).toBeNull();
    expect(await saveMyTheme(ocean)).toBe(false);
    mocks.user = null;
    expect(await fetchMyPreferences()).toBeNull();
  });

  it('saves for the signed-in login', async () => {
    expect(await saveMyTheme(ocean)).toBe(true);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'u1', theme: ocean }));
  });

  it('on a new device the account theme is applied and remembered', async () => {
    mocks.row = { theme: ocean, avatar_url: null };
    await syncThemeWithAccount();
    expect(loadStoredTheme()?.sidebar).toBe(ocean.sidebar);
    expect(document.documentElement.style.getPropertyValue('--shell')).toBe('11 37 69');
  });

  it('the account wins over a different local choice', async () => {
    saveStoredTheme(rosewood);
    mocks.row = { theme: ocean, avatar_url: null };
    await syncThemeWithAccount();
    expect(loadStoredTheme()?.sidebar).toBe(ocean.sidebar);
  });

  it('a local choice with nothing on the account is saved to the account', async () => {
    saveStoredTheme(rosewood);
    await syncThemeWithAccount();
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ theme: rosewood }));
  });
});
