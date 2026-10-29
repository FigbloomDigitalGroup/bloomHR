import { useRef, type CSSProperties, type ReactNode } from 'react';
import { ArrowRight, Check, MapPin } from 'lucide-react';
import { STEPS } from '../../lib/landing';
import { useLanding } from './context';
import { useStepSequence } from './hooks';
import { Container, Section, SectionHeading } from './Section';
import { Initials, Panel, SampleTag } from './previews/parts';
import { PAYSLIP_SAMPLE } from './previews/payslipSample';

// Four steps from sign-up to the first month closed. They light one after another as they come into view: the circle
// fills, the line runs on to it, and a small picture of the step draws itself (a name typed, branches placed, people
// approved, the month ticked off). It plays once. The words are on the page the whole time, only dimmed until their turn,
// and a visitor who wants less motion, or whose browser cannot tell what is on screen, sees every step lit and still.
// The pictures are illustrations with made-up names, and they say so.

const after = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties;

const chip = 'inline-flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] font-semibold';

/** One line of a scene: it arrives `ms` after its step lights. */
function Line({ ms, className = '', children }: { ms: number; className?: string; children: ReactNode }) {
  return (
    <div className={`lp-s ${className}`} style={after(ms)}>
      {children}
    </div>
  );
}

// 1: the company is named and its creator becomes the administrator
function CreateScene() {
  return (
    <div className="space-y-2.5">
      <Line ms={0} className="text-[10.5px] font-medium text-muted-foreground">
        Company name
      </Line>
      <Line ms={120} className="rounded-tile border border-border bg-white px-3 py-2 text-[13px] font-semibold text-ink">
        <span className="lp-wipe inline-block" style={{ ...after(380), '--n': PAYSLIP_SAMPLE.company.length } as CSSProperties}>
          {PAYSLIP_SAMPLE.company}
        </span>
      </Line>
      <Line ms={1500}>
        <span className={`${chip} rounded-pill bg-green-tint text-brand`}>
          <Check size={12} strokeWidth={3} aria-hidden="true" />
          Administrator
        </span>
      </Line>
    </div>
  );
}

// 2: branches are placed, and a chain of approvers is drawn
function SetUpScene() {
  const branches = ['Nairobi HQ', 'Mombasa', 'Kisumu'];
  const chain = ['Manager', 'HR', 'Payroll'];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {branches.map((name, i) => (
          <Line key={name} ms={i * 170} className={`${chip} rounded-tile border border-border bg-white text-ink`}>
            <MapPin size={12} className="text-brand" aria-hidden="true" />
            {name}
          </Line>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
        {chain.map((name, i) => (
          <span key={name} className="inline-flex items-center gap-1.5">
            {i > 0 && (
              <Line ms={700 + i * 220 - 110}>
                <ArrowRight size={12} className="text-muted-foreground" aria-hidden="true" />
              </Line>
            )}
            <Line ms={700 + i * 220} className={`${chip} rounded-pill bg-green-tint text-brand`}>
              {name}
            </Line>
          </span>
        ))}
      </div>
    </div>
  );
}

// 3: people arrive and HR approves each one
function PeopleScene() {
  const people = [
    { name: 'Amina Wanjiru', short: 'Amina', tone: 'tint' },
    { name: 'Brian Otieno', short: 'Brian', tone: 'brand' },
    { name: 'Faith Njeri', short: 'Faith', tone: 'orange' },
  ] as const;
  return (
    <div className="space-y-2.5">
      {people.map((person, i) => (
        <Line key={person.name} ms={i * 200} className="flex items-center gap-2.5">
          <Initials name={person.name} tone={person.tone} size={26} />
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">{person.short}</span>
          <span className="grid justify-items-end">
            <span className={`${chip} lp-flip-out col-start-1 row-start-1 rounded-pill bg-orange-tint-alt text-orange-text-alt`} style={after(1100 + i * 260)}>
              Pending
            </span>
            <span className={`${chip} lp-flip-in col-start-1 row-start-1 rounded-pill bg-green-tint text-brand`} style={after(1100 + i * 260)}>
              <Check size={12} strokeWidth={3} aria-hidden="true" />
              Approved
            </span>
          </span>
        </Line>
      ))}
    </div>
  );
}

// 4: the month is ticked off, ending where the product ends: marked paid, by the company's own team
function MonthScene() {
  const stages = ['Readiness checked', 'Payroll approved', 'Files downloaded', 'Marked paid'];
  return (
    <ul className="m-0 list-none space-y-2 p-0">
      {stages.map((label, i) => (
        <li key={label} className="flex items-center gap-2.5 text-[12.5px] font-semibold text-ink">
          <span className="lp-tick grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-brand text-white" style={after(250 + i * 520)}>
            <Check size={11} strokeWidth={3.2} aria-hidden="true" />
          </span>
          {label}
        </li>
      ))}
    </ul>
  );
}

const SCENES = [CreateScene, SetUpScene, PeopleScene, MonthScene];

export default function HowItWorks() {
  const { reduce } = useLanding();
  const list = useRef<HTMLOListElement>(null);
  const { lit, live } = useStepSequence(list, STEPS.length, reduce);
  // the line between circles runs to the last lit one; the first circle has nothing to run to
  const reach = STEPS.length > 1 ? Math.max(0, lit - 1) / (STEPS.length - 1) : 0;

  return (
    <Section id="how" labelledBy="how-title" className="py-20 sm:py-28">
      <Container>
        <SectionHeading id="how-title" eyebrow="How it works" title="From sign-up to month-end in four steps." />
        <div className="relative mt-14">
          {/* desktop: one line through the four circles, from the middle of the first to the middle of the last (a column and its gap are a quarter of the row) */}
          <div aria-hidden="true" className="pointer-events-none absolute left-5 top-5 hidden h-px w-[calc((100%+2rem)*0.75)] bg-brand/20 lg:block">
            <span className="lp-reach absolute inset-0 origin-left bg-brand" style={{ transform: `scaleX(${live ? reach : 1})` }} />
          </div>
          <ol ref={list} className="relative m-0 grid list-none gap-9 p-0 lg:grid-cols-4 lg:gap-8">
            {STEPS.map((step, index) => {
              const Scene = SCENES[index];
              return (
                <li key={step.title} data-step={index} data-lit={live ? (index < lit ? 'on' : 'off') : undefined} className="lp-step relative pl-14 lg:pl-0">
                  {/* phone and tablet: the line runs down the left, to the next circle */}
                  {index < STEPS.length - 1 && (
                    <span aria-hidden="true" className="absolute left-5 top-11 h-[calc(100%+0.75rem)] w-px bg-brand/20 lg:hidden">
                      <span className="lp-reach-down absolute inset-0 origin-top bg-brand" data-next={live ? (index + 1 < lit ? 'on' : 'off') : undefined} />
                    </span>
                  )}
                  {/* the list already says "item 2 of 4" to a screen reader */}
                  <span aria-hidden="true" className="lp-dot absolute left-0 top-0 z-10 grid h-10 w-10 place-items-center rounded-full border border-brand bg-brand font-mono text-[13px] font-medium text-white lg:relative">
                    {index + 1}
                  </span>
                  <div className="lp-step-body">
                    <h3 className="m-0 text-[21px] font-semibold tracking-[-0.02em] lg:mt-6">{step.title}</h3>
                    <p className="m-0 mt-2 text-[15.5px] leading-relaxed text-gray-600">{step.text.text}</p>
                    <Panel spot className="mt-5 min-h-[10.5rem] max-w-[26rem] p-4">
                      <div aria-hidden="true" className="select-none">
                        <Scene />
                      </div>
                    </Panel>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
        <div className="mt-8" data-reveal>
          <SampleTag />
        </div>
      </Container>
    </Section>
  );
}
