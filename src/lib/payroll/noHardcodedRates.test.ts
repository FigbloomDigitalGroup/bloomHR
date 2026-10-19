// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// No statutory figure is kept in the code that works out pay (FIG-813): every rate, band, limit, relief and levy is a
// dated statutory_rates row, so a Finance Act is a new row entered the same day, not a code change. This test reads the
// calculation paths and fails on a literal statutory number or a rate looked up with a made-up fallback.
//
// Reviewed and left as they are (not calculation paths): the payslip design page's sample payslip
// (PayslipDesignPage.tsx), the salary history upload template's example row (BulkSalaryHistoryUpload.tsx), the
// official column headings of the NSSF Tanzania and NSSF Uganda filing templates ("Employee Contribution (10%)"), and
// the legacy payslip viewer's fixed welfare line (a deduction, not a statutory rate), and the platform rates preview's
// sample salaries (lib/payroll/rateVersions SAMPLE_SALARIES: amounts to try, not rates).

const root = join(__dirname, '..', '..', '..');

/** The files that work out or show statutory figures. */
const CALCULATION_PATHS = [
  'src/lib/statutoryCalc.ts',
  'src/lib/payslipCalc.ts',
  'src/lib/leavePay.ts',
  'src/lib/nitaLevy.ts',
  'src/lib/workSettlement.ts',
  'src/lib/payslipOverrides.ts',
  'src/lib/payrollExports.ts',
  'src/lib/p9.ts',
  'src/lib/earnings.ts',
  'src/lib/piecePayouts.ts',
  'src/lib/payroll/taxDetails.ts',
  'src/lib/payroll/usdPay.ts',
  'src/lib/payroll/multiCountry.ts',
  'src/lib/payroll/countries/kenya.ts',
  'src/lib/payroll/countries/tanzania.ts',
  'src/lib/payroll/countries/uganda.ts',
  'src/lib/supabase.ts',
  'src/components/staff portal/PayslipViewer.tsx',
  'src/components/Payroll/PayrollDashboard.tsx',
];

/** Statutory numbers that must come from the rates: Kenya's, Tanzania's and Uganda's, and the per diem share. */
const STATUTORY_LITERALS: [RegExp, string][] = [
  [/\b2400\b/, 'personal relief 2,400'],
  [/\b0\.015\b/, 'housing levy 1.5%'],
  [/\b0\.0275\b/, 'SHIF 2.75%'],
  [/\b0\.06\b/, 'NSSF 6%'],
  [/\b0\.33\b/, 'per diem 33%'],
  [/\b(24000|32333|500000|800000)\b/, 'a Kenya PAYE band edge'],
  [/\b0\.325\b|\b0\.35\b/, 'a Kenya PAYE band rate'],
  [/\b(7000|8000|9000|36000|72000|108000)\b/, 'an NSSF earnings limit'],
  [/\bshif\w*\W+300\b|\b300\b\W+\w*shif/i, 'the SHIF minimum 300'],
  [/\bnita\w*\W+50\b|\b50\b\W+\w*nita/i, 'the NITA levy 50'],
  [/\b(270000|520000|760000)\b/, 'a Tanzania PAYE band edge'],
  [/\b0\.035\b|\b0\.005\b/, 'Tanzania SDL or WCF'],
  [/\b(235000|335000|410000|485000|10000000)\b/, 'a Uganda PAYE band edge'],
];

/** The code without comments (a comment may explain a rate; the code may not hold one). */
const codeOf = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
    .join('\n');

describe('no statutory figure is hard-coded in the calculation paths', () => {
  it.each(CALCULATION_PATHS)('%s', (file) => {
    const path = join(root, file);
    expect(existsSync(path)).toBe(true);
    const code = codeOf(readFileSync(path, 'utf8'));
    const found = code
      .split('\n')
      // (a toast's duration in milliseconds is not a rate)
      .map((line) => line.replace(/duration:\s*\d+/g, ''))
      .flatMap((line, i) => STATUTORY_LITERALS.filter(([re]) => re.test(line)).map(([, what]) => `line ${i + 1}: ${what}: ${line.trim()}`));
    expect(found).toEqual([]);
  });

  it.each(CALCULATION_PATHS)('%s looks rates up without a made-up fallback (0 or Infinity only)', (file) => {
    const code = codeOf(readFileSync(join(root, file), 'utf8'));
    const fallbacks = [...code.matchAll(/rateOf\([^()]*?,\s*'[a-z0-9_]+'\s*,\s*([^)]+)\)/g)].map((m) => m[1].trim());
    expect(fallbacks.filter((f) => f !== '0' && f !== 'Infinity')).toEqual([]);
  });

  it('the old copies are gone: P10.tsx, and the PAYE/NHIF/NSSF functions in lib/supabase', () => {
    expect(existsSync(join(root, 'src/components/Payroll/P10.tsx'))).toBe(false);
    const supabase = readFileSync(join(root, 'src/lib/supabase.ts'), 'utf8');
    expect(supabase).not.toMatch(/calculatePAYE|calculateNHIF|calculateNSSF|TAX_BRACKETS|PERSONAL_RELIEF/);
    expect(readFileSync(join(root, 'src/components/staff portal/PayslipViewer.tsx'), 'utf8')).not.toMatch(/statutorySettings|payeBrackets/);
  });

  it('the server keeps no copy of the Kenyan rates either', () => {
    const serverFiles = readdirSync(root).filter((f) => f.endsWith('.js'));
    expect(serverFiles.length).toBeGreaterThan(0);
    const found = serverFiles.flatMap((f) => {
      const code = codeOf(readFileSync(join(root, f), 'utf8'));
      return STATUTORY_LITERALS.slice(0, 8).filter(([re]) => re.test(code)).map(([, what]) => `${f}: ${what}`);
    });
    expect(found).toEqual([]);
  });
});
