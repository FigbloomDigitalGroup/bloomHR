import { createClient } from '@supabase/supabase-js';

// Validate environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Supabase URL and/or Anon Key are missing. Please check your environment variables.'
  );
}

// Create and export Supabase client
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true
  }
});

// Only create admin client if service role key exists
export const supabaseAdmin = supabaseServiceRoleKey 
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true
      }
    })
  : null;

// ... rest of your tax calculation code remains the same ...
// Kenyan tax calculations
// Kenyan tax constants
const TAX_BRACKETS = [
  { limit: 24000, rate: 0.1, deduction: 0 },
  { limit: 32333, rate: 0.25, deduction: 2400 },
  { limit: 500000, rate: 0.3, deduction: 2400 + 2083.25 },
  { limit: 800000, rate: 0.325, deduction: 2400 + 2083.25 + 140300.1 },
  { limit: Infinity, rate: 0.35, deduction: 2400 + 2083.25 + 140300.1 + 97500 }
];

const PERSONAL_RELIEF = 2400;

// Improved PAYE calculation
export const calculatePAYE = (grossPay: number): number => {
  if (grossPay <= 0) return 0;
  
  const bracket = TAX_BRACKETS.find(b => grossPay <= b.limit) || TAX_BRACKETS[TAX_BRACKETS.length - 1];
  const taxableAmount = grossPay - (bracket.limit === Infinity ? 800000 : 0);
  const tax = bracket.deduction + (taxableAmount * bracket.rate);
  
  return Math.max(0, tax - PERSONAL_RELIEF);
};

// NHIF rates in a more maintainable structure
const NHIF_RATES = [
  [0, 5999, 150],
  [6000, 7999, 300],
  [8000, 11999, 400],
  [12000, 14999, 500],
  [15000, 19999, 600],
  [20000, 24999, 750],
  [25000, 29999, 850],
  [30000, 34999, 900],
  [35000, 39999, 950],
  [40000, 44999, 1000],
  [45000, 49999, 1100],
  [50000, 59999, 1200],
  [60000, 69999, 1300],
  [70000, 79999, 1400],
  [80000, 89999, 1500],
  [90000, 99999, 1600]
];

export const calculateNHIF = (grossPay: number): number => {
  if (grossPay <= 0) return 0;
  
  const rate = NHIF_RATES.find(([min, max]) => grossPay >= min && grossPay <= max);
  return rate ? rate[2] : 1700; // Default to maximum rate if not found
};

// NSSF calculation remains the same but with validation
export const calculateNSSF = (grossPay: number): number => {
  if (grossPay <= 0) return 0;
  const pensionablePay = Math.min(Math.max(0, grossPay), 18000);
  return parseFloat((pensionablePay * 0.06).toFixed(2));
};