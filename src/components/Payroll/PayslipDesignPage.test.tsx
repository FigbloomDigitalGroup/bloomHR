import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// FIG-814: the Payslip design page: everyone sees it, only payslip-design changes it, the preview follows the form
// (a real recent payslip, or a sample), hidden sections disappear from the preview, and saving saves the design.

const h = vi.hoisted(() => ({
  modules: ['payslip-design'] as string[],
  recent: null as Record<string, unknown> | null,
  save: vi.fn(),
  saveBranch: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('html2pdf.js', () => ({ default: () => ({}) }));
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ loading: false, hasPermission: (m: string) => h.modules.includes(m) }),
}));
vi.mock('../../lib/supabase', () => {
  const chain = (result: () => unknown) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'limit', 'eq', 'lt']) q[m] = () => q;
    q.maybeSingle = () => Promise.resolve(result());
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
    return q;
  };
  return {
    supabase: {
      from: (table: string) =>
        chain(() =>
          table === 'salary_history'
            ? { data: h.recent, error: null }
            : table === 'company_profile'
              ? { data: { company_name: 'Acme Ltd', address_line1: 'Plot 7', city: 'Nairobi' }, error: null }
              : { data: null, error: null },
        ),
      rpc: () => Promise.resolve({ data: [{ employer_kra_pin: 'P051234567X' }], error: null }),
    },
  };
});
vi.mock('../../lib/branches', async (orig) => ({
  ...(await orig<typeof import('../../lib/branches')>()),
  loadBranches: () =>
    Promise.resolve([{ id: 'b1', name: 'Kampala', country: 'Uganda', currency: 'UGX', city: 'Kampala', address: null, active: true, is_default: false }]),
}));
vi.mock('../../lib/companyProfile', async (orig) => ({
  ...(await orig<typeof import('../../lib/companyProfile')>()),
  loadCompanyIdentity: () => Promise.resolve({ company_name: 'Acme Ltd', image_url: null, company_tagline: 'We grow' }),
}));
vi.mock('../../lib/payslipDesign', async (orig) => ({
  ...(await orig<typeof import('../../lib/payslipDesign')>()),
  loadPayslipDesign: () => Promise.resolve((({ ...(globalThis as Record<string, unknown>).__design as object }) as never)),
  loadBranchContacts: () => Promise.resolve([]),
  savePayslipDesign: h.save,
  saveBranchContacts: h.saveBranch,
}));
vi.mock('../../lib/payslipExtras', async (orig) => ({
  ...(await orig<typeof import('../../lib/payslipExtras')>()),
  loadPayslipExtras: () => Promise.resolve({}),
  clearPayslipExtrasCache: vi.fn(),
}));

import PayslipDesignPage from './PayslipDesignPage';
import { DEFAULT_DESIGN } from '../../lib/payslipDesign';

beforeEach(() => {
  h.modules = ['payslip-design'];
  h.recent = null;
  (globalThis as Record<string, unknown>).__design = { ...DEFAULT_DESIGN };
  h.save.mockReset().mockImplementation((d) => Promise.resolve(d));
  h.saveBranch.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

const preview = () => within(screen.getByTestId('payslip-design-preview'));

describe('Payslip design', () => {
  it('previews a sample payslip when there are none yet', async () => {
    render(<PayslipDesignPage />);
    await waitFor(() => expect(preview().getByText(/a sample payslip/)).toBeTruthy());
    expect(preview().getByText('Jane Wanjiku (sample)')).toBeTruthy();
    expect(preview().getByTestId('employer-contributions')).toBeTruthy();
  });

  it('previews a real recent payslip', async () => {
    h.recent = { employee_id: 'E7', employee_name: 'Otieno Real', pay_period: '2026-09', country: 'Kenya', currency: 'KES', gross_pay: 50000, net_pay: 40000 };
    render(<PayslipDesignPage />);
    await waitFor(() => expect(preview().getByText(/Otieno Real’s payslip for 2026-09/)).toBeTruthy());
  });

  it('the preview follows the form: hidden sections disappear, the footer and contacts change', async () => {
    render(<PayslipDesignPage />);
    await waitFor(() => expect(preview().getByTestId('employer-contributions')).toBeTruthy());
    fireEvent.click(screen.getByRole('checkbox', { name: 'Employer contributions' }));
    expect(preview().queryByTestId('employer-contributions')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Payment details' }));
    expect(preview().queryByTestId('payslip-payment')).toBeNull();
    expect(preview().queryByTestId('payslip-statutory-numbers')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'NSSF, SHA and ID numbers' }));
    expect(preview().getByTestId('payslip-statutory-numbers')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/This payslip is confidential/), { target: { value: 'Queries: pay@acme.co' } });
    expect(preview().getByTestId('payslip-footer').textContent).toContain('Queries: pay@acme.co');
    fireEvent.change(screen.getByRole('textbox', { name: 'Phone' }), { target: { value: '+254 711 111111' } });
    expect(within(preview().getByTestId('payslip-employer')).getByText(/\+254 711 111111/)).toBeTruthy();
    // the company profile address and the employer KRA PIN by default
    expect(within(preview().getByTestId('payslip-employer')).getByText('Plot 7, Nairobi')).toBeTruthy();
    expect(within(preview().getByTestId('payslip-employer')).getByText('KRA PIN: P051234567X')).toBeTruthy();
  });

  it('saves the design', async () => {
    render(<PayslipDesignPage />);
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Year to date' })).toBeTruthy());
    fireEvent.click(screen.getByRole('checkbox', { name: 'Year to date' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save design' }));
    await waitFor(() => expect(h.save).toHaveBeenCalledWith(expect.objectContaining({ show_ytd: false })));
  });

  it("a branch's own contacts", async () => {
    render(<PayslipDesignPage />);
    const row = await screen.findByTestId('branch-contacts-Kampala');
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    fireEvent.change(within(row).getByLabelText('Kampala address'), { target: { value: 'Plot 1, Kampala Road' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.saveBranch).toHaveBeenCalledWith({ branch_id: 'b1', address: 'Plot 1, Kampala Road', phone: null, email: null, website: null }));
  });

  it('without payslip-design: read only', async () => {
    h.modules = ['payroll'];
    render(<PayslipDesignPage />);
    await waitFor(() => expect(screen.getByText(/changing it needs the Payslip design module/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Save design' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Year to date' }).matches(':disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });
});
