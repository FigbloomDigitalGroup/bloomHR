// The sample payslip on the landing page: a fictional employee, in Kenya. Every figure here was produced by the product's
// own Kenyan payroll engine (src/lib/payroll/countries/kenya.ts) and payslipSample.test.ts recalculates it, so if a
// rate or a rule changes the test fails and the page is updated, instead of quietly showing a payslip the product would
// no longer produce. The company's per diem share is set to nothing, so PAYE is the plain result of the bands.

export interface SampleLine {
  label: string;
  amount: number;
}

export const PAYSLIP_SAMPLE = {
  company: 'Sample Company Ltd',
  month: 'October 2026',
  employee: 'Amina Wanjiru',
  number: 'EMP-014',
  position: 'Accountant',
  currency: 'KES',
  earnings: [
    { label: 'Basic salary', amount: 80000 },
    { label: 'House allowance', amount: 10000 },
    { label: 'Transport allowance', amount: 5000 },
    { label: 'Medical allowance', amount: 2000 },
  ] as SampleLine[],
  gross: 97000,
  deductions: [
    { label: 'PAYE', amount: 18500.6 },
    { label: 'NSSF', amount: 5820 },
    { label: 'SHIF', amount: 2667.5 },
    { label: 'Housing levy', amount: 1455 },
  ] as SampleLine[],
  totalDeductions: 28443.1,
  net: 68556.9,
};
