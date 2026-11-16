// @vitest-environment node
//
// pay_items.js is the server's copy of the pay-items rules table (src/lib/kenyaTaxTreatment.ts TAX_RULES), so the HR
// assistant says what the pay items page and payroll do. These tests fail when the two differ.
import { describe, expect, it } from 'vitest';
import { TAX_RULES } from '../src/lib/kenyaTaxTreatment';
// @ts-expect-error plain JavaScript server module
import { KENYA_PAY_ITEMS, PAY_ITEM_RATE_CODES, explainPayItem, payItemsPrompt, selectPayItems } from '../pay_items.js';

type Item = { id: string; keywords: RegExp[]; [k: string]: unknown };

const shape = (r: Record<string, unknown>) => ({
  id: r.id,
  title: r.title,
  keywords: (r.keywords as RegExp[]).map(String),
  kinds: r.kinds,
  treatment: r.treatment,
  explanation: r.explanation,
  legalBasis: r.legalBasis,
  capCode: r.capCode,
  caveats: r.caveats,
  goAhead: r.goAhead,
  inThisApp: r.inThisApp,
});

describe('pay_items.js', () => {
  it('is the same table as TAX_RULES in src/lib/kenyaTaxTreatment.ts', () => {
    expect((KENYA_PAY_ITEMS as Item[]).map(shape)).toEqual(TAX_RULES.map((r) => shape(r as unknown as Record<string, unknown>)));
  });

  it('needs every cap code the table names, and the insurance relief rate', () => {
    expect(PAY_ITEM_RATE_CODES).toContain('pension_deduction_cap');
    expect(PAY_ITEM_RATE_CODES).toContain('insurance_relief_rate');
  });

  it('picks the items a question names, and knows a pay question without one', () => {
    expect(selectPayItems('Is HELB deducted before tax?').items.map((i: Item) => i.id)).toEqual(['helb']);
    expect(selectPayItems('What comes off before tax on a payslip?')).toEqual({ about: true, items: [] });
    expect(selectPayItems('Who is on leave next week?').about).toBe(false);
  });

  it('fills caps from the rates, and says where they are when unknown', () => {
    const pension = (KENYA_PAY_ITEMS as Item[]).find((i) => i.id === 'pension');
    expect(explainPayItem(pension, { pension_deduction_cap: 30000 })).toContain('up to KSh 30,000 a month');
    expect(explainPayItem(pension, {})).toContain('up to the monthly limit in the statutory rates');
  });

  it('is left out of the prompt when the question is not about pay', () => {
    expect(payItemsPrompt(selectPayItems('Who has a birthday soon?'))).toBe('');
    const prompt = payItemsPrompt(selectPayItems('Is SACCO tax deductible?'));
    expect(prompt).toContain('SACCO savings or shares [deduction]: AFTER TAX');
    expect(prompt).toContain('Employment Act 2007 s.19(3)');
  });
});
