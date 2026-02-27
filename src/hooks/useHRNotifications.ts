/**
 * useHRNotifications
 * -------------------
 * Runs once on mount (and can be manually triggered).
 * 1. Reads hr_employment_status for records expiring within 7 days.
 * 2. For each one that has NOT already been notified today, inserts a row
 *    into `hr_notifications` and sends an email to the employee.
 *
 * The hr_notifications table is also read by:
 *  - Header.tsx  (admin bell panel)
 *  - StaffPortal notification panel (filtered by employee_number)
 */

import { useCallback } from 'react';
import { supabase } from '../lib/supabase';

const API_URL =
    import.meta.env.VITE_API_URL ||
    (import.meta.env.MODE === 'production' ? '/api' : 'http://localhost:3002/api');

export interface HRNotification {
    id: number;
    employee_number: string;
    notification_type: 'contract_expiring' | 'probation_expiring';
    title: string;
    message: string;
    end_date: string;
    days_remaining: number;
    is_read_admin: boolean;
    is_read_staff: boolean;
    email_sent: boolean;
    created_at: string;
    employee_name?: string;
    work_email?: string;
}

async function sendReminderEmail(to: string, subject: string, htmlBody: string) {
    try {
        const res = await fetch(`${API_URL}/email/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to, subject, html: htmlBody, provider: 'resend' }),
        });
        return res.ok;
    } catch {
        return false;
    }
}

function buildEmailHtml(employeeName: string, type: string, endDate: string, daysLeft: number): string {
    const typeLabel = type === 'contract_expiring' ? 'Contract' : 'Probation Period';
    const actionLine =
        type === 'contract_expiring'
            ? 'Please speak with your HR team about renewal or conversion to permanent employment.'
            : 'Please speak with your HR team about your confirmation status.';

    return `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
      <div style="background:#ffffff;padding:24px;text-align:center;border-bottom:4px solid #03c04a;">
        <h1 style="margin:0;color:#1e293b;font-size:22px;font-weight:800;">HR Reminder</h1>
        <p style="margin:4px 0 0;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Human Resources Department</p>
      </div>
      <div style="padding:28px 24px;color:#334155;line-height:1.7;font-size:15px;">
        <p>Dear <strong>${employeeName}</strong>,</p>
        <p>This is an automated reminder that your <strong>${typeLabel}</strong> is expiring in <strong>${daysLeft} day${daysLeft !== 1 ? 's' : ''}</strong>, on <strong>${endDate}</strong>.</p>
        <p>${actionLine}</p>
        <p style="margin-top:24px;">Best regards,<br/><strong>Human Resources</strong></p>
      </div>
      <div style="background:#f8fafc;padding:16px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #e5e7eb;">
        This is an automated notification. Please do not reply to this email.
      </div>
    </div>
  `;
}

export function useHRNotifications() {
    const checkAndNotify = useCallback(async () => {
        try {
            const today = new Date();
            const todayStr = today.toISOString().split('T')[0];
            const in7Days = new Date(today.getTime() + 7 * 86400000).toISOString().split('T')[0];

            // Get all employment statuses expiring in ≤7 days
            const { data: statuses } = await supabase
                .from('hr_employment_status')
                .select('"Employee Number", employment_type, probation_end_date, contract_end_date, is_confirmed')
                .or(
                    `and(employment_type.eq.Probation,is_confirmed.eq.false,probation_end_date.gte.${todayStr},probation_end_date.lte.${in7Days}),` +
                    `and(employment_type.eq.Contract,contract_end_date.gte.${todayStr},contract_end_date.lte.${in7Days})`
                );

            if (!statuses || statuses.length === 0) return;

            // Fetch existing notifications created today to avoid duplicates
            const { data: existingToday } = await supabase
                .from('hr_notifications')
                .select('employee_number, notification_type')
                .gte('created_at', `${todayStr}T00:00:00`);

            const alreadyNotified = new Set(
                (existingToday || []).map((n: any) => `${n.employee_number}-${n.notification_type}`)
            );

            // Fetch employee details
            const empNumbers = statuses.map((s: any) => s['Employee Number']);
            const { data: employees } = await supabase
                .from('employees')
                .select('"Employee Number", "First Name", "Last Name", "Work Email"')
                .in('"Employee Number"', empNumbers);

            const empMap = new Map((employees || []).map((e: any) => [e['Employee Number'], e]));

            for (const status of statuses as any[]) {
                const empNum = status['Employee Number'];
                const type: HRNotification['notification_type'] =
                    status.employment_type === 'Probation' ? 'probation_expiring' : 'contract_expiring';
                const endDate: string = status.employment_type === 'Probation'
                    ? status.probation_end_date
                    : status.contract_end_date;

                const key = `${empNum}-${type}`;
                if (alreadyNotified.has(key)) continue;

                const daysLeft = Math.ceil((new Date(endDate).getTime() - today.getTime()) / 86400000);
                const emp = empMap.get(empNum);
                const employeeName = emp
                    ? `${emp['First Name'] || ''} ${emp['Last Name'] || ''}`.trim()
                    : empNum;
                const workEmail = emp?.['Work Email'] || null;

                const title =
                    type === 'contract_expiring'
                        ? `Contract expiring in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`
                        : `Probation ending in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`;

                const message =
                    type === 'contract_expiring'
                        ? `${employeeName}'s contract expires on ${endDate}. Action required: renew or convert.`
                        : `${employeeName}'s probation ends on ${endDate}. Confirm or extend as needed.`;

                // Send email
                let emailSent = false;
                if (workEmail) {
                    const html = buildEmailHtml(employeeName, type, endDate, daysLeft);
                    const subject = `Reminder: Your ${type === 'contract_expiring' ? 'Contract' : 'Probation'} ends on ${endDate}`;
                    emailSent = await sendReminderEmail(workEmail, subject, html);
                }

                // Insert notification
                await supabase.from('hr_notifications').insert({
                    employee_number: empNum,
                    employee_name: employeeName,
                    work_email: workEmail,
                    notification_type: type,
                    title,
                    message,
                    end_date: endDate,
                    days_remaining: daysLeft,
                    is_read_admin: false,
                    is_read_staff: false,
                    email_sent: emailSent,
                });
            }
        } catch (err) {
            console.error('[useHRNotifications] Error:', err);
        }
    }, []);

    return { checkAndNotify };
}

/** Fetch unread HR notifications for the admin bell panel */
export async function fetchAdminHRNotifications(): Promise<HRNotification[]> {
    const { data } = await supabase
        .from('hr_notifications')
        .select('*')
        .eq('is_read_admin', false)
        .order('created_at', { ascending: false })
        .limit(50);
    return (data || []) as HRNotification[];
}

/** Fetch HR notifications for a specific staff member */
export async function fetchStaffHRNotifications(employeeNumber: string): Promise<HRNotification[]> {
    const { data } = await supabase
        .from('hr_notifications')
        .select('*')
        .eq('employee_number', employeeNumber)
        .eq('is_read_staff', false)
        .order('created_at', { ascending: false })
        .limit(20);
    return (data || []) as HRNotification[];
}

/** Mark a notification as read by admin */
export async function markAdminNotificationRead(id: number) {
    await supabase.from('hr_notifications').update({ is_read_admin: true }).eq('id', id);
}

/** Mark a notification as read by staff */
export async function markStaffNotificationRead(id: number) {
    await supabase.from('hr_notifications').update({ is_read_staff: true }).eq('id', id);
}
