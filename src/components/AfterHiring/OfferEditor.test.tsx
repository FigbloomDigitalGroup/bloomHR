import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));

import OfferEditor from './OfferEditor';
import { fillPlaceholders, offerValues, unknownPlaceholders, type OfferJobGroup, type OfferTemplate } from '../../lib/offers';

const template: OfferTemplate = {
  id: 't1', title: 'Offer: {{job_title}}', is_default: true, active: true,
  body: 'Dear {{candidate_name}},\n\nYou start on {{start_date}} at {{company_name}}. Basic {{basic_salary}}, allowances {{allowances}}.',
};
const group: OfferJobGroup = {
  id: 'g1', code: 'G4', name: 'Grade 4', effective_from: '2026-01-01', basic_salary: 80000, basic_min: null, basic_max: null,
  house_allowance: 12000, travel_allowance: 3000, other_allowances: 0,
};
const branding = { name: 'Favor Farm', primary_color: '#123456' };

afterEach(() => cleanup());

const open = (onSave = vi.fn().mockResolvedValue(undefined)) => {
  render(<OfferEditor offer={null} templates={[template]} groups={[group]} branding={branding} onClose={vi.fn()} onSave={onSave} />);
  return onSave;
};
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('placeholders', () => {
  it('are filled from the offer; unknown ones are left and reported', () => {
    const values = offerValues(
      { candidate_first_name: 'Jane', candidate_last_name: 'Wanjiku', job_title: 'Accountant', start_date: '2026-11-02', expiry_date: '2026-10-20',
        basic_salary: 50000, house_allowance: 5000, travel_allowance: 2000, other_allowances: 0 },
      { companyName: 'Favor Farm', jobGroup: null }
    );
    expect(fillPlaceholders('{{candidate_name}} · {{ start_date }} · {{allowances}} · {{job_group}} · {{nope}}', values))
      .toBe('Jane Wanjiku · 2 November 2026 · KSh 7,000 · — · {{nope}}');
    expect(unknownPlaceholders('{{first_name}} {{salary}}')).toEqual(['salary']);
  });
});

describe('OfferEditor', () => {
  it('starts from the default template and previews the letter as it is typed, on the company’s letterhead', () => {
    open();
    type('First name', 'Jane');
    type('Last name', 'Wanjiku');
    type('Job title', 'Accountant');
    const letter = screen.getByTestId('offer-letter');
    expect(within(letter).getByText('Favor Farm')).toBeTruthy();
    expect(within(letter).getByText('Offer: Accountant')).toBeTruthy();
    expect(within(letter).getByText(/Dear Jane Wanjiku,/)).toBeTruthy();
  });

  it('a job group fills the pay from its current rate and locks it', () => {
    open();
    fireEvent.change(screen.getByLabelText('Job group'), { target: { value: 'g1' } });
    expect((screen.getByLabelText('Basic salary') as HTMLInputElement).value).toBe('80000');
    expect((screen.getByLabelText('Basic salary') as HTMLInputElement).disabled).toBe(true);
    expect(within(screen.getByTestId('offer-letter')).getByText(/Basic KSh 80,000, allowances KSh 15,000/)).toBeTruthy();
  });

  it('won’t send without the email and dates, and saves a draft with what was typed', async () => {
    const onSave = open();
    type('First name', 'Jane');
    type('Job title', 'Accountant');
    fireEvent.click(screen.getByText('Save and send'));
    expect(await screen.findByText(/Add the candidate’s email/)).toBeTruthy();
    expect(screen.getByText('Choose the start date')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Save draft'));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({ candidate_first_name: 'Jane', job_title: 'Accountant', template_id: 't1', title: template.title });
    expect(onSave.mock.calls[0][1]).toBe(false);
  });
});
