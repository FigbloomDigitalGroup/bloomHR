import type { CSSProperties } from 'react';
import { OUTCOMES, type Outcome } from '../../lib/landing';
import PhotoCard, { FloatingCard } from './PhotoCard';
import { Container, Section, SectionHeading, Stage } from './Section';
import { ApprovalChainCard, OnboardingReviewCard, OutcomesCard } from './previews/Cards';
import { Panel, PreviewFrame } from './previews/parts';
import { PayrollRunPreview } from './previews/Panels';

// The problems HR teams know, each turned into what changes, in one line. Four editorial rows with a picture of the product
// (or a photograph with a card over it) beside them, alternating sides, so the page reads as a story and not a grid of cards.

function Visual({ id }: { id: Outcome['id'] }) {
  switch (id) {
    case 'records':
      return (
        <Stage>
          <Panel className="mx-auto max-w-[440px] p-5">
            <PreviewFrame label="Sample onboarding review: three sections approved and one sent back with a comment.">
              <OnboardingReviewCard />
            </PreviewFrame>
          </Panel>
        </Stage>
      );
    case 'approvals':
      return (
        <Stage>
          <Panel className="mx-auto max-w-[440px] p-5">
            <PreviewFrame label="Sample approval chain: the line manager approved, HR is next, then payroll is informed.">
              <ApprovalChainCard />
            </PreviewFrame>
          </Panel>
        </Stage>
      );
    case 'month-end':
      return (
        <Stage>
          <PayrollRunPreview className="mx-auto max-w-[460px]" />
        </Stage>
      );
    case 'visibility':
      return (
        <PhotoCard photo="team" ratio="4 / 3" sizes="(min-width: 1800px) 810px, (min-width: 1536px) 725px, (min-width: 1024px) 640px, 92vw" className="shadow-[0_40px_90px_-48px_rgba(14,38,25,0.6)]">
          <FloatingCard className="bottom-4 left-4 right-4 sm:right-auto">
            <OutcomesCard />
          </FloatingCard>
        </PhotoCard>
      );
  }
}

export default function Outcomes() {
  return (
    <Section id="changes" labelledBy="changes-title" className="py-20 sm:py-28">
      <Container>
        <SectionHeading id="changes-title" eyebrow="What changes" title="From chasing to knowing." />
        <div className="mt-14 space-y-20 sm:mt-16 sm:space-y-28">
          {OUTCOMES.map((outcome, index) => (
            <article key={outcome.id} className="grid items-center gap-8 lg:grid-cols-12 lg:gap-14" data-reveal>
              <div className={`min-w-0 lg:col-span-5 ${index % 2 ? 'lg:order-2' : ''}`}>
                <div className="flex items-center gap-3">
                  <span aria-hidden="true" className="font-mono text-[13px] font-medium text-brand">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span aria-hidden="true" className="h-px w-10 bg-brand/30" />
                  <span className="text-[13px] font-semibold text-muted-foreground">From {outcome.from.toLowerCase()}</span>
                </div>
                <h3 className="m-0 mt-4 text-[clamp(1.65rem,1.1rem+1.6vw,2.5rem)] font-semibold leading-[1.08] tracking-[-0.03em]">{outcome.text.text}</h3>
              </div>
              <div className={`min-w-0 lg:col-span-7 ${index % 2 ? 'lg:order-1' : ''}`} style={{ '--lp-delay': '120ms' } as CSSProperties}>
                <Visual id={outcome.id} />
              </div>
            </article>
          ))}
        </div>
      </Container>
    </Section>
  );
}
