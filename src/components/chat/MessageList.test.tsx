import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const files = vi.hoisted(() => ({ signedFileUrl: vi.fn() }));
const dialogs = vi.hoisted(() => ({ confirmDialog: vi.fn() }));
vi.mock('../../lib/privateFiles', () => files);
vi.mock('../../lib/confirmDialog', () => dialogs);
// the profile card needs the router and the company; not what these tests are about
vi.mock('./EmployeeProfile', () => ({ EmployeeProfile: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import { MessageList } from './MessageList';
import type { DirectMessage, Message, ReactionRow } from './types/types';

const ME = 'user-me';
const BEN = 'user-ben';
const dm: DirectMessage = { id: 'dm-1', name: 'Ben Otieno', type: 'direct_message', initials: 'BO', status: 'offline', userId: 'E1' };
const person = (id: string, name: string) => ({ id, name, avatar: '', initials: name[0], email: '', status: 'online' as const });
const msg = (id: string, author: string, content: string, extra: Partial<Message> = {}): Message => ({
  id,
  content,
  author: author === ME ? person(ME, 'Me Myself') : person(BEN, 'Ben Otieno'),
  timestamp: '2026-10-27T09:00:00Z',
  ...extra,
});

// jsdom lacks what the menus and popovers measure with
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = () => false;
});
beforeEach(() => {
  files.signedFileUrl.mockReset();
  dialogs.confirmDialog.mockReset();
});
afterEach(cleanup);

const openMore = (index = 0) => fireEvent.keyDown(screen.getAllByRole('button', { name: 'More' })[index], { key: 'Enter' });

describe('replies', () => {
  it('the reply button hands the message to the box below', () => {
    const onReply = vi.fn();
    const hello = msg('m1', BEN, 'hi there');
    render(<MessageList messages={[hello]} channel={dm} currentUserId={ME} onReply={onReply} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(onReply).toHaveBeenCalledWith(hello);
  });

  it('a reply shows the message it answers, and clicking the quote goes to it', () => {
    render(
      <MessageList
        messages={[msg('m1', BEN, 'lunch at 1?'), msg('m2', ME, 'yes!', { replyTo: 'm1' })]}
        channel={dm}
        currentUserId={ME}
      />
    );
    const quote = screen.getByRole('button', { name: 'Replying to Ben Otieno: go to their message' });
    expect(quote.textContent).toContain('lunch at 1?');
    fireEvent.click(quote);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(document.getElementById('chat-message-m1')?.className).toContain('bg-yellow-100');
  });

  it('a reply to a message that is not loaded says so instead of breaking', () => {
    render(<MessageList messages={[msg('m2', ME, 'yes!', { replyTo: 'old' })]} channel={dm} currentUserId={ME} />);
    expect(screen.getByText('An earlier message')).toBeTruthy();
  });
});

describe('reactions', () => {
  const rows: ReactionRow[] = [
    { id: 'r1', messageId: 'm1', userId: BEN, emoji: '👍' },
    { id: 'r2', messageId: 'm1', userId: ME, emoji: '👍' },
  ];

  it('shows each emoji with its count and who reacted; clicking one adds or takes back mine', () => {
    const onReact = vi.fn();
    render(
      <MessageList messages={[msg('m1', BEN, 'done')]} channel={dm} currentUserId={ME} reactionRows={rows} onReact={onReact}
        peopleNames={{ [BEN]: 'Ben Otieno' }} />
    );
    const chip = screen.getByRole('button', { name: '👍 2: You and Ben Otieno' });
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(chip);
    expect(onReact).toHaveBeenCalledWith('m1', '👍');
  });

  it('the picker reacts with the chosen emoji', async () => {
    const onReact = vi.fn();
    render(<MessageList messages={[msg('m1', BEN, 'done')]} channel={dm} currentUserId={ME} onReact={onReact} />);
    fireEvent.click(screen.getByRole('button', { name: 'React' }));
    fireEvent.click(await screen.findByRole('button', { name: '❤️' }));
    expect(onReact).toHaveBeenCalledWith('m1', '❤️');
  });

  it('the welcome line has nothing to react or reply to', () => {
    render(<MessageList messages={[msg('welcome-dm-1', 'system', 'Say hello!')]} channel={dm} currentUserId={ME} />);
    expect(screen.queryByRole('button', { name: 'React' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reply' })).toBeNull();
  });
});

describe('the More menu', () => {
  it('has reply and copy for someone else’s message, and nothing "coming soon"', async () => {
    render(<MessageList messages={[msg('m1', BEN, 'hi')]} channel={dm} currentUserId={ME} />);
    openMore();
    expect(await screen.findByRole('menuitem', { name: 'Copy text' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Reply' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/coming soon/i);
  });

  it('copies the text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<MessageList messages={[msg('m1', BEN, 'the code is 4421')]} channel={dm} currentUserId={ME} />);
    openMore();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy text' }));
    expect(writeText).toHaveBeenCalledWith('the code is 4421');
  });

  it('edits my own message in place', async () => {
    const onEdit = vi.fn().mockResolvedValue(true);
    render(<MessageList messages={[msg('m1', ME, 'teh plan')]} channel={dm} currentUserId={ME} onEdit={onEdit} />);
    openMore();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const box = screen.getByRole('textbox', { name: 'Edit message' });
    fireEvent.change(box, { target: { value: 'the plan' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    expect(onEdit).toHaveBeenCalledWith('m1', 'the plan');
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Edit message' })).toBeNull());
  });

  it('shows that a message was edited', () => {
    render(<MessageList messages={[msg('m1', ME, 'the plan', { isEdited: true })]} channel={dm} currentUserId={ME} />);
    expect(screen.getByText(/edited ·/)).toBeTruthy();
  });

  it('deletes my own message after asking', async () => {
    const onDelete = vi.fn();
    dialogs.confirmDialog.mockResolvedValue(true);
    const mine = msg('m1', ME, 'oops');
    render(<MessageList messages={[mine]} channel={dm} currentUserId={ME} onDelete={onDelete} />);
    openMore();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(mine));
  });

  it('keeps the message when the question is cancelled', async () => {
    const onDelete = vi.fn();
    dialogs.confirmDialog.mockResolvedValue(false);
    render(<MessageList messages={[msg('m1', ME, 'oops')]} channel={dm} currentUserId={ME} onDelete={onDelete} />);
    openMore();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(dialogs.confirmDialog).toHaveBeenCalled());
    expect(onDelete).not.toHaveBeenCalled();
  });
});

describe('files', () => {
  it('shows a picture from its signed link and a document as a download, never "Sent 1 file(s)"', async () => {
    files.signedFileUrl.mockImplementation(async (_bucket: string, path: string) => `https://signed.example/${path}?token=t`);
    render(
      <MessageList
        messages={[
          msg('m1', BEN, '', {
            attachments: [
              { path: 'co/chat/photo.png', name: 'beach.png', type: 'image/png', size: 2048 },
              { path: 'co/chat/cv.pdf', name: 'cv.pdf', type: 'application/pdf', size: 3 * 1024 * 1024 },
            ],
          }),
        ]}
        channel={dm}
        currentUserId={ME}
      />
    );
    const img = (await screen.findByRole('img', { name: 'beach.png' })) as HTMLImageElement;
    expect(img.src).toBe('https://signed.example/co/chat/photo.png?token=t');
    expect(files.signedFileUrl).toHaveBeenCalledWith('chat-attachments', 'co/chat/photo.png', expect.any(Number));
    const link = screen.getByText('cv.pdf').closest('a') as HTMLAnchorElement;
    await waitFor(() => expect(link.href).toBe('https://signed.example/co/chat/cv.pdf?token=t'));
    expect(screen.getByText('3.0 MB')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Sent \d+ file/);
  });

  it('says when a file can no longer be opened', async () => {
    files.signedFileUrl.mockRejectedValue(new Error('gone'));
    render(
      <MessageList
        messages={[msg('m1', BEN, 'see attached', { attachments: [{ path: 'co/chat/gone.pdf', name: 'gone.pdf', type: 'application/pdf', size: 10 }] })]}
        channel={dm}
        currentUserId={ME}
      />
    );
    expect(await screen.findByText('No longer available')).toBeTruthy();
  });
});
