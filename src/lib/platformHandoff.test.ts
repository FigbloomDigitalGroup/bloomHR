import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: { auth: { getSession: vi.fn() }, from: vi.fn() } }));

import {
  PENDING_MS, clearPendingHandoff, loadPendingHandoff, readArrival, safeNext, savePendingHandoff, statusMessage,
} from './platformHandoff';

const ID = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';

describe('safeNext: where to go after signing in from Figbloom Schools', () => {
  it('keeps a path on this site', () => {
    expect(safeNext('/payroll')).toBe('/payroll');
    expect(safeNext('/employees?tab=leave#x')).toBe('/employees?tab=leave#x');
  });

  it('anything else opens the dashboard', () => {
    for (const bad of ['', 'payroll', 'https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)',
      '/\nx', '/login', '/handoff', '/api/x', '/mfa', `/${'a'.repeat(600)}`, null, undefined, 5]) {
      expect(safeNext(bad)).toBe('/dashboard');
    }
  });
});

describe('readArrival: what /handoff was opened with', () => {
  it('a sign-in token and where next', () => {
    expect(readArrival('', '#token_hash=abc123def456&next=%2Fpayroll')).toEqual({ kind: 'signin', tokenHash: 'abc123def456', next: '/payroll' });
    expect(readArrival('', '#token_hash=abc123def456&next=https%3A%2F%2Fevil.example')).toEqual({ kind: 'signin', tokenHash: 'abc123def456', next: '/dashboard' });
  });

  it('a pending id to connect', () => {
    expect(readArrival('', `#connect=${ID}`)).toEqual({ kind: 'connect', pending: ID });
  });

  it('a status, or "invalid" for anything unexpected', () => {
    expect(readArrival('?status=no_access', '')).toEqual({ kind: 'status', status: 'no_access' });
    expect(readArrival('?status=<script>', '')).toEqual({ kind: 'status', status: 'invalid' });
    expect(readArrival('', '#connect=short')).toEqual({ kind: 'status', status: 'invalid' });
  });

  it('the pages say what the contract says', () => {
    expect(statusMessage('no_access').body).toBe('You don\'t have access to HR for this school. Ask your HR administrator.');
    expect(statusMessage('off').title).toBe('Not available yet');
    expect(statusMessage('anything').title).toBe('This link has expired');
  });
});

describe('the pending id kept in this browser', () => {
  beforeEach(() => localStorage.clear());

  it('is kept for 10 minutes, then forgotten', () => {
    savePendingHandoff(ID, 1000);
    expect(loadPendingHandoff(1000 + PENDING_MS - 1)).toBe(ID);
    expect(loadPendingHandoff(1000 + PENDING_MS)).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it('is cleared, and a malformed one is never kept', () => {
    savePendingHandoff(ID);
    clearPendingHandoff();
    expect(loadPendingHandoff()).toBeNull();
    savePendingHandoff('not valid!');
    expect(loadPendingHandoff()).toBeNull();
    localStorage.setItem('figbloom.platformHandoff', '{oops');
    expect(loadPendingHandoff()).toBeNull();
  });
});
