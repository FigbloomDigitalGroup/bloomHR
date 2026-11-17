import type { CSSProperties } from 'react';
import { PAYROLL } from '../../lib/landing';
import BrandMark from './BrandMark';
import { Container, Section, SectionHeading } from './Section';
import PayslipPreview from './previews/PayslipPreview';

// Payroll is what Figbloom HR is chiefly used for, so it gets a band of its own: the way a month is run, in four steps,
// and a payslip. The last step is the honest one: the money is not sent from here.

export default function PayrollBand() {
  return (
    <Section id="payroll" labelledBy="payroll-title" tone="brand" className="py-20 sm:py-28">
      <BrandMark outline className="lp-drift pointer-events-none absolute -left-44 -top-36 h-[640px] w-[640px] text-white/[0.07]" />
      <Container className="relative grid items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] lg:gap-20">
        <div>
          <SectionHeading dark id="payroll-title" eyebrow={PAYROLL.eyebrow} title={PAYROLL.title} text={PAYROLL.text} />
          <ol className="m-0 mt-10 list-none p-0">
            {PAYROLL.steps.map((step, index) => (
              <li key={step.title} className="grid grid-cols-[2.5rem_1fr] gap-x-3 border-t border-white/15 py-5 last:border-b" data-reveal style={{ '--lp-delay': `${index * 70}ms` } as CSSProperties}>
                <span aria-hidden="true" className="font-mono text-[13px] font-medium text-white/60">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div>
                  <h3 className="m-0 text-[19px] font-semibold tracking-[-0.015em]">{step.title}</h3>
                  <p className="m-0 mt-1.5 text-[15.5px] leading-relaxed text-white/75">{step.text.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div data-reveal style={{ '--lp-delay': '120ms' } as CSSProperties}>
          <PayslipPreview />
          <p className="m-0 mt-4 text-[13px] leading-snug text-white/60">{PAYROLL.sampleNote}</p>
        </div>
      </Container>
    </Section>
  );
}
