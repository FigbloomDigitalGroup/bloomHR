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
  it('lists the documents by section, required or optional, and hides claim documents nobody claims', async () => {
    render(<DocumentsSection employeeId="e1" />);
    expect(await screen.findByText('Core attachments')).toBeTruthy();
    expect(screen.getByText('Driving licence')).toBeTruthy();
    expect(screen.getAllByText('(optional)')).toHaveLength(1);
    expect(screen.queryByText('KRA PWD exemption certificate')).toBeNull();
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

  it('asks this employee for a role-specific document, and shows their referees', async () => {
    render(<DocumentsReview employeeId="e1" onChanged={vi.fn()} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Driving licence' }));
    await waitFor(() => expect(api.setEmployeeRequirement).toHaveBeenCalledWith('e1', 'driving_licence', true));
    expect(screen.getByText('Dr Mary Achieng')).toBeTruthy();
  });
});
