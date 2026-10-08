import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import SearchableDropdown from './SearchableDropdown';

afterEach(cleanup);

const open = (props: Partial<React.ComponentProps<typeof SearchableDropdown>> = {}) => {
  const onChange = vi.fn();
  render(<SearchableDropdown options={['Finance', 'Operations']} value="" placeholder="Select Department" {...props} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: /Select Department|Field Officer/ }));
  return onChange;
};

describe('SearchableDropdown', () => {
  it('shows the placeholder for an empty value', () => {
    render(<SearchableDropdown options={['Finance']} value="" onChange={vi.fn()} placeholder="Select Department" />);
    expect(screen.getByText('Select Department')).toBeTruthy();
  });

  it('offers "Add" for a value not in the list when typing is allowed, by click or Enter', () => {
    const onChange = open({ allowCreate: true });
    const search = screen.getByPlaceholderText(/type a new one/);
    fireEvent.change(search, { target: { value: '  Field Officer ' } });
    fireEvent.click(screen.getByRole('button', { name: /Add “Field Officer”/ }));
    expect(onChange).toHaveBeenCalledWith('Field Officer');
  });

  it('Enter picks an existing option (any case) instead of adding a duplicate', () => {
    const onChange = open({ allowCreate: true });
    const search = screen.getByPlaceholderText(/type a new one/);
    fireEvent.change(search, { target: { value: 'finance' } });
    expect(screen.queryByRole('button', { name: /Add “/ })).toBeNull();
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('Finance');
  });

  it('does not offer "Add" unless allowed', () => {
    open();
    fireEvent.change(screen.getByPlaceholderText('Search options...'), { target: { value: 'Field Officer' } });
    expect(screen.queryByRole('button', { name: /Add “/ })).toBeNull();
    expect(screen.getByText('No matches found')).toBeTruthy();
  });

  it('shows a saved value that is not in the list', () => {
    render(<SearchableDropdown options={['Finance']} value="Field Officer" onChange={vi.fn()} placeholder="Select Job Title" />);
    expect(screen.getByText('Field Officer')).toBeTruthy();
  });
});
