import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const api = vi.hoisted(() => ({
  fetchCareersJobs: vi.fn(),
  fetchCareersJob: vi.fn(),
  uploadCv: vi.fn(),
  applyToJob: vi.fn(),
}));
vi.mock('../lib/careers', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/careers')>()), ...api }));

import CareersPage from './CareersPage';
import { CareersError } from '../lib/careers';

const company = {
  slug: 'acme', name: 'Acme Ltd', tagline: 'We sell', logo_url: 'https://cdn/logo.png', primary_color: '#0F766E', secondary_color: null,
  website: 'https://acme.co.ke', description: 'A good place to work',
};
const job = {
  id: 'j1', title: 'Sales Rep', department: 'Sales', location: 'Nairobi', employment_type: 'Full-time', job_level: null,
  description: 'Sell our products', requirements: 'Two years in sales', responsibilities: null, benefits: null, salary: null,
  closing_date: '2026-11-30', posted_at: '2026-10-01T09:00:00Z',
};

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/careers/:slug" element={<CareersPage />} />
        <Route path="/careers/:slug/jobs/:jobId" element={<CareersPage />} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.fetchCareersJobs.mockResolvedValue({ company, jobs: [job] });
  api.fetchCareersJob.mockResolvedValue({ company, job, form_token: '1760000000000.sig' });
});
afterEach(cleanup);

describe('hosted careers page', () => {
  it("lists the company's open jobs in its brand, without sign-in", async () => {
    at('/careers/ACME');
    expect(await screen.findByRole('heading', { name: 'Careers at Acme Ltd' })).toBeTruthy();
    expect(api.fetchCareersJobs).toHaveBeenCalledWith('acme');
    expect(screen.getByText('1 open position')).toBeTruthy();
    const link = screen.getByRole('link', { name: /Sales Rep/ });
    expect(link.getAttribute('href')).toBe('/careers/acme/jobs/j1');
    expect(screen.getByText('Sales · Full-time')).toBeTruthy();
    expect(screen.getByText('We sell')).toBeTruthy();
  });

  it('says when there are no open jobs, and when the page does not exist', async () => {
    api.fetchCareersJobs.mockResolvedValueOnce({ company, jobs: [] });
    at('/careers/acme');
    expect(await screen.findByText('No open positions right now')).toBeTruthy();
    cleanup();
    api.fetchCareersJobs.mockRejectedValueOnce(new CareersError('Not found', 404));
    at('/careers/nobody');
    expect(await screen.findByText('This careers page does not exist.')).toBeTruthy();
  });

  it('shows a job and sends an application with the CV, the form token and the empty hidden field', async () => {
    api.uploadCv.mockResolvedValue('careers/t/cv.pdf');
    api.applyToJob.mockResolvedValue({ ok: true, message: 'Thank you for applying.' });
    at('/careers/acme/jobs/j1');
    expect(await screen.findByRole('heading', { name: 'Sales Rep' })).toBeTruthy();
    expect(screen.getByText('Two years in sales')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Doe' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jane@mail.com' } });
    fireEvent.change(screen.getByLabelText('Cover note'), { target: { value: 'Hello' } });
    const cv = new File(['%PDF-1.7'], 'jane.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(/^CV/), { target: { files: [cv] } });
    fireEvent.click(screen.getByRole('button', { name: 'Send application' }));

    expect(await screen.findByText('Thank you for applying.')).toBeTruthy();
    expect(api.uploadCv).toHaveBeenCalledWith('acme', 'j1', cv);
    expect(api.applyToJob).toHaveBeenCalledWith('acme', 'j1', expect.objectContaining({
      first_name: 'Jane', last_name: 'Doe', email: 'jane@mail.com', cover_note: 'Hello', cv_path: 'careers/t/cv.pdf', cv_name: 'jane.pdf',
      form_token: '1760000000000.sig', website: '',
    }));
  });

  it('refuses a CV of the wrong type or size before uploading', async () => {
    at('/careers/acme/jobs/j1');
    await screen.findByRole('heading', { name: 'Sales Rep' });
    fireEvent.click(screen.getByRole('button', { name: 'Send application' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Please attach your CV');

    fireEvent.change(screen.getByLabelText(/^CV/), { target: { files: [new File(['x'], 'cv.exe')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Send application' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/PDF, DOC or DOCX/));

    const big = new File(['x'], 'cv.pdf');
    Object.defineProperty(big, 'size', { value: 5 * 1024 * 1024 + 1 });
    fireEvent.change(screen.getByLabelText(/^CV/), { target: { files: [big] } });
    fireEvent.click(screen.getByRole('button', { name: 'Send application' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/5 MB/));
    expect(api.uploadCv).not.toHaveBeenCalled();
  });

  it('a closed job says so', async () => {
    api.fetchCareersJob.mockRejectedValueOnce(new CareersError('This job is not open for applications', 404));
    at('/careers/acme/jobs/gone');
    expect(await screen.findByText('This job is no longer open.')).toBeTruthy();
    expect(screen.getByRole('link', { name: /All jobs/ }).getAttribute('href')).toBe('/careers/acme');
  });
});
