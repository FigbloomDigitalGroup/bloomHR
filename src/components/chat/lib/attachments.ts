import type { Attachment } from '../types/types';

// Files sent in chat. The bucket (20261027300000_chat_replies_media.sql) has the same limits, so a file refused here
// would be refused by storage anyway; checking first gives a clear message instead of a failed upload.

export const CHAT_ATTACHMENTS_BUCKET = 'chat-attachments' as const;

/** 25 MB: room for photos, scans and office documents, not videos. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

/** What the bucket accepts. No HTML or SVG: a file opened from its link must not be able to run code. */
export const ALLOWED_ATTACHMENT_TYPES = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
  'application/pdf', 'text/plain', 'text/csv',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
];

/** For the file picker. */
export const ATTACHMENT_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/heic,image/heif,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip';

/** Why a file can't be sent, or null when it can. */
export function attachmentProblem(file: { name: string; size: number; type: string }): string | null {
  if (file.size > MAX_ATTACHMENT_BYTES) return `${file.name} is ${formatFileSize(file.size)}; files can be up to 25 MB`;
  if (file.size === 0) return `${file.name} is empty`;
  if (!ALLOWED_ATTACHMENT_TYPES.includes(file.type)) return `${file.name}: send pictures, PDFs, office documents, text or zip files`;
  return null;
}

export const isImageAttachment = (a: Pick<Attachment, 'type'>): boolean => a.type.startsWith('image/');

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The stored list, keeping only well-formed entries (older rows have an empty list, or nothing). */
export function toAttachments(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object' && typeof (a as { path?: unknown }).path === 'string')
    .map((a) => ({
      path: a.path as string,
      name: typeof a.name === 'string' && a.name ? a.name : 'File',
      type: typeof a.type === 'string' ? a.type : '',
      size: typeof a.size === 'number' ? a.size : 0,
    }));
}

/** A line for the conversation list or a quote: the text, or what was sent when there is no text. */
export function messagePreview(message: { content?: string | null; attachments?: unknown }): string {
  const text = (message.content || '').trim();
  if (text) return text;
  const files = toAttachments(message.attachments);
  if (files.length === 0) return '';
  if (files.length === 1) return `${isImageAttachment(files[0]) ? '📷' : '📎'} ${files[0].name}`;
  return `📎 ${files.length} files`;
}
