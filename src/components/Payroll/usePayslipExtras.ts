import { useEffect, useState } from 'react';
import { loadPayslipExtras, type PayslipExtras } from '../../lib/payslipExtras';

/**
 * A payslip's employer block, employee numbers, year to date, run and the company's design (lib/payslipExtras), for
 * the payslip on screen. null while loading (the payslip shows its own figures meanwhile).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a payroll row or saved payslip
export function usePayslipExtras(record: any, companyInfo?: { company_name?: string | null; image_url?: string | null } | null): PayslipExtras | null {
  const [extras, setExtras] = useState<PayslipExtras | null>(null);
  const key = `${record?.employee_id ?? ''}|${record?.pay_period ?? ''}|${record?.country ?? ''}|${record?.currency ?? ''}`;
  useEffect(() => {
    let live = true;
    setExtras(null);
    if (!record?.employee_id) return;
    loadPayslipExtras(record, companyInfo)
      .then((e) => {
        if (live) setExtras(e);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // the payslip is the same while its employee, month, country and currency are
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, companyInfo?.company_name, companyInfo?.image_url]);
  return extras;
}
