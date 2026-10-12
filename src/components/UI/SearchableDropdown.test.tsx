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

  it('draws the list over the page, so a card that clips its contents does not hide it, and picking still works', () => {
    const onChange = vi.fn();
    const { container } = render(
      <div style={{ overflow: 'hidden', height: 40 }}>
        <SearchableDropdown options={['Kenyan Citizen', 'International']} value="" placeholder="Select Nationality" onChange={onChange} />
      </div>
    );
    fireEvent.click(screen.getByRole('button', { name: /Select Nationality/ }));
    const option = screen.getByRole('button', { name: 'Kenyan Citizen' });
    expect(container.contains(option)).toBe(false); // not inside the clipping card
    fireEvent.mouseDown(option); // a press inside the list is not a click outside
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith('Kenyan Citizen');
  });

  it('opens upwards when there is not enough room below', () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      { top: window.innerHeight - 60, bottom: window.innerHeight - 28, left: 10, width: 200, right: 210, height: 32, x: 10, y: 0, toJSON: () => ({}) } as DOMRect
    );
    open();
    const panel = screen.getByPlaceholderText('Search options...').closest('[style*="position: fixed"]') as HTMLElement;
    expect(panel.style.bottom).toBe('68px');
    expect(panel.style.top).toBe('');
    rect.mockRestore();
  });
});
