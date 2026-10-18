import type { Rates } from '../../statutoryCalc';

/** Tanzania's default rates (20261021000000_tanzania_payroll.sql), as statutory_rates_on(day, 'Tanzania') returns them. */
export const TANZANIA_RATES: Rates = {
  paye_bands: [
    { upto: 270000, rate: 0 },
    { upto: 520000, rate: 0.08 },
    { upto: 760000, rate: 0.2 },
    { upto: 1000000, rate: 0.25 },
    { upto: null, rate: 0.3 },
  ],
  nonresident_paye_rate: 0.15,
  secondary_paye_rate: 0.3,
  nssf_rate: 0.1,
  nssf_employer_rate: 0.1,
  nssf_deductible: 1,
  sdl_rate: 0.035,
  sdl_min_employees: 10,
  wcf_rate: 0.005,
  heslb_rate: 0.15,
  wht_resident: 0.05,
  wht_nonresident: 0.15,
};
