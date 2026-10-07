import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import { randomFileName, storagePathFrom } from './privateFiles';

describe('storagePathFrom', () => {
  it('keeps a stored path as it is', () => {
    expect(storagePathFrom('expense-receipts', 'abc/receipts/r1.jpg')).toBe('abc/receipts/r1.jpg');
  });

  it('reads the path out of an old public link, or a signed one', () => {
    expect(storagePathFrom('expense-receipts', 'https://x.supabase.co/storage/v1/object/public/expense-receipts/receipts/0.12.jpg')).toBe(
      'receipts/0.12.jpg'
    );
    expect(storagePathFrom('resumes', 'https://x.supabase.co/storage/v1/object/sign/resumes/public/My%20CV.pdf?token=t')).toBe('public/My CV.pdf');
  });

  it('refuses a link to another bucket or another site', () => {
    expect(() => storagePathFrom('resumes', 'https://x.supabase.co/storage/v1/object/public/documents/a.pdf')).toThrow();
    expect(() => storagePathFrom('resumes', 'https://evil.example/resumes/a.pdf')).toThrow();
  });
});

describe('randomFileName', () => {
  it('keeps only a clean extension', () => {
    expect(randomFileName('receipt.JPG')).toMatch(/^[0-9a-f-]{36}\.jpg$/);
    expect(randomFileName('../../x.p/h p')).toMatch(/^[0-9a-f-]{36}\.php$/);
  });
});
