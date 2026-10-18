import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, type EmployeeMinimum, type MinimumWageSettings } from '../lib/minimumWage';
import { loadCompanyMinimum, loadEmployeeMinimums } from '../lib/minimumWageApi';

/**
 * The minimum wage in force on a day (FIG-812 stage 6), for the casual worker and piece rate warnings: the company's
 * settings, the company-country amount (for someone not saved yet) and each employee's. Nothing set, the check off or
 * a failed load all mean no warnings.
 */
export function useMinimumWages(day: string, { perEmployee = true }: { perEmployee?: boolean } = {}) {
  const [settings, setSettings] = useState<MinimumWageSettings>({ ...DEFAULT_SETTINGS, enabled: false });
  const [company, setCompany] = useState<EmployeeMinimum | null>(null);
  const [byEmployee, setByEmployee] = useState<Map<string, EmployeeMinimum>>(new Map());

  useEffect(() => {
    let live = true;
    Promise.all([loadCompanyMinimum(day), perEmployee ? loadEmployeeMinimums(day) : Promise.resolve(new Map<string, EmployeeMinimum>())])
      .then(([c, list]) => {
        if (!live) return;
        setSettings({ enabled: c.enabled, daysPerMonth: c.daysPerMonth });
        setCompany(c.minimum);
        setByEmployee(list);
      })
      .catch(() => {
        // people without access, or no migration yet: no warnings
      });
    return () => {
      live = false;
    };
  }, [day, perEmployee]);

  const minimumFor = useCallback(
    (employeeNumber?: string | null): EmployeeMinimum | null => (employeeNumber ? byEmployee.get(employeeNumber) : undefined) ?? company,
    [byEmployee, company],
  );

  return { settings, company, minimumFor };
}
