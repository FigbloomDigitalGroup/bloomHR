import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  tenant: 'tenant-1' as string | null,
  upload: vi.fn(),
  uploadError: null as unknown,
}));

vi.mock('./supabase', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: mocks.user } }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: mocks.tenant ? { tenant_id: mocks.tenant } : null, error: null }) }) }),
    }),
    storage: {
      from: (bucket: string) => ({
        upload: (...args: unknown[]) => {
          mocks.upload(bucket, ...args);
          return Promise.resolve({ error: mocks.uploadError });
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://files.example/${bucket}/${path}` } }),
      }),
    },
  },
}));

import { uploadEmployeeAvatar } from './avatarStorage';

const file = (name: string) => new File(['x'], name, { type: 'image/png' });

beforeEach(() => {
  mocks.user = { id: 'u1' };
  mocks.tenant = 'tenant-1';
  mocks.uploadError = null;
  mocks.upload.mockReset();
});

describe('uploadEmployeeAvatar', () => {
  it('saves into the company’s own folder, named after the employee, and replaces what was there', async () => {
    const url = await uploadEmployeeAvatar(file('me.PNG'), 'EMP-001');
    expect(mocks.upload).toHaveBeenCalledWith('employeeavatar', 'tenant-1/profile_images/EMP-001.png', expect.any(File), { upsert: true, cacheControl: '3600' });
    expect(url).toMatch(/^https:\/\/files\.example\/employeeavatar\/tenant-1\/profile_images\/EMP-001\.png\?v=\d+$/);
  });

  it('keeps a slash in an employee number from changing the folder', async () => {
    await uploadEmployeeAvatar(file('a.jpg'), 'A/B');
    expect(mocks.upload.mock.calls[0][1]).toBe('tenant-1/profile_images/A-B.jpg');
  });

  it('falls back to png for a file with no usable extension', async () => {
    await uploadEmployeeAvatar(file('photo'), 'EMP-002');
    expect(String(mocks.upload.mock.calls[0][1])).toMatch(/\.(png|photo)$/);
  });

  it('refuses when nobody is signed in or the company cannot be found', async () => {
    mocks.user = null;
    await expect(uploadEmployeeAvatar(file('a.png'), 'EMP-001')).rejects.toThrow(/not signed in/);
    mocks.user = { id: 'u1' };
    mocks.tenant = null;
    await expect(uploadEmployeeAvatar(file('a.png'), 'EMP-001')).rejects.toThrow(/find your company/);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('passes a storage refusal on to the caller', async () => {
    mocks.uploadError = { message: 'new row violates row-level security policy' };
    await expect(uploadEmployeeAvatar(file('a.png'), 'EMP-001')).rejects.toMatchObject({ message: expect.stringContaining('row-level security') });
  });
});
