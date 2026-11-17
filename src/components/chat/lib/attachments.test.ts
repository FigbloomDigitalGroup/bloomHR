import { describe, expect, it } from 'vitest';
import { attachmentProblem, formatFileSize, MAX_ATTACHMENT_BYTES, messagePreview, toAttachments } from './attachments';

describe('attachmentProblem', () => {
  it('accepts pictures and documents up to 25 MB', () => {
    expect(attachmentProblem({ name: 'photo.jpg', size: 2_000_000, type: 'image/jpeg' })).toBeNull();
    expect(attachmentProblem({ name: 'payslip.pdf', size: MAX_ATTACHMENT_BYTES, type: 'application/pdf' })).toBeNull();
  });

  it('refuses a file over 25 MB, an empty file, and pages that could run code', () => {
    expect(attachmentProblem({ name: 'video.pdf', size: MAX_ATTACHMENT_BYTES + 1, type: 'application/pdf' })).toMatch(/up to 25 MB/);
    expect(attachmentProblem({ name: 'empty.txt', size: 0, type: 'text/plain' })).toMatch(/empty/);
    expect(attachmentProblem({ name: 'page.html', size: 10, type: 'text/html' })).toMatch(/pictures, PDFs/);
    expect(attachmentProblem({ name: 'logo.svg', size: 10, type: 'image/svg+xml' })).toMatch(/pictures, PDFs/);
  });
});

describe('toAttachments', () => {
  it('keeps the well-formed files and fills in what is missing', () => {
    expect(toAttachments([{ path: 'a/b/c.pdf', name: 'c.pdf', type: 'application/pdf', size: 10 }, { name: 'no path' }, null])).toEqual([
      { path: 'a/b/c.pdf', name: 'c.pdf', type: 'application/pdf', size: 10 },
    ]);
    expect(toAttachments([{ path: 'a/b/x' }])).toEqual([{ path: 'a/b/x', name: 'File', type: '', size: 0 }]);
    expect(toAttachments(null)).toEqual([]);
  });
});

describe('messagePreview', () => {
  it('is the text, or what was sent when there is only a file', () => {
    expect(messagePreview({ content: 'hello' })).toBe('hello');
    expect(messagePreview({ content: '', attachments: [{ path: 'p', name: 'beach.png', type: 'image/png', size: 1 }] })).toBe('📷 beach.png');
    expect(messagePreview({ content: '', attachments: [{ path: 'p', name: 'cv.pdf', type: 'application/pdf', size: 1 }] })).toBe('📎 cv.pdf');
    expect(messagePreview({ content: null, attachments: [{ path: 'p' }, { path: 'q' }] })).toBe('📎 2 files');
  });
});

describe('formatFileSize', () => {
  it('reads like a person would say it', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2048)).toBe('2 KB');
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
