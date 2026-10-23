import { describe, expect, it } from 'vitest';
import { MAIL_SANDBOX, hasRemoteContent, linkifyText, mailCsp, mailSrcDoc } from './mailHtml';

describe('showing email HTML', () => {
  it('blocks everything but inline styles and embedded images, until images are asked for (https only)', () => {
    expect(mailCsp(false)).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src data: cid:");
    expect(mailCsp(true)).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src https: data: cid:");
  });

  it('never lets the frame run scripts or share the app origin', () => {
    expect(MAIL_SANDBOX).not.toMatch(/allow-scripts|allow-same-origin|allow-forms|allow-top-navigation/);
  });

  it('puts the policy, no-referrer and new-tab links before the email, and fixes up its links', () => {
    const doc = mailSrcDoc(
      '<html><head><meta http-equiv="refresh" content="0;url=https://evil.example"><base href="https://evil.example/"></head>' +
        '<body><a href="https://client.co.ke/x">site</a><a href="javascript:alert(1)">bad</a><script>alert(1)</script></body></html>',
      false
    );
    const head = doc.slice(0, doc.indexOf('</head>'));
    expect(head).toContain(`<meta http-equiv="Content-Security-Policy" content="${mailCsp(false)}">`);
    expect(head).toContain('<meta name="referrer" content="no-referrer">');
    expect(head).toContain('<base target="_blank">');
    expect(doc).not.toContain('refresh');
    expect(doc).not.toContain('evil.example');
    expect(doc).toContain('<a href="https://client.co.ke/x" target="_blank" rel="noopener noreferrer">site</a>');
    expect(doc).not.toContain('javascript:');
    // scripts could never run there (no allow-scripts, default-src 'none'); they are dropped too
    expect(doc).not.toContain('<script');
  });

  it('knows when an email loads things from the internet', () => {
    expect(hasRemoteContent('<img src="https://t.example/p.gif">')).toBe(true);
    expect(hasRemoteContent('<td background="//cdn.example/bg.png">')).toBe(true);
    expect(hasRemoteContent('<div style="background:url(\'http://x.example/a.png\')">')).toBe(true);
    expect(hasRemoteContent('<img src="data:image/png;base64,AAAA"><p>Hi</p>')).toBe(false);
  });

  it('makes web links in plain text clickable, leaving the rest as text', () => {
    expect(linkifyText('See https://client.co.ke/pay?id=1. Or <b>not</b> javascript:alert(1)')).toEqual([
      { text: 'See ' },
      { href: 'https://client.co.ke/pay?id=1' },
      { text: '. Or <b>not</b> javascript:alert(1)' },
    ]);
  });
});
