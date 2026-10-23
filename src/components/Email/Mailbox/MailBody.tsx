import { useEffect, useMemo, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { Button } from '../../UI';
import { MAIL_SANDBOX, hasRemoteContent, linkifyText, mailSrcDoc } from '../../../lib/mailHtml';

/**
 * An email's body. HTML goes into a sandboxed frame (no scripts, no access to the app, its own strict policy; see
 * lib/mailHtml.ts) with images from the internet blocked until "Show images". Plain text is shown as it is, with web
 * links made clickable.
 */
export default function MailBody({ html, text }: { html: string | null; text: string }) {
  const [showImages, setShowImages] = useState(false);
  // a new email starts with images blocked again
  useEffect(() => setShowImages(false), [html]);
  const srcDoc = useMemo(() => (html ? mailSrcDoc(html, showImages) : ''), [html, showImages]);
  const remote = useMemo(() => Boolean(html && hasRemoteContent(html)), [html]);

  if (html) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        {remote && !showImages && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 mb-2 rounded-tile bg-secondary text-[12px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <ImageOff className="w-4 h-4" aria-hidden />
              Images from the internet are hidden, so the sender can't tell you opened this email.
            </span>
            <Button variant="secondary" onClick={() => setShowImages(true)}>
              Show images
            </Button>
          </div>
        )}
        <iframe
          title="Email content"
          sandbox={MAIL_SANDBOX}
          referrerPolicy="no-referrer"
          srcDoc={srcDoc}
          className="w-full flex-1 min-h-[420px] border border-border rounded-tile bg-white"
        />
      </div>
    );
  }

  return (
    <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-ink">
      {linkifyText(text || '').map((piece, i) =>
        'href' in piece ? (
          <a key={i} href={piece.href} target="_blank" rel="noopener noreferrer" className="text-brand underline break-all">
            {piece.href}
          </a>
        ) : (
          <span key={i}>{piece.text}</span>
        )
      )}
    </pre>
  );
}
