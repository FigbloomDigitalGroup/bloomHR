import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const ai = vi.hoisted(() => ({ ask: vi.fn() }));
vi.mock('../../services/ai', () => ({ askTaxTreatment: ai.ask }));

import TaxTreatmentHint from './TaxTreatmentHint';
import { TAX_DISCLAIMER } from '../../lib/kenyaTaxTreatment';

const suggestion = {
  treatment: 'not_taxable',
  explanation: 'Gym fees come out of pay after tax.',
  legal_basis: 'KRA guidance',
  confidence: 'medium',
  caveats: ['If the employer pays the gym, it may be a taxable benefit.'],
};

beforeEach(() => {
  ai.ask.mockReset();
  ai.ask.mockResolvedValue(suggestion);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('TaxTreatmentHint', () => {
  it('shows the built-in rule straight away, with the legal basis and the disclaimer', () => {
    render(<TaxTreatmentHint kind="deduction" name="SACCO savings" />);
    expect(screen.getByTestId('tax-badge')).toHaveProperty("textContent", 'Not tax-deductible');
    expect(screen.getByText(/come out of pay after tax/)).toBeTruthy();
    expect(screen.getByText(/Legal basis: Not an allowable deduction/)).toBeTruthy();
    expect(screen.getByText(TAX_DISCLAIMER)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ask AI' })).toBeNull();
    expect(ai.ask).not.toHaveBeenCalled();
  });

  it('fills the cap from the statutory rates and says where to record the tax effect', () => {
    render(<TaxTreatmentHint kind="deduction" name="Pension" rates={{ pension_deduction_cap: 30000 }} />);
    expect(screen.getByTestId('tax-badge')).toHaveProperty("textContent", 'Reduces taxable pay');
    expect(screen.getByText(/up to KSh 30,000 a month/)).toBeTruthy();
    expect(screen.getByText(/pension contribution in their tax details/)).toBeTruthy();
  });

  it('waits for typing to pause before looking the name up', () => {
    vi.useFakeTimers();
    const { rerender } = render(<TaxTreatmentHint kind="earning" name="" />);
    expect(screen.queryByTestId('tax-hint')).toBeNull();
    rerender(<TaxTreatmentHint kind="earning" name="Sales commission" />);
    expect(screen.queryByTestId('tax-hint')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByTestId('tax-badge')).toHaveProperty("textContent", 'Taxable');
  });

  it('asks the AI only when clicked, and labels the answer as an AI suggestion', async () => {
    render(<TaxTreatmentHint kind="deduction" name="Gym membership" description="monthly gym" />);
    expect(screen.getByText(/No built-in tax rule/)).toBeTruthy();
    expect(ai.ask).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }));
    expect(ai.ask).toHaveBeenCalledWith('deduction', 'Gym membership', 'monthly gym');
    expect(await screen.findByText('AI suggestion')).toBeTruthy();
    expect(screen.getByTestId('tax-badge')).toHaveProperty("textContent", 'Not tax-deductible');
    expect(screen.getByText('medium confidence')).toBeTruthy();
    expect(screen.getByText(/Legal basis \(as the AI gave it\): KRA guidance/)).toBeTruthy();
    expect(screen.getByText(TAX_DISCLAIMER)).toBeTruthy();
  });

  it('shows the error when the AI cannot answer', async () => {
    ai.ask.mockRejectedValue(new Error('AI limit reached for now. Try again later.'));
    render(<TaxTreatmentHint kind="deduction" name="Gym membership" />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }));
    expect(await screen.findByText('AI limit reached for now. Try again later.')).toBeTruthy();
  });

  it('drops an AI answer once the name changes', async () => {
    const { rerender } = render(<TaxTreatmentHint kind="deduction" name="Gym membership" debounceMs={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }));
    await screen.findByText('AI suggestion');
    rerender(<TaxTreatmentHint kind="deduction" name="Gym fees" debounceMs={0} />);
    expect(await screen.findByRole('button', { name: 'Ask AI' })).toBeTruthy();
    expect(screen.queryByText('AI suggestion')).toBeNull();
  });

  it('applies nothing by itself: "Use this" only appears with onUse, and fills the field when pressed', async () => {
    const onUse = vi.fn();
    const { rerender } = render(<TaxTreatmentHint kind="deduction" name="Life insurance" />);
    expect(screen.queryByRole('button', { name: 'Use this' })).toBeNull();

    rerender(<TaxTreatmentHint kind="deduction" name="Life insurance" onUse={onUse} />);
    expect(onUse).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Use this' }));
    expect(onUse).toHaveBeenCalledWith('relief', expect.objectContaining({ by: 'rule', ruleId: 'insurance' }));

    rerender(<TaxTreatmentHint kind="deduction" name="Gym membership" onUse={onUse} debounceMs={0} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ask AI' }));
    await screen.findByText('AI suggestion');
    expect(onUse).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Use this' }));
    expect(onUse).toHaveBeenLastCalledWith('not_taxable', expect.objectContaining({ by: 'ai', ruleId: null }));
  });
});
