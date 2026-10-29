import type { CSSProperties } from 'react';
import { STEPS } from '../../lib/landing';
import { Container, Section, SectionHeading } from './Section';

// Four steps from sign-up to the first month closed. Joined by a line that draws itself once as the section comes into
// view (and is simply there for anyone who asks for less motion).

export default function HowItWorks() {
  return (
    <Section id="how" labelledBy="how-title" className="py-20 sm:py-28">
      <Container>
        <SectionHeading id="how-title" eyebrow="How it works" title="From sign-up to month-end in four steps." />
        <ol className="relative m-0 mt-14 grid list-none gap-9 p-0 lg:grid-cols-4 lg:gap-8">
          <li aria-hidden="true" className="lp-line pointer-events-none absolute left-5 right-5 top-5 hidden h-px bg-brand/25 lg:block" data-reveal />
          {STEPS.map((step, index) => (
            <li key={step.title} className="relative pl-14 lg:pl-0" data-reveal style={{ '--lp-delay': `${index * 90}ms` } as CSSProperties}>
              {index < STEPS.length - 1 && <span aria-hidden="true" className="absolute left-5 top-11 h-[calc(100%+0.75rem)] w-px bg-brand/25 lg:hidden" />}
              {/* the list already says "item 2 of 4" to a screen reader */}
              <span aria-hidden="true" className="absolute left-0 top-0 z-10 grid h-10 w-10 place-items-center rounded-full border border-brand bg-page font-mono text-[13px] font-medium text-brand lg:relative">
                {index + 1}
              </span>
              <h3 className="m-0 text-[21px] font-semibold tracking-[-0.02em] lg:mt-6">{step.title}</h3>
              <p className="m-0 mt-2 text-[15.5px] leading-relaxed text-gray-600">{step.text.text}</p>
            </li>
          ))}
        </ol>
      </Container>
    </Section>
  );
}
