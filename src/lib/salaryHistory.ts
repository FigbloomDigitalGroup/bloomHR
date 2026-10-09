import { supabase } from './supabase';
import { WRITE_BATCH_SIZE, chunks } from './fetchAll';
import type { DeductionItem } from './voluntaryDeductions';

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
    /** voluntary deductions on this payslip, itemised (their total is other_deductions) */
    deduction_items?: DeductionItem[];
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
