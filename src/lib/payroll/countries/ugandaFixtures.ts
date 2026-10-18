import type { Rates } from '../../statutoryCalc';

// Uganda's default rates (supabase/migrations/20261021100000_uganda_payroll.sql) for the tests.

/** Uganda's rates as statutory_rates_on('2026-10-31', 'Uganda') returns them. */
export const UGANDA_RATES: Rates = {
  paye_bands: [
    { upto: 335000, rate: 0 },
    { upto: 410000, rate: 0.2 },
    { upto: 485000, rate: 0.25 },
    { upto: null, rate: 0.3 },
  ],
  paye_bands_non_resident: [
    { upto: 335000, rate: 0.1 },
    { upto: 410000, rate: 0.2 },
    { upto: null, rate: 0.3 },
  ],
  paye_surcharge_threshold: 10000000,
  paye_surcharge_rate: 0.1,
  nssf_rate: 0.05,
  nssf_employer_rate: 0.1,
  nssf_deductible: 0,
  lst_bands: [
    { upto: 100000, amount: 0 },
    { upto: 200000, amount: 5000 },
    { upto: 300000, amount: 10000 },
    { upto: 400000, amount: 20000 },
    { upto: 500000, amount: 30000 },
    { upto: 600000, amount: 40000 },
    { upto: 700000, amount: 60000 },
    { upto: 800000, amount: 70000 },
    { upto: 900000, amount: 80000 },
    { upto: 1000000, amount: 90000 },
    { upto: null, amount: 100000 },
  ],
  lst_deductible: 1,
  lst_first_month: 7,
  lst_months: 4,
  wht_contractual: 0.06,
  wht_professional: 0.06,
};
