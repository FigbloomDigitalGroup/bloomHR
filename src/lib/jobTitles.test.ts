import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import { jobTitleError, likelyDuplicates, tidyTitle, titleDefaults, titleKey, titleNameProblem } from './jobTitles';

describe('titleKey / tidyTitle', () => {
  it('compares names as the database does: case, spacing and tabs ignored', () => {
    expect(titleKey('  Sales \t REP ')).toBe('sales rep');
    expect(titleKey(null)).toBe('');
    expect(tidyTitle('  Sales \t Rep ')).toBe('Sales Rep');
  });
});

describe('likelyDuplicates', () => {
  it('groups titles that differ only in punctuation or a final s', () => {
    const groups = likelyDuplicates([
      { id: '1', name: 'Sales Rep' },
      { id: '2', name: 'Sales Rep.' },
      { id: '3', name: 'Sales reps' },
      { id: '4', name: 'Driver' },
      { id: '5', name: '---' },
    ]);
    expect(groups.map((g) => g.map((t) => t.id))).toEqual([['1', '2', '3']]);
  });
});

describe('titleNameProblem', () => {
  const titles = [{ id: 'a', name: 'Driver' }];
  it('needs a name that is not already used (ignoring case and spaces)', () => {
    expect(titleNameProblem('  ', titles, null)).toMatch(/name/);
    expect(titleNameProblem(' DRIVER ', titles, null)).toMatch(/already/);
    expect(titleNameProblem('Driver', titles, 'a')).toBeNull();
    expect(titleNameProblem('x'.repeat(121), titles, null)).toMatch(/120/);
  });
});

describe('titleDefaults', () => {
  it('fills the usual department and job group only where the form has none', () => {
    const t = { department_id: 'd1', job_group_id: 'g1' };
    expect(titleDefaults(t, {})).toEqual({ department_id: 'd1', job_group_id: 'g1' });
    expect(titleDefaults(t, { department_id: 'd9' })).toEqual({ job_group_id: 'g1' });
    expect(titleDefaults(undefined, {})).toEqual({});
  });
});

describe('jobTitleError', () => {
  it('says plainly what went wrong', () => {
    expect(jobTitleError({ code: '23505' })).toMatch(/already a job title/);
    expect(jobTitleError({ code: '42501', message: 'new row violates row-level security policy' })).toMatch(/not allowed/);
    expect(jobTitleError({ message: 'Boom' })).toBe('Boom');
  });
});
