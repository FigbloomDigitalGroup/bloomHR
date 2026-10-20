import { companyApi, type Invitation } from './companyApi';
import {
  BUSINESS_TYPES,
  EMPTY_PROFILE,
  INDUSTRIES,
  MONTHS,
  loadCompanyProfile,
  profileErrors,
  profileFields,
  saveCompanyProfile,
  type CompanyProfile,
  type CompanyProfileFields,
} from './companyProfile';
import { addDepartment, loadDepartments, type Department } from './orgStructure';
import { loadJobGroups, saveJobGroup, type JobGroup } from './jobGroups';
import { formatEmployeeNumber, loadEmployeeNumbering, numberingError, saveEmployeeNumbering, type EmployeeNumbering } from './employeeNumbering';
import { normaliseWorkEmail, sendInvitations, summariseInvites, workEmailProblem } from './employeeInvite';
import { loadBranches, type Branch } from './branches';
import { describeSaveError, findExistingEmployees, saveEmployeesInBatches } from './bulkEmployees';
import { queueInvitations, rememberInviteBatch } from './inviteQueue';
import { startOnboardingByEmail } from './onboarding';
import { isValidPhone } from './formValidation';
import { supabase } from './supabase';

// The company set-up chat (ai_routes.js, POST /api/ai/setup). The AI only proposes; this file shows what a proposal
// would change and applies it when the person clicks Apply, through the same functions the Settings pages use, with
// the person's own session (so the database's rules decide what they may change). Employees are added the way Bulk
// upload adds them (save_employees_batch, then a queued invitation to join and onboarding for each new person).

export type ProfileProposalField = Exclude<keyof CompanyProfileFields, 'logo_url' | 'primary_color' | 'secondary_color' | 'letterhead_header_url' | 'letterhead_footer_url'>;

export type SetupProposal =
  | { type: 'profile'; fields: Partial<Pick<CompanyProfileFields, ProfileProposalField>> }
  | { type: 'departments'; items: { name: string; parent: string | null }[] }
  | { type: 'job_groups'; items: { code: string; name: string }[] }
  | { type: 'employee_numbering'; mode: 'system' | 'own'; prefix?: string; digits?: number }
  | { type: 'invitations'; items: { email: string; role: string }[] }
  | { type: 'add_employees'; items: NewEmployee[] };

/** A person to add as an employee, as ai_routes.js checked it (names and a valid work email; the rest optional). */
export interface NewEmployee {
  first_name: string;
  last_name: string;
  work_email: string;
  phone?: string;
  job_title?: string;
  /** a department's name, as the company has it */
  department?: string;
  /** a branch's name, as the company has it; none = the default branch */
  branch?: string;
  employment_type?: string;
  /** YYYY-MM-DD */
  start_date?: string;
  basic_salary?: number;
  /** only when the company types its own numbers */
  employee_number?: string;
}

/** What the company has set up so far (null where the person may not see it or it could not be loaded). */
export interface SetupState {
  companyName: string;
  profile: CompanyProfile | null;
  departments: Department[] | null;
  jobGroups: JobGroup[] | null;
  numbering: EmployeeNumbering | null;
  invitations: Invitation[] | null;
  employeeCount: number | null;
  branches?: Branch[] | null;
}

const settled = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === 'fulfilled' ? r.value : null);

export async function loadSetupState(): Promise<SetupState> {
  const [companies, profile, departments, jobGroups, numbering, invitations, employees, branches] = await Promise.allSettled([
    companyApi.myCompanies(),
    loadCompanyProfile(),
    loadDepartments(),
    loadJobGroups(),
    loadEmployeeNumbering(),
    companyApi.listInvitations(),
    supabase.from('employees').select('"Employee Number"', { head: true, count: 'exact' }),
    loadBranches(),
  ]);
  const p = settled(profile);
  const count = settled(employees);
  return {
    companyName: p?.company_name || settled(companies)?.find((c) => c.is_current)?.name || '',
    profile: p,
    departments: settled(departments),
    jobGroups: settled(jobGroups),
    numbering: settled(numbering),
    invitations: settled(invitations),
    employeeCount: count && !count.error ? count.count ?? 0 : null,
    branches: settled(branches),
  };
}

const PROFILE_KEYS: ProfileProposalField[] = [
  'company_name', 'tagline', 'description', 'registration_no', 'business_type', 'industry', 'country', 'base_currency',
  'official_phone', 'official_email', 'website', 'address_line1', 'address_line2', 'city', 'postal_code',
  'fiscal_year_start_month', 'week_start_day',
];

/** The set-up as the AI is told it: short, and only what helps it decide what to ask next. */
export function setupSummary(s: SetupState) {
  const profile = s.profile
    ? Object.fromEntries(PROFILE_KEYS.filter((k) => s.profile![k] !== null && s.profile![k] !== '').map((k) => [k, s.profile![k]]))
    : null;
  const byId = new Map((s.departments ?? []).map((d) => [d.id, d.name]));
  return {
    company_name: s.companyName,
    profile: profile ?? 'not set up yet',
    departments: s.departments?.filter((d) => d.active).map((d) => (d.parent_id && byId.has(d.parent_id) ? `${d.name} (under ${byId.get(d.parent_id)})` : d.name)) ?? 'unknown',
    job_groups: s.jobGroups?.filter((g) => g.active).map((g) => `${g.code}: ${g.name}`) ?? 'unknown',
    employee_numbering: s.numbering ? (s.numbering.mode === 'own' ? 'own numbers' : `system, next ${s.numbering.preview}`) : 'unknown',
    invitations: s.invitations?.filter((i) => i.status !== 'revoked').slice(0, 50).map((i) => `${i.email} (${i.role}, ${i.status})`) ?? 'unknown',
    employees: s.employeeCount ?? 'unknown',
    // "Name (Country)": the server also reads the countries from here, to pick the law that applies
    branches: s.branches === undefined || s.branches === null ? 'unknown' : s.branches.filter((b) => b.active).map((b) => `${b.name} (${b.country})${b.is_default ? ', default' : ''}`),
  };
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The part of a proposal the company does not have yet (null when there is nothing left to do). */
export function whatIsNew(p: SetupProposal, s: SetupState): SetupProposal | null {
  switch (p.type) {
    case 'profile': {
      const current = s.profile ? profileFields(s.profile) : { ...EMPTY_PROFILE, company_name: s.companyName };
      const fields = Object.fromEntries(Object.entries(p.fields).filter(([k, v]) => current[k as ProfileProposalField] !== v));
      return Object.keys(fields).length ? { type: 'profile', fields } : null;
    }
    case 'departments': {
      const items = p.items.filter((d, i) => !(s.departments ?? []).some((e) => same(e.name, d.name)) && p.items.findIndex((o) => same(o.name, d.name)) === i);
      return items.length ? { type: 'departments', items } : null;
    }
    case 'job_groups': {
      const items = p.items.filter((g, i) => !(s.jobGroups ?? []).some((e) => same(e.code, g.code)) && p.items.findIndex((o) => same(o.code, g.code)) === i);
      return items.length ? { type: 'job_groups', items } : null;
    }
    case 'employee_numbering': {
      const n = s.numbering;
      if (n && n.mode === p.mode && (p.mode === 'own' || (n.prefix === p.prefix && n.digits === p.digits))) return null;
      return p;
    }
    case 'invitations': {
      const items = p.items.filter(
        (i, idx) =>
          !(s.invitations ?? []).some((e) => e.status !== 'revoked' && same(e.email, i.email)) &&
          p.items.findIndex((o) => same(o.email, i.email)) === idx
      );
      return items.length ? { type: 'invitations', items } : null;
    }
    case 'add_employees': {
      // people already in the company are found when applying (the state does not hold every employee's email)
      const items = p.items.filter((e, i) => p.items.findIndex((o) => same(o.work_email, e.work_email)) === i);
      return items.length ? { type: 'add_employees', items } : null;
    }
  }
}

const findByName = <T extends { name: string; active: boolean }>(list: T[] | null | undefined, name: string) =>
  (list ?? []).find((x) => x.active && same(x.name, name));

/**
 * Why these people cannot be added as they are (empty when they can): the checks Bulk upload makes (names, a work
 * email, the company's own number when it types its own), and that each department and branch named exists.
 */
export function employeeProblems(items: NewEmployee[], s: SetupState): string[] {
  const own = s.numbering?.mode === 'own';
  const problems: string[] = [];
  const numbers = new Set<string>();
  for (const e of items) {
    const who = `${e.first_name} ${e.last_name}`.trim() || e.work_email;
    if (!e.first_name?.trim() || !e.last_name?.trim()) problems.push(`${who}: missing first or last name`);
    const emailProblem = workEmailProblem(e.work_email);
    if (emailProblem) problems.push(`${who}: ${emailProblem}`);
    if (e.phone && !isValidPhone(e.phone)) problems.push(`${who}: phone "${e.phone}" is not a valid number`);
    if (e.department && !findByName(s.departments, e.department)) {
      problems.push(`${who}: there is no department "${e.department}" yet (add it first)`);
    }
    if (e.branch && !findByName(s.branches, e.branch)) problems.push(`${who}: there is no branch "${e.branch}" (add it under Branches first)`);
    if (own) {
      const number = e.employee_number?.trim() ?? '';
      if (!number) problems.push(`${who}: missing Employee Number (your company uses its own numbers)`);
      else if (numbers.has(number)) problems.push(`${who}: Employee Number ${number} is used by another person in the list`);
      numbers.add(number);
    }
  }
  return problems;
}

/** The employee record a person becomes, in the columns Add employee and Bulk upload save. */
export function employeeRecord(e: NewEmployee, s: SetupState): Record<string, unknown> {
  const department = e.department ? findByName(s.departments, e.department) : undefined;
  const branch = e.branch ? findByName(s.branches, e.branch) : undefined;
  return {
    // the system's next number unless the company types its own (save_employees_batch gives it)
    'Employee Number': s.numbering?.mode === 'own' ? e.employee_number?.trim() ?? '' : '',
    'First Name': e.first_name.trim(),
    'Last Name': e.last_name.trim(),
    'Work Email': normaliseWorkEmail(e.work_email),
    ...(e.phone ? { 'Mobile Number': e.phone } : {}),
    ...(e.job_title ? { 'Job Title': e.job_title } : {}),
    // as Add employee saves a department: its id, and its name in Job Level
    ...(department ? { department_id: department.id, 'Job Level': department.name } : {}),
    ...(branch ? { branch_id: branch.id, Branch: branch.name } : {}),
    ...(e.employment_type ? { 'Employee Type': e.employment_type } : {}),
    ...(e.start_date ? { 'Start Date': e.start_date } : {}),
    ...(e.basic_salary !== undefined ? { 'Basic Salary': e.basic_salary } : {}),
  };
}

const PROFILE_LABELS: Record<ProfileProposalField, string> = {
  company_name: 'Company name', tagline: 'Tagline', description: 'About the company', registration_no: 'Registration number',
  business_type: 'Business type', industry: 'Industry', country: 'Country', base_currency: 'Base currency',
  official_phone: 'Phone', official_email: 'Email', website: 'Website', address_line1: 'Address', address_line2: 'Address (line 2)',
  city: 'City', postal_code: 'Postal code', fiscal_year_start_month: 'Financial year starts', week_start_day: 'Work week starts',
};

const labelOf = (list: { id: string; label: string }[], id: unknown) => list.find((x) => x.id === id)?.label ?? String(id);

/** A profile value as a person reads it ('ict' is "ICT & technology", 7 is July). */
function profileValue(key: ProfileProposalField, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (key === 'industry') return labelOf(INDUSTRIES, value);
  if (key === 'business_type') return labelOf(BUSINESS_TYPES, value);
  if (key === 'fiscal_year_start_month') return MONTHS[Number(value) - 1] ?? String(value);
  if (key === 'week_start_day') return String(value).charAt(0).toUpperCase() + String(value).slice(1);
  return String(value);
}

export interface ProposalView {
  title: string;
  lines: { text: string; was?: string }[];
  /** shown as a table instead of lines (employees to add) */
  table?: { columns: string[]; rows: string[][] };
  /** what stops it being applied as it is */
  problems?: string[];
  note?: string;
  applyLabel: string;
}

const money = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

/** How a proposal's card reads. */
export function describeProposal(p: SetupProposal, s: SetupState): ProposalView {
  switch (p.type) {
    case 'profile': {
      const current = s.profile ? profileFields(s.profile) : null;
      return {
        title: 'Company details',
        lines: (Object.keys(p.fields) as ProfileProposalField[]).map((k) => {
          const was = current?.[k];
          return {
            text: `${PROFILE_LABELS[k] ?? k}: ${profileValue(k, p.fields[k])}`,
            ...(was !== null && was !== undefined && was !== '' ? { was: profileValue(k, was) } : {}),
          };
        }),
        applyLabel: 'Save details',
      };
    }
    case 'departments':
      return {
        title: `${p.items.length} ${p.items.length === 1 ? 'department' : 'departments'}`,
        lines: p.items.map((d) => ({ text: d.parent ? `${d.name} (under ${d.parent})` : d.name })),
        applyLabel: 'Add departments',
      };
    case 'job_groups':
      return {
        title: `${p.items.length} ${p.items.length === 1 ? 'job group' : 'job groups'}`,
        lines: p.items.map((g) => ({ text: `${g.code}: ${g.name}` })),
        note: 'Set what each group pays on the Job groups page.',
        applyLabel: 'Add job groups',
      };
    case 'employee_numbering':
      return {
        title: 'Employee numbers',
        lines:
          p.mode === 'own'
            ? [{ text: 'Your own numbers, typed in when you add someone' }]
            : [{ text: `Given by the system: ${formatEmployeeNumber(p.prefix ?? '', p.digits ?? 1, 1)}, ${formatEmployeeNumber(p.prefix ?? '', p.digits ?? 1, 2)}, …` }],
        note: p.mode === 'system' ? 'Numbers already given are not changed.' : undefined,
        applyLabel: 'Save numbering',
      };
    case 'invitations':
      return {
        title: `Invite ${p.items.length} ${p.items.length === 1 ? 'person' : 'people'}`,
        lines: p.items.map((i) => ({ text: `${i.email}: ${i.role}` })),
        note: 'Each person gets an email with a link to join.',
        applyLabel: 'Send invitations',
      };
    case 'add_employees': {
      const own = s.numbering?.mode === 'own';
      const problems = employeeProblems(p.items, s);
      return {
        title: `Add ${plural(p.items.length, 'employee', 'employees')}`,
        lines: [],
        table: {
          columns: [...(own ? ['Number'] : []), 'Name', 'Work email', 'Phone', 'Job title', 'Department', 'Branch', 'Type', 'Starts', 'Basic salary'],
          rows: p.items.map((e) => [
            ...(own ? [e.employee_number ?? '—'] : []),
            `${e.first_name} ${e.last_name}`,
            e.work_email,
            e.phone ?? '—',
            e.job_title ?? '—',
            e.department ?? '—',
            e.branch ?? '—',
            e.employment_type ?? '—',
            e.start_date ?? '—',
            e.basic_salary !== undefined ? money(e.basic_salary) : '—',
          ]),
        },
        ...(problems.length ? { problems } : {}),
        note: `${own ? '' : `Numbers are given by the system (next ${s.numbering?.preview ?? 'in order'}). `}Each new employee is emailed a link to join as Staff and fill in the rest of their details. Anyone already in the company is left as they are.`,
        applyLabel: `Add ${plural(p.items.length, 'employee', 'employees')}`,
      };
    }
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Applies a proposal (only what is new, see whatIsNew) and says what was done. Throws with the reason when refused. */
export async function applyProposal(p: SetupProposal, s: SetupState): Promise<string> {
  switch (p.type) {
    case 'profile': {
      const base = s.profile ? profileFields(s.profile) : { ...EMPTY_PROFILE, company_name: s.companyName };
      const merged = { ...base, ...p.fields };
      const problem = Object.values(profileErrors(merged))[0];
      if (problem) throw new Error(problem);
      await saveCompanyProfile(merged);
      return 'Saved the company details.';
    }

    case 'departments': {
      const ids = new Map((s.departments ?? []).map((d) => [d.name.trim().toLowerCase(), d.id]));
      const left = [...p.items];
      let added = 0;
      // parents first: each pass adds the departments whose parent exists (or that have none); a parent that is never
      // found puts the department at the top rather than leaving it out
      while (left.length) {
        let ready = left.filter((d) => !d.parent || ids.has(d.parent.trim().toLowerCase()));
        if (!ready.length) ready = [left[0]];
        for (const d of ready) {
          left.splice(left.indexOf(d), 1);
          try {
            const made = await addDepartment(d.name, (d.parent && ids.get(d.parent.trim().toLowerCase())) || null);
            ids.set(made.name.trim().toLowerCase(), made.id);
            added += 1;
          } catch (err) {
            const reason = err instanceof Error ? err.message : 'Could not save the department';
            throw new Error(added ? `Added ${plural(added, 'department', 'departments')}, then stopped at ${d.name}: ${reason}` : reason);
          }
        }
      }
      return `Added ${plural(added, 'department', 'departments')}.`;
    }

    case 'job_groups': {
      let added = 0;
      for (const g of p.items) {
        try {
          await saveJobGroup(null, g);
          added += 1;
        } catch (err) {
          const reason = err instanceof Error ? err.message : 'Could not save the job group';
          throw new Error(added ? `Added ${plural(added, 'job group', 'job groups')}, then stopped at ${g.code}: ${reason}` : reason);
        }
      }
      return `Added ${plural(added, 'job group', 'job groups')}.`;
    }

    case 'employee_numbering': {
      if (p.mode === 'own') {
        await saveEmployeeNumbering('own', s.numbering?.prefix ?? 'MCL-', s.numbering?.digits ?? 6);
        return 'Employee numbers are now typed in by you.';
      }
      const prefix = p.prefix ?? '';
      const digits = p.digits ?? 6;
      const problem = numberingError(prefix, digits, 1);
      if (problem) throw new Error(problem);
      const saved = await saveEmployeeNumbering('system', prefix, digits);
      return `The next employee number will be ${saved.preview}.`;
    }

    case 'invitations': {
      const outcomes = await sendInvitations(p.items.map((i) => ({ email: normaliseWorkEmail(i.email), role: i.role })));
      const { sent, members, notSent } = summariseInvites(outcomes);
      const parts = [
        sent && `Sent ${plural(sent, 'invitation', 'invitations')}.`,
        members && `${plural(members, 'person is', 'people are')} already in the company.`,
        notSent.length && `Not sent to ${notSent.map((o) => o.email).join(', ')} (see Invite people).`,
      ].filter(Boolean);
      // nothing was made at all: show it as refused (an invitation made but not emailed can still be sent by hand)
      if (outcomes.every((o) => o.status === 'failed')) throw new Error(notSent[0]?.reason || 'The invitations were not sent.');
      return parts.join(' ');
    }

    case 'add_employees': {
      const problems = employeeProblems(p.items, s);
      if (problems.length) throw new Error(problems.slice(0, 3).join('; ') + (problems.length > 3 ? ` (and ${problems.length - 3} more)` : ''));

      // only new people: save_employees_batch would update an employee whose work email or number a row has
      const own = s.numbering?.mode === 'own';
      const existing = await findExistingEmployees(
        p.items.map((e) => normaliseWorkEmail(e.work_email)),
        own ? p.items.map((e) => e.employee_number?.trim() ?? '') : []
      );
      const already = p.items.filter((e) => existing.emails.has(normaliseWorkEmail(e.work_email)));
      const numberTaken = p.items.filter((e) => !already.includes(e) && own && existing.numbers.has(e.employee_number?.trim() ?? ''));
      const fresh = p.items.filter((e) => !already.includes(e) && !numberTaken.includes(e));

      const saved = fresh.length
        ? await saveEmployeesInBatches(fresh.map((e, i) => ({ row: i + 1, data: employeeRecord(e, s) })))
        : [];
      const created = saved.filter((r) => r.outcome === 'created');
      const failed = saved
        .filter((r) => r.outcome !== 'created')
        .map((r) => {
          const e = fresh[r.row_no - 1];
          return `${e ? `${e.first_name} ${e.last_name}` : `Row ${r.row_no}`}: ${r.outcome === 'error' ? describeSaveError(r.error_code, r.error_message) : 'already an employee'}`;
        });

      // as after Bulk upload: everyone added is emailed a link to join (sent in the background) and is now onboarding
      let notInvited: string[] = [];
      const emails = created.map((r) => r.work_email).filter((x): x is string => !!x);
      if (emails.length) {
        const queued = await queueInvitations(emails.map((email) => ({ email, role: 'STAFF' })));
        rememberInviteBatch(queued.batchId);
        notInvited = queued.rejected.map((r) => r.email);
        const rejected = new Set(notInvited);
        await startOnboardingByEmail(emails.filter((email) => !rejected.has(email)));
      }

      const numbers = created.length <= 5 ? created.map((r) => r.employee_number).filter(Boolean) : [];
      const parts = [
        created.length && `Added ${plural(created.length, 'employee', 'employees')}${numbers.length ? ` (${numbers.join(', ')})` : ''}; their invitations to join are on their way.`,
        already.length && `Already employees, left as they are: ${already.map((e) => e.work_email).join(', ')}.`,
        numberTaken.length && `Not added, their Employee Number is taken: ${numberTaken.map((e) => `${e.first_name} ${e.last_name} (${e.employee_number})`).join(', ')}.`,
        failed.length && `Not added: ${failed.join('; ')}.`,
        notInvited.length && `Not invited (send it from Invite people): ${notInvited.join(', ')}.`,
      ].filter(Boolean);
      if (!created.length && !already.length) throw new Error(parts.join(' ') || 'No one was added.');
      return parts.join(' ');
    }
  }
}
