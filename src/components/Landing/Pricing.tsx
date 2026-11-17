import { useState, type CSSProperties } from 'react';
import { CTA, LINKS, PRICING, group, kes } from '../../lib/landing';
import { useLanding } from './context';
import { useTween } from './hooks';
import { Container, Cta, Section, SectionHeading } from './Section';
import { Panel } from './previews/parts';

// The owner's price: a monthly amount for the company and a monthly amount for each active employee (PRICING in
// src/lib/landing.ts). Beside it, a slider to try a headcount: the total runs to its new figure and the bar shows how much
// of it is the company and how much is the staff. The slider is a plain range input, so it works by keyboard and says
// its value aloud; the figure that runs is hidden from screen readers, which are given the finished one.

function Price({ amount, note, plus = false }: { amount: number; note: string; plus?: boolean }) {
  return (
    <div>
      <p className="m-0 flex items-baseline gap-2 text-[clamp(2.4rem,1.6rem+3.4vw,4rem)] font-semibold leading-none tracking-[-0.04em] text-ink">
        {plus && (
          <span aria-hidden="true" className="font-light text-brand">
            +
          </span>
        )}
        <span>
          <span className="text-[0.4em] font-medium tracking-normal text-ink/55">{PRICING.currency}</span> {group(amount)}
        </span>
      </p>
      <p className="m-0 mt-2 text-[16px] leading-snug text-gray-600">{note}</p>
    </div>
  );
}

export default function Pricing() {
  const { reduce } = useLanding();
  const [count, setCount] = useState<number>(PRICING.start);
  const staff = count * PRICING.perEmployee;
  const total = PRICING.monthly + staff;
  const shown = useTween(total, reduce, 420);
  const companyShare = PRICING.monthly / total;
  const fill = ((count - PRICING.min) / (PRICING.max - PRICING.min)) * 100;

  return (
    <Section id="pricing" labelledBy="pricing-title" tone="white" className="py-20 sm:py-28">
      <Container className="grid items-center gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-20">
        <div>
          <SectionHeading id="pricing-title" eyebrow={PRICING.eyebrow} title={PRICING.title} />
          <div className="mt-10 space-y-7" data-reveal>
            <Price amount={PRICING.monthly} note={PRICING.monthlyNote} />
            <Price amount={PRICING.perEmployee} note={PRICING.perEmployeeNote} plus />
          </div>
          <div className="mt-10 flex flex-wrap items-center gap-3" data-reveal>
            <Cta href={LINKS.create} arrow>
              {CTA.primary}
            </Cta>
            <Cta href="#talk" variant="secondary">
              {CTA.talk}
            </Cta>
          </div>
        </div>

        <div data-reveal style={{ '--lp-delay': '120ms' } as CSSProperties}>
          <Panel spot className="p-6 sm:p-8">
            <div className="flex items-baseline justify-between gap-4">
              <label htmlFor="pricing-staff" className="text-[14px] font-semibold text-ink">
                {PRICING.estimate}
              </label>
              <span aria-hidden="true" className="text-[30px] font-semibold tabular-nums leading-none tracking-[-0.03em] text-brand">
                {count}
              </span>
            </div>
            <input
              id="pricing-staff"
              type="range"
              className="lp-range mt-2"
              min={PRICING.min}
              max={PRICING.max}
              step={1}
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
              aria-valuetext={`${count} active ${count === 1 ? 'employee' : 'employees'}, ${kes(total)} ${PRICING.perMonth}`}
              style={{ '--fill': `${fill}%` } as CSSProperties}
            />
            <div aria-hidden="true" className="flex justify-between font-mono text-[11px] text-muted-foreground">
              <span>{PRICING.min}</span>
              <span>{PRICING.max}</span>
            </div>

            <div className="mt-7 border-t border-border pt-6">
              <p className="m-0 flex flex-wrap items-baseline gap-x-3 text-ink">
                <span aria-hidden="true" className="text-[clamp(2rem,1.4rem+2.4vw,3rem)] font-semibold tabular-nums leading-none tracking-[-0.035em]">
                  {kes(shown)}
                </span>
                <span className="sr-only">{kes(total)}</span>
                <span className="text-[15px] text-gray-600">{PRICING.perMonth}</span>
              </p>
              <div aria-hidden="true" className="relative mt-5 h-2.5 overflow-hidden rounded-pill bg-brand/25">
                <div className="lp-bar-fill absolute inset-0 origin-left bg-brand" style={{ transform: `scaleX(${companyShare})` }} />
              </div>
              <ul className="m-0 mt-4 list-none space-y-1.5 p-0 text-[13.5px] text-gray-600">
                <li className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true" className="h-2 w-2 rounded-full bg-brand" />
                    Company
                  </span>
                  <span className="font-mono tabular-nums text-ink">{kes(PRICING.monthly)}</span>
                </li>
                <li className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true" className="h-2 w-2 rounded-full bg-brand/25" />
                    {count} × {kes(PRICING.perEmployee)}
                  </span>
                  <span className="font-mono tabular-nums text-ink">{kes(staff)}</span>
                </li>
              </ul>
            </div>
          </Panel>
        </div>
      </Container>
    </Section>
  );
}
