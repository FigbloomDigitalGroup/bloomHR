import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const api = vi.hoisted(() => ({
  loadCareersSettings: vi.fn(),
  saveCareersSettings: vi.fn(),
  loadCareersPostings: vi.fn(),
  setPostingPublic: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/careers', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../lib/careers')>()), ...api }));

import CareersSettingsCard from './CareersSettings';

const future = '2999-01-01';
beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.loadCareersSettings.mockResolvedValue({ slug: 'acme', allowed_origins: ['https://www.acme.co.ke'], show_salary: false });
  api.loadCareersPostings.mockResolvedValue([
    { id: 'p1', job_title: 'Sales Rep', department: 'Sales', status: 'open', is_public: true, application_deadline: future },
    { id: 'p2', job_title: 'Driver', department: null, status: 'open', is_public: false, application_deadline: null },
    { id: 'p3', job_title: 'Clerk', department: null, status: 'closed', is_public: true, application_deadline: null },
  ]);
});
afterEach(cleanup);

describe('Careers page settings card', () => {
  it('shows the public page, API addresses with an example, and the embed snippets', async () => {
    render(<CareersSettingsCard />);
    expect(await screen.findByText('1 job on the careers page')).toBeTruthy();
    const origin = window.location.origin;
    expect(screen.getByRole('link', { name: new RegExp(`${origin}/careers/acme`) })).toBeTruthy();
    expect(screen.getByText(`GET http://localhost:3001/api/careers/acme/jobs`)).toBeTruthy();
    expect(screen.getByText(/fetch\('http:\/\/localhost:3001\/api\/careers\/acme\/jobs'\)/)).toBeTruthy();
    expect(screen.getByText(new RegExp(`data-figbloom-careers="acme"[\\s\\S]*${origin}/careers-embed.js`))).toBeTruthy();
    expect(screen.getByText(new RegExp(`<iframe id="figbloom-careers" src="${origin}/careers/acme\\?embed=1"`))).toBeTruthy();
    expect(screen.getByText(/not listed: closed/)).toBeTruthy();
  });

  it('saves the address, allowed websites and salary setting', async () => {
    api.saveCareersSettings.mockResolvedValue({ slug: 'acme-jobs', allowed_origins: ['https://www.acme.co.ke', 'https://jobs.acme.co.ke'], show_salary: true });
    render(<CareersSettingsCard />);
    const slug = await screen.findByLabelText('Careers address');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(slug, { target: { value: 'acme-jobs' } });
    fireEvent.change(screen.getByLabelText('Allowed websites'), { target: { value: 'https://www.acme.co.ke\n https://jobs.acme.co.ke \n' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /salary range/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.saveCareersSettings).toHaveBeenCalledWith({
        slug: 'acme-jobs', allowed_origins: ['https://www.acme.co.ke', 'https://jobs.acme.co.ke'], show_salary: true,
      })
    );
    expect(await screen.findByRole('link', { name: /\/careers\/acme-jobs/ })).toBeTruthy();
  });

  it('turns "Show on careers page" on for a posting', async () => {
    api.setPostingPublic.mockResolvedValue(undefined);
    render(<CareersSettingsCard />);
    const toggle = await screen.findByRole('switch', { name: 'Show Driver on careers page' });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(toggle);
    await waitFor(() => expect(api.setPostingPublic).toHaveBeenCalledWith('p2', true));
    await waitFor(() => expect((screen.getByRole('switch', { name: 'Show Driver on careers page' }) as HTMLInputElement).checked).toBe(true));
    expect(within(screen.getByRole('status')).getByText('2 jobs on the careers page')).toBeTruthy();
  });
});
