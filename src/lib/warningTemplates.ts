// The warning templates of the Disciplinary module (components/Warning/StaffCheck) and of Leave discipline (FIG-881).
// The leave discipline ones have {placeholders} filled from the record the warning is for (fillWarningTemplate).

export interface WarningTemplate {
  id: number;
  type: string;
  subject: string;
  message: string;
}

export type DisciplineCase = 'unexcused_absence' | 'failed_to_notify' | 'missing_document';

export const DISCIPLINE_TEMPLATES: Record<DisciplineCase, WarningTemplate> = {
  unexcused_absence: {
    id: 5,
    type: 'Unexcused absence',
    subject: 'Warning Regarding Unexcused Absence',
    message:
      'This is a formal warning regarding your absence from work on {dates} ({days}) without permission or a valid reason. ' +
      'Absence without leave is a breach of your terms of employment, and the days are unpaid. Any further unexcused ' +
      'absence may result in further disciplinary action.',
  },
  failed_to_notify: {
    id: 6,
    type: 'Failure to notify',
    subject: 'Warning Regarding Failure to Notify',
    message:
      'This is a formal warning regarding your failure to notify your supervisor or HR in time that you would not be at ' +
      'work on {dates}. You must tell us as early as possible, and before your shift starts, whenever you cannot come to ' +
      'work. Further failures to notify may result in further disciplinary action.',
  },
  missing_document: {
    id: 7,
    type: 'Leave without the required document',
    subject: 'Warning Regarding Leave Without the Required Document',
    message:
      'This is a formal warning regarding your {leave_type} on {dates}: the required {document} was not provided ' +
      '({due}). Please provide it to HR without delay. Leave without the required proof may be treated as unpaid or as ' +
      'an unexcused absence, and may result in further disciplinary action.',
  },
};

export const WARNING_TEMPLATES: WarningTemplate[] = [
  {
    id: 1,
    type: 'Tardiness',
    subject: 'Warning Regarding Frequent Tardiness',
    message: 'This is a formal warning regarding your frequent tardiness. Continued violations may result in further disciplinary action.',
  },
  {
    id: 2,
    type: 'Performance',
    subject: 'Warning Regarding Performance Issues',
    message:
      'This is a formal warning regarding your recent performance which has not met the expected standards. We expect to see immediate improvement.',
  },
  {
    id: 3,
    type: 'Conduct',
    subject: 'Warning Regarding Unprofessional Conduct',
    message:
      'This is a formal warning regarding your recent behavior which violates our code of conduct. Further incidents may lead to disciplinary action.',
  },
  {
    id: 4,
    type: 'Policy Violation',
    subject: 'Warning Regarding Policy Violation',
    message:
      'This is a formal warning regarding your violation of company policy. Please review the employee handbook and ensure compliance moving forward.',
  },
  ...Object.values(DISCIPLINE_TEMPLATES),
];

/** Fills {dates}, {days}, {leave_type}, {document}, {due}; a placeholder with no value is left out sensibly. */
export function fillWarningTemplate(message: string, values: Partial<Record<'dates' | 'days' | 'leave_type' | 'document' | 'due', string>>) {
  const fallback: Record<string, string> = { dates: 'the dates recorded', days: 'working days', leave_type: 'leave', document: 'document', due: 'it was due' };
  return message.replace(/\{(dates|days|leave_type|document|due)\}/g, (_, key: string) => values[key as keyof typeof values]?.trim() || fallback[key]);
}
