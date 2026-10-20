import jsPDF from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import type { WibaCover, WorkInjuryCase } from './workInjury';
import { rulesFor } from './workInjuryRules';

/**
 * The employer's report of an accident, filled in from a work injury case: the details DOSH Form 1 (Kenya, WIBA s.22)
 * asks for, laid out to copy onto the official form or attach to it. In Tanzania and Uganda the same details go to the
 * WCF or the labour officer. It is not the official form itself.
 */

export interface ReportEmployer {
  name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  registrationNo: string | null;
  businessType: string | null;
}

export interface ReportEmployee {
  idNumber?: string | null;
  gender?: string | null;
  dateOfBirth?: string | null;
  jobTitle?: string | null;
}

const v = (value: unknown) => {
  if (value === null || value === undefined) return '-';
  const s = String(value).trim();
  return s || '-';
};

const when = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** The sections and rows of the report (also used by the print view and tests). */
export function reportSections(c: WorkInjuryCase, employer: ReportEmployer, cover: WibaCover | null, employee: ReportEmployee = {}) {
  const money = (n: number | null) => (n === null || n === undefined ? '-' : `${c.currency || ''} ${Number(n).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`.trim());
  return [
    {
      title: 'A. Employer',
      rows: [
        ['Name of employer', v(employer.name)],
        ['Postal / physical address', v(employer.address)],
        ['Telephone / email', [employer.phone, employer.email].filter(Boolean).join(' / ') || '-'],
        ['Nature of business', v(employer.businessType)],
        ['Workplace (DOSH) registration no.', v(cover?.dosh_registration_no)],
        ['Company registration no.', v(employer.registrationNo)],
        ['Insurer and policy no.', cover?.insurer_name ? `${cover.insurer_name}${cover.policy_number ? `, policy ${cover.policy_number}` : ''}` : '-'],
      ],
    },
    {
      title: 'B. Injured employee',
      rows: [
        ['Name', v(c.employee_name)],
        ['Employee number', v(c.employee_number)],
        ['ID / passport no.', v(employee.idNumber)],
        ['Sex', v(employee.gender)],
        ['Date of birth', v(employee.dateOfBirth)],
        ['Occupation', v(employee.jobTitle)],
        ['Monthly earnings', money(c.monthly_earnings)],
      ],
    },
    {
      title: 'C. The accident',
      rows: [
        ['Kind', c.kind === 'occupational_disease' ? 'Occupational disease' : 'Accident'],
        ['Date and time', when(c.occurred_at)],
        ['Place', v(c.place)],
        ['How it happened', v(c.what_happened)],
        ['Was the employee on duty?', c.on_duty ? 'Yes' : 'No'],
        ['Witnesses', v(c.witnesses)],
        ['Date the employer was told', v(c.employer_notified_on)],
        ['Fatal', c.is_fatal ? 'Yes' : 'No'],
      ],
    },
    {
      title: 'D. The injury',
      rows: [
        ['Nature and extent of the injury', v(c.injury_nature)],
        ['Part(s) of the body', v(c.body_parts)],
        ['First aid given', v(c.first_aid)],
        ['Hospital / clinic', v(c.hospital)],
        ['Doctor', v(c.doctor)],
        ['Stopped work on', v(c.stopped_work_on)],
        ['Returned to work on', v(c.returned_to_work_on)],
      ],
    },
  ];
}

export function workInjuryReportPdf(c: WorkInjuryCase, employer: ReportEmployer, cover: WibaCover | null, employee: ReportEmployee = {}) {
  const rules = rulesFor(c.country, c.occurred_at.slice(0, 10));
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.setFontSize(14);
  doc.text('Employer’s report of an accident or occupational disease', 40, 42);
  doc.setFontSize(9);
  doc.text(`For: ${rules.reportForm} — ${rules.act}`, 40, 60, { maxWidth: 515 });
  let y = 84;
  for (const section of reportSections(c, employer, cover, employee)) {
    autoTable(doc, {
      startY: y,
      head: [[section.title, '']],
      body: section.rows,
      styles: { fontSize: 8.5, cellPadding: 4, valign: 'top' },
      headStyles: { fillColor: [14, 79, 39] },
      columnStyles: { 0: { cellWidth: 170, fontStyle: 'bold' } },
      margin: { left: 40, right: 40 },
    });
    y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 14;
  }
  const bottom = doc.internal.pageSize.getHeight();
  if (y > bottom - 110) {
    doc.addPage();
    y = 50;
  }
  doc.setFontSize(9);
  doc.text('Signature of employer: ______________________     Designation: ________________     Date: ____________', 40, y + 16);
  doc.setFontSize(7);
  doc.text(
    'Filled in from Figbloom HR. Copy these details onto the official form (or attach this to it) and keep a copy. A guide, not legal advice.',
    40,
    bottom - 30,
    { maxWidth: 515 },
  );
  return doc;
}

export function downloadWorkInjuryReport(c: WorkInjuryCase, employer: ReportEmployer, cover: WibaCover | null, employee: ReportEmployee = {}) {
  const name = (c.employee_name || c.employee_number).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  workInjuryReportPdf(c, employer, cover, employee).save(`accident-report-${name}-${c.occurred_at.slice(0, 10)}.pdf`);
}
