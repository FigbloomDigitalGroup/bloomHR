// hooks/useStatutorySettings.js
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const getDefaultSettings = () => ({
  payeBrackets: [
    { threshold: 24000, rate: 0.10 },
    { threshold: 32333, rate: 0.25 },
    { threshold: 500000, rate: 0.30 },
    { threshold: 800000, rate: 0.325 },
    { threshold: 999999999, rate: 0.35 }
  ],
  personalRelief: 2400,
  nssfLowerLimit: 8000,
  nssfUpperLimit: 72000,
  nssfRate: 0.06,
  nssfMaximum: 4320,
  nhifRate: 0.0275, // Flat rate system
  housingLevyRate: 0.015,
  currency: 'KSh',
  effectiveDate: new Date().toISOString().split('T')[0]
});

const useStatutorySettings = () => {
  const [settings, setSettings] = useState(getDefaultSettings());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadLatestSettings();
  }, []);

  const loadLatestSettings = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('statutory_settings')
        .select('settings')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (data && !error) {
        // Handle migration from old tiered system to new flat rate system
        const migratedSettings = migrateSettings(data.settings);
        setSettings(migratedSettings);
      } else {
        setSettings(getDefaultSettings());
      }
    } catch (error) {
      console.error('Error loading statutory settings:', error);
      setSettings(getDefaultSettings());
    } finally {
      setIsLoading(false);
    }
  };

  // Migration function to handle old tiered NHIF structure
  const migrateSettings = (savedSettings) => {
    if (!savedSettings) return getDefaultSettings();
    
    // If using old tiered system but no nhifRate, set a default
    if (savedSettings.nhifRates && !savedSettings.nhifRate) {
      return {
        ...savedSettings,
        nhifRate: 0.0275 // Default to 0.275%
      };
    }
    
    return savedSettings;
  };
  

  const calculatePAYE = (taxableIncome) => {
  if (!settings || !taxableIncome || taxableIncome <= 0) return 0;
  
  
  
  let tax = 0;
  let remainingIncome = taxableIncome;

  for (let i = 0; i < settings.payeBrackets.length; i++) {
    const bracket = settings.payeBrackets[i];
    const prevBracket = i > 0 ? settings.payeBrackets[i - 1] : { threshold: 0 };
    
    if (remainingIncome > 0) {
      const bracketAmount = i === 0 
        ? Math.min(remainingIncome, bracket.threshold)
        : Math.min(remainingIncome, bracket.threshold - prevBracket.threshold);
      
      
      
      tax += bracketAmount * bracket.rate;
      remainingIncome -= bracketAmount;
    }
  }

  
  
  tax = Math.max(0, tax - (settings.personalRelief || 0));
  
  
  
  return Number(tax.toFixed(2));
};

  const calculateNSSF = (grossSalary) => {
    if (!settings || !grossSalary || grossSalary <= 0) return 0;

    const tier1 = Math.min(grossSalary, settings.nssfLowerLimit || 0) * (settings.nssfRate || 0);
    let tier2 = 0;

    if (grossSalary > (settings.nssfLowerLimit || 0)) {
      const tier2Salary = Math.min(
        grossSalary - (settings.nssfLowerLimit || 0), 
        (settings.nssfUpperLimit || 0) - (settings.nssfLowerLimit || 0)
      );
      tier2 = tier2Salary * (settings.nssfRate || 0);
    }

    const total = Math.min(tier1 + tier2, settings.nssfMaximum || 0);
    return Number(total.toFixed(2));
  };

  const calculateNHIF = (grossPay) => {
    if (!settings || !grossPay || grossPay <= 0) return 0;

    // Handle both old and new NHIF structures
    if (settings.nhifRate) {
      // New flat rate system
      const nhif = grossPay * settings.nhifRate;
      return Number(nhif.toFixed(2));
    } else if (settings.nhifRates && Array.isArray(settings.nhifRates)) {
      // Old tiered system (backward compatibility)
      for (const rate of settings.nhifRates) {
        if (grossPay <= rate.threshold) {
          return rate.amount;
        }
      }
      return settings.nhifDefault || 0;
    }
    
    return 0;
  };

  const calculateHousingLevy = (grossSalary, hasTaxPIN) => {
    if (!settings || !grossSalary || grossSalary <= 0 || !hasTaxPIN) return 0;
    const levy = grossSalary * (settings.housingLevyRate || 0);
    return Number(levy.toFixed(2));
  };

  return {
    settings,
    isLoading,
    calculatePAYE,
    calculateNSSF,
    calculateNHIF,
    calculateHousingLevy,
    reloadSettings: loadLatestSettings
  };
};

export default useStatutorySettings;