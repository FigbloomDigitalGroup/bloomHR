import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import DialogHost from './DialogHost';
import { confirmDialog, noticeDialog } from '../../lib/confirmDialog';

const browserConfirm = vi.fn();
const browserAlert = vi.fn();
beforeEach(() => {
  vi.stubGlobal('confirm', browserConfirm);
  vi.stubGlobal('alert', browserAlert);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  browserConfirm.mockReset();
  browserAlert.mockReset();
});

describe('confirmDialog with the host mounted', () => {
  it('shows the app modal, never the browser pop-up, and resolves with the answer', async () => {
    render(<DialogHost />);
    let answer: Promise<boolean> = Promise.resolve(false);
    act(() => {
      answer = confirmDialog({ title: 'Delete this offer?', message: 'Its link stops working.', confirmLabel: 'Delete', tone: 'danger' });
    });
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Its link stops working.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await expect(answer).resolves.toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(browserConfirm).not.toHaveBeenCalled();
  });

  it('cancel and Escape answer no', async () => {
    render(<DialogHost />);
    let first: Promise<boolean> = Promise.resolve(true);
    act(() => {
      first = confirmDialog('Discard your unsaved changes?');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await expect(first).resolves.toBe(false);

    let second: Promise<boolean> = Promise.resolve(true);
    act(() => {
      second = confirmDialog('Clear all rows?');
    });
    fireEvent.keyDown(window, { key: 'Escape' });
    await expect(second).resolves.toBe(false);
  });

  it('shows dialogs asked for together one after another', async () => {
    render(<DialogHost />);
    let a: Promise<boolean> = Promise.resolve(false);
    let b: Promise<void> = Promise.resolve();
    act(() => {
      a = confirmDialog('First?');
      b = noticeDialog({ title: 'Transaction details', message: 'Amount: KES 500' });
    });
    expect(screen.getByText('First?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await expect(a).resolves.toBe(true);
    expect(await screen.findByText('Amount: KES 500')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await expect(b).resolves.toBeUndefined();
    expect(browserAlert).not.toHaveBeenCalled();
  });
});
