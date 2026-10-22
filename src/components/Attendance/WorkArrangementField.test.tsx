import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import WorkArrangementField from './WorkArrangementField';

afterEach(cleanup);

describe('WorkArrangementField', () => {
  it('defaults to On-site and explains it', () => {
    render(<WorkArrangementField arrangement={null} remoteDays={null} onChange={vi.fn()} />);
    expect((screen.getByLabelText('Work arrangement') as HTMLSelectElement).value).toBe('on_site');
    expect(screen.getByText("Follows the company's clock-in policy.")).toBeTruthy();
  });

  it('choosing Field clears remote days; Hybrid starts on Friday and toggles days', () => {
    const onChange = vi.fn();
    const { rerender } = render(<WorkArrangementField arrangement="on_site" remoteDays={[]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Work arrangement'), { target: { value: 'field' } });
    expect(onChange).toHaveBeenLastCalledWith('field', []);
    fireEvent.change(screen.getByLabelText('Work arrangement'), { target: { value: 'hybrid' } });
    expect(onChange).toHaveBeenLastCalledWith('hybrid', [5]);
    rerender(<WorkArrangementField arrangement="hybrid" remoteDays={[5]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mon' }));
    expect(onChange).toHaveBeenLastCalledWith('hybrid', [1, 5]);
    fireEvent.click(screen.getByRole('button', { name: 'Fri' }));
    expect(onChange).toHaveBeenLastCalledWith('hybrid', []);
  });

  it('hybrid with no remote days says so; read-only when not editing', () => {
    render(<WorkArrangementField arrangement="hybrid" remoteDays={[]} onChange={vi.fn()} disabled />);
    expect(screen.getByRole('alert').textContent).toBe('Choose at least one remote day');
    expect((screen.getByLabelText('Work arrangement') as HTMLSelectElement).disabled).toBe(true);
  });
});
