import { describe, expect, it } from 'vitest';
import { profileItems, profileScore } from './profileCompleteness';

const full = {
  'Profile Image': 'https://x/y.png',
  'Mobile Number': '0712345678',
  'Personal Email': 'me@gmail.com',
  'Date of Birth': '1990-01-01',
  'ID Number': 12345678,
  'Tax PIN': 'A001234567B',
  payment_method: 'Bank',
  Bank: 'KCB',
  'Account Number': '1100000001',
};

describe('profileItems / profileScore', () => {
  it('a completely filled record is 100%', () => {
    const score = profileScore(profileItems(full, true));
    expect(score).toMatchObject({ done: 8, total: 8, percent: 100, complete: true });
    expect(score.missing).toEqual([]);
  });

  it('an almost empty record (the kind HR creates) lists everything the person still has to add', () => {
    const score = profileScore(profileItems({ 'First Name': 'Jane', 'Work Email': 'jane@co.com' }, false));
    expect(score.percent).toBe(0);
    expect(score.missing.map((m) => m.key)).toEqual(['photo', 'mobile', 'personalEmail', 'dob', 'idNumber', 'taxPin', 'payment', 'emergency']);
  });

  it('counts empty text, spaces, zero and null as missing', () => {
    const items = profileItems({ ...full, 'Mobile Number': '   ', 'Tax PIN': '', 'ID Number': 0, 'Profile Image': null }, true);
    expect(items.filter((i) => !i.done).map((i) => i.key)).toEqual(['photo', 'mobile', 'idNumber', 'taxPin']);
  });

  it('bank details are needed unless paid by mobile money or cash', () => {
    const noBank = { ...full, Bank: null, 'Account Number': null };
    expect(profileItems({ ...noBank, payment_method: 'Bank' }, true).find((i) => i.key === 'payment')?.done).toBe(false);
    expect(profileItems({ ...noBank, payment_method: 'Mpesa' }, true).find((i) => i.key === 'payment')?.done).toBe(true);
    expect(profileItems({ ...noBank, payment_method: 'Cash' }, true).find((i) => i.key === 'payment')?.done).toBe(true);
    expect(profileItems({ ...full, 'Account Number': '' }, true).find((i) => i.key === 'payment')?.done).toBe(false);
  });

  it('leaves the emergency contact out when it is not known, instead of calling it missing', () => {
    expect(profileItems(full, null).some((i) => i.key === 'emergency')).toBe(false);
    expect(profileScore(profileItems(full, null))).toMatchObject({ done: 7, total: 7, percent: 100 });
  });

  it('rounds the percentage', () => {
    const s = profileScore(profileItems({ 'Profile Image': 'x', 'Mobile Number': '0712345678', 'Personal Email': 'a@b.co' }, false));
    expect(s.percent).toBe(Math.round((3 / 8) * 100));
  });

  it('copes with no record at all', () => {
    expect(profileScore(profileItems(null, null)).percent).toBe(0);
  });
});
