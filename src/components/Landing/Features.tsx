import { Check } from 'lucide-react';
import { ALSO, CTA, FEATURES, LINKS, type PreviewKey } from '../../lib/landing';
import { useLanding } from './context';
import { FEATURE_ICONS } from './featureIcons';
import PhotoCard, { FloatingCard } from './PhotoCard';
import { Container, Cta, Section, SectionHeading, Stage } from './Section';
import { TabList } from './Tabs';
import { panelId, tabId } from './tabIds';
import { ApprovalChainCard, LeaveRequestCard, PipelineCard } from './previews/Cards';
import { PaymentsToMakeCard } from './previews/More';
import { AttendancePreview, EmployeesPreview, KpiPreview, PayrollRunPreview, PhonePortalPreview } from './previews/Panels';
import { Panel, PreviewFrame } from './previews/parts';
import { WorkPayPreview } from './previews/Work';

// The showcase: the parts of the platform as tabs. Each shows what it is for, three short points and a picture of it.
// Every point is a Fact (src/lib/landing.ts): a sentence the product backs, with the files that show it.

function Preview({ id }: { id: PreviewKey }) {
  switch (id) {
    case 'people':
      return (
        <Stage>
          <EmployeesPreview count={2} />
        </Stage>
      );
    case 'leave':
      return (
        <Stage>
          <div className="grid gap-4 sm:grid-cols-2">
            <Panel className="p-4">
              <PreviewFrame label="Sample leave request form: leave type, dates, working days and a reason.">
                <LeaveRequestCard />
              </PreviewFrame>
            </Panel>
            <Panel className="p-4">
              <PreviewFrame label="Sample approval chain for the request: the line manager approved, HR is next.">
                <ApprovalChainCard />
              </PreviewFrame>
            </Panel>
          </div>
        </Stage>
      );
    case 'attendance':
      return (
        <Stage>
          <AttendancePreview />
        </Stage>
      );
    case 'payroll':
      return (
        <Stage>
          <PayrollRunPreview className="mx-auto max-w-[480px]" />
        </Stage>
      );
    case 'work':
      return (
        <Stage>
          <WorkPayPreview className="mx-auto max-w-[480px]" />
        </Stage>
      );
    case 'approvals':
      return (
        <Stage>
          <div className="grid gap-4 sm:grid-cols-2">
            <Panel className="p-4">
              <PreviewFrame label="Sample approval chain.">
                <ApprovalChainCard />
              </PreviewFrame>
            </Panel>
            <PaymentsToMakeCard />
          </div>
        </Stage>
      );
    case 'hiring':
      return (
        <PhotoCard photo="interview" ratio="4 / 3" sizes="(min-width: 1024px) 640px, 92vw" className="shadow-[0_40px_90px_-48px_rgba(14,38,25,0.6)]">
          <FloatingCard className="right-4 top-4 hidden sm:block">
            <PipelineCard />
          </FloatingCard>
          <FloatingCard className="bottom-4 left-4 right-4 sm:hidden">
            <PipelineCard />
          </FloatingCard>
        </PhotoCard>
      );
    case 'performance':
      return (
        <Stage>
          <KpiPreview className="mx-auto max-w-[480px]" />
        </Stage>
      );
    case 'portal':
      return (
        <Stage>
          <PhonePortalPreview />
        </Stage>
      );
  }
}

export default function Features() {
  const { tab, setTab } = useLanding();
  const feature = FEATURES.find((f) => f.id === tab) ?? FEATURES[0];

  return (
    <Section id="features" labelledBy="features-title" tone="white" className="py-20 sm:py-28">
      <Container>
        <SectionHeading id="features-title" eyebrow="The platform" title="Everything HR runs on, in one place." />

        <div className="mt-10" data-reveal>
          {/* the padding leaves room for the focus ring, which an overflow container would otherwise cut off */}
          <div className="lp-scroll-x -mx-5 -my-2 overflow-x-auto px-5 py-2 sm:-mx-2 sm:px-2">
            <TabList
              label="Parts of the platform"
              prefix="feature"
              tabs={FEATURES}
              active={tab}
              onSelect={setTab}
              className="flex w-max gap-2 sm:w-auto sm:flex-wrap"
              tabClassName={(on) => `lp-tab ${on ? 'lp-tab-on' : ''}`}
            >
              {(item) => {
                const Icon = FEATURE_ICONS[item.id];
                return (
                  <>
                    <Icon size={16} aria-hidden="true" />
                    {item.label}
                  </>
                );
              }}
            </TabList>
          </div>

          <div
            key={feature.id}
            role="tabpanel"
            id={panelId('feature', feature.id)}
            aria-labelledby={tabId('feature', feature.id)}
            tabIndex={0}
            className="lp-swap mt-8 grid items-center gap-8 rounded-[28px] outline-offset-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14"
          >
            <div>
              <h3 className="m-0 text-[clamp(1.65rem,1.1rem+1.7vw,2.6rem)] font-semibold leading-[1.07] tracking-[-0.03em]">{feature.title}</h3>
              <ul className="m-0 mt-6 list-none space-y-3.5 p-0">
                {feature.benefits.map((benefit) => (
                  <li key={benefit.text} className="flex items-start gap-3 text-[15.5px] leading-snug text-ink">
                    <span aria-hidden="true" className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-green-tint text-brand">
                      <Check size={12} strokeWidth={3} />
                    </span>
                    {benefit.text}
                  </li>
                ))}
              </ul>
              <Cta href={LINKS.create} arrow className="mt-8">
                {CTA.primary}
              </Cta>
            </div>
            <div className="min-w-0">
              <Preview id={feature.id} />
            </div>
          </div>
          <p className="m-0 mt-12 border-t border-border pt-5 text-[15px] leading-relaxed text-gray-600">{ALSO.text}</p>
        </div>
      </Container>
    </Section>
  );
}
