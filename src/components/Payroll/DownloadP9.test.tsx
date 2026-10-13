import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ downloadP9Pdf: vi.fn(), toastError: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: mocks.toastError, success: vi.fn() }) }));
vi.mock('../../lib/p9', () => ({ downloadP9Pdf: mocks.downloadP9Pdf }));

import DownloadP9 from './DownloadP9';

const p9 = (paye: number) => ({ year: 2025, employer: { name: '', pin: '' }, employee: { name: '', pin: '', payrollNumber: '', employeeNumber: 'E1' },
  rows: [{ month: 'January', values: [paye] }], totals: [paye] });

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('DownloadP9', () => {
  it('downloads the chosen year', async () => {
    const load = vi.fn().mockResolvedValue(p9(100));
    render(<DownloadP9 load={load} />);
    const lastYear = new Date().getFullYear() - 1;
    fireEvent.change(screen.getByLabelText('P9 year'), { target: { value: String(lastYear) } });
    fireEvent.click(screen.getByRole('button', { name: /Download P9/ }));
    await waitFor(() => expect(mocks.downloadP9Pdf).toHaveBeenCalled());
    expect(load).toHaveBeenCalledWith(lastYear);
  });

  it('says so when the year has no approved payslips', async () => {
    render(<DownloadP9 load={vi.fn().mockResolvedValue(p9(0))} />);
    fireEvent.click(screen.getByRole('button', { name: /Download P9/ }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(expect.stringMatching(/no approved payslips/)));
    expect(mocks.downloadP9Pdf).not.toHaveBeenCalled();
  });
});
