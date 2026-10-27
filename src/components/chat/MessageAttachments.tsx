// MessageAttachments.tsx
import { useEffect, useState } from "react";
import { Download, FileText, ImageOff } from "lucide-react";
import { signedFileUrl } from "../../lib/privateFiles";
import { CHAT_ATTACHMENTS_BUCKET, formatFileSize, isImageAttachment } from "./lib/attachments";
import type { Attachment } from "./types/types";

// The files are in a private bucket: each one is opened through a short-lived signed link, which storage only gives to
// people who can read the chat. Links are kept for a while so scrolling back and forth doesn't ask again.
const LINK_SECONDS = 60 * 60;
const links = new Map<string, { url: string; until: number }>();

async function linkFor(path: string): Promise<string> {
  const cached = links.get(path);
  if (cached && cached.until > Date.now()) return cached.url;
  const url = await signedFileUrl(CHAT_ATTACHMENTS_BUCKET, path, LINK_SECONDS);
  // renewed five minutes early, so a link is never handed out just before it stops working
  links.set(path, { url, until: Date.now() + (LINK_SECONDS - 300) * 1000 });
  return url;
}

function useSignedLink(path: string) {
  const [state, setState] = useState<{ url?: string; failed?: boolean }>({});
  useEffect(() => {
    let live = true;
    linkFor(path).then(
      (url) => live && setState({ url }),
      () => live && setState({ failed: true })
    );
    return () => {
      live = false;
    };
  }, [path]);
  return state;
}

function ImageAttachment({ attachment }: { attachment: Attachment }) {
  const { url, failed } = useSignedLink(attachment.path);
  if (failed) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-500">
        <ImageOff className="h-4 w-4" /> {attachment.name} is no longer available
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="block" title={`Open ${attachment.name}`}>
      {url ? (
        <img src={url} alt={attachment.name} className="max-h-64 max-w-full rounded-lg object-cover bg-gray-100" loading="lazy" />
      ) : (
        <div className="h-40 w-56 max-w-full animate-pulse rounded-lg bg-gray-200" aria-label={`Loading ${attachment.name}`} />
      )}
    </a>
  );
}

function FileAttachment({ attachment, mine }: { attachment: Attachment; mine: boolean }) {
  const { url, failed } = useSignedLink(attachment.path);
  return (
    <a
      href={url}
      download={attachment.name}
      target="_blank"
      rel="noopener noreferrer"
      aria-disabled={!url}
      onClick={(e) => !url && e.preventDefault()}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 min-w-0 ${
        mine ? 'bg-white/15 hover:bg-white/25' : 'bg-gray-100 hover:bg-gray-200'
      } ${url ? '' : 'cursor-default opacity-70'}`}
    >
      <FileText className="h-8 w-8 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{attachment.name}</span>
        <span className={`block text-xs ${mine ? 'text-white/75' : 'text-gray-500'}`}>
          {failed ? 'No longer available' : formatFileSize(attachment.size)}
        </span>
      </span>
      {url && <Download className="h-4 w-4 shrink-0" aria-label={`Download ${attachment.name}`} />}
    </a>
  );
}

export function MessageAttachments({ attachments, mine }: { attachments: Attachment[]; mine: boolean }) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 mb-1">
      {attachments.map((attachment) =>
        isImageAttachment(attachment) ? (
          <ImageAttachment key={attachment.path} attachment={attachment} />
        ) : (
          <FileAttachment key={attachment.path} attachment={attachment} mine={mine} />
        )
      )}
    </div>
  );
}
