import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const state = vi.hoisted(() => ({ perms: ['settings'] as string[] }));
const saveCompanyProfile = vi.hoisted(() => vi.fn());
const uploadCompanyLogo = vi.hoisted(() => vi.fn());
const uploadLetterheadImage = vi.hoisted(() => vi.fn());
const saveEmployerPin = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ loading: false, hasPermission: (p: string) => state.perms.includes(p) }),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
// the work week card has its own data and tests (WorkWeek.test.tsx)
vi.mock('./WorkWeek', () => ({ default: () => null }));
vi.mock('./CompanyEmailSettings', () => ({ default: () => null }));
vi.mock('./CompanyMailServer', () => ({ default: () => null }));
vi.mock('../Dashboard/GetStarted', () => ({ COMPANY_PROFILE_SAVED: 'profile-saved' }));
vi.mock('../../lib/p9', () => ({ saveEmployerPin }));
vi.mock('../../lib/companyProfile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/companyProfile')>()),
  loadCompanyProfile: () => Promise.resolve({ ...PROFILE }),
  loadCompanyAdmin: () => Promise.resolve({ full_name: 'Ada Admin', email: 'ada@acme.co' }),
  loadEmployerPinForProfile: () => Promise.resolve('P051234567X'),
  saveCompanyProfile,
  uploadCompanyLogo,
  uploadLetterheadImage,
}));

import CompanyProfilePage from './CompanyProfile';

const PROFILE = vi.hoisted(() => ({
  tenant_id: 't1', company_name: 'Acme Ltd', tagline: null, logo_url: null, primary_color: null, secondary_color: null,
  description: null, registration_no: null, business_type: null, industry: null, country: 'Kenya', base_currency: 'KES',
  official_phone: null, official_email: null, website: null, address_line1: null, address_line2: null, city: null,
  postal_code: null, fiscal_year_start_month: 1, week_start_day: 'monday', letterhead_header_url: null as string | null,
  letterhead_footer_url: null as string | null,
}));

const renderPage = () => render(<MemoryRouter><CompanyProfilePage /></MemoryRouter>);

beforeEach(() => {
  state.perms = ['settings'];
  saveCompanyProfile.mockReset();
  uploadCompanyLogo.mockReset();
  uploadLetterheadImage.mockReset();
  PROFILE.letterhead_header_url = null;
  PROFILE.letterhead_footer_url = null;
  saveEmployerPin.mockReset();
});
afterEach(() => cleanup());

describe('Company profile page', () => {
  it('loads the profile in its sections, with the creator as admin', async () => {
    renderPage();
    expect(((await screen.findByLabelText('Company name')) as HTMLInputElement).value).toBe('Acme Ltd');
    for (const h of ['Brand identity', 'Business details', 'Contact information', 'Physical address', 'Fiscal & calendar']) {
      expect(screen.getByRole('heading', { name: h })).toBeTruthy();
    }
    expect((screen.getByLabelText('Admin email') as HTMLInputElement).value).toBe('ada@acme.co');
    expect((screen.getByLabelText(/Employer KRA PIN/) as HTMLInputElement).value).toBe('P051234567X');
    // payroll keeps the PIN; without Payroll it is read-only here
    expect((screen.getByLabelText(/Employer KRA PIN/) as HTMLInputElement).disabled).toBe(true);
  });

  it('says what is wrong and will not save it', async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText('Official email'), { target: { value: 'not-an-email' } });
    fireEvent.change(screen.getByLabelText('Official phone'), { target: { value: 'call me' } });
    fireEvent.change(screen.getByLabelText(/^Website/), { target: { value: 'nope' } });
    fireEvent.change(screen.getByLabelText('Primary colour hex'), { target: { value: '#12' } });
    expect(screen.getByText(/Enter an email like/)).toBeTruthy();
    expect(screen.getByText(/Enter a phone number like/)).toBeTruthy();
    expect(screen.getByText(/Enter a website like/)).toBeTruthy();
    expect(screen.getByText(/Use a colour like #17402A/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('picks a colour and resets it to the default', async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText('Primary colour picker'), { target: { value: '#0f766e' } });
    expect((screen.getByLabelText('Primary colour hex') as HTMLInputElement).value).toBe('#0F766E');
    fireEvent.click(screen.getAllByRole('button', { name: 'Reset to default' })[0]);
    expect((screen.getByLabelText('Primary colour hex') as HTMLInputElement).value).toBe('#17402A');
  });

  it('saves the changes, adding https:// to the website', async () => {
    saveCompanyProfile.mockImplementation((f) => Promise.resolve({ tenant_id: 't1', ...f }));
    renderPage();
    fireEvent.change(await screen.findByLabelText('Company name'), { target: { value: 'Acme Kenya Ltd' } });
    fireEvent.change(screen.getByLabelText(/^Website/), { target: { value: 'acme.co.ke' } });
    fireEvent.change(screen.getByLabelText('Industry'), { target: { value: 'ict' } });
    fireEvent.change(screen.getByLabelText('Fiscal year starts in'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveCompanyProfile).toHaveBeenCalledTimes(1));
    expect(saveCompanyProfile.mock.calls[0][0]).toMatchObject({
      company_name: 'Acme Kenya Ltd', website: 'acme.co.ke', industry: 'ict', fiscal_year_start_month: 7,
    });
    expect(saveEmployerPin).not.toHaveBeenCalled();
  });

  it('uploads a new logo with a preview, and saves its URL', async () => {
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview');
    globalThis.URL.revokeObjectURL = vi.fn();
    uploadCompanyLogo.mockResolvedValue('https://cdn/logo.png');
    saveCompanyProfile.mockImplementation((f) => Promise.resolve({ tenant_id: 't1', ...f }));
    renderPage();
    const file = new File(['x'], 'logo.png', { type: 'image/png' });
    fireEvent.change(await screen.findByLabelText('Logo file'), { target: { files: [file] } });
    expect((screen.getByAltText('Company logo preview') as HTMLImageElement).src).toBe('blob:preview');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveCompanyProfile).toHaveBeenCalledWith(expect.objectContaining({ logo_url: 'https://cdn/logo.png' })));
  });

  it('turns away a logo that is not an image', async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText('Logo file'), { target: { files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] } });
    expect(screen.getByText(/Use a PNG, JPG, SVG or WebP image/)).toBeTruthy();
  });

  it('uploads an offer letter header and footer with previews, and saves their URLs', async () => {
    let n = 0;
    globalThis.URL.createObjectURL = vi.fn(() => `blob:preview-${++n}`);
    globalThis.URL.revokeObjectURL = vi.fn();
    uploadLetterheadImage.mockImplementation((f: File) => Promise.resolve(`https://cdn/${f.name}`));
    saveCompanyProfile.mockImplementation((f) => Promise.resolve({ tenant_id: 't1', ...f }));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Offer letter letterhead' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Header file'), { target: { files: [new File(['x'], 'header.png', { type: 'image/png' })] } });
    fireEvent.change(screen.getByLabelText('Footer file'), { target: { files: [new File(['x'], 'footer.jpg', { type: 'image/jpeg' })] } });
    expect((screen.getByAltText('Header preview') as HTMLImageElement).src).toBe('blob:preview-1');
    expect((screen.getByAltText('Footer preview') as HTMLImageElement).src).toBe('blob:preview-2');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveCompanyProfile).toHaveBeenCalledWith(expect.objectContaining({
      letterhead_header_url: 'https://cdn/header.png', letterhead_footer_url: 'https://cdn/footer.jpg',
    })));
  });

  it('removes a saved letterhead image, and turns away one that is not a PNG or JPG or is too big', async () => {
    PROFILE.letterhead_header_url = 'https://cdn/old-header.png';
    PROFILE.letterhead_footer_url = 'https://cdn/old-footer.png';
    saveCompanyProfile.mockImplementation((f) => Promise.resolve({ tenant_id: 't1', ...f }));
    renderPage();
    expect((await screen.findByAltText('Header preview') as HTMLImageElement).src).toBe('https://cdn/old-header.png');
    fireEvent.change(screen.getByLabelText('Header file'), { target: { files: [new File(['x'], 'h.svg', { type: 'image/svg+xml' })] } });
    expect(screen.getByText('Use a PNG or JPG image')).toBeTruthy();
    const big = new File(['x'], 'f.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 3 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText('Footer file'), { target: { files: [big] } });
    expect(screen.getByText('Use an image of 2 MB or less')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove header' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove footer' }));
    expect(screen.queryByAltText('Header preview')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveCompanyProfile).toHaveBeenCalledWith(expect.objectContaining({
      letterhead_header_url: null, letterhead_footer_url: null,
    })));
    expect(uploadLetterheadImage).not.toHaveBeenCalled();
  });

  it('with Payroll, the KRA PIN is changed through payroll’s settings', async () => {
    state.perms = ['settings', 'payroll'];
    saveEmployerPin.mockResolvedValue('P000000001Z');
    saveCompanyProfile.mockImplementation((f) => Promise.resolve({ tenant_id: 't1', ...f }));
    renderPage();
    fireEvent.change(await screen.findByLabelText(/Employer KRA PIN/), { target: { value: 'p000000001z' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(saveEmployerPin).toHaveBeenCalledWith('P000000001Z'));
  });

  it('is read-only for people without Settings', async () => {
    state.perms = [];
    renderPage();
    expect(((await screen.findByLabelText('Company name')) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Upload logo/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Upload header/ })).toBeNull();
  });
});
