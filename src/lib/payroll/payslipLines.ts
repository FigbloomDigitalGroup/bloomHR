// A payslip's statutory lines for a country other than Kenya (FIG-905): Tanzania's and Uganda's tax and contributions,
// with the employer's costs apart. Kenya's payslips keep their own lines.

export { countryPayslipLines } from './countries';

/* eslint-disable @typescript-eslint/no-explicit-any -- payslip rows are the untyped rows the payroll page uses */
const countryOf = (record: any) => String(record?.country ?? '').trim() || 'Kenya';

export const isKenyaPayslip = (record: any) => countryOf(record).toLowerCase() === 'kenya';
/* eslint-enable @typescript-eslint/no-explicit-any */
