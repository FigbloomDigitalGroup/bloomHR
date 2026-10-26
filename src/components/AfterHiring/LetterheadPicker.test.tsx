import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ upload: vi.fn(), set: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/companyProfile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/companyProfile')>()),
  uploadLetterheadImage: (...a: unknown[]) => mocks.upload(...a),
  setCompanyLetterhead: (...a: unknown[]) => mocks.set(...a),
}));

import LetterheadPicker from './LetterheadPicker';

beforeEach(() => {
  mocks.upload.mockReset().mockResolvedValue('https://cdn/new-head.png');
  mocks.set.mockReset().mockImplementation((h, f) => Promise.resolve({ letterhead_header_url: h, letterhead_footer_url: f }));
});
afterEach(() => cleanup());

describe('LetterheadPicker', () => {
  it('uploads a header image and saves it, keeping the footer', async () => {
    const onChange = vi.fn();
    render(<LetterheadPicker branding={{ name: 'Acme', letterhead_footer_url: 'https://cdn/foot.png' }} onChange={onChange} />);
    expect(screen.getByText('None: made from your logo and name')).toBeTruthy();
    const file = new File(['png'], 'head.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Upload a letterhead header'), { target: { files: [file] } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(mocks.upload).toHaveBeenCalledWith(file);
    expect(mocks.set).toHaveBeenCalledWith('https://cdn/new-head.png', 'https://cdn/foot.png');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ letterhead_header_url: 'https://cdn/new-head.png', letterhead_footer_url: 'https://cdn/foot.png' }));
  });

  it('refuses a file that is not a PNG or JPG', async () => {
    render(<LetterheadPicker branding={{ name: 'Acme' }} onChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Upload a letterhead header'), { target: { files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] } });
    await Promise.resolve();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('removes the footer, keeping the header', async () => {
    const onChange = vi.fn();
    render(<LetterheadPicker branding={{ name: 'Acme', letterhead_header_url: 'https://cdn/head.png', letterhead_footer_url: 'https://cdn/foot.png' }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove the letterhead footer' }));
    await waitFor(() => expect(mocks.set).toHaveBeenCalledWith('https://cdn/head.png', null));
  });
});
