#!/usr/bin/env node
// Kijani Ridge Academy demo: completes the school's staff in Figbloom HR and gives them a 2026 payroll history.
//
// Only HR company b117aba0-9d08-49c6-9d30-4a8994b0fb6d (platform tenant 6034dfe2-9818-42a4-a05d-ee0f8bd413ea). The
// staff reach HR from Figbloom Schools through the platform's staff events (platform_upsert_staff(): a DRAFT employee,
// mapped in external_people with source 'schools'). This seeder completes those employees; it never creates one, never
// links one, never invites anyone, and creates no logins. Staff in the company without a Schools link are reported and
// left alone.
//
// It works in two steps, so production only ever needs psql (docker exec ... psql on the HR database server):
//
//   1. node scripts/seed-kijani-hr.mjs --snapshot-sql > snapshot.sql
//        psql -X -At -v ON_ERROR_STOP=1 -f snapshot.sql > snapshot.json        (read-only: the company as it is now)
//   2. node scripts/seed-kijani-hr.mjs --snapshot snapshot.json --dry-run      (prints what would be done; writes nothing)
//      node scripts/seed-kijani-hr.mjs --snapshot snapshot.json --out seed.sql [--trial]
//        psql -X -v ON_ERROR_STOP=1 -f seed.sql                                (one transaction)
//
// Step 2 works out every payslip with HR's own payroll engine (src/lib/payroll/multiCountry.ts calculateRun ->
// src/lib/payslipCalc.ts, bundled with esbuild at run time), with the statutory rates the database has for each month,
// exactly as the payroll page does, so PAYE, SHIF, NSSF and the housing levy are HR's figures. The SQL checks again
// that nothing it relied on changed since the snapshot (the people, their links and numbers, each month's rates) and
// stops without changing anything if it did. --trial ends the transaction with ROLLBACK instead of COMMIT.
//
// Running it again changes nothing that is already done (every row has a natural key; months already seeded are
// skipped); new staff that reached HR since are completed, but get no history for months already seeded.
//
// Safety (see the report printed by --dry-run):
//   * no emails: Schools' @kijaniridge-demo.invalid addresses are dropped by HR's event route (realEmail()), so these
//     employees have no work email; the seeder never sets one. Each employee's notification emails are turned off
//     (notification_preferences), and any notification created while seeding is deleted in the same transaction.
//   * no SMS: the birthday SMS (send-birthday-sms, Celcom) needs "Date of Birth": the seeder never sets one. Phone
//     numbers are left as Schools sent them. Salaries are paid by bank transfer to made-up accounts, never M-Pesa.
//   * no platform events, invitations, payments or payslip emails: the transaction stops if any is queued for the
//     company while it runs. Payroll months are written as already paid (no approval effects run), so nothing is
//     announced and nothing can be sent to a payment provider.
//   * every made-up number starts with 99 (ID, KRA PIN A99..., SHA CR99..., NSSF, bank account).

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HR_TENANT = 'b117aba0-9d08-49c6-9d30-4a8994b0fb6d';
export const PLATFORM_TENANT = '6034dfe2-9818-42a4-a05d-ee0f8bd413ea';
export const SEED_TAG = 'seed-kijani-hr';
export const SEED_NOTE = 'Kijani Ridge demo payroll history (seed-kijani-hr)';
export const DEMO_EMAIL_DOMAIN = 'kijaniridge-demo.invalid';
const YEAR = 2026;
const FIRST_PERIOD = '2026-01';
const LAST_ALLOWED_PERIOD = '2026-11';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------------------------
// 1. the snapshot: everything the plan depends on, read-only
// ---------------------------------------------------------------------------------------------
export const SNAPSHOT_SQL = `-- seed-kijani-hr snapshot: read-only. Run with: psql -X -At -v ON_ERROR_STOP=1 -f snapshot.sql > snapshot.json
begin transaction read only;
select jsonb_build_object(
  'kind', '${SEED_TAG}/snapshot',
  'taken_at', now(),
  'today', current_date,
  'tenant_id', '${HR_TENANT}',
  'tenant', (select jsonb_build_object('id', t.id, 'name', t.name, 'slug', t.slug, 'status', t.status,
                                       'platform_tenant_id', t.platform_tenant_id, 'platform_source', t.platform_source)
             from public.tenants t where t.id = '${HR_TENANT}'),
  'company_country', public.company_country('${HR_TENANT}'),
  'employees', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'number', e."Employee Number", 'first', e."First Name", 'middle', e."Middle Name", 'last', e."Last Name",
      'title', e."Job Title", 'email', e."Work Email", 'mobile', e."Mobile Number", 'onboarding', e.onboarding_status,
      'status', e."Status", 'worker_kind', e.worker_kind, 'termination', e."Termination Date",
      'country', public.employee_country(e.tenant_id, e."Employee Number"),
      'gender', e."Gender", 'id_number', e."ID Number", 'tax_pin', e."Tax PIN", 'shif', e."SHIF Number",
      'nssf', e."NSSF Number", 'account', e."Account Number", 'date_of_birth', e."Date of Birth",
      'exit_open', exists (select 1 from public.employee_exits x where x.tenant_id = e.tenant_id
                           and x.employee_number = e."Employee Number" and x.status in ('requested', 'approved', 'clearance', 'completed')),
      'links', (select coalesce(jsonb_agg(jsonb_build_object('source', m.source, 'external_id', m.external_id) order by m.source, m.external_id), '[]'::jsonb)
                from public.external_people m where m.tenant_id = e.tenant_id and m.employee_number = e."Employee Number")
    ) order by e."Employee Number"), '[]'::jsonb)
    from public.employees e where e.tenant_id = '${HR_TENANT}'),
  'rates', (select jsonb_object_agg(p, public.statutory_rates_for('${HR_TENANT}', public.pay_period_last_day(p), 'Kenya'))
            from (select to_char(make_date(${YEAR}, m, 1), 'YYYY-MM') p from generate_series(1, 11) m) q),
  'runs', (select coalesce(jsonb_agg(jsonb_build_object('period', r.pay_period, 'status', r.status, 'notes', r.notes,
                                                         'payslips', (select count(*) from public.salary_history h where h.run_id = r.id))
                                     order by r.pay_period), '[]'::jsonb)
           from public.payroll_runs r where r.tenant_id = '${HR_TENANT}' and r.pay_period like '${YEAR}-%'),
  'settings', (select jsonb_build_object('leave_daily_rate_basis', s.leave_daily_rate_basis, 'deduction_cap', s.deduction_cap,
                                         'payslip_email_auto', s.payslip_email_auto)
               from public.company_payroll_settings s where s.tenant_id = '${HR_TENANT}'),
  'pay_items', (select count(*) from public.company_pay_items i where i.tenant_id = '${HR_TENANT}' and i.active),
  'leave_policies', (select coalesce(jsonb_agg(jsonb_build_object('type_id', lt.id, 'name', lt.name, 'deductible', lt.is_deductible,
                                                                  'method', cp.accrual_method, 'days', cp.days_allotted) order by lt.name), '[]'::jsonb)
                     from public.leave_types lt join public.current_leave_policies cp on cp.leave_type_id = lt.id
                     where lt.tenant_id = '${HR_TENANT}'),
  'banks', (select coalesce(jsonb_agg(jsonb_build_object('code', b.code, 'name', b.name,
                    'branch', (select jsonb_build_object('code', x.branch_code, 'name', x.name) from public.bank_branches x
                               where x.bank_code = b.code order by x.branch_code limit 1)) order by b.code), '[]'::jsonb)
            from public.banks b where b.code in ('01', '03', '07', '11', '68', '70') and coalesce(b.open, true))
)::text;
rollback;
`;

// ---------------------------------------------------------------------------------------------
// 2. what each kind of staff member gets
// ---------------------------------------------------------------------------------------------
/** Job groups (job_groups + job_group_rates from 1 January): TSC-like scales for teachers, three for support staff. */
export const GROUPS = {
  'KR-T5': { name: 'Teacher II (TSC-like scale 5)', min: 24000, max: 31500, house: 6750, travel: 4000 },
  'KR-T6': { name: 'Teacher I (TSC-like scale 6)', min: 29500, max: 37500, house: 7500, travel: 4000 },
  'KR-T7': { name: 'Senior Teacher II (TSC-like scale 7)', min: 35000, max: 46000, house: 10000, travel: 5000 },
  'KR-T8': { name: 'Senior Teacher I (TSC-like scale 8)', min: 42000, max: 55500, house: 12000, travel: 5000 },
  'KR-T9': { name: 'Head of Department (TSC-like scale 9)', min: 49000, max: 65000, house: 14000, travel: 6000 },
  'KR-T11': { name: 'Deputy Head Teacher (TSC-like scale 11)', min: 69000, max: 91500, house: 18000, travel: 8000 },
  'KR-T13': { name: 'Head Teacher (TSC-like scale 13)', min: 96000, max: 126000, house: 25000, travel: 10000 },
  'KR-S1': { name: 'Support staff I', min: 16500, max: 20000, house: 2500, travel: 1500 },
  'KR-S2': { name: 'Support staff II (skilled)', min: 22000, max: 32000, house: 4000, travel: 2000 },
  'KR-S3': { name: 'Support staff III (professional)', min: 45000, max: 68000, house: 9000, travel: 4000 },
};

const ACADEMICS = 'Academics';
export const LEVELS = [
  { dept: 'Pre-Primary (PP1-PP2)', weight: 4, match: /\b(pp\s*[12]|pre-?primary|ecde|kindergarten|nursery)\b/i },
  { dept: 'Lower Primary (Grades 1-3)', weight: 6, match: /\bgrade\s*[1-3]\b/i },
  { dept: 'Upper Primary (Grades 4-6)', weight: 6, match: /\bgrade\s*[4-6]\b/i },
  { dept: 'Junior School (Grades 7-9)', weight: 6, match: /\b(grade\s*[7-9]|junior school|jss)\b/i },
  { dept: 'Senior School (Grades 10-12)', weight: 6, match: /\b(grade\s*1[0-2]|senior school|stem|pathway)\b/i },
];

/** Departments, parents first. */
export const DEPARTMENTS = [
  { name: 'Administration' },
  { name: ACADEMICS },
  ...LEVELS.map((l) => ({ name: l.dept, parent: ACADEMICS })),
  { name: 'Finance & Accounts' },
  { name: 'Library, ICT & Labs' },
  { name: 'Health & Boarding' },
  { name: 'Stores & Procurement' },
  { name: 'Catering' },
  { name: 'Transport' },
  { name: 'Security' },
  { name: 'Estates & Housekeeping' },
];

/**
 * Roles, matched on the job title Schools sends (in this order: the first match wins). `group` null: by years of
 * service (teachers). `dept` null: the teacher's school level.
 */
export const ROLES = [
  { key: 'deputy', match: /\bdeputy\b/i, label: 'Deputy Head Teacher', group: 'KR-T11', dept: 'Administration', teaching: true, years: [8, 18] },
  { key: 'head_teacher', match: /\b(head ?teacher|head ?master|head ?mistress|principal)\b/i, label: 'Head Teacher', group: 'KR-T13', dept: 'Administration', teaching: true, years: [12, 22] },
  { key: 'senior_teacher', match: /\b(senior (teacher|master|mistress)|head of (department|section)|head of [a-z]+(\s+(and|&)?\s*[a-z]+)*|hod|dean|subject (head|coordinator)|coordinator)\b/i, label: 'Senior Teacher / Head of Department', group: 'KR-T9', dept: null, teaching: true, years: [7, 20] },
  { key: 'teacher', match: /\b(teacher|tutor|instructor|lecturer|coach)\b/i, label: 'Teacher', group: null, dept: null, teaching: true, years: [0, 20], newHires: 0.1 },
  { key: 'bursar', match: /\b(bursar|finance (officer|manager)|accountant)\b/i, label: 'Bursar', group: 'KR-S3', dept: 'Finance & Accounts', years: [4, 14] },
  { key: 'accounts', match: /\b(accounts? (clerk|assistant)|cashier|fees clerk)\b/i, label: 'Accounts Clerk', group: 'KR-S2', dept: 'Finance & Accounts', years: [1, 10] },
  { key: 'administrator', match: /\b(administrator|admin(istration)? (manager|officer))\b/i, label: 'School Administrator', group: 'KR-S3', dept: 'Administration', years: [3, 15] },
  { key: 'secretary', match: /\b(secretary|receptionist|front office)\b/i, label: 'School Secretary', group: 'KR-S2', dept: 'Administration', years: [1, 12] },
  { key: 'ict', match: /\b(ict|it officer|computer|systems)\b/i, label: 'ICT Officer', group: 'KR-S3', dept: 'Library, ICT & Labs', years: [1, 8] },
  { key: 'librarian', match: /\blibrar/i, label: 'Librarian', group: 'KR-S2', dept: 'Library, ICT & Labs', years: [1, 12] },
  { key: 'lab_technician', match: /\b(lab(oratory)? (technician|assistant)|lab tech)\b/i, label: 'Laboratory Technician', group: 'KR-S2', dept: 'Library, ICT & Labs', years: [1, 10] },
  { key: 'nurse', match: /\b(nurse|clinic|health officer|medical)\b/i, label: 'School Nurse', group: 'KR-S3', dept: 'Health & Boarding', years: [2, 12] },
  { key: 'matron', match: /\b(matron|patron|house ?(mother|father|parent)|boarding)\b/i, label: 'Matron', group: 'KR-S2', dept: 'Health & Boarding', years: [1, 14] },
  { key: 'storekeeper', match: /\b(store|procurement|inventory|supplies)/i, label: 'Storekeeper', group: 'KR-S2', dept: 'Stores & Procurement', years: [1, 12] },
  { key: 'head_cook', match: /\b(head|chief) (cook|chef)\b|\bcatering (manager|supervisor)\b/i, label: 'Head Cook', group: 'KR-S2', dept: 'Catering', years: [4, 15] },
  { key: 'cook', match: /\b(cook|chef|kitchen|cater|meals)/i, label: 'Cook', group: 'KR-S1', dept: 'Catering', years: [0, 12], newHires: 0.1 },
  { key: 'driver', match: /\b(driver|transport)\b/i, label: 'Driver', group: 'KR-S2', dept: 'Transport', years: [1, 14] },
  { key: 'security', match: /\b(security|guard|watchman|askari|gate ?keeper)\b/i, label: 'Security Guard', group: 'KR-S1', dept: 'Security', years: [0, 12], newHires: 0.1 },
  { key: 'cleaner', match: /\b(clean|janitor|housekeep|sweeper|laundry)/i, label: 'Cleaner', group: 'KR-S1', dept: 'Estates & Housekeeping', years: [0, 10], newHires: 0.1 },
  { key: 'groundsman', match: /\b(grounds?(man|keeper)?|garden|messenger|handyman|maintenance|caretaker|artisan)\b/i, label: 'Groundsman', group: 'KR-S1', dept: 'Estates & Housekeeping', years: [0, 12] },
];
/** What an unmatched title gets (reported). */
export const DEFAULT_ROLE = { key: 'support', label: 'General Support Staff', group: 'KR-S1', dept: 'Estates & Housekeeping', years: [0, 10] };

export const roleFor = (title) => ROLES.find((r) => r.match.test(String(title ?? ''))) ?? null;

/** Written job descriptions, one per role: kept as closed (never public) job postings, Recruitment's place for them. */
export const JOB_DESCRIPTIONS = {
  head_teacher: {
    description: 'Leads Kijani Ridge Academy: sets the school\'s direction under the Competency-Based Curriculum, leads the senior management team, and is accountable to the Board for learning outcomes, staff, finances and the safety of every learner.',
    requirements: 'Bachelor of Education or equivalent with a postgraduate qualification in education leadership\nRegistered with the Teachers Service Commission\nAt least 10 years\' teaching experience, 5 of them in school leadership\nKEMI or equivalent school management training',
    responsibilities: 'Lead curriculum delivery and CBC assessment across PP1 to Grade 12\nAppraise and develop teaching and support staff\nPrepare and manage the school budget with the Bursar\nChair senior management and parents\' meetings; report to the Board\nEnsure compliance with Ministry of Education, TSC and KNEC requirements',
  },
  deputy: {
    description: 'Second in charge of the school: runs the day-to-day academic programme, timetabling and discipline, and stands in for the Head Teacher.',
    requirements: 'Bachelor of Education or equivalent; TSC registration\nAt least 8 years\' teaching experience, including as a Head of Department\nTraining in school management or guidance and counselling',
    responsibilities: 'Draw up and supervise the master timetable and duty rosters\nCoordinate CATs, mid-term and end-term examinations and report forms\nOversee learner discipline, attendance and welfare\nSupervise Heads of Department and class teachers\nDeputise for the Head Teacher',
  },
  senior_teacher: {
    description: 'Leads a school level or subject department: plans the scheme of work, supports and observes the teachers in it, and is responsible for its learners\' progress.',
    requirements: 'Bachelor of Education or Diploma in Education with at least 7 years\' experience\nTSC registration\nCBC training (KICD) and experience leading a team',
    responsibilities: 'Plan schemes of work and lesson plans for the department\nModerate assessments and analyse results each term\nMentor new teachers and observe lessons\nManage the department\'s teaching materials and textbooks\nTeach a full timetable',
  },
  teacher: {
    description: 'Plans and teaches learning areas under the Competency-Based Curriculum, assesses learners continuously, and is the first point of contact for the learners and parents of their class.',
    requirements: 'Diploma or Bachelor of Education (P1 certificate or ECDE diploma for pre-primary)\nTSC registration\nCBC training',
    responsibilities: 'Prepare schemes of work, lesson plans and records of work\nTeach and assess learners; record CATs and examination marks\nKeep the class register and follow up absences\nGive parents feedback on learners\' progress\nTake part in co-curricular activities and duty rosters',
  },
  bursar: {
    description: 'Runs the school\'s finances: fees collection, payments, payroll, budgets and the books of account, and advises the Head Teacher and Board on financial matters.',
    requirements: 'Degree in Commerce/Accounting or CPA (K)\nAt least 4 years\' experience in school or institutional accounting\nKnowledge of Kenyan payroll and statutory deductions (PAYE, SHIF, NSSF, Housing Levy)',
    responsibilities: 'Invoice fees each term and follow up arrears\nProcess payments to suppliers and staff\nRun the monthly payroll and statutory returns\nPrepare budgets, management accounts and the annual audit\nSupervise accounts, stores and catering spending',
  },
  accounts: {
    description: 'Supports the Bursar with fees receipting, banking, records and day-to-day accounts.',
    requirements: 'Diploma in Accounting or CPA Part II\nAt least 1 year\'s experience\nComputer literate (accounting software, spreadsheets)',
    responsibilities: 'Receipt fees and reconcile M-Pesa and bank collections\nKeep cash books and petty cash\nPrepare fee statements for parents\nFile vouchers and supporting documents',
  },
  administrator: {
    description: 'Runs the school office and its administration: records, admissions, communication with parents and the smooth running of the school day.',
    requirements: 'Degree or diploma in Business or Public Administration\nAt least 3 years\' experience in school administration',
    responsibilities: 'Manage admissions and learner records\nCoordinate the school calendar, events and communication with parents\nSupervise office and support staff\nKeep statutory and Ministry records up to date',
  },
  secretary: {
    description: 'Front office of the school: receives visitors and parents, handles correspondence and keeps the office running.',
    requirements: 'Diploma in Secretarial Studies or Office Administration\nGood communication and computer skills',
    responsibilities: 'Receive visitors, parents and phone calls\nType letters, circulars and examination papers\nKeep files and the visitors\' book\nSchedule the Head Teacher\'s appointments',
  },
  ict: {
    description: 'Looks after the school\'s computers, network and digital learning tools, and supports teachers and learners using them.',
    requirements: 'Diploma or degree in ICT or Computer Science\nExperience with networks, Windows/Linux and school management systems',
    responsibilities: 'Maintain computers, printers, projectors and the network\nSupport the computer lab and coding club\nManage user accounts and backups\nTrain staff on digital tools',
  },
  librarian: {
    description: 'Runs the school library: the KICD-approved textbooks and readers, issuing and recovering books, and building a reading culture.',
    requirements: 'Diploma or certificate in Library and Information Science\nExperience in a school library',
    responsibilities: 'Catalogue and issue textbooks and library books\nTrack and recover books at the end of each term\nRun reading sessions and the library timetable\nAdvise on book purchases',
  },
  lab_technician: {
    description: 'Prepares and maintains the science laboratories and equipment for practical lessons and examinations.',
    requirements: 'Diploma in Science Laboratory Technology\nKnowledge of laboratory safety',
    responsibilities: 'Prepare apparatus and reagents for practicals\nMaintain laboratory equipment and stock\nKeep laboratory safety and chemical records\nSupport KNEC practical examinations',
  },
  nurse: {
    description: 'Runs the school sick bay: first aid, care of sick learners and staff, health records and health education.',
    requirements: 'Diploma in Nursing (KRCHN or KECHN) and a current practising licence\nAt least 2 years\' experience',
    responsibilities: 'Give first aid and care in the sick bay\nKeep learners\' health records and allergies\nRefer and follow up cases with parents and hospitals\nRun health talks and hygiene inspections',
  },
  matron: {
    description: 'Looks after learners\' welfare outside the classroom: hygiene, uniforms, the boarding and changing areas, and pastoral care of the youngest learners.',
    requirements: 'Certificate in Social Work, Counselling or Child Care\nExperience caring for children',
    responsibilities: 'Supervise learners\' hygiene and welfare\nLook after dormitories, linen and lost property\nWork with the nurse on sick learners\nReport welfare concerns to the Deputy Head Teacher',
  },
  storekeeper: {
    description: 'Receives, stores and issues the school\'s stock: textbooks, stationery, cleaning materials and kitchen food stores.',
    requirements: 'Certificate or diploma in Purchasing and Supplies\nExperience keeping stores records',
    responsibilities: 'Receive deliveries against orders and check quality\nIssue kitchen stock daily and stationery on requisition\nKeep stock cards and run monthly stock takes\nReport stock levels and reorder needs to the Bursar',
  },
  head_cook: {
    description: 'Leads the kitchen: plans and cooks the daily meals for learners and staff, and supervises the kitchen team, hygiene and food stores.',
    requirements: 'Certificate in Food Production\nFood handler\'s medical certificate\nExperience running an institutional kitchen',
    responsibilities: 'Plan the weekly menu and daily quantities\nSupervise cooks and kitchen hygiene\nRequest food stock from the stores\nKeep meal and consumption records',
  },
  cook: {
    description: 'Prepares and serves the daily meals for learners and staff and keeps the kitchen clean.',
    requirements: 'Food handler\'s medical certificate\nExperience in an institutional kitchen',
    responsibilities: 'Prepare and cook meals to the menu\nServe learners at break and lunch\nClean the kitchen, utensils and dining hall\nFollow food safety rules',
  },
  driver: {
    description: 'Drives the school buses on the morning and evening routes and for trips, keeping learners safe on the road.',
    requirements: 'Valid driving licence for PSV vehicles and a PSV badge\nCertificate of good conduct\nAt least 3 years\' driving experience',
    responsibilities: 'Drive the assigned route safely and on time\nKeep the bus clean, serviced and inspected\nKeep the trip and fuel log\nReport incidents to the Deputy Head Teacher',
  },
  security: {
    description: 'Keeps the school, its learners and property safe: controls the gate, patrols the grounds and manages visitors.',
    requirements: 'KCSE certificate\nCertificate of good conduct\nSecurity training',
    responsibilities: 'Control the gate and sign visitors in and out\nCheck that learners leave with authorised people\nPatrol the grounds day and night\nReport incidents',
  },
  cleaner: {
    description: 'Keeps the classrooms, offices, washrooms and compound clean.',
    requirements: 'Basic education\nExperience in cleaning',
    responsibilities: 'Clean classrooms, offices and washrooms daily\nEmpty bins and manage waste\nReport repairs needed',
  },
  groundsman: {
    description: 'Maintains the school grounds, playing fields and gardens, and does small repairs.',
    requirements: 'Basic education\nExperience in grounds maintenance',
    responsibilities: 'Maintain the playing fields, hedges and gardens\nPrepare the fields for games and sports day\nDo minor repairs',
  },
  support: {
    description: 'Supports the school\'s operations as assigned by the Bursar or Head Teacher.',
    requirements: 'Basic education',
    responsibilities: 'Carry out assigned support duties\nKeep the work area clean and safe',
  },
};

const FEMALE = new Set(('grace wambui mary jane faith mercy esther ruth sarah anne ann alice janet joyce lucy margaret rose agnes caroline ' +
  'catherine christine dorothy elizabeth eunice florence gladys hannah irene jacinta josephine judith lilian lydia martha monica nancy naomi ' +
  'pauline peris phyllis priscilla purity rachel rebecca rosemary sharon susan teresa veronica violet winnie wanjiku wanjiru njeri nyambura ' +
  'wairimu akinyi achieng atieno awuor adhiambo anyango chebet chepkoech jepkoech jeptoo cherono mwende mutheu nduku kanini zawadi amani ' +
  'neema imani tabitha beatrice brenda cynthia diana edith emily evelyn fatuma halima hellen jackline joan juliet kate lilian loise ' +
  'maureen miriam nelly norah olive rhoda salome stella sylvia tracy vivian zipporah damaris doreen everlyne gloria immaculate ivy ' +
  'jemimah lilian lucia milka mumbi nekesa nafula naliaka wangari wangui wambui wanjiru wairimu muthoni nyokabi njoki kemunto moraa kerubo ' +
  'bosibori nyaboke lavender scholastica consolata millicent pamela sheila').split(/\s+/));
const MALE = new Set(('john james peter paul joseph david daniel samuel stephen michael kennedy kevin brian collins dennis duncan edwin ' +
  'eric felix francis george geoffrey isaac jackson job joel joshua julius kelvin lawrence martin mark moses nicholas patrick philip ' +
  'richard robert simon thomas timothy victor vincent wilson wycliffe allan alex anthony benard bernard charles cyrus dan elijah emmanuel ' +
  'evans fredrick gideon harrison henry hillary ibrahim jacob jeremiah kariuki kamau kimani mwangi otieno ochieng odhiambo omondi onyango ' +
  'kiprop kipchoge kiptoo kibet kipkemboi cheruiyot mutua musyoka mwenda njoroge njuguna wafula wanyama barasa juma hassan ali omar ' +
  'abdi baraka amos andrew ben benson boniface calvin clement cornelius erick ezekiel fidel humphrey jared jonah levi lucas luke ' +
  'mathew matthew maxwell nelson oscar owen reuben sammy silas solomon titus tom wesley zachary zakayo kioko kilonzo ndungu gitau macharia ' +
  'onesmus protus nahashon').split(/\s+/));
export const genderFor = (first) => {
  const f = String(first ?? '').trim().toLowerCase();
  if (FEMALE.has(f)) return 'Female';
  if (MALE.has(f)) return 'Male';
  return null;
};

// ---------------------------------------------------------------------------------------------
// 3. the plan
// ---------------------------------------------------------------------------------------------
/** A stable number from a person and a purpose (same person, same answer, every run). */
const hash = (key, label) => createHash('sha256').update(`${SEED_TAG}:${label}:${key}`).digest().readUInt32BE(0);
const pick = (key, label, n) => hash(key, label) % n;
const chance = (key, label, p) => hash(key, label) / 0x100000000 < p;
const round10 = (n) => Math.round(n / 10) * 10;
const lastDay = (period) => {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const addMonths = (iso, months) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};
const periodsThrough = (through) => {
  const out = [];
  for (let m = 1; m <= 12; m++) {
    const p = `${YEAR}-${String(m).padStart(2, '0')}`;
    if (p > through) break;
    out.push(p);
  }
  return out;
};
const isDemoEmail = (email) => String(email ?? '').toLowerCase().endsWith(`@${DEMO_EMAIL_DOMAIN}`);
const fullName = (e) => [e.first, e.middle, e.last].filter(Boolean).join(' ');

/** The group a teacher is on from their years of service. */
/** Teachers' scales by years of service, and how many teachers are on each (a school has more young teachers). */
const TEACHER_BANDS = [
  { group: 'KR-T5', years: [1, 2], share: 25 },
  { group: 'KR-T6', years: [3, 6], share: 30 },
  { group: 'KR-T7', years: [7, 11], share: 25 },
  { group: 'KR-T8', years: [12, 20], share: 20 },
];
const teacherBand = (years) => TEACHER_BANDS.find((b) => years <= b.years[1]) ?? TEACHER_BANDS.at(-1);
/** A teacher's years of service: a band by its share, then a year within it. */
const teacherYears = (k) => {
  let n = pick(k, 'band', 100);
  const band = TEACHER_BANDS.find((b) => (n -= b.share) < 0) ?? TEACHER_BANDS.at(-1);
  return band.years[0] + pick(k, 'years', band.years[1] - band.years[0] + 1);
};

/** A unique made-up number of `digits` digits starting with 99, not already used in the company. */
function uniqueNumber(key, label, digits, taken) {
  const space = 10 ** (digits - 2);
  let n = hash(key, label) % space;
  for (;;) {
    const v = `99${String(n).padStart(digits - 2, '0')}`;
    if (!taken.has(v)) {
      taken.add(v);
      return v;
    }
    n = (n + 1) % space;
  }
}

export class PlanError extends Error {}

/**
 * The plan for a snapshot: who is completed and with what, who is skipped and why, the months of payroll to write.
 * `schoolsStaff` (optional): Schools' current staff [{person_id, full_name, job_title}] to report anyone not in HR.
 */
export function buildPlan(snapshot, { through = '2026-10', schoolsStaff = null } = {}) {
  if (snapshot?.kind !== `${SEED_TAG}/snapshot`) throw new PlanError('This is not a seed-kijani-hr snapshot (run --snapshot-sql first)');
  if (snapshot.tenant_id !== HR_TENANT) throw new PlanError(`The snapshot is for ${snapshot.tenant_id}; this seeder only works on ${HR_TENANT}`);
  if (!snapshot.tenant) throw new PlanError(`HR company ${HR_TENANT} does not exist in this database; nothing to do`);
  if (snapshot.tenant.id !== HR_TENANT) throw new PlanError('The snapshot names another company; refusing');
  if (snapshot.tenant.platform_tenant_id !== PLATFORM_TENANT) {
    throw new PlanError(`HR company ${HR_TENANT} is linked to platform tenant ${snapshot.tenant.platform_tenant_id}, not Kijani Ridge's ${PLATFORM_TENANT}; refusing`);
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(through) || through < FIRST_PERIOD || through > LAST_ALLOWED_PERIOD) {
    throw new PlanError(`--through must be a month from ${FIRST_PERIOD} to ${LAST_ALLOWED_PERIOD}`);
  }
  if (Number(snapshot.pay_items) > 0) {
    throw new PlanError('The company has standard pay items (company_pay_items); the payslips would not match the payroll page. Remove them or extend the seeder.');
  }

  const report = { unlinked: [], skipped: [], realEmails: [], defaulted: [], noGender: [], alreadyApproved: [], missingInHr: [], hasDateOfBirth: [] };
  const taken = { id: new Set(), pin: new Set(), shif: new Set(), nssf: new Set(), account: new Set() };
  for (const e of snapshot.employees) {
    if (e.id_number) taken.id.add(e.id_number);
    if (e.tax_pin) taken.pin.add(e.tax_pin.slice(1, -1));
    if (e.shif) taken.shif.add(e.shif.replace(/^CR/, ''));
    if (e.nssf) taken.nssf.add(e.nssf);
    if (e.account) taken.account.add(e.account);
  }

  // who is in: linked from Schools, an employee, not leaving, in Kenya
  const candidates = [];
  for (const e of snapshot.employees) {
    const link = e.links.find((l) => l.source === 'schools');
    if (!link) {
      report.unlinked.push({ number: e.number, name: fullName(e), title: e.title, links: e.links.map((l) => l.source) });
      continue;
    }
    const why = e.worker_kind && e.worker_kind !== 'employee' ? `a ${e.worker_kind}, not an employee`
      : ['terminated', 'inactive'].includes(String(e.status ?? '').toLowerCase()) ? `status ${e.status}`
      : e.termination ? `termination date ${e.termination}`
      : e.exit_open ? 'has an exit in progress'
      : (e.country || 'Kenya') !== 'Kenya' ? `paid in ${e.country}, not Kenya`
      : null;
    if (why) {
      report.skipped.push({ number: e.number, name: fullName(e), title: e.title, why });
      continue;
    }
    candidates.push({ ...e, external_id: link.external_id });
  }
  candidates.sort((a, b) => (a.external_id < b.external_id ? -1 : a.external_id > b.external_id ? 1 : 0));

  // roles, school levels, years of service
  const people = candidates.map((e) => {
    const k = e.external_id;
    let role = roleFor(e.title);
    if (!role) {
      role = DEFAULT_ROLE;
      report.defaulted.push({ number: e.number, name: fullName(e), title: e.title });
    }
    const newHire = role.newHires && chance(k, 'new-hire', role.newHires);
    const [lo, hi] = role.years;
    const years = newHire ? 0 : role.group ? Math.max(1, lo + pick(k, 'years', hi - lo + 1)) : teacherYears(k);
    return { e, k, role, years, newHire };
  });
  // a senior teacher per school level first (round robin), then teachers by title or by the size of each level
  const levelWeights = LEVELS.flatMap((l, i) => Array(l.weight).fill(i));
  let senior = 0;
  for (const p of people) {
    if (p.role.dept) continue;
    const byTitle = LEVELS.findIndex((l) => l.match.test(String(p.e.title ?? '')));
    p.level = byTitle >= 0 ? byTitle : p.role.key === 'senior_teacher' ? senior++ % LEVELS.length : levelWeights[pick(p.k, 'level', levelWeights.length)];
    p.dept = LEVELS[p.level].dept;
  }
  for (const p of people) if (p.role.dept) p.dept = p.role.dept;

  // who leads what: the head teacher, a deputy, a senior teacher per level, the first of each support department
  const first = (pred) => people.find(pred);
  const head = first((p) => p.role.key === 'head_teacher') ?? first((p) => p.role.key === 'administrator') ?? null;
  const deputy = first((p) => p.role.key === 'deputy' && p !== head) ?? null;
  const bursar = first((p) => p.role.key === 'bursar' && p !== head) ?? null;
  const deptHead = new Map();
  if (head) deptHead.set('Administration', head);
  if (head || deputy) deptHead.set(ACADEMICS, deputy ?? head);
  for (const l of LEVELS) {
    const h = first((p) => p.role.key === 'senior_teacher' && p.dept === l.dept);
    if (h) deptHead.set(l.dept, h);
  }
  const leaderOrder = ['bursar', 'nurse', 'head_cook', 'storekeeper', 'librarian', 'ict', 'driver', 'security', 'groundsman', 'cleaner', 'cook', 'matron', 'accounts', 'lab_technician', 'support'];
  for (const d of DEPARTMENTS) {
    if (deptHead.has(d.name) || d.parent || d.name === ACADEMICS) continue;
    const h = leaderOrder.map((key) => first((p) => p.dept === d.name && p.role.key === key)).find(Boolean);
    if (h) deptHead.set(d.name, h);
  }
  const managerOf = (p) => {
    if (p === head) return null;
    if (p === deputy) return head;
    if (p.role.teaching) {
      const levelHead = deptHead.get(p.dept);
      if (levelHead && levelHead !== p && p.role.key === 'teacher') return levelHead;
      return deputy && deputy !== p ? deputy : head;
    }
    if (p === bursar) return head;
    const dh = deptHead.get(p.dept);
    if (dh && dh !== p) return dh;
    return bursar ?? head;
  };

  const banks = (snapshot.banks ?? []).filter((b) => b && b.code);
  const policies = (snapshot.leave_policies ?? []).filter((l) => l.deductible && ['monthly_cumulative', 'annual'].includes(l.method));

  const employees = people.map((p) => {
    const { e, k, role, years, newHire } = p;
    const band = role.group ? { group: role.group, years: role.years } : teacherBand(years);
    const group = band.group;
    const g = GROUPS[group];
    // where they are on the scale: by their years within the band the scale covers
    const step = Math.min(1, Math.max(0, (years - band.years[0]) / Math.max(1, band.years[1] - band.years[0])));
    const basic = Math.min(g.max, Math.max(g.min, round10(g.min + (g.max - g.min) * step + pick(k, 'jitter', 400))));
    const start = newHire
      ? (chance(k, 'term2', 0.4) ? '2026-05-04' : '2026-01-05')
      : `${YEAR - years}-${chance(k, 'may', 0.25) ? '05' : '01'}-0${4 + pick(k, 'day', 5)}`;
    const contract = !role.teaching && !newHire && chance(k, 'contract', 0.3);
    const bank = banks.length ? banks[pick(k, 'bank', banks.length)] : null;
    const gender = e.gender ?? genderFor(e.first);
    if (!gender) report.noGender.push({ number: e.number, name: fullName(e) });
    if (e.email && !isDemoEmail(e.email)) report.realEmails.push({ number: e.number, name: fullName(e), email: e.email });
    if (e.onboarding === 'approved') report.alreadyApproved.push({ number: e.number, name: fullName(e) });
    if (e.date_of_birth) report.hasDateOfBirth.push({ number: e.number, name: fullName(e) });
    const name = [e.first, e.last].filter(Boolean).join(' ');
    const id_number = e.id_number ?? uniqueNumber(k, 'id', 8, taken.id);
    const tax_pin = e.tax_pin ?? `A${uniqueNumber(k, 'pin', 9, taken.pin)}${'ABCDEFGHJKLMNPQRTUVWXYZ'[pick(k, 'pin-letter', 23)]}`;
    const shif = e.shif ?? `CR${uniqueNumber(k, 'shif', 12, taken.shif)}`;
    const nssf = e.nssf ?? uniqueNumber(k, 'nssf', 9, taken.nssf);
    const account = e.account ?? uniqueNumber(k, 'account', 13, taken.account);

    // voluntary deductions: welfare for everyone, union dues for teachers, SACCO savings for about half
    const startPeriod = start.slice(0, 7) > FIRST_PERIOD ? start.slice(0, 7) : FIRST_PERIOD;
    const deductions = [{ type: 'Staff Welfare', amount: 300 }];
    if (role.teaching) deductions.push({ type: "Teachers' union dues", amount: round10(basic * 0.02) });
    if (chance(k, 'sacco', 0.55)) {
      deductions.push({ type: 'Kijani Staff SACCO', amount: role.teaching ? 2000 + 500 * pick(k, 'sacco-amount', 9) : 500 + 250 * pick(k, 'sacco-amount', 7) });
    }

    // leave already taken this year (the balances' used days; no applications are made)
    const leave = policies.map((l) => {
      let used = 0;
      if (/^annual/i.test(l.name)) used = newHire ? pick(k, 'annual', 3) : 2 + pick(k, 'annual', 9);
      else if (/^sick/i.test(l.name)) used = chance(k, 'sick-any', 0.6) ? 1 + pick(k, 'sick', 4) : 0;
      else if (/study|exam/i.test(l.name)) used = role.teaching && chance(k, 'study', 0.1) ? 2 + pick(k, 'study-days', 4) : 0;
      return { type_id: l.type_id, name: l.name, method: l.method, days: l.days, used };
    });

    return {
      id: e.id, number: e.number, external_id: k, name: fullName(e),
      snap: { title: e.title, first: e.first, middle: e.middle, last: e.last, mobile: e.mobile, id_number: e.id_number, tax_pin: e.tax_pin, shif: e.shif, nssf: e.nssf, account: e.account, gender: e.gender },
      title: e.title, role: role.key, role_label: role.label, department: p.dept, group, years,
      basic, house: g.house, travel: g.travel,
      employee_type: contract ? 'Contract' : 'Permanent',
      start_date: start,
      probation_start: newHire ? start : null,
      probation_end: newHire ? addMonths(start, 3) : null,
      contract_start: contract ? `${YEAR}-01-05` : null,
      contract_end: contract ? '2027-12-31' : null,
      notice_days: role.teaching ? 90 : 30,
      gender,
      id_number, tax_pin, shif, nssf,
      bank: bank?.name ?? null, bank_code: bank?.code ?? null,
      bank_branch: bank?.branch?.name ?? null, branch_code: bank?.branch?.code ?? null,
      account, account_name: name,
      reports_to: null,
      deductions, leave, start_period: startPeriod,
      mobile: e.mobile,
      _p: p,
    };
  });
  const byPerson = new Map(employees.map((x) => [x._p, x]));
  for (const x of employees) {
    const m = managerOf(x._p);
    x.reports_to = m ? byPerson.get(m).number : null;
  }
  const departmentHeads = [...deptHead.entries()].map(([dept, p]) => ({ department: dept, number: byPerson.get(p).number }));

  // job titles: each Schools title present gets a department and group when everyone with it has the same
  const titles = new Map();
  for (const x of employees) {
    if (!x.title) continue;
    const t = titles.get(x.title.toLowerCase()) ?? { title: x.title, departments: new Set(), groups: new Set() };
    t.departments.add(x.department);
    t.groups.add(x.group);
    titles.set(x.title.toLowerCase(), t);
  }
  const titleRows = [...titles.values()].map((t) => ({
    title: t.title,
    department: t.departments.size === 1 ? [...t.departments][0] : null,
    group: t.groups.size === 1 ? [...t.groups][0] : null,
  }));

  // job descriptions for the roles present
  const roleKeys = [...new Set(employees.map((x) => x.role))];
  const allRoles = [...ROLES, DEFAULT_ROLE];
  const postings = roleKeys.map((key) => {
    const r = allRoles.find((x) => x.key === key);
    const groupCodes = [...new Set(employees.filter((x) => x.role === key).map((x) => x.group))].sort();
    const lo = Math.min(...groupCodes.map((c) => GROUPS[c].min));
    const hi = Math.max(...groupCodes.map((c) => GROUPS[c].max));
    return {
      job_title: r.label,
      department: r.dept ?? ACADEMICS,
      job_level: groupCodes.map((c) => GROUPS[c].name).join(' / '),
      job_type: 'Full-time',
      salary_range: `KES ${lo.toLocaleString('en-KE')} - ${hi.toLocaleString('en-KE')} basic per month, plus house and commuter allowances`,
      benefits: 'House allowance, commuter allowance, staff welfare scheme, SACCO membership, staff meals during term, 21 days\' annual leave',
      ...JOB_DESCRIPTIONS[key],
    };
  });

  // payroll months: from January to `through`, skipping months the company already has a run for
  const runs = new Map((snapshot.runs ?? []).map((r) => [r.period, r]));
  const months = [];
  const monthsSkipped = [];
  for (const period of periodsThrough(through)) {
    const r = runs.get(period);
    if (r) {
      monthsSkipped.push({ period, why: r.notes === SEED_NOTE ? `already seeded (${r.status})` : `the company already has a ${r.status} run (not the seeder's); left alone` });
      continue;
    }
    const rates = snapshot.rates?.[period];
    if (!rates || !rates.paye_bands) throw new PlanError(`No Kenyan statutory rates for ${period}`);
    const paid = employees.filter((x) => x.start_date <= lastDay(period));
    months.push({ period, rates, employees: paid.map((x) => x.number) });
  }

  // Schools staff that never reached HR (only when Schools' list is given)
  if (Array.isArray(schoolsStaff)) {
    const linked = new Set(snapshot.employees.flatMap((e) => e.links.filter((l) => l.source === 'schools').map((l) => l.external_id)));
    for (const s of schoolsStaff) {
      if (!linked.has(String(s.person_id))) report.missingInHr.push({ person_id: s.person_id, name: s.full_name, title: s.job_title });
    }
  }

  for (const x of employees) delete x._p;
  return {
    tenant_id: HR_TENANT,
    platform_tenant_id: PLATFORM_TENANT,
    through,
    taken_at: snapshot.taken_at,
    settings: snapshot.settings ?? {},
    departments: DEPARTMENTS,
    groups: Object.entries(GROUPS).filter(([code]) => employees.some((x) => x.group === code)).map(([code, g]) => ({ code, ...g })),
    titles: titleRows,
    employees,
    departmentHeads,
    deductionTypes: [...new Set(employees.flatMap((x) => x.deductions.map((d) => d.type)))],
    postings,
    months,
    monthsSkipped,
    report,
  };
}

// ---------------------------------------------------------------------------------------------
// 4. payslips, by HR's own payroll engine
// ---------------------------------------------------------------------------------------------
/** HR's payroll engine (src/lib), bundled for Node. The database client is replaced by a stub that throws if used. */
export async function loadPayrollEngine() {
  const { createRequire } = await import('node:module');
  const require = createRequire(join(ROOT, 'package.json'));
  const esbuild = require('esbuild');
  const entry = [
    "export { calculateRun } from './src/lib/payroll/multiCountry';",
    "export { deductionsForPeriod } from './src/lib/voluntaryDeductions';",
  ].join('\n');
  const noDatabase = {
    name: 'no-database',
    setup(b) {
      b.onResolve({ filter: /(^|\/)supabase$/ }, (a) => (a.importer.includes('node_modules') ? undefined : { path: 'supabase', namespace: 'no-database' }));
      b.onLoad({ filter: /.*/, namespace: 'no-database' }, () => ({
        contents: 'export const supabase = new Proxy({}, { get() { throw new Error("seed-kijani-hr: the payroll engine tried to use the database"); } });',
        loader: 'js',
      }));
    },
  };
  const out = await esbuild.build({
    stdin: { contents: entry, resolveDir: ROOT, loader: 'ts' },
    bundle: true, write: false, format: 'cjs', platform: 'node', target: 'node20',
    plugins: [noDatabase], define: { 'import.meta.env': '{}' }, logLevel: 'error',
  });
  // evaluated in memory (no temporary file): a CommonJS bundle with only Node built-ins left to require
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}

// PayrollDashboard.tsx PAYSLIP_AMOUNTS / toSalaryHistory: a calculated row as the salary_history row the page saves
const PAYSLIP_AMOUNTS = [
  'basic_salary', 'gross_pay', 'net_pay', 'total_deductions', 'nssf_deduction', 'nhif_deduction', 'paye_tax',
  'housing_levy', 'house_allowance', 'transport_allowance', 'medical_allowance', 'other_allowances', 'overtime_hours',
  'overtime_rate', 'commission', 'bonus', 'per_diem', 'tax_relief', 'loan_deduction', 'advance_deduction',
  'welfare_deduction', 'other_deductions', 'leave_deduction', 'overtime_pay',
  'work_pay', 'jobs_pay', 'paid_out', 'ahl_withheld', 'reserve_released', 'wht_withheld', 'wht_rate', 'wht_tax',
  'arrears_brought_forward', 'arrears_carried_forward',
  'employer_nssf', 'heslb_deduction', 'sdl_levy', 'wcf_levy', 'lst_deduction',
  'reimbursements',
];
export const toSalaryHistory = (record) => ({
  ...Object.fromEntries(PAYSLIP_AMOUNTS.map((k) => [k, Number(record[k]) || 0])),
  employee_id: record.employee_id,
  employee_name: record.employee_name,
  pay_period: record.pay_period,
  deduction_items: record.deduction_items ?? [],
  earning_items: record.earning_items ?? [],
  reimbursement_items: record.reimbursement_items ?? [],
  leave_items: record.leave_items ?? [],
  payslip_note: record.payslip_note ?? null,
  overtime_items: record.overtime_items ?? [],
  work_items: record.work_items ?? [],
  arrears_note: record.arrears_note ?? null,
  worker_kind: record.worker_kind ?? null,
  work_settlement: record.work_settlement === true,
  country: record.country || 'Kenya',
  currency: record.currency || 'KES',
  fx_rate: record.fx_rate ?? null,
  local_currency: record.local_currency ?? null,
  local_amounts: record.local_amounts ?? null,
  taxable_pay: record.taxable_pay ?? null,
  tax_resident: record.tax_resident ?? null,
  tax_details: record.tax_details ?? null,
  payment_method: record.payment_method || '',
  bank_name: record.bank_name || '',
  account_number: record.account_number || '',
});

/** The employee row as the payroll page will read it once the seed has run (what the payslip is worked out from). */
export const employeeRowFor = (x) => ({
  id: x.id,
  'Employee Number': x.number,
  'First Name': x.snap.first,
  'Middle Name': x.snap.middle,
  'Last Name': x.snap.last,
  'Job Title': x.title,
  'Job Group': x.group,
  'Job Level': x.department,
  Office: 'Kijani Ridge Academy',
  'ID Number': x.id_number,
  'Mobile Number': x.mobile,
  'Tax PIN': x.tax_pin,
  'SHIF Number': x.shif,
  'NSSF Number': x.nssf,
  'Basic Salary': x.basic,
  house_allowance: x.house,
  travel_allowance: x.travel,
  other_cash_allowances: 0,
  payment_method: 'Bank Transfer',
  Bank: x.bank,
  'Account Number': x.account,
  Country: 'Kenya',
  worker_kind: 'employee',
  pay_basis: 'salary',
  pay_frequency: 'monthly',
  kra_employee_type: 'Primary Employee',
  kra_residency: 'Resident',
  onboarding_status: 'approved',
});

/** Every payslip of every month in the plan, as the payroll page would save it. */
export function computePayslips(plan, engine) {
  const byNumber = new Map(plan.employees.map((x) => [x.number, x]));
  const types = plan.deductionTypes.map((name) => ({ id: name, name, active: true }));
  const deductions = plan.employees.flatMap((x) => x.deductions.map((d) => ({
    id: `${x.number}:${d.type}`, employee_number: x.number, deduction_type_id: d.type, amount: d.amount, start_period: x.start_period, end_period: null, notes: null,
  })));
  return plan.months.map((m) => {
    const employees = m.employees.map((n) => employeeRowFor(byNumber.get(n)));
    const ctx = {
      period: m.period,
      rates: m.rates,
      overrideStatutoryChecks: false,
      voluntaryByEmployee: engine.deductionsForPeriod(types, deductions, m.period),
      payrollLoans: [],
      earningsByEmployee: new Map(),
      leaveByEmployee: new Map(),
      leaveBasis: plan.settings.leave_daily_rate_basis || 'basic_30',
      absenceByEmployee: new Map(),
      leavePayouts: new Map(),
      overtimeMonth: undefined,
      advanceFor: () => 0,
      workByEmployee: new Map(),
      deductionCap: plan.settings.deduction_cap !== false,
      lstPaidThisYear: new Map(),
      lstCollection: 'instalments',
    };
    const { records, notCalculated, heldBack } = engine.calculateRun(employees, [], (country) => (country === 'Kenya' ? ctx : null));
    if (notCalculated.length || heldBack.length || records.length !== employees.length) {
      throw new PlanError(`The payroll engine left people out of ${m.period}: ${JSON.stringify({ notCalculated, heldBack }).slice(0, 500)}`);
    }
    const created = `${m.period}-25T09:00:00+03:00`;
    return {
      period: m.period,
      payslips: records.map((r) => ({ ...toSalaryHistory(r), tenant_id: HR_TENANT, created_at: created })),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// 5. the SQL: one transaction, checks first
// ---------------------------------------------------------------------------------------------
const dateOf = (period, day, time) => `${period}-${String(day).padStart(2, '0')}T${time}+03:00`;

export function buildSql(plan, payroll, { trial = false } = {}) {
  const data = {
    employees: plan.employees.map(({ deductions, leave, ...x }) => ({ ...x, deductions, leave })),
    departments: plan.departments,
    groups: plan.groups,
    titles: plan.titles,
    heads: plan.departmentHeads,
    deduction_types: plan.deductionTypes,
    postings: plan.postings,
    months: plan.months.map((m) => {
      const p = payroll.find((x) => x.period === m.period);
      return {
        period: m.period, rates: m.rates, payslips: p.payslips,
        created_at: dateOf(m.period, 22, '09:00:00'), approved_at: dateOf(m.period, 24, '15:30:00'), paid_at: dateOf(m.period, 27, '10:00:00'),
      };
    }),
  };
  const json = JSON.stringify(data);
  if (json.includes('$kijani_json$')) throw new PlanError('The data contains the SQL quote tag');
  const columns = Object.keys(payroll[0]?.payslips[0] ?? { employee_id: null }).filter((c) => c !== 'run_id');
  const colList = columns.map((c) => `"${c}"`).join(', ');

  return `-- seed-kijani-hr: Kijani Ridge Academy demo staff and 2026 payroll history for HR company ${HR_TENANT}.
-- Generated ${new Date().toISOString()} from the snapshot taken ${plan.taken_at}. ${trial ? 'TRIAL: rolls back at the end.' : 'Commits at the end.'}
-- Run with: psql -X -v ON_ERROR_STOP=1 -f <this file>. It stops, changing nothing, if anything changed since the snapshot.
begin;
do $kijani$
declare
  k_tenant constant uuid := '${HR_TENANT}';
  k_platform constant uuid := '${PLATFORM_TENANT}';
  v constant jsonb := $kijani_json$${json}$kijani_json$::jsonb;
  v_company public.tenants;
  v_emp public.employees;
  vx jsonb;
  vy jsonb;
  vm jsonb;
  v_id uuid;
  v_run uuid;
  v_num text;
  v_balance uuid;
  v_accrued numeric;
  v_used numeric;
  v_rows integer;
  v_notifications_before bigint;
  v_outbox integer; v_invites integer; v_payments integer; v_payslip_emails integer; v_bulk integer;
  n_departments integer := 0; n_groups integer := 0; n_rates integer := 0; n_titles integer := 0; n_employees integer := 0;
  n_managers integer := 0; n_prefs integer := 0; n_reviews integer := 0; n_types integer := 0; n_deductions integer := 0;
  n_balances integer := 0; n_postings integer := 0; n_months integer := 0; n_payslips integer := 0; n_skipped integer := 0;
  n_notifications integer := 0;
begin
  -- one seeder at a time
  perform pg_advisory_xact_lock(hashtextextended('${SEED_TAG}', 0));

  -- 0. the company, and nothing else
  select * into v_company from public.tenants where id = k_tenant;
  if v_company.id is null then
    raise exception '${SEED_TAG}: HR company % not found; nothing done', k_tenant;
  end if;
  if v_company.platform_tenant_id is distinct from k_platform then
    raise exception '${SEED_TAG}: HR company % is linked to platform tenant %, not %; nothing done', k_tenant, v_company.platform_tenant_id, k_platform;
  end if;
  if exists (select 1 from public.company_pay_items i where i.tenant_id = k_tenant and i.active) then
    raise exception '${SEED_TAG}: the company now has standard pay items; take a new snapshot. Nothing done';
  end if;

  -- what must not be queued by seeding: counted now, checked at the end
  select coalesce(max(id), 0) into v_notifications_before from public.hr_notifications;
  select count(*) into v_outbox from public.platform_event_outbox where tenant_id = k_tenant;
  select count(*) into v_invites from public.invite_queue where tenant_id = k_tenant;
  select count(*) into v_payments from public.payroll_payments where tenant_id = k_tenant;
  select count(*) into v_payslip_emails from public.payslip_emails where tenant_id = k_tenant;
  select count(*) into v_bulk from public.bulk_email_recipients where tenant_id = k_tenant;

  -- 1. the snapshot still holds: the same people, linked the same way, with the same numbers
  for vx in select value from jsonb_array_elements(v -> 'employees') loop
    select * into v_emp from public.employees where tenant_id = k_tenant and "Employee Number" = vx ->> 'number';
    if v_emp.id is null or v_emp.id <> (vx ->> 'id')::uuid
       or not exists (select 1 from public.external_people p where p.tenant_id = k_tenant and p.source = 'schools'
                      and p.external_id = vx ->> 'external_id' and p.employee_number = v_emp."Employee Number")
       or v_emp."Job Title" is distinct from vx -> 'snap' ->> 'title'
       or v_emp."First Name" is distinct from vx -> 'snap' ->> 'first'
       or v_emp."Middle Name" is distinct from vx -> 'snap' ->> 'middle'
       or v_emp."Last Name" is distinct from vx -> 'snap' ->> 'last'
       or v_emp."Mobile Number" is distinct from vx -> 'snap' ->> 'mobile'
       or v_emp."ID Number" is distinct from vx -> 'snap' ->> 'id_number'
       or v_emp."Tax PIN" is distinct from vx -> 'snap' ->> 'tax_pin'
       or v_emp."SHIF Number" is distinct from vx -> 'snap' ->> 'shif'
       or v_emp."NSSF Number" is distinct from vx -> 'snap' ->> 'nssf'
       or v_emp."Account Number" is distinct from vx -> 'snap' ->> 'account'
       or coalesce(public.employee_country(k_tenant, v_emp."Employee Number"), 'Kenya') <> 'Kenya' then
      -- (a second run sees its own numbers: the snapshot then has them too)
      raise exception '${SEED_TAG}: employee % changed since the snapshot; take a new snapshot and build again. Nothing done', vx ->> 'number';
    end if;
  end loop;
  for vm in select value from jsonb_array_elements(v -> 'months') loop
    if exists (select 1 from public.payroll_runs r where r.tenant_id = k_tenant and r.pay_period = vm ->> 'period') then
      raise exception '${SEED_TAG}: payroll for % was started since the snapshot; take a new snapshot. Nothing done', vm ->> 'period';
    end if;
    if public.statutory_rates_for(k_tenant, public.pay_period_last_day(vm ->> 'period'), 'Kenya') is distinct from vm -> 'rates' then
      raise exception '${SEED_TAG}: the statutory rates for % changed since the snapshot; take a new snapshot. Nothing done', vm ->> 'period';
    end if;
  end loop;

  -- 2. departments (parents first)
  for vx in select value from jsonb_array_elements(v -> 'departments') loop
    insert into public.departments (tenant_id, name, parent_id)
    values (k_tenant, vx ->> 'name', (select d.id from public.departments d where d.tenant_id = k_tenant and lower(btrim(d.name)) = lower(vx ->> 'parent')))
    on conflict (tenant_id, lower(btrim(name))) do nothing;
    get diagnostics v_rows = row_count; n_departments := n_departments + v_rows;
  end loop;

  -- 3. job groups and what they pay from 1 January
  for vx in select value from jsonb_array_elements(v -> 'groups') loop
    insert into public.job_groups (tenant_id, code, name) values (k_tenant, vx ->> 'code', vx ->> 'name')
    on conflict (tenant_id, lower(btrim(code))) do nothing;
    get diagnostics v_rows = row_count; n_groups := n_groups + v_rows;
    select g.id into v_id from public.job_groups g where g.tenant_id = k_tenant and lower(btrim(g.code)) = lower(vx ->> 'code');
    if not exists (select 1 from public.job_group_rates r where r.job_group_id = v_id and r.effective_from = date '${YEAR}-01-01') then
      insert into public.job_group_rates (tenant_id, job_group_id, effective_from, basic_salary, basic_min, basic_max,
                                          house_allowance, travel_allowance, other_allowances)
      values (k_tenant, v_id, date '${YEAR}-01-01', null, (vx ->> 'min')::numeric, (vx ->> 'max')::numeric,
              (vx ->> 'house')::numeric, (vx ->> 'travel')::numeric, 0);
      n_rates := n_rates + 1;
    end if;
  end loop;

  -- 4. the employees: complete, approved, active (a row that already matches is not touched)
  for vx in select value from jsonb_array_elements(v -> 'employees') loop
    update public.employees emp set
      department_id = (select d.id from public.departments d where d.tenant_id = k_tenant and lower(btrim(d.name)) = lower(vx ->> 'department')),
      job_group_id = (select g.id from public.job_groups g where g.tenant_id = k_tenant and lower(btrim(g.code)) = lower(vx ->> 'group')),
      pay_overridden = false,
      "Basic Salary" = (vx ->> 'basic')::numeric,
      "Employee Type" = vx ->> 'employee_type',
      "Start Date" = vx ->> 'start_date',
      "Probation Start Date" = vx ->> 'probation_start',
      "Probation End Date" = vx ->> 'probation_end',
      "Contract Start Date" = vx ->> 'contract_start',
      "Contract End Date" = vx ->> 'contract_end',
      notice_days = (vx ->> 'notice_days')::integer,
      "Gender" = vx ->> 'gender',
      "Type of Identification" = 'National ID',
      "ID Number" = vx ->> 'id_number',
      "Tax PIN" = vx ->> 'tax_pin',
      "SHIF Number" = vx ->> 'shif',
      "NSSF Number" = vx ->> 'nssf',
      payment_method = 'Bank Transfer',
      "Bank" = vx ->> 'bank',
      bank_code = vx ->> 'bank_code',
      "Bank Branch" = vx ->> 'bank_branch',
      branch_code = vx ->> 'branch_code',
      "Account Number" = vx ->> 'account',
      account_number_name = vx ->> 'account_name',
      kra_employee_type = 'Primary Employee',
      kra_residency = 'Resident',
      "Country" = 'Kenya',
      nationality = 'Kenyan',
      "Office" = 'Kijani Ridge Academy',
      worker_kind = 'employee',
      pay_basis = 'salary',
      pay_frequency = 'monthly',
      "Status" = 'Active',
      onboarding_status = 'approved',
      onboarding_submitted_at = coalesce(emp.onboarding_submitted_at, (vx ->> 'start_date')::date - 7),
      onboarding_reviewed_at = coalesce(emp.onboarding_reviewed_at, (vx ->> 'start_date')::date - 5)
    where emp.tenant_id = k_tenant and emp."Employee Number" = vx ->> 'number'
      and (emp.department_id is distinct from (select d.id from public.departments d where d.tenant_id = k_tenant and lower(btrim(d.name)) = lower(vx ->> 'department'))
        or emp.job_group_id is distinct from (select g.id from public.job_groups g where g.tenant_id = k_tenant and lower(btrim(g.code)) = lower(vx ->> 'group'))
        or emp.pay_overridden or emp."Basic Salary" is distinct from (vx ->> 'basic')::numeric
        or (emp."Employee Type", emp."Start Date", emp."Probation Start Date", emp."Probation End Date", emp."Contract Start Date", emp."Contract End Date")
           is distinct from (vx ->> 'employee_type', vx ->> 'start_date', vx ->> 'probation_start', vx ->> 'probation_end', vx ->> 'contract_start', vx ->> 'contract_end')
        or emp.notice_days is distinct from (vx ->> 'notice_days')::integer
        or (emp."Gender", emp."Type of Identification", emp."ID Number", emp."Tax PIN", emp."SHIF Number", emp."NSSF Number")
           is distinct from (vx ->> 'gender', 'National ID', vx ->> 'id_number', vx ->> 'tax_pin', vx ->> 'shif', vx ->> 'nssf')
        or (emp.payment_method, emp."Bank", emp.bank_code, emp."Bank Branch", emp.branch_code, emp."Account Number", emp.account_number_name)
           is distinct from ('Bank Transfer', vx ->> 'bank', vx ->> 'bank_code', vx ->> 'bank_branch', vx ->> 'branch_code', vx ->> 'account', vx ->> 'account_name')
        or (emp.kra_employee_type, emp.kra_residency, emp."Country", emp.nationality, emp."Office", emp.worker_kind, emp.pay_basis, emp.pay_frequency, emp."Status", emp.onboarding_status)
           is distinct from ('Primary Employee', 'Resident', 'Kenya', 'Kenyan', 'Kijani Ridge Academy', 'employee', 'salary', 'monthly', 'Active', 'approved'));
    get diagnostics v_rows = row_count; n_employees := n_employees + v_rows;

    -- the payslips were worked out from exactly this: stop if a trigger made it anything else
    select * into v_emp from public.employees where tenant_id = k_tenant and "Employee Number" = vx ->> 'number';
    if v_emp."Basic Salary" is distinct from (vx ->> 'basic')::numeric or coalesce(v_emp.house_allowance, 0) <> (vx ->> 'house')::numeric
       or coalesce(v_emp.travel_allowance, 0) <> (vx ->> 'travel')::numeric or coalesce(v_emp.other_cash_allowances, 0) <> 0
       or v_emp."Job Group" is distinct from vx ->> 'group' or v_emp."Job Level" is distinct from vx ->> 'department'
       or v_emp."Tax PIN" is distinct from vx ->> 'tax_pin' or v_emp."NSSF Number" is distinct from vx ->> 'nssf'
       or v_emp."SHIF Number" is distinct from vx ->> 'shif' or v_emp.onboarding_status <> 'approved' then
      raise exception '${SEED_TAG}: employee % did not end up as planned (basic %, house %, travel %, group %, department %); nothing done',
        vx ->> 'number', v_emp."Basic Salary", v_emp.house_allowance, v_emp.travel_allowance, v_emp."Job Group", v_emp."Job Level";
    end if;

    -- notification emails off (the bell still works); no work email is ever set
    insert into public.notification_preferences (employee_id, tenant_id, email, email_level, event_emails, birthday_emails)
    values (v_emp.id, k_tenant, false, 'off', false, false)
    on conflict (employee_id) do update set email = false, email_level = 'off', event_emails = false, birthday_emails = false, updated_at = now()
      where (public.notification_preferences.email, public.notification_preferences.email_level, public.notification_preferences.event_emails,
             public.notification_preferences.birthday_emails) is distinct from (false, 'off', false, false);
    get diagnostics v_rows = row_count; n_prefs := n_prefs + v_rows;

    -- the onboarding review that approved them (no auth user: nobody is notified)
    if not exists (select 1 from public.employee_onboarding_reviews r where r.employee_id = v_emp.id and r.action = 'approved') then
      insert into public.employee_onboarding_reviews (tenant_id, employee_id, action, comment, actor, created_at)
      values (k_tenant, v_emp.id, 'approved', 'Records completed from Figbloom Schools and the staff files', null, (vx ->> 'start_date')::date - 5);
      n_reviews := n_reviews + 1;
    end if;
  end loop;

  -- line managers and department heads
  for vx in select value from jsonb_array_elements(v -> 'employees') loop
    update public.employees emp set reports_to_id = (select m.id from public.employees m where m.tenant_id = k_tenant and m."Employee Number" = vx ->> 'reports_to')
    where emp.tenant_id = k_tenant and emp."Employee Number" = vx ->> 'number'
      and emp.reports_to_id is distinct from (select m.id from public.employees m where m.tenant_id = k_tenant and m."Employee Number" = vx ->> 'reports_to');
    get diagnostics v_rows = row_count; n_managers := n_managers + v_rows;
  end loop;
  for vx in select value from jsonb_array_elements(v -> 'heads') loop
    update public.departments d set head_employee_id = (select m.id from public.employees m where m.tenant_id = k_tenant and m."Employee Number" = vx ->> 'number')
    where d.tenant_id = k_tenant and lower(btrim(d.name)) = lower(vx ->> 'department')
      and d.head_employee_id is distinct from (select m.id from public.employees m where m.tenant_id = k_tenant and m."Employee Number" = vx ->> 'number');
  end loop;

  -- 5. job titles (made from Schools' titles when the staff arrived): their department and group where one fits all
  for vx in select value from jsonb_array_elements(v -> 'titles') loop
    update public.job_titles j set
      department_id = (select d.id from public.departments d where d.tenant_id = k_tenant and lower(btrim(d.name)) = lower(vx ->> 'department')),
      job_group_id = (select g.id from public.job_groups g where g.tenant_id = k_tenant and lower(btrim(g.code)) = lower(vx ->> 'group'))
    where j.tenant_id = k_tenant and public.job_title_key(j.name) = public.job_title_key(vx ->> 'title')
      and (j.department_id, j.job_group_id) is distinct from (
        (select d.id from public.departments d where d.tenant_id = k_tenant and lower(btrim(d.name)) = lower(vx ->> 'department')),
        (select g.id from public.job_groups g where g.tenant_id = k_tenant and lower(btrim(g.code)) = lower(vx ->> 'group')));
    get diagnostics v_rows = row_count; n_titles := n_titles + v_rows;
  end loop;

  -- 6. voluntary deductions (on every payslip from the month they started)
  for vx in select value from jsonb_array_elements(v -> 'deduction_types') loop
    insert into public.deduction_types (tenant_id, name) values (k_tenant, vx #>> '{}') on conflict (tenant_id, lower(btrim(name))) do nothing;
    get diagnostics v_rows = row_count; n_types := n_types + v_rows;
  end loop;
  for vx in select value from jsonb_array_elements(v -> 'employees') loop
    for vy in select value from jsonb_array_elements(vx -> 'deductions') loop
      select d.id into v_id from public.deduction_types d where d.tenant_id = k_tenant and lower(btrim(d.name)) = lower(vy ->> 'type');
      if not exists (select 1 from public.employee_deductions d where d.tenant_id = k_tenant and d.employee_number = vx ->> 'number' and d.deduction_type_id = v_id) then
        insert into public.employee_deductions (tenant_id, employee_number, deduction_type_id, amount, start_period, end_period, notes)
        values (k_tenant, vx ->> 'number', v_id, (vy ->> 'amount')::numeric, vx ->> 'start_period', null, 'Demo: ${SEED_TAG}');
        n_deductions := n_deductions + 1;
      end if;
    end loop;
  end loop;

  -- 7. leave balances for ${YEAR}: earned so far by HR's own rules (leave_seed_days), less leave already taken
  for vx in select value from jsonb_array_elements(v -> 'employees') loop
    for vy in select value from jsonb_array_elements(vx -> 'leave') loop
      continue when not exists (select 1 from public.leave_types lt where lt.id = (vy ->> 'type_id')::uuid and lt.tenant_id = k_tenant);
      v_accrued := public.leave_seed_days(k_tenant, vx ->> 'number', vy ->> 'method',
                     public.leave_entitlement(k_tenant, vx ->> 'number', (vy ->> 'type_id')::uuid, (vy ->> 'days')::numeric), ${YEAR});
      v_used := least((vy ->> 'used')::numeric, v_accrued);
      v_balance := null;
      insert into public.leave_balances (tenant_id, employee_number, leave_type_id, year, month, accrued_days, used_days, carried_over_days, last_accrual_date)
      values (k_tenant, vx ->> 'number', (vy ->> 'type_id')::uuid, ${YEAR}, 0, v_accrued, v_used, 0, current_date)
      on conflict (employee_number, leave_type_id, year, month) do nothing
      returning id into v_balance;
      if v_balance is not null then
        n_balances := n_balances + 1;
        insert into public.leave_balance_adjustments
          (tenant_id, leave_balance_id, change_type, delta_days, used_days_before, used_days_after, accrued_days_before, accrued_days_after, reason)
        values (k_tenant, v_balance, case when vy ->> 'method' = 'annual' then 'annual_reset' else 'monthly_accrual' end, v_accrued, 0, 0, 0, v_accrued,
                format('Year %s: %s days by the leave policy', ${YEAR}, v_accrued));
        if v_used > 0 then
          insert into public.leave_balance_adjustments
            (tenant_id, leave_balance_id, change_type, delta_days, used_days_before, used_days_after, accrued_days_before, accrued_days_after, reason)
          values (k_tenant, v_balance, 'approval_deduction', v_used, 0, v_used, v_accrued, v_accrued,
                  'Leave taken in ${YEAR} before Figbloom HR (from the staff leave records)');
        end if;
      end if;
    end loop;
  end loop;

  -- 8. a written job description per role: a closed job posting, never on the careers page
  for vx in select value from jsonb_array_elements(v -> 'postings') loop
    if not exists (select 1 from public.job_postings j where j.tenant_id = k_tenant and j.job_title = vx ->> 'job_title' and j.posted_by = '${SEED_TAG}') then
      insert into public.job_postings (tenant_id, job_title, department, location, job_type, job_level, description, requirements,
                                       responsibilities, salary_range, benefits, application_deadline, status, posted_by, posted_at, is_public)
      values (k_tenant, vx ->> 'job_title', vx ->> 'department', 'Kijani Ridge Academy', vx ->> 'job_type', vx ->> 'job_level', vx ->> 'description',
              vx ->> 'requirements', vx ->> 'responsibilities', vx ->> 'salary_range', vx ->> 'benefits', date '${YEAR - 1}-11-30', 'closed',
              '${SEED_TAG}', timestamptz '${YEAR - 1}-11-03 09:00:00+03', false);
      n_postings := n_postings + 1;
    end if;
  end loop;

  -- 9. payroll ${FIRST_PERIOD} onwards: each month written as already paid, with the payslips HR's engine worked out.
  --    The run's country is a draft while its payslips go in (salary_history_in_draft_run), then recorded as paid on
  --    its dates. The approval effects (notifications, loan repayments, payment files) are not run: nothing to repay,
  --    and nobody is to be told. payroll_run_legacy keeps the run's status from being recomputed meanwhile.
  for vm in select value from jsonb_array_elements(v -> 'months') loop
    perform set_config('app.payroll_run_legacy', 'on', true);
    insert into public.payroll_runs (tenant_id, pay_period, status, notes, created_by, created_at, updated_at, approved_at, paid_at)
    values (k_tenant, vm ->> 'period', 'paid', '${SEED_NOTE}', null, (vm ->> 'created_at')::timestamptz, (vm ->> 'paid_at')::timestamptz,
            (vm ->> 'approved_at')::timestamptz, (vm ->> 'paid_at')::timestamptz)
    returning id into v_run;
    insert into public.payroll_run_countries (tenant_id, run_id, country, currency, status, created_at)
    values (k_tenant, v_run, 'Kenya', 'KES', 'draft', (vm ->> 'created_at')::timestamptz);
    insert into public.payroll_run_rates (tenant_id, run_id, country, rates, calculated_by, calculated_at)
    values (k_tenant, v_run, 'Kenya', vm -> 'rates', null, (vm ->> 'created_at')::timestamptz);
    insert into public.salary_history (${colList})
    select ${colList} from jsonb_populate_recordset(null::public.salary_history, vm -> 'payslips');
    get diagnostics v_rows = row_count; n_payslips := n_payslips + v_rows;
    if v_rows <> jsonb_array_length(vm -> 'payslips') or exists (
         select 1 from public.salary_history h where h.run_id = v_run and (h.tenant_id <> k_tenant or h.country <> 'Kenya' or h.currency <> 'KES')) then
      raise exception '${SEED_TAG}: the payslips for % did not go in as planned; nothing done', vm ->> 'period';
    end if;
    delete from public.payroll_run_countries c where c.run_id = v_run;
    insert into public.payroll_run_countries (tenant_id, run_id, country, currency, status, approved_at, paid_at, created_at, updated_at)
    values (k_tenant, v_run, 'Kenya', 'KES', 'paid', (vm ->> 'approved_at')::timestamptz, (vm ->> 'paid_at')::timestamptz,
            (vm ->> 'created_at')::timestamptz, (vm ->> 'paid_at')::timestamptz);
    perform set_config('app.payroll_run_legacy', '', true);
    if (select r.status from public.payroll_runs r where r.id = v_run) <> 'paid' then
      raise exception '${SEED_TAG}: payroll for % did not end up paid; nothing done', vm ->> 'period';
    end if;
    n_months := n_months + 1;
  end loop;

  -- 10. nothing announced, queued or sent
  delete from public.hr_notifications where tenant_id = k_tenant and id > v_notifications_before;
  get diagnostics n_notifications = row_count;
  if (select count(*) from public.platform_event_outbox where tenant_id = k_tenant) <> v_outbox then
    raise exception '${SEED_TAG}: seeding queued a platform event; nothing done';
  end if;
  if (select count(*) from public.invite_queue where tenant_id = k_tenant) <> v_invites then
    raise exception '${SEED_TAG}: seeding queued an invitation; nothing done';
  end if;
  if (select count(*) from public.payroll_payments where tenant_id = k_tenant) <> v_payments then
    raise exception '${SEED_TAG}: seeding queued a payment; nothing done';
  end if;
  if (select count(*) from public.payslip_emails where tenant_id = k_tenant) <> v_payslip_emails then
    raise exception '${SEED_TAG}: seeding queued a payslip email; nothing done';
  end if;
  if (select count(*) from public.bulk_email_recipients where tenant_id = k_tenant) <> v_bulk then
    raise exception '${SEED_TAG}: seeding queued a company-wide email; nothing done';
  end if;

  raise notice '${SEED_TAG}: company % (%): departments +%, job groups +% (rates +%), employees updated %, line managers set %, job titles updated %',
    v_company.name, k_tenant, n_departments, n_groups, n_rates, n_employees, n_managers, n_titles;
  raise notice '${SEED_TAG}: notification emails turned off for %, onboarding approvals +%, deduction types +%, deductions +%, leave balances +%, job descriptions +%',
    n_prefs, n_reviews, n_types, n_deductions, n_balances, n_postings;
  raise notice '${SEED_TAG}: payroll months +% (% payslips); notifications removed %', n_months, n_payslips, n_notifications;
end
$kijani$;
${trial ? "-- TRIAL: nothing is kept\nrollback;" : 'commit;'}
`;
}

// ---------------------------------------------------------------------------------------------
// 6. the report
// ---------------------------------------------------------------------------------------------
const money = (n) => Math.round(n).toLocaleString('en-KE');
export function formatReport(plan, payroll) {
  const lines = [];
  const r = plan.report;
  lines.push(`seed-kijani-hr plan for HR company ${plan.tenant_id} (platform tenant ${plan.platform_tenant_id}), snapshot ${plan.taken_at}`);
  lines.push(`  employees to complete: ${plan.employees.length}`);
  const byRole = new Map();
  for (const x of plan.employees) byRole.set(x.role_label, (byRole.get(x.role_label) ?? 0) + 1);
  for (const [role, n] of [...byRole].sort((a, b) => b[1] - a[1])) lines.push(`    ${String(n).padStart(3)}  ${role}`);
  const byGroup = new Map();
  for (const x of plan.employees) byGroup.set(x.group, [...(byGroup.get(x.group) ?? []), x.basic]);
  lines.push('  job groups (people, basic pay range):');
  for (const g of plan.groups) {
    const b = byGroup.get(g.code) ?? [];
    lines.push(`    ${g.code.padEnd(7)} ${g.name.padEnd(40)} ${String(b.length).padStart(3)}  KES ${money(Math.min(...b))} - ${money(Math.max(...b))} + house ${money(g.house)} + commuter ${money(g.travel)}`);
  }
  lines.push(`  departments: ${plan.departments.length}; department heads: ${plan.departmentHeads.length}; job descriptions: ${plan.postings.length}`);
  lines.push(`  voluntary deductions: ${plan.employees.reduce((s, x) => s + x.deductions.length, 0)} (${plan.deductionTypes.join(', ')})`);
  lines.push(`  leave balances: ${plan.employees.reduce((s, x) => s + x.leave.length, 0)} (${[...new Set(plan.employees.flatMap((x) => x.leave.map((l) => l.name)))].join(', ') || 'no leave types'})`);
  lines.push(`  payroll months to write (paid): ${plan.months.map((m) => m.period).join(', ') || 'none'}`);
  for (const s of plan.monthsSkipped) lines.push(`    skipped ${s.period}: ${s.why}`);
  if (payroll?.length) {
    lines.push('  payroll totals (KES):');
    for (const p of payroll) {
      const sum = (k) => p.payslips.reduce((s, x) => s + Number(x[k] || 0), 0);
      lines.push(`    ${p.period}: ${String(p.payslips.length).padStart(3)} payslips  gross ${money(sum('gross_pay'))}  PAYE ${money(sum('paye_tax'))}  SHIF ${money(sum('nhif_deduction'))}  NSSF ${money(sum('nssf_deduction'))}  AHL ${money(sum('housing_levy'))}  net ${money(sum('net_pay'))}`);
    }
  }
  const list = (title, rows, fmt) => {
    lines.push(`  ${title}: ${rows.length}`);
    for (const x of rows.slice(0, 50)) lines.push(`    - ${fmt(x)}`);
    if (rows.length > 50) lines.push(`    ... and ${rows.length - 50} more`);
  };
  list('in the company but not linked from Schools (left alone)', r.unlinked, (x) => `${x.number} ${x.name} (${x.title ?? 'no title'})${x.links.length ? ` linked from ${x.links.join(', ')}` : ''}`);
  list('linked from Schools but skipped', r.skipped, (x) => `${x.number} ${x.name}: ${x.why}`);
  list('title not recognised, given the default role (General Support Staff)', r.defaulted, (x) => `${x.number} ${x.name}: "${x.title ?? ''}"`);
  if (r.missingInHr) list('Schools staff with no HR employee (no external_people link; not invented)', r.missingInHr, (x) => `${x.person_id} ${x.name} (${x.title ?? ''})`);
  list(`work email not on @${DEMO_EMAIL_DOMAIN} (kept; their notification emails are turned off)`, r.realEmails, (x) => `${x.number} ${x.name} <${x.email}>`);
  list('date of birth already set (birthday SMS could reach their phone)', r.hasDateOfBirth, (x) => `${x.number} ${x.name}`);
  list('gender not guessed from the first name (left empty)', r.noGender, (x) => `${x.number} ${x.name}`);
  list('already approved before seeding (pay and details are set again)', r.alreadyApproved, (x) => `${x.number} ${x.name}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// 7. command line
// ---------------------------------------------------------------------------------------------
const USAGE = `Usage:
  node scripts/seed-kijani-hr.mjs --snapshot-sql                          print the read-only snapshot query
  node scripts/seed-kijani-hr.mjs --snapshot <file.json> --dry-run        print what would be done
  node scripts/seed-kijani-hr.mjs --snapshot <file.json> --out <file.sql> [--trial]
Options: --through YYYY-MM (last payroll month, default 2026-10, at most 2026-11)
         --schools-staff <file.json> (Schools' staff [{person_id, full_name, job_title}], to report anyone not in HR)`;

export function parseArgs(argv) {
  const args = { through: '2026-10' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const val = argv[++i];
      if (val === undefined) throw new PlanError(`${a} needs a value\n${USAGE}`);
      return val;
    };
    if (a === '--snapshot-sql') args.snapshotSql = true;
    else if (a === '--snapshot') args.snapshot = next();
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--out') args.out = next();
    else if (a === '--trial') args.trial = true;
    else if (a === '--through') args.through = next();
    else if (a === '--schools-staff') args.schoolsStaff = next();
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new PlanError(`Unknown option ${a}\n${USAGE}`);
  }
  return args;
}

/** psql -At output is the JSON line; tolerate a BOM or stray blank lines. */
export const readSnapshot = (file) => {
  const text = readFileSync(file, 'utf8').replace(/^﻿/, '');
  const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith('{'));
  if (!line) throw new PlanError(`${file} has no snapshot JSON in it`);
  return JSON.parse(line);
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }
  if (args.snapshotSql) {
    process.stdout.write(SNAPSHOT_SQL);
    return;
  }
  if (!args.snapshot) throw new PlanError(USAGE);
  if (!args.dryRun && !args.out) throw new PlanError(`Give --dry-run or --out <file.sql>\n${USAGE}`);
  const snapshot = readSnapshot(args.snapshot);
  const schoolsStaff = args.schoolsStaff ? JSON.parse(readFileSync(args.schoolsStaff, 'utf8')) : null;
  const plan = buildPlan(snapshot, { through: args.through, schoolsStaff });
  const engine = await loadPayrollEngine();
  const payroll = computePayslips(plan, engine);
  console.log(formatReport(plan, payroll));
  if (args.dryRun) {
    console.log('\nDry run: nothing written.');
    return;
  }
  writeFileSync(args.out, buildSql(plan, payroll, { trial: !!args.trial }));
  console.log(`\nWrote ${args.out}${args.trial ? ' (TRIAL: it rolls back)' : ''}. Run it with: psql -X -v ON_ERROR_STOP=1 -f ${args.out}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof PlanError ? `seed-kijani-hr: ${err.message}` : err);
    process.exit(1);
  });
}
