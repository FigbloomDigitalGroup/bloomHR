import { beforeEach, describe, expect, it } from 'vitest';
import { clearCompanyChoice, hasChosenCompany, markCompanyChosen } from './companyChoice';

beforeEach(() => sessionStorage.clear());

describe('companyChoice', () => {
  it('remembers the choice for the same person only', () => {
    expect(hasChosenCompany('u1')).toBe(false);
    markCompanyChosen('u1');
    expect(hasChosenCompany('u1')).toBe(true);
    expect(hasChosenCompany('u2')).toBe(false); // someone else signing in on this tab is asked again
  });

  it('forgets on sign-out', () => {
    markCompanyChosen('u1');
    clearCompanyChoice();
    expect(hasChosenCompany('u1')).toBe(false);
  });
});
