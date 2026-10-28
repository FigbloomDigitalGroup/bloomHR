import type { CSSProperties } from 'react';
import { CTA, FINAL, LINKS } from '../../lib/landing';
import BrandMark from './BrandMark';
import PhotoCard, { FloatingCard } from './PhotoCard';
import { Container, Cta, Section } from './Section';
import { ModuleListCard } from './previews/Cards';

// The last word: one main action, one quiet one, on the deep green of the brand. The photograph carries the welcome card
// (the first thing a new company sees is a workspace with these parts in it), and the mark is drawn very large behind.

export default function FinalCta() {
  return (
    <Section labelledBy="final-title" tone="brand" className="py-20 sm:py-28">
      <BrandMark outline className="pointer-events-none absolute -left-40 top-1/2 h-[760px] w-[760px] -translate-y-1/2 text-white/[0.07]" />
      <Container className="relative grid items-center gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-16">
        <div data-reveal>
          <h2 id="final-title" className="m-0 text-[clamp(2.2rem,1.2rem+4vw,4.4rem)] font-semibold leading-[1.02] tracking-[-0.035em]">
            {FINAL.title}
          </h2>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Cta href={LINKS.create} variant="light" arrow>
              {CTA.primary}
            </Cta>
            <Cta href="#talk" variant="ghost-light">
              {CTA.talk}
            </Cta>
          </div>
        </div>
        <div data-reveal style={{ '--lp-delay': '120ms' } as CSSProperties}>
          <PhotoCard photo="office" repeat ratio="4 / 3" sizes="(min-width: 1024px) 560px, 92vw" className="shadow-[0_44px_90px_-40px_rgba(0,0,0,0.65)]">
            <FloatingCard className="bottom-4 right-4 hidden sm:block">
              <ModuleListCard />
            </FloatingCard>
          </PhotoCard>
        </div>
      </Container>
    </Section>
  );
}
