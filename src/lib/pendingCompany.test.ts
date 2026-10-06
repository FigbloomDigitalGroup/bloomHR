import { beforeEach, describe, expect, it } from 'vitest';
import { clearPendingCompany, readPendingCompany, writePendingCompany } from './pendingCompany';

beforeEach(() => localStorage.clear());

describe('pendingCompany', () => {
  it('keeps the name until it is used', () => {
    expect(readPendingCompany()).toBeNull();
    writePendingCompany('Acme Ltd');
    expect(readPendingCompany()).toBe('Acme Ltd');
    clearPendingCompany();
    expect(readPendingCompany()).toBeNull();
  });
});
