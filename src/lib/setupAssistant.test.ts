import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({
  departments: [] as { name: string; parentId: string | null }[],
  jobGroups: [] as { code: string; name: string }[],
  profile: [] as Record<string, unknown>[],
  numbering: [] as unknown[][],
  invites: [] as { email: string; role: string }[][],
  failDepartment: '' as string,
}));

vi.mock('./supabase', () => ({ supabase: {} }));
vi.mock('./orgStructure', () => ({
  loadDepartments: vi.fn(),
  addDepartment: vi.fn(async (name: string, parentId: string | null) => {
    if (name === calls.failDepartment) throw new Error('There is already a department with that name');
    calls.departments.push({ name, parentId });
    return { id: `id-${name}`, name, parent_id: parentId, head_employee_id: null, active: true };
  }),
}));
vi.mock('./jobGroups', () => ({
  loadJobGroups: vi.fn(),
  saveJobGroup: vi.fn(async (_id: null, g: { code: string; name: string }) => {
    calls.jobGroups.push(g);
    return `id-${g.code}`;
  }),
}));
vi.mock('./companyProfile', async (original) => ({
  ...(await original<typeof import('./companyProfile')>()),
  loadCompanyProfile: vi.fn(),
  saveCompanyProfile: vi.fn(async (fields: Record<string, unknown>) => {
    calls.profile.push(fields);
    return fields;
  }),
}));
vi.mock('./employeeNumbering', async (original) => ({
  ...(await original<typeof import('./employeeNumbering')>()),
  loadEmployeeNumbering: vi.fn(),
  saveEmployeeNumbering: vi.fn(async (...args: unknown[]) => {
    calls.numbering.push(args);
    return { mode: args[0], prefix: args[1], digits: args[2], next_number: 1, preview: `${args[1]}${'1'.padStart(Number(args[2]), '0')}` };
  }),
}));
vi.mock('./employeeInvite', async (original) => ({
  ...(await original<typeof import('./employeeInvite')>()),
  sendInvitations: vi.fn(async (people: { email: string; role: string }[]) => {
    calls.invites.push(people);
    return people.map((p) => (p.email.startsWith('bad') ? { status: 'failed', email: p.email, reason: 'Only HR can invite' } : { status: 'sent', email: p.email }));
  }),
}));

import { applyProposal, describeProposal, setupSummary, whatIsNew, type SetupState } from './setupAssistant';
import { EMPTY_PROFILE } from './companyProfile';

const state = (over: Partial<SetupState> = {}): SetupState => ({
  companyName: 'Bloom Farm',
  profile: null,
  departments: [{ id: 'd1', name: 'Finance', parent_id: null, head_employee_id: null, active: true }],
  jobGroups: [],
  numbering: { mode: 'system', prefix: 'MCL-', digits: 6, next_number: 1, preview: 'MCL-000001' },
  invitations: [{ id: 'i1', email: 'jane@bloom.co.ke', role: 'HR', status: 'pending', created_at: '', expires_at: '', accepted_at: null }],
  employeeCount: 0,
  ...over,
});

beforeEach(() => {
  calls.departments = [];
  calls.jobGroups = [];
  calls.profile = [];
  calls.numbering = [];
  calls.invites = [];
  calls.failDepartment = '';
});

describe('whatIsNew: only what the company does not have yet', () => {
  it('leaves out departments, job groups and invitations it already has (any case), and repeats', () => {
    expect(
      whatIsNew({ type: 'departments', items: [{ name: 'finance', parent: null }, { name: 'Farm', parent: null }, { name: 'farm', parent: null }] }, state())
    ).toEqual({ type: 'departments', items: [{ name: 'Farm', parent: null }] });
    expect(whatIsNew({ type: 'invitations', items: [{ email: 'JANE@bloom.co.ke', role: 'HR' }] }, state())).toBeNull();
    expect(
      whatIsNew({ type: 'invitations', items: [{ email: 'jane@bloom.co.ke', role: 'HR' }] }, state({ invitations: [{ ...state().invitations![0], status: 'revoked' }] }))
    ).not.toBeNull();
  });

  it('leaves out profile fields that already hold that value, and numbering that is already so', () => {
    const profile = { tenant_id: 't', ...EMPTY_PROFILE, company_name: 'Bloom Farm', industry: 'agriculture' };
    expect(whatIsNew({ type: 'profile', fields: { industry: 'agriculture', city: 'Naivasha' } }, state({ profile }))).toEqual({
      type: 'profile',
      fields: { city: 'Naivasha' },
    });
    expect(whatIsNew({ type: 'profile', fields: { company_name: 'Bloom Farm' } }, state())).toBeNull();
    expect(whatIsNew({ type: 'employee_numbering', mode: 'system', prefix: 'MCL-', digits: 6 }, state())).toBeNull();
    expect(whatIsNew({ type: 'employee_numbering', mode: 'system', prefix: 'BF-', digits: 4 }, state())).not.toBeNull();
  });
});

describe('describeProposal', () => {
  it('reads profile values as a person would, with what they replace', () => {
    const profile = { tenant_id: 't', ...EMPTY_PROFILE, company_name: 'Bloom Farm', city: 'Nakuru' };
    const view = describeProposal({ type: 'profile', fields: { industry: 'ict', fiscal_year_start_month: 7, city: 'Naivasha' } }, state({ profile }));
    expect(view.lines).toEqual([{ text: 'Industry: ICT & technology' }, { text: 'Financial year starts: July', was: 'January' }, { text: 'City: Naivasha', was: 'Nakuru' }]);
  });

  it('shows the first numbers the system will give', () => {
    expect(describeProposal({ type: 'employee_numbering', mode: 'system', prefix: 'BF-', digits: 4 }, state()).lines[0].text).toBe(
      'Given by the system: BF-0001, BF-0002, …'
    );
  });
});

describe('applyProposal', () => {
  it('adds parents before the departments under them, linking to existing ones', async () => {
    const note = await applyProposal(
      {
        type: 'departments',
        items: [
          { name: 'Packhouse', parent: 'Farm' },
          { name: 'Payroll', parent: 'finance' },
          { name: 'Farm', parent: null },
          { name: 'Orphan', parent: 'Nowhere' },
        ],
      },
      state()
    );
    expect(calls.departments).toEqual([
      { name: 'Payroll', parentId: 'd1' },
      { name: 'Farm', parentId: null },
      { name: 'Packhouse', parentId: 'id-Farm' },
      { name: 'Orphan', parentId: null },
    ]);
    expect(note).toBe('Added 4 departments.');
  });

  it('says how far it got when one is refused', async () => {
    calls.failDepartment = 'Packhouse';
    await expect(
      applyProposal({ type: 'departments', items: [{ name: 'Farm', parent: null }, { name: 'Packhouse', parent: 'Farm' }] }, state())
    ).rejects.toThrow('Added 1 department, then stopped at Packhouse: There is already a department with that name');
  });

  it('saves the whole profile with the proposed fields, starting from blank for a new company', async () => {
    await applyProposal({ type: 'profile', fields: { industry: 'agriculture', city: 'Naivasha' } }, state());
    expect(calls.profile[0]).toEqual({ ...EMPTY_PROFILE, company_name: 'Bloom Farm', industry: 'agriculture', city: 'Naivasha' });
  });

  it('refuses a profile the page would refuse', async () => {
    await expect(applyProposal({ type: 'profile', fields: { official_phone: 'call us' } }, state())).rejects.toThrow('Enter a phone number');
    expect(calls.profile).toHaveLength(0);
  });

  it('sets numbering without moving the count, and keeps the format when switching to own numbers', async () => {
    expect(await applyProposal({ type: 'employee_numbering', mode: 'system', prefix: 'BF-', digits: 4 }, state())).toBe(
      'The next employee number will be BF-0001.'
    );
    await applyProposal({ type: 'employee_numbering', mode: 'own' }, state());
    expect(calls.numbering).toEqual([
      ['system', 'BF-', 4],
      ['own', 'MCL-', 6],
    ]);
  });

  it('adds job groups and sends invitations, reporting any not sent', async () => {
    expect(await applyProposal({ type: 'job_groups', items: [{ code: 'JG1', name: 'Management' }] }, state())).toBe('Added 1 job group.');
    const note = await applyProposal(
      { type: 'invitations', items: [{ email: 'Tom@Bloom.co.ke ', role: 'MANAGER' }, { email: 'bad@bloom.co.ke', role: 'HR' }] },
      state()
    );
    expect(calls.invites[0]).toEqual([
      { email: 'tom@bloom.co.ke', role: 'MANAGER' },
      { email: 'bad@bloom.co.ke', role: 'HR' },
    ]);
    expect(note).toBe('Sent 1 invitation. Not sent to bad@bloom.co.ke (see Invite people).');
    await expect(applyProposal({ type: 'invitations', items: [{ email: 'bad@x.co', role: 'HR' }] }, state())).rejects.toThrow('Only HR can invite');
  });
});

describe('setupSummary', () => {
  it('tells the AI what exists, briefly', () => {
    const s = state({
      departments: [
        { id: 'd1', name: 'Finance', parent_id: null, head_employee_id: null, active: true },
        { id: 'd2', name: 'Payroll', parent_id: 'd1', head_employee_id: null, active: true },
        { id: 'd3', name: 'Old', parent_id: null, head_employee_id: null, active: false },
      ],
      jobGroups: null,
    });
    expect(setupSummary(s)).toEqual({
      company_name: 'Bloom Farm',
      profile: 'not set up yet',
      departments: ['Finance', 'Payroll (under Finance)'],
      job_groups: 'unknown',
      employee_numbering: 'system, next MCL-000001',
      invitations: ['jane@bloom.co.ke (HR, pending)'],
      employees: 0,
    });
  });
});
