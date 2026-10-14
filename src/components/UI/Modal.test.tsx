import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import Modal from './Modal';

afterEach(cleanup);

// A form in a modal whose parent hands it a fresh onClose arrow on every render, the way most
// callers do.
function FormInModal({ onClosed }: { onClosed: () => void }) {
  const [open, setOpen] = useState(true);
  const [name, setName] = useState('');
  return (
    <Modal
      open={open}
      onClose={() => {
        setOpen(false);
        onClosed();
      }}
      title="Add holiday"
    >
      <label htmlFor="name">Name</label>
      <input id="name" value={name} onChange={(e) => setName(e.target.value)} />
    </Modal>
  );
}

describe('Modal', () => {
  it('shows a named dialog and closes on Escape', () => {
    const onClosed = vi.fn();
    render(<FormInModal onClosed={onClosed} />);
    expect(screen.getByRole('dialog', { name: 'Add holiday' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on a backdrop tap but not on a tap inside the panel', () => {
    const onClosed = vi.fn();
    render(<FormInModal onClosed={onClosed} />);
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(onClosed).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('keeps focus in a field while typing, even though the parent re-renders with a new onClose', () => {
    render(<FormInModal onClosed={vi.fn()} />);
    const input = screen.getByLabelText('Name') as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: 'Madaraka' } });
    expect(input.value).toBe('Madaraka');
    expect(document.activeElement).toBe(input);
  });
});
