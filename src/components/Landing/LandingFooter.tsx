import { CTA, FOOTER, LINKS, SITE } from '../../lib/landing';
import { LEGAL_REVIEWED } from '../../lib/legalGate';
import BrandMark from './BrandMark';
import { Container } from './Section';
import { Eyebrow } from './previews/parts';

// The footer: where things are, how to reach someone, and the small print. The Privacy Policy and Terms links appear
// only once those pages are approved (src/lib/legalGate.ts), so no link on this page leads nowhere.

// an address can break anywhere: with larger text the columns are narrow and "hr@figbloom.org" is a long word
const linkClass = 'inline-flex min-h-9 items-center text-[15px] text-gray-600 transition-colors [overflow-wrap:anywhere] hover:text-ink';

export default function LandingFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border bg-white">
      <Container className="py-14 sm:py-16">
        <div className="grid gap-10 md:grid-cols-[minmax(0,1.5fr)_repeat(2,minmax(0,1fr))]">
          <div>
            <a href="#top" className="inline-flex items-center gap-2.5" aria-label="FigbloomHR, back to the top">
              <BrandMark className="h-8 w-8 text-brand" />
              <span className="text-[20px] font-semibold tracking-[-0.02em] text-ink">
                Figbloom<span className="font-light text-ink/60">HR</span>
              </span>
            </a>
            <p className="m-0 mt-4 max-w-[19rem] text-[15px] leading-relaxed text-gray-600">{FOOTER.tagline}</p>
          </div>

          <nav aria-label="Account">
            <Eyebrow className="text-muted-foreground">Get started</Eyebrow>
            <ul className="m-0 mt-3 list-none p-0">
              <li>
                <a href={LINKS.create} className={linkClass}>
                  {CTA.primary}
                </a>
              </li>
              <li>
                <a href={LINKS.signIn} className={linkClass}>
                  {CTA.signIn}
                </a>
              </li>
              <li>
                <a href="#talk" className={linkClass}>
                  {CTA.talk}
                </a>
              </li>
            </ul>
          </nav>

          <div>
            <Eyebrow className="text-muted-foreground">Contact</Eyebrow>
            <ul className="m-0 mt-3 list-none p-0">
              <li>
                <a href={`mailto:${SITE.email}`} className={linkClass}>
                  {SITE.email}
                </a>
              </li>
              {LEGAL_REVIEWED && (
                <>
                  <li>
                    <a href="/privacy" className={linkClass}>
                      Privacy Policy
                    </a>
                  </li>
                  <li>
                    <a href="/terms" className={linkClass}>
                      Terms of Service
                    </a>
                  </li>
                </>
              )}
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-border pt-6 text-[13px] leading-snug text-gray-600 sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0">
            © {year} {SITE.legalName}
          </p>
          <p className="m-0">{FOOTER.illustrative}</p>
        </div>
      </Container>
    </footer>
  );
}
