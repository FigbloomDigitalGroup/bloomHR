// Whether the Privacy Policy and Terms pages are live. They are drafts (src/lib/legal.ts) until the company's lawyer has
// approved them: false keeps /privacy and /terms off, and the landing page's footer shows no legal links. legal.test.ts
// refuses true while any [[placeholder]] is left in the text. When this turns true, add both pages to public/sitemap.xml.
//
// A tiny file of its own because src/main.tsx reads it before anything else loads.
export const LEGAL_REVIEWED: boolean = false;

export const LEGAL_PATHS = ['/privacy', '/terms'] as const;
