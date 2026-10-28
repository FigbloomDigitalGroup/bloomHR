import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { FAQ, PRICING_QUESTION } from '../../lib/landing';
import { Container, Section, SectionHeading } from './Section';

// Questions people ask before signing, answered from what the product does (every answer is a Fact in src/lib/landing.ts,
// except the last, which sends them to a conversation). An accordion any number of which can be open: each question is a
// button that says whether its answer is showing, and a closed answer is hidden from everyone, not just from sight.

const ITEMS = [...FAQ.map((item) => ({ q: item.q, a: item.a.text })), { q: PRICING_QUESTION.q, a: PRICING_QUESTION.a }];

export default function Faq() {
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set([0]));
  const toggle = (index: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(index)) next.add(index);
      return next;
    });

  return (
    <Section id="faq" labelledBy="faq-title" className="py-20 sm:py-28">
      <Container className="grid gap-12 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-20">
        <SectionHeading id="faq-title" eyebrow="FAQ" title="Questions, answered plainly." />
        <div data-reveal>
          {ITEMS.map((item, index) => {
            const isOpen = open.has(index);
            return (
              <div key={item.q} className="border-t border-border last:border-b">
                <h3 className="m-0">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`faq-a-${index}`}
                    onClick={() => toggle(index)}
                    className="flex min-h-14 w-full items-center justify-between gap-6 py-4 text-left text-[17px] font-semibold tracking-[-0.01em] text-ink"
                  >
                    {item.q}
                    <ChevronDown size={20} aria-hidden="true" className={`shrink-0 text-brand transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                </h3>
                {/* no role="region": with this many answers open at once they would crowd a screen reader's list of landmarks */}
                <div id={`faq-a-${index}`} hidden={!isOpen} className="lp-open pb-5 pr-10">
                  <p className="m-0 text-[16px] leading-relaxed text-gray-600">{item.a}</p>
                </div>
              </div>
            );
          })}
        </div>
      </Container>
    </Section>
  );
}
