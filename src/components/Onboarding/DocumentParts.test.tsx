import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// Files settings (20261022000000): named slots that follow the ID type, labelled many-file rows, extra pages, HR's
// grouping, and the company's files settings and own document types.

const api = vi.hoisted(() => ({
  loadChecklist: vi.fn(),
  loadDocuments: vi.fn(),
  uploadMyDocument: vi.fn(),
  deleteMyDocument: vi.fn(),
  loadEmployeeRequirements: vi.fn(),
  loadReferees: vi.fn(),
  acceptDocument: vi.fn(),
  acceptDocumentAsComplete: vi.fn(),
  rejectDocument: vi.fn(),
  setEmployeeRequirement: vi.fn(),
  openDocument: vi.fn(),
  loadCompanyDocumentSettings: vi.fn(),
  setCompanyDocumentRequired: vi.fn(),
  setDocumentFilesSetting: vi.fn(),
  saveCompanyDocumentType: vi.fn(),
  removeCompanyDocumentType: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/confirmDialog', () => ({ confirmDialog: () => Promise.resolve(true) }));
vi.mock('../../lib/employeeDocuments', async (importOriginal) => ({ ...(await importOriginal<object>()), ...api }));

import DocumentsSection from './DocumentsSection';
import DocumentsReview from './DocumentsReview';
import RequiredDocumentsModal from './RequiredDocumentsModal';

const ID_SLOTS = { 'National ID': ['Front', 'Back'], 'Passport Number': ['Bio page'], '*': ['Front', 'Back'] };
const idItem = { code: 'id_document', label: 'Proof of identity', section: 'core', description: null, allows_many: true, required: true, sort: 10,
  file_mode: 'slots', slots: ['Front', 'Back'], slots_def: ID_SLOTS };
const many = (code: string, label: string) => ({ code, label, section: 'qualifications', description: null, allows_many: true, required: true, sort: 120, file_mode: 'many' });
const single = (code: string, label: string) => ({ code, label, section: 'core', description: null, allows_many: false, required: true, sort: 30, file_mode: 'single' });
const doc = (id: string, code: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, employee_id: 'e1', code, file_path: `t/u/${id}.pdf`, file_name: `${id}.pdf`, content_type: null, size_bytes: 1, status, review_note: null,
  reviewed_at: null, uploaded_at: '', ...extra,
});
const choose = (label: string, ...names: string[]) =>
  fireEvent.change(screen.getByLabelText(label), { target: { files: names.map((n) => new File(['x'], n)) } });

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.loadChecklist.mockResolvedValue([idItem, many('academic_certificate', 'Academic certificates'), many('dependants_documents', 'Dependants’ documents'),
    single('kra_pin_certificate', 'KRA PIN certificate')]);
  api.loadDocuments.mockResolvedValue([]);
  api.uploadMyDocument.mockResolvedValue(undefined);
  api.deleteMyDocument.mockResolvedValue(undefined);
  api.loadEmployeeRequirements.mockResolvedValue([]);
  api.loadReferees.mockResolvedValue([]);
  api.acceptDocumentAsComplete.mockResolvedValue(undefined);
});
afterEach(() => cleanup());

describe('named slots: the ID', () => {
  it('Front and Back for a national ID, the Bio page once they choose a passport', async () => {
    const { rerender } = render(<DocumentsSection employeeId="e1" identityType="National ID" />);
    expect(await screen.findByLabelText('Upload Proof of identity Front')).toBeTruthy();
    expect(screen.getByLabelText('Upload Proof of identity Back')).toBeTruthy();
    expect(screen.getByText('Both sides needed')).toBeTruthy();
    rerender(<DocumentsSection employeeId="e1" identityType="Passport Number" />);
    expect(screen.getByLabelText('Upload Proof of identity Bio page')).toBeTruthy();
    expect(screen.queryByLabelText('Upload Proof of identity Back')).toBeNull();
  });

  it('each side is uploaded into its own slot', async () => {
    render(<DocumentsSection employeeId="e1" identityType="National ID" />);
    await screen.findByLabelText('Upload Proof of identity Back');
    choose('Upload Proof of identity Back', 'back.jpg');
    await waitFor(() => expect(api.uploadMyDocument).toHaveBeenCalledWith('e1', 'id_document', expect.any(File), { part: 'Back' }));
  });

  it('an older single ID file is the Front, and the Back is still needed', async () => {
    api.loadDocuments.mockResolvedValue([doc('old', 'id_document', 'pending')]);
    render(<DocumentsSection employeeId="e1" identityType="National ID" />);
    const front = await screen.findByTestId('slot-Front');
    expect(within(front).getByText('old.pdf')).toBeTruthy();
    expect(within(screen.getByTestId('slot-Back')).getByText('Back needed')).toBeTruthy();
    expect(screen.getByText(/Both sides needed \(Back missing\)/)).toBeTruthy();
  });

  it('no hint once both sides are in', async () => {
    api.loadDocuments.mockResolvedValue([doc('f', 'id_document', 'pending', { part: 'Front' }), doc('b', 'id_document', 'accepted', { part: 'Back' })]);
    render(<DocumentsSection employeeId="e1" identityType="National ID" />);
    await screen.findByText('b.pdf');
    expect(screen.queryByText(/Both sides needed/)).toBeNull();
    expect(within(screen.getByTestId('slot-Front')).getByLabelText('Replace Proof of identity Front')).toBeTruthy();
  });
});

describe('many files, each with a label', () => {
  it('several files at once, each labelled', async () => {
    render(<DocumentsSection employeeId="e1" />);
    await screen.findByText('Academic certificates');
    choose('Add files to Academic certificates', 'kcse.pdf', 'bcom.pdf');
    fireEvent.change(screen.getByLabelText('Label for kcse.pdf'), { target: { value: 'KCSE certificate' } });
    fireEvent.change(screen.getByLabelText('Label for bcom.pdf'), { target: { value: 'BSc Commerce' } });
    fireEvent.click(screen.getByRole('button', { name: /Upload files/ }));
    await waitFor(() => expect(api.uploadMyDocument).toHaveBeenCalledTimes(2));
    expect(api.uploadMyDocument).toHaveBeenCalledWith('e1', 'academic_certificate', expect.any(File), { label: 'KCSE certificate' });
    expect(api.uploadMyDocument).toHaveBeenCalledWith('e1', 'academic_certificate', expect.any(File), { label: 'BSc Commerce' });
  });

  it('dependants’ documents ask whose each one is before uploading', async () => {
    render(<DocumentsSection employeeId="e1" />);
    await screen.findByText('Dependants’ documents');
    choose('Add files to Dependants’ documents', 'birth.pdf');
    expect(screen.getByText('Whose document? (name and relationship)')).toBeTruthy();
    const button = screen.getByRole('button', { name: /Upload files/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Label for birth.pdf'), { target: { value: 'Zawadi, daughter' } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(api.uploadMyDocument).toHaveBeenCalledWith('e1', 'dependants_documents', expect.any(File), { label: 'Zawadi, daughter' }));
  });

  it('lists the files with their labels', async () => {
    api.loadDocuments.mockResolvedValue([doc('c1', 'academic_certificate', 'accepted', { label: 'BSc Commerce' })]);
    render(<DocumentsSection employeeId="e1" />);
    expect(await screen.findByText('BSc Commerce')).toBeTruthy();
    expect(screen.getByLabelText('Add files to Academic certificates')).toBeTruthy();
  });
});

describe('one file, with extra pages', () => {
  it('"Add a page" once page 1 is in; pages are numbered', async () => {
    api.loadDocuments.mockResolvedValue([doc('p1', 'kra_pin_certificate', 'pending'), doc('p2', 'kra_pin_certificate', 'pending', { part: 'Page 2' })]);
    render(<DocumentsSection employeeId="e1" />);
    await screen.findByText('p2.pdf');
    expect(screen.queryByLabelText('Upload KRA PIN certificate')).toBeNull();
    expect(screen.getByText('Page 1')).toBeTruthy();
    expect(screen.getByText('Page 2')).toBeTruthy();
    choose('Add a page to KRA PIN certificate', 'page3.jpg');
    await waitFor(() => expect(api.uploadMyDocument).toHaveBeenCalledWith('e1', 'kra_pin_certificate', expect.any(File), { part: 'Page 3' }));
  });
});

describe('HR review', () => {
  it('groups the ID by side, says the Back is missing, and can accept one file as complete', async () => {
    api.loadDocuments.mockResolvedValue([doc('f', 'id_document', 'pending', { part: 'Front' }), doc('c1', 'academic_certificate', 'pending', { label: 'BSc Commerce' })]);
    render(<DocumentsReview employeeId="e1" onChanged={vi.fn()} />);
    const id = await screen.findByTestId('review-id_document');
    expect(within(id).getByText('Front')).toBeTruthy();
    expect(within(id).getByText('Back missing')).toBeTruthy();
    expect(within(screen.getByTestId('review-academic_certificate')).getByText('BSc Commerce')).toBeTruthy();
    fireEvent.click(within(id).getByRole('button', { name: /Accept as complete/ }));
    await waitFor(() => expect(api.acceptDocumentAsComplete).toHaveBeenCalledWith('f'));
  });

  it('nothing missing once both sides are in', async () => {
    api.loadDocuments.mockResolvedValue([doc('f', 'id_document', 'accepted', { part: 'Front' }), doc('b', 'id_document', 'pending', { part: 'Back' })]);
    render(<DocumentsReview employeeId="e1" onChanged={vi.fn()} />);
    const id = await screen.findByTestId('review-id_document');
    expect(within(id).queryByText(/missing/)).toBeNull();
    expect(within(id).queryByRole('button', { name: /Accept as complete/ })).toBeNull();
  });
});

describe('Required documents settings', () => {
  beforeEach(() => {
    api.loadCompanyDocumentSettings.mockResolvedValue([
      { code: 'id_document', label: 'Proof of identity', section: 'core', required_by_default: true, countries: null, required: null,
        default_file_mode: 'slots', default_slots: ID_SLOTS, file_mode: null, slots: null },
      { code: 'professional_certificate', label: 'Professional certificates', section: 'qualifications', required_by_default: false, countries: null,
        required: null, default_file_mode: 'many', default_slots: null, file_mode: null, slots: null },
    ]);
    api.setDocumentFilesSetting.mockResolvedValue(undefined);
    api.saveCompanyDocumentType.mockResolvedValue('co_1');
  });

  it('a type becomes named slots of the company’s own', async () => {
    render(<RequiredDocumentsModal onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('Files for Professional certificates'), { target: { value: 'slots' } });
    expect(api.setDocumentFilesSetting).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Slots for Professional certificates'), { target: { value: 'Certificate, Practising licence' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save slots for Professional certificates' }));
    await waitFor(() => expect(api.setDocumentFilesSetting).toHaveBeenCalledWith('professional_certificate', 'slots', ['Certificate', 'Practising licence']));
  });

  it('the ID can be one file', async () => {
    render(<RequiredDocumentsModal onClose={vi.fn()} />);
    expect(await screen.findByText(/Default: Front, Back \(passport: Bio page\)/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Files for Proof of identity'), { target: { value: 'single' } });
    await waitFor(() => expect(api.setDocumentFilesSetting).toHaveBeenCalledWith('id_document', 'single', undefined));
  });

  it('adds the company’s own document type', async () => {
    render(<RequiredDocumentsModal onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Add a document type/ }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Firearm licence' } });
    fireEvent.change(screen.getByLabelText('Section'), { target: { value: 'role' } });
    fireEvent.change(screen.getByLabelText('How many files'), { target: { value: 'slots' } });
    const save = screen.getByRole('button', { name: 'Save document type' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true); // slots need names
    fireEvent.change(screen.getByLabelText('Slot names'), { target: { value: 'Licence, Training certificate' } });
    fireEvent.click(screen.getByLabelText('Kenya'));
    fireEvent.click(save);
    await waitFor(() => expect(api.saveCompanyDocumentType).toHaveBeenCalledWith({
      label: 'Firearm licence', description: '', section: 'role', countries: ['Kenya'], required: true, file_mode: 'slots',
      slots: ['Licence', 'Training certificate'],
    }));
  });
});
