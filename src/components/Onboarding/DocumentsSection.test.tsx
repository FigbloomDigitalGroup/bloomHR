import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  loadChecklist: vi.fn(),
  loadDocuments: vi.fn(),
  uploadMyDocument: vi.fn(),
  deleteMyDocument: vi.fn(),
  loadEmployeeRequirements: vi.fn(),
  loadReferees: vi.fn(),
  acceptDocument: vi.fn(),
  rejectDocument: vi.fn(),
  setEmployeeRequirement: vi.fn(),
  openDocument: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/employeeDocuments', async (importOriginal) => ({ ...(await importOriginal<object>()), ...api }));

import DocumentsSection from './DocumentsSection';
import DocumentsReview from './DocumentsReview';

const item = (code: string, label: string, section: string, required: boolean, allows_many = false) => ({ code, label, section, description: null, allows_many, required, sort: 0 });
const doc = (id: string, code: string, status: string, review_note: string | null = null) => ({
  id, employee_id: 'e1', code, file_path: `t/u/${id}.pdf`, file_name: `${id}.pdf`, content_type: null, size_bytes: 1, status, review_note, reviewed_at: null, uploaded_at: '',
});

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.loadChecklist.mockResolvedValue([
    item('id_document', 'Proof of identity', 'core', true, true),
    item('cv', 'Updated CV', 'qualifications', true),
    item('driving_licence', 'Driving licence', 'role', false),
    item('pwd_certificate', 'KRA PWD exemption certificate', 'claims', false),
  ]);
  api.loadDocuments.mockResolvedValue([doc('d1', 'cv', 'rejected', 'Page 2 missing'), doc('d2', 'id_document', 'accepted')]);
  api.uploadMyDocument.mockResolvedValue(undefined);
  api.loadEmployeeRequirements.mockResolvedValue([]);
  api.loadReferees.mockResolvedValue([{ id: 'r1', full_name: 'Dr Mary Achieng', organisation: 'KCB', position: 'Manager', phone: '0711000000', email: '', relationship: 'Supervisor' }]);
  api.acceptDocument.mockResolvedValue(undefined);
  api.rejectDocument.mockResolvedValue(undefined);
  api.setEmployeeRequirement.mockResolvedValue(undefined);
});
afterEach(() => cleanup());

describe('DocumentsSection (employee)', () => {
  it('lists what is required by section, and hides claim documents nobody claims', async () => {
    render(<DocumentsSection employeeId="e1" />);
    expect(await screen.findByText('Core attachments')).toBeTruthy();
    expect(screen.getByText('Proof of identity')).toBeTruthy();
    expect(screen.queryByText('Driving licence')).toBeNull(); // optional: offered under "Add a document"
    expect(screen.queryByText('KRA PWD exemption certificate')).toBeNull();
    expect(screen.getByText('Other documents')).toBeTruthy();
  });

  it('shows why HR rejected a file, and lets the employee upload it again', async () => {
    render(<DocumentsSection employeeId="e1" />);
    expect(await screen.findByText(/“Page 2 missing”, please upload it again/)).toBeTruthy();
    const input = screen.getByLabelText('Upload Updated CV') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'cv.pdf')] } });
    await waitFor(() => expect(api.uploadMyDocument).toHaveBeenCalledWith('e1', 'cv', expect.any(File)));
  });

  it('an accepted file can’t be removed', async () => {
    render(<DocumentsSection employeeId="e1" />);
    await screen.findByText('d2.pdf');
    expect(screen.getAllByRole('button', { name: /Remove/ })).toHaveLength(1); // only the rejected CV
  });
});

describe('DocumentsSection: other documents', () => {
  const openForm = async () => {
    render(<DocumentsSection employeeId="e1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Add a document/ }));
    return screen.getByLabelText('Document type') as HTMLSelectElement;
  };
  const choose = (...names: string[]) =>
    fireEvent.change(screen.getByLabelText('Choose files'), { target: { files: names.map((n) => new File(['x'], n)) } });
  const uploadButton = () => screen.getByRole('button', { name: /^Upload$/ }) as HTMLButtonElement;

  it('offers the types the employee is not asked for, and "Other"; never a required or claim type', async () => {
    const select = await openForm();
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).toContain('Driving licence');
    expect(options).toContain('Other (give it a title)');
    expect(options).not.toContain('Updated CV');
    expect(options).not.toContain('KRA PWD exemption certificate');
  });

  it('picks a type and uploads several files', async () => {
    const select = await openForm();
    fireEvent.change(select, { target: { value: 'driving_licence' } });
    choose('front.jpg', 'back.jpg');
    fireEvent.click(uploadButton());
    await waitFor(() => expect(api.uploadMyDocument).toHaveBeenCalledTimes(2));
    expect(api.uploadMyDocument).toHaveBeenCalledWith('e1', 'driving_licence', expect.any(File), { description: '' });
  });

  it('"Other" needs a title before it uploads', async () => {
    const select = await openForm();
    fireEvent.change(select, { target: { value: 'other' } });
    choose('first-aid.pdf');
    expect(uploadButton().disabled).toBe(true);
    expect(screen.getByText('Give the document a title.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'First Aid certificate' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Red Cross' } });
    expect(uploadButton().disabled).toBe(false);
    fireEvent.click(uploadButton());
    await waitFor(() => expect(api.uploadMyDocument).toHaveBeenCalledWith('e1', 'other', expect.any(File), { title: 'First Aid certificate', description: 'Red Cross' }));
  });

  it('lists what was added, by its title', async () => {
    api.loadDocuments.mockResolvedValue([
      { ...doc('d3', 'other', 'pending'), title: 'First Aid certificate', description: 'Red Cross' },
      { ...doc('d4', 'driving_licence', 'accepted'), type_label: 'Driving licence' },
    ]);
    render(<DocumentsSection employeeId="e1" />);
    expect(await screen.findByText('First Aid certificate')).toBeTruthy();
    expect(screen.getByText('Driving licence')).toBeTruthy();
    expect(screen.getByText('Red Cross')).toBeTruthy();
  });
});

describe('DocumentsSection: the checklist follows the employee’s country', () => {
  it('a Tanzania employee is asked for the TRA TIN and NSSF Tanzania, not a KRA PIN certificate', async () => {
    api.loadChecklist.mockResolvedValue([
      item('id_document', 'Proof of identity', 'core', true, true),
      item('tra_tin_certificate', 'TRA TIN certificate', 'core', true),
      item('tz_nssf_document', 'NSSF Tanzania card or statement', 'core', true),
      item('heslb_document', 'HESLB letter (loan beneficiaries)', 'core', false),
    ]);
    api.loadDocuments.mockResolvedValue([]);
    render(<DocumentsSection employeeId="e1" />);
    expect(await screen.findByText('TRA TIN certificate')).toBeTruthy();
    expect(screen.getByText('NSSF Tanzania card or statement')).toBeTruthy();
    expect(screen.queryByText(/KRA PIN/)).toBeNull();
    expect(screen.queryByText('HESLB letter (loan beneficiaries)')).toBeNull(); // not a loan holder
  });
});

describe('DocumentsReview (HR)', () => {
  it('accepts a file', async () => {
    const onChanged = vi.fn();
    render(<DocumentsReview employeeId="e1" onChanged={onChanged} />);
    await screen.findByText('d1.pdf');
    fireEvent.click(screen.getByRole('button', { name: /Accept/ }));
    await waitFor(() => expect(api.acceptDocument).toHaveBeenCalledWith('d1'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('rejects a file only with a reason', async () => {
    render(<DocumentsReview employeeId="e1" onChanged={vi.fn()} />);
    await screen.findByText('d2.pdf');
    fireEvent.click(screen.getByRole('button', { name: /^Reject$/ }));
    const confirm = screen.getAllByRole('button', { name: 'Reject' }).at(-1) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason for rejecting d2.pdf'), { target: { value: 'Expired ID' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(api.rejectDocument).toHaveBeenCalledWith('d2', 'Expired ID'));
  });

  it('shows what the employee added under "Other documents", to accept or reject', async () => {
    api.loadDocuments.mockResolvedValue([
      doc('d1', 'cv', 'accepted'),
      { ...doc('d3', 'other', 'pending'), title: 'First Aid certificate', description: 'Red Cross' },
    ]);
    render(<DocumentsReview employeeId="e1" onChanged={vi.fn()} />);
    expect(await screen.findByText('Other documents')).toBeTruthy();
    expect(screen.getByText('First Aid certificate')).toBeTruthy();
    expect(screen.getByText('Red Cross')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Accept/ }));
    await waitFor(() => expect(api.acceptDocument).toHaveBeenCalledWith('d3'));
  });

  it('asks this employee for a role-specific document, and shows their referees', async () => {
    render(<DocumentsReview employeeId="e1" onChanged={vi.fn()} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Driving licence' }));
    await waitFor(() => expect(api.setEmployeeRequirement).toHaveBeenCalledWith('e1', 'driving_licence', true));
    expect(screen.getByText('Dr Mary Achieng')).toBeTruthy();
  });
});
