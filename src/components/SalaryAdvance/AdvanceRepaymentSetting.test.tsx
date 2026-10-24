import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('../../lib/salaryAdvanceApi', () => ({
  loadMaxRepaymentMonths: vi.fn(),
  saveMaxRepaymentMonths: vi.fn(),
}));

import * as api from '../../lib/salaryAdvanceApi';
import AdvanceRepaymentSetting from './AdvanceRepaymentSetting';

const mocked = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
  mocked.loadMaxRepaymentMonths.mockResolvedValue(6);
  mocked.saveMaxRepaymentMonths.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('the advance repayment setting', () => {
  it('shows the company’s setting and saves a change', async () => {
    render(<AdvanceRepaymentSetting />);
    const select = screen.getByLabelText(/Repaid within/) as HTMLSelectElement;
    await vi.waitFor(() => expect(select.disabled).toBe(false));
    expect(select.value).toBe('6');
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(select, { target: { value: '1' } });
    fireEvent.click(save);
    await vi.waitFor(() => expect(mocked.saveMaxRepaymentMonths).toHaveBeenCalledWith(1));
  });
});
