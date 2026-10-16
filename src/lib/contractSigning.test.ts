import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, canCancel, canUploadSigned, contentTypeFor, contractFileProblem, dueState, matchesFilter, type ContractSigningStatus } from './contractSigning';

const ALL: ContractSigningStatus[] = ['sent', 'viewed', 'signed', 'accepted', 'sent_back', 'cancelled'];

describe('contentTypeFor', () => {
  it('knows PDFs and Word files, whatever the case', () => {
    expect(contentTypeFor('Contract.PDF')).toBe('application/pdf');
    expect(contentTypeFor('a.doc')).toBe('application/msword');
    expect(contentTypeFor('a.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });

  it('refuses anything else, and names without an extension', () => {
    expect(contentTypeFor('scan.jpg')).toBeNull();
    expect(contentTypeFor('notes.txt')).toBeNull();
    expect(contentTypeFor('pdf')).toBeNull();
    expect(contentTypeFor('run.exe')).toBeNull();
  });
});

describe('contractFileProblem', () => {
  const file = (name: string, size = 1000) => ({ name, size });

  it('the contract HR sends is a PDF or Word file', () => {
    expect(contractFileProblem(file('c.pdf'), 'contract')).toBeNull();
    expect(contractFileProblem(file('c.docx'), 'contract')).toBeNull();
    expect(contractFileProblem(file('c.jpg'), 'contract')).toBe('Choose a PDF or Word file');
  });

  it('a signed copy is a PDF only', () => {
    expect(contractFileProblem(file('signed.pdf'), 'signed')).toBeNull();
    expect(contractFileProblem(file('signed.PDF'), 'signed')).toBeNull();
    for (const name of ['signed.jpg', 'signed.png', 'signed.docx', 'signed.doc', 'signed']) {
      expect(contractFileProblem(file(name), 'signed')).toMatch(/must be a PDF/);
    }
  });

  it('refuses empty files and files over 20 MB', () => {
    expect(contractFileProblem(file('c.pdf', 0), 'contract')).toBe('That file is empty');
    expect(contractFileProblem(file('c.pdf', MAX_FILE_BYTES), 'contract')).toBeNull();
    expect(contractFileProblem(file('c.pdf', MAX_FILE_BYTES + 1), 'contract')).toBe('That file is larger than 20 MB');
  });
});

describe('what each status allows', () => {
  it('the employee may upload until HR accepts (not once cancelled)', () => {
    expect(ALL.filter(canUploadSigned)).toEqual(['sent', 'viewed', 'signed', 'sent_back']);
  });

  it('HR may cancel anything not accepted or already cancelled', () => {
    expect(ALL.filter(canCancel)).toEqual(['sent', 'viewed', 'signed', 'sent_back']);
  });

  it("HR's filters", () => {
    const pick = (f: Parameters<typeof matchesFilter>[1]) => ALL.filter((status) => matchesFilter({ status }, f));
    expect(pick('review')).toEqual(['signed']);
    expect(pick('waiting')).toEqual(['sent', 'viewed', 'sent_back']);
    expect(pick('accepted')).toEqual(['accepted']);
    expect(pick('all')).toEqual(ALL);
  });
});

describe('dueState', () => {
  const today = new Date(2027, 0, 10, 15, 30); // 10 Jan 2027, mid-afternoon

  it('overdue, due soon (within 3 days) or due, while the employee still has it', () => {
    expect(dueState({ sign_by: '2027-01-09', status: 'sent' }, today)).toBe('overdue');
    expect(dueState({ sign_by: '2027-01-10', status: 'viewed' }, today)).toBe('due-soon');
    expect(dueState({ sign_by: '2027-01-13', status: 'sent_back' }, today)).toBe('due-soon');
    expect(dueState({ sign_by: '2027-01-14', status: 'sent' }, today)).toBe('due');
  });

  it('nothing without a date, or once signed, accepted or cancelled', () => {
    expect(dueState({ sign_by: null, status: 'sent' }, today)).toBeNull();
    expect(dueState({ sign_by: '2027-01-01', status: 'signed' }, today)).toBeNull();
    expect(dueState({ sign_by: '2027-01-01', status: 'accepted' }, today)).toBeNull();
    expect(dueState({ sign_by: '2027-01-01', status: 'cancelled' }, today)).toBeNull();
  });
});
