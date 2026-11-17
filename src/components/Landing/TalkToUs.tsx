import { Mail } from 'lucide-react';
import { CTA, LINKS, SITE, TALK } from '../../lib/landing';
import { Container, Cta, Section, SectionHeading } from './Section';

// No price list: pricing and set-up are a conversation. This section opens an email to the address on the page. A plain
// mailto: link, so there is no form to protect, store or answer.

export default function TalkToUs() {
  return (
    <Section id="talk" labelledBy="talk-title" tone="tint" className="py-20 sm:py-28">
      <Container className="grid items-center gap-8 lg:grid-cols-2 lg:gap-20">
        <SectionHeading id="talk-title" eyebrow={TALK.eyebrow} title={TALK.title} text={TALK.text} />
        <div data-reveal>
          <div className="flex flex-wrap items-center gap-3">
            <Cta href={LINKS.mail} arrow>
              <Mail size={17} aria-hidden="true" />
              {CTA.talk}
            </Cta>
            <Cta href={LINKS.create} variant="secondary">
              {CTA.primary}
            </Cta>
          </div>
          <p className="m-0 mt-4 text-[14px] text-gray-600">
            <a href={`mailto:${SITE.email}`} className="font-semibold text-brand underline underline-offset-4">
              {SITE.email}
            </a>
          </p>
        </div>
      </Container>
    </Section>
  );
}
