import { useState } from 'react';
import { Check } from 'lucide-react';
import { ROLES, type Role } from '../../lib/landing';
import PhotoCard, { FloatingCard } from './PhotoCard';
import { Container, Section, SectionHeading, Stage } from './Section';
import { TabList } from './Tabs';
import { panelId, tabId } from './tabIds';
import { LeaveRequestCard, OnboardingReviewCard } from './previews/Cards';
import { PaymentsToMakeCard, RolesPreview, WaitingCard } from './previews/More';
import { Panel, PreviewFrame } from './previews/parts';

// Who it is for: each person who touches HR in a company, and what they get. The picture beside the words changes with
// the person: the roles screen for administrators, an onboarding review for HR, the finance list, a manager's queue, and
// an employee's leave request over a photograph.

function Visual({ id }: { id: Role['id'] }) {
  switch (id) {
    case 'admin':
      return (
        <Stage>
          <RolesPreview className="mx-auto max-w-[440px]" />
        </Stage>
      );
    case 'hr':
      return (
        <Stage>
          <Panel className="mx-auto max-w-[440px] p-5">
            <PreviewFrame label="Sample onboarding review: three sections approved and one sent back with a comment.">
              <OnboardingReviewCard />
            </PreviewFrame>
          </Panel>
        </Stage>
      );
    case 'finance':
      return (
        <Stage>
          <PaymentsToMakeCard className="mx-auto max-w-[460px]" />
        </Stage>
      );
    case 'managers':
      return (
        <Stage>
          <PreviewFrame label="Sample list of what is waiting for a manager's decision.">
            <WaitingCard title="Waiting for your decision" className="mx-auto max-w-[400px] shadow-sm" />
          </PreviewFrame>
        </Stage>
      );
    case 'employees':
      return (
        <PhotoCard photo="lounge" ratio="4 / 3" sizes="(min-width: 1024px) 640px, 92vw" className="shadow-[0_40px_90px_-48px_rgba(14,38,25,0.6)]">
          <FloatingCard className="right-4 top-4 hidden sm:block">
            <LeaveRequestCard />
          </FloatingCard>
          <FloatingCard className="bottom-4 left-4 right-4 sm:hidden">
            <LeaveRequestCard />
          </FloatingCard>
        </PhotoCard>
      );
  }
}

export default function Roles() {
  const [active, setActive] = useState<Role['id']>('admin');
  const role = ROLES.find((r) => r.id === active) ?? ROLES[0];

  return (
    <Section id="roles" labelledBy="roles-title" tone="white" className="py-20 sm:py-28">
      <Container>
        <SectionHeading id="roles-title" eyebrow="Who it's for" title="Built for everyone who touches HR." />

        <div className="mt-10" data-reveal>
          {/* the padding leaves room for the focus ring, which an overflow container would otherwise cut off */}
          <div className="lp-scroll-x -mx-5 -my-2 overflow-x-auto px-5 py-2 sm:-mx-2 sm:px-2">
            <TabList
              label="Roles"
              prefix="role"
              tabs={ROLES}
              active={active}
              onSelect={setActive}
              className="flex w-max gap-2 sm:w-auto sm:flex-wrap"
              tabClassName={(on) => `lp-tab ${on ? 'lp-tab-on' : ''}`}
            >
              {(item) => item.label}
            </TabList>
          </div>

          <div
            key={role.id}
            role="tabpanel"
            id={panelId('role', role.id)}
            aria-labelledby={tabId('role', role.id)}
            tabIndex={0}
            className="lp-swap mt-8 grid items-center gap-8 rounded-[28px] outline-offset-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14"
          >
            <div>
              <h3 className="m-0 text-[clamp(1.65rem,1.1rem+1.7vw,2.6rem)] font-semibold leading-[1.07] tracking-[-0.03em]">{role.title}</h3>
              <ul className="m-0 mt-6 list-none space-y-3.5 p-0">
                {role.points.map((point) => (
                  <li key={point.text} className="flex items-start gap-3 text-[15.5px] leading-snug text-ink">
                    <span aria-hidden="true" className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-green-tint text-brand">
                      <Check size={12} strokeWidth={3} />
                    </span>
                    {point.text}
                  </li>
                ))}
              </ul>
            </div>
            <div className="min-w-0">
              <Visual id={role.id} />
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}
