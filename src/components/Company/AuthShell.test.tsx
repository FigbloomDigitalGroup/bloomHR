import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AuthShell, { AuthButton, Field } from './AuthShell';

afterEach(() => cleanup());

describe('AuthShell', () => {
  it('uses the sign-in layout: brand panel, title, subtitle and the form', () => {
    render(
      <AuthShell title="Create your company" subtitle="Set up a company.">
        <p>form here</p>
      </AuthShell>
    );
    expect(screen.getByText('Create your company')).toBeTruthy();
    expect(screen.getByText('Set up a company.')).toBeTruthy();
    expect(screen.getByText('form here')).toBeTruthy();
    expect(screen.getByText(/Automate Your/)).toBeTruthy(); // the same brand panel as the login page
  });

  it('Field is a labelled input that reports changes and can be read-only', () => {
    const onChange = vi.fn();
    render(<Field label="Email" value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } });
    expect(onChange).toHaveBeenCalledWith('a@b.co');
    cleanup();
    render(<Field label="Email" value="a@b.co" onChange={onChange} readOnly />);
    expect((screen.getByLabelText('Email') as HTMLInputElement).readOnly).toBe(true);
  });

  it('AuthButton clicks, and does nothing while disabled', () => {
    const onClick = vi.fn();
    const { rerender } = render(<AuthButton onClick={onClick}>Go</AuthButton>);
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(
      <AuthButton onClick={onClick} disabled>
        Go
      </AuthButton>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
