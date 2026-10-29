import { ShieldCheck } from 'lucide-react';
import { SECURITY } from '../../lib/landing';
import { Container, Section, SectionHeading } from './Section';

// What the product does about sensitive data, in the words the code supports and no more: there are no certifications,
// uptime figures or hosting promises on this page.

export function Security() {
  return (
    <Section id="security" labelledBy="security-title" className="py-20 sm:py-28">
      <Container className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
        <SectionHeading id="security-title" eyebrow="Security" title={SECURITY.title} />
        <ul className="m-0 list-none p-0" data-reveal>
          {SECURITY.points.map((point) => (
            <li key={point.text} className="flex items-start gap-3.5 border-t border-border py-4 text-[16px] leading-snug text-ink last:border-b">
              <ShieldCheck size={19} className="mt-0.5 shrink-0 text-status-success" aria-hidden="true" />
              {point.text}
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  );
}
