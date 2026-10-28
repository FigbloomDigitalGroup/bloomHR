import type { CSSProperties } from 'react';
import { CTA, LINKS, WHY } from '../../lib/landing';
import { Container, Cta, Section, SectionHeading } from './Section';

// What Figbloom is built around, as a ruled list of things a visitor can check. It is not a ranking: there are no customers,
// benchmarks or reviews to back "the best", so each point says what the product does and the page ends by inviting the
// visitor to look for themselves.

export default function Why() {
  return (
    <Section id="why" labelledBy="why-title" tone="tint" className="py-20 sm:py-28">
      <Container>
        <SectionHeading id="why-title" eyebrow={WHY.eyebrow} title={WHY.title} />
        <ol className="m-0 mt-12 list-none p-0 sm:mt-14">
          {WHY.points.map((point, index) => (
            <li
              key={point.title}
              className="grid gap-x-16 gap-y-3 border-t border-border py-7 last:border-b sm:py-9 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]"
              data-reveal
              style={{ '--lp-delay': `${index * 70}ms` } as CSSProperties}
            >
              <h3 className="m-0 flex items-baseline gap-4 text-[clamp(1.35rem,1.05rem+1vw,1.9rem)] font-semibold leading-tight tracking-[-0.025em]">
                <span aria-hidden="true" className="font-mono text-[13px] font-medium text-brand">
                  {String(index + 1).padStart(2, '0')}
                </span>
                {point.title}
              </h3>
              <p className="m-0 text-[16.5px] leading-relaxed text-gray-600">{point.text.text}</p>
            </li>
          ))}
        </ol>
        <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6" data-reveal>
          <Cta href={LINKS.create} arrow>
            {CTA.primary}
          </Cta>
          <p className="m-0 text-[15px] leading-snug text-gray-600">{WHY.close}</p>
        </div>
      </Container>
    </Section>
  );
}
