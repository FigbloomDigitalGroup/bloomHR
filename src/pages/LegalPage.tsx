import { useEffect } from 'react';
import { SITE } from '../lib/landing';
import { PRIVACY, TERMS } from '../lib/legal';
import BrandMark from '../components/Landing/BrandMark';
import { Container } from '../components/Landing/Section';

// The Privacy Policy (/privacy) and Terms of Service (/terms), shown once they are approved (src/lib/legalGate.ts). A
// plain, readable page: the text comes from src/lib/legal.ts. Like the landing page it has no app in it.

export default function LegalPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const doc = kind === 'terms' ? TERMS : PRIVACY;
  const other = kind === 'terms' ? { href: '/privacy', label: 'Privacy Policy' } : { href: '/terms', label: 'Terms of Service' };

  useEffect(() => {
    const previous = document.title;
    document.title = `${doc.title} | ${SITE.name}`;
    return () => {
      document.title = previous;
    };
  }, [doc.title]);

  return (
    <div className="lp min-h-screen bg-page font-sans text-ink">
      <header className="border-b border-border bg-white">
        <Container className="flex h-16 items-center justify-between">
          <a href="/" aria-label="Figbloom HR home" className="flex items-center gap-2.5">
            <BrandMark className="h-8 w-8 text-brand" />
            <span className="text-[20px] font-semibold tracking-[-0.02em]">
              Figbloom<span className="font-light text-ink/60">HR</span>
            </span>
          </a>
          <a href={other.href} className="lp-nav-link">
            {other.label}
          </a>
        </Container>
      </header>

      <main id="main" className="py-14 sm:py-20">
        <Container className="max-w-[46rem]">
          <h1 className="m-0 text-[clamp(2.2rem,1.4rem+3vw,3.4rem)] font-semibold leading-[1.05] tracking-[-0.035em]">{doc.title}</h1>
          <p className="m-0 mt-3 text-[14px] text-gray-600">Last updated {doc.updated}</p>
          {doc.intro.map((paragraph) => (
            <p key={paragraph} className="m-0 mt-5 text-[17px] leading-relaxed text-gray-600">
              {paragraph}
            </p>
          ))}
          {doc.sections.map((section) => (
            <section key={section.heading} className="mt-10">
              <h2 className="m-0 text-[22px] font-semibold tracking-[-0.02em]">{section.heading}</h2>
              {section.paragraphs?.map((paragraph) => (
                <p key={paragraph} className="m-0 mt-3 text-[16.5px] leading-relaxed text-gray-600">
                  {paragraph}
                </p>
              ))}
              {section.items && (
                <ul className="m-0 mt-3 list-disc space-y-2 pl-5 text-[16.5px] leading-relaxed text-gray-600">
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </Container>
      </main>

      <footer className="border-t border-border bg-white">
        <Container className="flex flex-col gap-2 py-8 text-[13px] text-gray-600 sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0">
            © {new Date().getFullYear()} {SITE.legalName}
          </p>
          <a href="/" className="font-semibold text-brand underline underline-offset-4">
            Back to {SITE.name}
          </a>
        </Container>
      </footer>
    </div>
  );
}
