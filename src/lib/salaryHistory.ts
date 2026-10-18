import { supabase } from './supabase';
import { WRITE_BATCH_SIZE, chunks } from './fetchAll';
import type { DeductionItem } from './voluntaryDeductions';
import type { EarningItem } from './earnings';
import type { LeaveItem } from './leavePay';
import type { OvertimeItem } from './overtimePay';
import type { WorkLine } from './workSettlement';

export interface SalaryHistoryRecord {
    employee_id: string;
    employee_name?: string;
    pay_period: string;
    basic_salary: number;
    gross_pay: number;
    net_pay: number;
    total_deductions: number;
    nssf_deduction: number;
    nhif_deduction: number;
    paye_tax: number;
    housing_levy: number;
    house_allowance?: number;
    transport_allowance?: number;
    medical_allowance?: number;
    other_allowances?: number;
    overtime_hours?: number;
    overtime_rate?: number;
    commission?: number;
    bonus?: number;
    per_diem?: number;
    tax_relief?: number;
    loan_deduction?: number;
    advance_deduction?: number;
    welfare_deduction?: number;
    other_deductions?: number;
    /** voluntary deductions and loan repayments on this payslip, itemised (their totals are other_deductions and loan_deduction) */
    deduction_items?: DeductionItem[];
    /** bonuses, commissions and incentives on this payslip, itemised (their total is commission + bonus) */
    earning_items?: EarningItem[];
    /** unpaid and half-pay leave taken off gross pay this month (FIG-880), and its lines */
    leave_deduction?: number;
    leave_items?: LeaveItem[];
    /** a note payroll added when editing the payslip (FIG-883) */
    payslip_note?: string | null;
    /** overtime paid this month from approved entries (FIG-889), and its lines (one per kind of day) */
    overtime_pay?: number;
    overtime_items?: OvertimeItem[];
    /** the month-end settlement of piece rate work and contract jobs (FIG-812, lib/workSettlement) */
    work_pay?: number;
    jobs_pay?: number;
    work_items?: WorkLine[];
    paid_out?: number;
    ahl_withheld?: number;
    reserve_released?: number;
    wht_withheld?: number;
    wht_rate?: number;
    wht_tax?: number;
    arrears_brought_forward?: number;
    arrears_carried_forward?: number;
    arrears_note?: string | null;
    /**
     * Tanzania and Uganda (FIG-905): the employer's NSSF (never taken from pay), the pay PAYE was worked out on
     * (Tanzania's taxable pay, Uganda's chargeable income: the same thing) and whether the employee was taxed as a
     * resident. Kenya's payslips leave them empty.
     */
    employer_nssf?: number;
    taxable_pay?: number | null;
    /** how taxable pay and PAYE were worked out (FIG-814, lib/payroll/taxDetails) */
    tax_details?: unknown;
    tax_resident?: boolean | null;
    /** Tanzania: the HESLB loan repayment taken from pay, and the employer's SDL and WCF */
    heslb_deduction?: number;
    sdl_levy?: number;
    wcf_levy?: number;
    /** Uganda: Local Service Tax */
    lst_deduction?: number;
    worker_kind?: string | null;
    work_settlement?: boolean;
    /** the payslip's country and currency (FIG-905): its employee's branch's when worked out */
    country?: string;
    currency?: string;
    /** paid in USD (FIG-906): the month's rate, the country's currency and the local statutory figures (lib/payroll/usdPay) */
    fx_rate?: number | null;
    local_currency?: string | null;
    local_amounts?: Record<string, unknown> | null;
    payment_method?: string;
    bank_name?: string;
    account_number?: string;
}

/**
 * Saves a batch of calculated payroll records to the salary_history table.
 */
export const saveSalaryHistoryBatch = async (records: SalaryHistoryRecord[]) => {
    if (!records || records.length === 0) return { success: true, count: 0 };

    try {
        const createdAt = new Date().toISOString();
        // in batches: thousands of payslips do not fit one request
        for (const batch of chunks(records, WRITE_BATCH_SIZE)) {
            const { error } = await supabase
                .from('salary_history')
                .upsert(
                    batch.map(record => ({
                        ...record,
                        created_at: createdAt
                    })),
                    // unique per tenant since FIG-515; tenant_id is stamped by the column default
                    { onConflict: 'tenant_id,employee_id,pay_period' }
                );

            if (error) {
                console.error('Error saving salary history:', error);
                throw error;
            }
        }

        return { success: true, count: records.length };
    } catch (error) {
        console.error('Failed to save salary history batch:', error);
        throw error;
    }
};

/**
 * Retrieves past salary history for a specific employee
 */
export const getEmployeeSalaryHistory = async (employeeId: string) => {
    try {
        const { data, error } = await supabase
            .from('salary_history')
            .select('*')
            .eq('employee_id', employeeId)
            .order('pay_period', { ascending: false });

        if (error) {
            console.error('Error fetching employee salary history:', error);
            throw error;
        }

        return data;
    } catch (error) {
        console.error('Failed to fetch employee salary history:', error);
        return [];
    }
};
