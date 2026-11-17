import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), toasts) }));

import { MessageInput } from './MessageInput';
import type { Message } from './types/types';

const reply: Message = {
  id: 'm1',
  content: 'lunch at 1?',
  author: { id: 'user-ben', name: 'Ben Otieno', avatar: '', initials: 'BO', email: '', status: 'online' },
  timestamp: '2026-10-27T09:00:00Z',
};
const file = (name: string, type: string, size: number) => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};
const pick = (...picked: File[]) => fireEvent.change(screen.getByLabelText('Attach files'), { target: { files: picked } });
const send = () => act(async () => {
  fireEvent.click(screen.getByRole('button', { name: /Send/ }));
});

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});
beforeEach(() => {
  toasts.error.mockReset();
});
afterEach(cleanup);

describe('sending files', () => {
  it('sends the chosen file itself, with or without text', async () => {
    const onSend = vi.fn().mockResolvedValue(true);
    render(<MessageInput channelName="general" onSendMessage={onSend} employees={[]} />);
    const photo = file('beach.png', 'image/png', 2048);
    pick(photo);
    expect(screen.getByAltText('beach.png')).toBeTruthy(); // the preview
    await send();
    expect(onSend).toHaveBeenCalledWith('', [photo], null);
    expect(screen.queryByAltText('beach.png')).toBeNull(); // sent, so cleared
  });

  it('refuses a file over 25 MB, or a kind storage would refuse, and says why', () => {
    render(<MessageInput channelName="general" onSendMessage={vi.fn()} employees={[]} />);
    pick(file('video.pdf', 'application/pdf', 26 * 1024 * 1024), file('page.html', 'text/html', 10));
    expect(toasts.error).toHaveBeenCalledTimes(2);
    expect(toasts.error.mock.calls[0][0]).toMatch(/up to 25 MB/);
    expect(screen.queryByText('video.pdf')).toBeNull();
  });

  it('keeps the draft and files when the message could not be sent', async () => {
    const onSend = vi.fn().mockResolvedValue(false);
    render(<MessageInput channelName="general" onSendMessage={onSend} employees={[]} />);
    pick(file('cv.pdf', 'application/pdf', 1000));
    fireEvent.change(screen.getByPlaceholderText('Message #general'), { target: { value: 'my CV' } });
    await send();
    expect(onSend).toHaveBeenCalledWith('my CV', [expect.any(File)], null);
    expect(screen.getByText('cv.pdf')).toBeTruthy();
    expect((screen.getByPlaceholderText('Message #general') as HTMLTextAreaElement).value).toBe('my CV');
  });
});

describe('replying', () => {
  it('shows the message being answered, sends it with the reply, then clears it', async () => {
    const onSend = vi.fn().mockResolvedValue(true);
    const onCancel = vi.fn();
    render(<MessageInput channelName="general" onSendMessage={onSend} employees={[]} replyingTo={reply} onCancelReply={onCancel} />);
    expect(screen.getByText('Replying to Ben Otieno')).toBeTruthy();
    expect(screen.getByText('lunch at 1?')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Message #general'), { target: { value: 'yes!' } });
    await send();
    expect(onSend).toHaveBeenCalledWith('yes!', [], reply);
    expect(onCancel).toHaveBeenCalled();
  });

  it('can be cancelled with the cross or Escape', () => {
    const onCancel = vi.fn();
    render(<MessageInput channelName="general" onSendMessage={vi.fn()} employees={[]} replyingTo={reply} onCancelReply={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel reply' }));
    fireEvent.keyDown(screen.getByPlaceholderText('Message #general'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
