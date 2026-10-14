import type { ReactNode } from 'react';

// The app's own "are you sure?" and notice dialogs, in place of the browser's confirm() and alert() pop-ups.
// `await confirmDialog('Delete this offer?')` shows a modal (components/UI/DialogHost, mounted once at the root)
// and resolves true for the confirm button, false for cancel, Escape or a tap outside.

export interface DialogOptions {
  /** the dialog's heading; a short question or statement */
  title?: string;
  /** what will happen, in a sentence or two */
  message?: ReactNode;
  /** the confirm button's words ("Delete", "Approve"); defaults to "Confirm", or "OK" for a notice */
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' paints the confirm button red: for deleting, removing, withdrawing */
  tone?: 'default' | 'danger';
}

export interface OpenDialog extends DialogOptions {
  /** a notice has only the OK button */
  notice: boolean;
  resolve: (ok: boolean) => void;
}

type Listener = (dialog: OpenDialog | null) => void;

let listener: Listener | null = null;
const queue: OpenDialog[] = [];

/** DialogHost subscribes here; returns the unsubscribe. */
export function subscribeDialogs(fn: Listener): () => void {
  listener = fn;
  fn(queue[0] ?? null);
  return () => {
    if (listener === fn) listener = null;
  };
}

/** The open dialog was answered: settle it and show the next one waiting. */
export function answerDialog(ok: boolean) {
  const current = queue.shift();
  current?.resolve(ok);
  listener?.(queue[0] ?? null);
}

const text = (node: ReactNode) => (typeof node === 'string' || typeof node === 'number' ? String(node) : '');

function open(options: DialogOptions, notice: boolean): Promise<boolean> {
  // no host mounted (a unit test rendering one component): fall back to the browser's own
  if (!listener) {
    const words = [options.title, text(options.message)].filter(Boolean).join('\n\n');
    if (notice) {
      window.alert(words);
      return Promise.resolve(true);
    }
    return Promise.resolve(window.confirm(words));
  }
  return new Promise((resolve) => {
    queue.push({ ...options, notice, resolve });
    if (queue.length === 1) listener?.(queue[0]);
  });
}

/** Ask before doing something: resolves true when they confirm. A plain string is the title. */
export function confirmDialog(options: DialogOptions | string): Promise<boolean> {
  return open(typeof options === 'string' ? { title: options } : options, false);
}

/** Tell them something they need to read (more than a toast holds): resolves when they close it. */
export async function noticeDialog(options: DialogOptions | string): Promise<void> {
  await open(typeof options === 'string' ? { title: options } : options, true);
}
