// Showing an email's HTML safely, without a sanitiser library (FIG-1205).
//
// The HTML is never put into the app's own page. It goes into an <iframe sandbox srcdoc> (MailBody.tsx) that has
// neither allow-scripts nor allow-same-origin, so nothing in the email can run, read the app's session, or reach the
// app's page; and a Content-Security-Policy in the document itself allows only inline styles and embedded images:
// no scripts, frames, fonts, forms posting anywhere, or requests to the internet. Images from the internet (which tell
// the sender you opened the email) stay blocked until the reader asks for them, which widens img-src to https: only.
// Links open in a new tab (a <base target="_blank">, and every link gets rel="noopener noreferrer"), and no referrer
// is sent.

/** The policy for the email's document; `showImages` lets images from https: sites load. */
export function mailCsp(showImages: boolean) {
  return `default-src 'none'; style-src 'unsafe-inline'; img-src ${showImages ? 'https: data: cid:' : 'data: cid:'}`;
}

/** The sandbox for the iframe: links may open a new tab (outside the sandbox); nothing else. */
export const MAIL_SANDBOX = 'allow-popups allow-popups-to-escape-sandbox';

const REMOTE = /(?:\bsrc|\bbackground|\bposter|\bsrcset)\s*=\s*["']?\s*(?:https?:)?\/\/|url\(\s*["']?\s*(?:https?:)?\/\//i;

/** Does the email load anything from the internet (images, backgrounds) that is blocked until asked for? */
export const hasRemoteContent = (html: string) => REMOTE.test(html);

const SAFE_HREF = /^(?:https?:|mailto:|tel:|#)/i;

/**
 * Every link opens in a new tab without telling the site where it came from. Done on an inert copy (DOMParser runs no
 * scripts and loads nothing); this is not what makes the email safe (the sandbox and policy are), only how links behave.
 */
function withSafeLinks(html: string): string {
  if (typeof DOMParser === 'undefined') return html;
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('a[href], area[href]').forEach((a) => {
      // only web, email and phone links (no javascript: or data: pages opened in a new tab)
      if (!SAFE_HREF.test((a.getAttribute('href') || '').trim())) a.removeAttribute('href');
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    });
    // the email's own <base> (ours sets where links open), http-equiv metas (a refresh would take the frame to another
    // page), and scripts and frames, which could never run or load anyway
    doc.querySelectorAll('base, meta[http-equiv], script, iframe, frame, object, embed').forEach((el) => el.remove());
    return `${doc.head.innerHTML}${doc.body.innerHTML}`;
  } catch {
    return html;
  }
}

/** The whole document for the iframe's srcdoc: our policy and link rules first, then the email. */
export function mailSrcDoc(html: string, showImages: boolean) {
  const csp = mailCsp(showImages);
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    '<meta name="referrer" content="no-referrer">' +
    '<base target="_blank">' +
    '<style>html,body{margin:0;padding:0}body{padding:12px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#1f2937;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}</style>' +
    '</head><body>' +
    withSafeLinks(html) +
    '</body></html>'
  );
}

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]]/gi;

/** Plain text split into text and http(s) links, for showing with clickable links (React escapes the text). */
export function linkifyText(text: string): ({ text: string } | { href: string })[] {
  const out: ({ text: string } | { href: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at) });
    out.push({ href: m[0] });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
