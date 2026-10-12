import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  loadPolicyChecklist: vi.fn(),
  acceptPolicy: vi.fn(),
  loadPoliciesForAdmin: vi.fn(),
  createPolicy: vi.fn(),
  publishPolicyVersion: vi.fn(),
  updatePolicy: vi.fn(),
  openPolicyFile: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../lib/companyPolicies', async (importOriginal) => ({ ...(await importOriginal<object>()), ...api }));

import AgreementsSection from './AgreementsSection';
import AgreementsReview from './AgreementsReview';
import PoliciesModal from './PoliciesModal';

const policy = (title: string, accepted_at: string | null, required = true, body: string | null = 'Be honest.') => ({
  policy_id: `p-${title}`, title, required, version_id: `v-${title}`, version: 2, body, file_path: null, file_name: null, published_at: '', accepted_at,
});

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.acceptPolicy.mockResolvedValue(undefined);
  api.createPolicy.mockResolvedValue(undefined);
  api.publishPolicyVersion.mockResolvedValue(undefined);
  api.updatePolicy.mockResolvedValue(undefined);
});
afterEach(() => cleanup());

describe('AgreementsSection (employee)', () => {
  it('each policy has its own checkbox; ticking it accepts that version', async () => {
    api.loadPolicyChecklist
      .mockResolvedValueOnce([policy('Code of conduct', null), policy('Gym membership', null, false)])
      .mockResolvedValue([policy('Code of conduct', '2026-10-12T10:00:00Z'), policy('Gym membership', null, false)]);
    const onChanged = vi.fn();
    render(<AgreementsSection onChanged={onChanged} />);
    const boxes = await screen.findAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    fireEvent.click(boxes[0]);
    await waitFor(() => expect(api.acceptPolicy).toHaveBeenCalledWith('v-Code of conduct'));
    expect(await screen.findByText(/Signed/)).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
  });

  it('an accepted policy stays ticked and can’t be unticked', async () => {
    api.loadPolicyChecklist.mockResolvedValue([policy('Code of conduct', '2026-10-12T10:00:00Z')]);
    render(<AgreementsSection />);
    const box = (await screen.findByRole('checkbox')) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(true);
  });

  it('shows the wording on request', async () => {
    api.loadPolicyChecklist.mockResolvedValue([policy('Code of conduct', null)]);
    render(<AgreementsSection />);
    fireEvent.click(await screen.findByRole('button', { name: /Read/ }));
    expect(screen.getByText('Be honest.')).toBeTruthy();
  });
});

describe('AgreementsReview (HR)', () => {
  it('shows what the employee accepted and when, and what they have not', async () => {
    api.loadPolicyChecklist.mockResolvedValue([policy('Code of conduct', '2026-10-12T10:00:00Z'), policy('Data protection', null)]);
    render(<AgreementsReview employeeId="e1" />);
    expect(await screen.findByText(/Accepted/)).toBeTruthy();
    expect(screen.getByText('Not accepted')).toBeTruthy();
    expect(api.loadPolicyChecklist).toHaveBeenCalledWith('e1');
  });
});

describe('PoliciesModal (HR)', () => {
  it('adds a required policy with its wording', async () => {
    api.loadPoliciesForAdmin.mockResolvedValue([]);
    render(<PoliciesModal onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Add a policy/ }));
    fireEvent.change(screen.getByPlaceholderText('Code of conduct'), { target: { value: 'Code of conduct' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Wording/ }), { target: { value: 'Be honest.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(api.createPolicy).toHaveBeenCalledWith('Code of conduct', true, 'Be honest.', null));
  });

  it('publishes a new version of an existing policy', async () => {
    api.loadPoliciesForAdmin.mockResolvedValue([{ id: 'p1', title: 'Code of conduct', required: true, active: true, version: 1, body: 'Be honest.', file_name: null, published_at: '', accepted: 3 }]);
    render(<PoliciesModal onClose={vi.fn()} />);
    expect(await screen.findByText(/accepted by 3/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New version' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Wording/ }), { target: { value: 'Be honest and kind.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(api.publishPolicyVersion).toHaveBeenCalledWith('p1', 'Be honest and kind.', null));
  });
});
