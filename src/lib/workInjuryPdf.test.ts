// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { reportSections, workInjuryReportPdf } from './workInjuryPdf';
import type { WorkInjuryCase } from './workInjury';

const c = {
  id: 'c1', incident_report_id: null, employee_number: 'MCL-000001', employee_name: 'Amina Wanjiru', country: 'Kenya', currency: 'KES',
  kind: 'accident', is_fatal: false, occurred_at: '2026-10-20T07:00:00Z', employer_notified_on: '2026-10-20', place: 'Warehouse',
  what_happened: 'Slipped on a wet floor', injury_nature: 'Broken wrist', body_parts: 'Left wrist', witnesses: 'Juma', first_aid: 'Splint',
  hospital: 'Kenyatta National Hospital', doctor: null, on_duty: true, stopped_work_on: '2026-10-20', returned_to_work_on: null,
  days_off: null, incapacity_percent: null, monthly_earnings: 36500, medical_costs: null, status: 'reported',
} as unknown as WorkInjuryCase;
const employer = { name: 'Acme Tech', address: 'Nairobi', phone: null, email: null, registrationNo: 'CPR/1', businessType: 'Logistics' };
const cover = { insurer_name: 'Jubilee', policy_number: 'WIBA-1', cover_start: null, cover_expiry: null, dosh_registration_no: 'DOSH/123', notes: null };

describe('the employer’s accident report (DOSH Form 1 details)', () => {
  it('has the employer, employee, accident and injury details', () => {
    const rows = Object.fromEntries(reportSections(c, employer, cover, { idNumber: '12345678' }).flatMap((s) => s.rows));
    expect(rows['Name of employer']).toBe('Acme Tech');
    expect(rows['Workplace (DOSH) registration no.']).toBe('DOSH/123');
    expect(rows['Insurer and policy no.']).toBe('Jubilee, policy WIBA-1');
    expect(rows['ID / passport no.']).toBe('12345678');
    expect(rows['How it happened']).toBe('Slipped on a wet floor');
    expect(rows['Monthly earnings']).toBe('KES 36,500');
    expect(rows['Doctor']).toBe('-');
  });

  it('draws a PDF', () => {
    const out = workInjuryReportPdf(c, employer, cover).output();
    expect(out).toContain('accident or occupational disease');
    expect(out).toContain('DOSH Form 1');
  });
});
