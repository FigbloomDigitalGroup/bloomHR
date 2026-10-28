import type { CSSProperties } from 'react';
import { CheckCircle2, Lock } from 'lucide-react';
import { CTA, HERO, LINKS } from '../../lib/landing';
import BrandMark from './BrandMark';
import PhotoCard from './PhotoCard';
import { jumpTo } from './hooks';
import { useLanding } from './context';
import { Container, Cta, Section } from './Section';
import DashboardPreview from './previews/DashboardPreview';

// The first screen: what Figbloom HR is, the two ways in, and the product itself. A photograph sits behind a real
// dashboard, with two small notices floating over them: layers of the actual product, not decoration. On a phone the
// layers are simplified (the photo and the dashboard) rather than shrunk.

const delay = (ms: number) => ({ '--lp-delay': `${ms}ms` }) as CSSProperties;

const chip = 'lp-rise absolute z-20 hidden items-center gap-3 rounded-card border border-white/70 bg-white/90 p-3 pr-5 shadow-[0_24px_60px_-18px_rgba(14,38,25,0.45)] backdrop-blur-md lg:flex';

export default function Hero() {
  const { reduce } = useLanding();
  return (
    <Section id="top" labelledBy="hero-title" className="pb-16 pt-28 sm:pb-20 sm:pt-32 lg:pb-28 lg:pt-36">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -right-48 -top-48 h-[760px] w-[760px] rounded-full bg-[radial-gradient(closest-side,rgb(var(--tint)),transparent)]" />
        <BrandMark outline className="absolute -right-36 top-4 hidden h-[640px] w-[640px] text-brand/[0.1] lg:block" />
      </div>

      <Container className="relative grid items-center gap-14 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-6">
        <div>
          <p className="lp-rise m-0 inline-flex items-center gap-2 rounded-pill border border-border bg-white/80 px-3.5 py-1.5 text-[12.5px] font-semibold text-ink backdrop-blur" style={delay(0)}>
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-orange" />
            {HERO.eyebrow}
          </p>
          <h1
            id="hero-title"
            className="lp-rise m-0 mt-6 text-[clamp(2.6rem,1.3rem+5.4vw,5rem)] font-semibold leading-[1] tracking-[-0.04em] text-ink lg:text-[3.75rem] xl:text-[4.5rem] min-[1440px]:text-[5rem]"
            style={delay(80)}
          >
            {HERO.lead} <span className="font-light text-ink/55">{HERO.tail}</span>
          </h1>
          <p className="lp-rise m-0 mt-6 max-w-[30rem] text-[clamp(1.05rem,1rem+0.3vw,1.2rem)] leading-relaxed text-gray-600" style={delay(160)}>
            <span className="font-semibold text-ink">{HERO.problem}</span> {HERO.text}
          </p>
          <div className="lp-rise mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center" style={delay(240)}>
            <Cta href={LINKS.create} arrow>
              {CTA.primary}
            </Cta>
            <a
              href="#features"
              onClick={(event) => {
                event.preventDefault();
                jumpTo('features', reduce);
              }}
              className="lp-btn lp-btn-secondary"
            >
              {CTA.secondary}
            </a>
          </div>
          <ul className="lp-rise m-0 mt-8 flex list-none flex-wrap gap-x-6 gap-y-2.5 p-0" style={delay(360)}>
            {HERO.trust.map((item) => (
              <li key={item.text} className="flex items-center gap-2 text-[13.5px] font-medium text-ink">
                <CheckCircle2 size={16} className="shrink-0 text-status-success" aria-hidden="true" />
                {item.text}
              </li>
            ))}
          </ul>
        </div>

        {/* the product: a photograph at the back, the dashboard in front, and two notices; the face stays clear of the dashboard */}
        <div className="relative mx-auto w-full max-w-[620px] lg:h-[600px] lg:max-w-none">
          <div className="lp-rise ml-auto w-[94%] lg:absolute lg:right-0 lg:top-0 lg:ml-0 lg:w-[60%]" style={delay(200)}>
            <div className="lp-parallax">
              <PhotoCard
                photo="office"
                eager
                ratio={null}
                sizes="(min-width: 1024px) 380px, 92vw"
                className="aspect-[4/3] shadow-[0_44px_90px_-44px_rgba(14,38,25,0.65)] lg:aspect-[4/5]"
              />
            </div>
          </div>

          <div className="lp-rise relative z-10 -mt-24 w-[96%] sm:-mt-32 lg:absolute lg:bottom-0 lg:left-0 lg:mt-0 lg:w-[76%]" style={delay(380)}>
            <DashboardPreview />
          </div>

          <div aria-hidden="true" className={`${chip} left-10 top-6`} style={delay(560)}>
            <span className="grid h-9 w-9 place-items-center rounded-tile bg-green-tint text-status-success">
              <CheckCircle2 size={17} />
            </span>
            <div>
              <div className="text-[13px] font-bold text-ink">Leave approved</div>
              <div className="text-[11.5px] text-muted-foreground">Amina Wanjiru · 5 days</div>
            </div>
          </div>

          <div aria-hidden="true" className={`${chip} -bottom-12 left-32`} style={delay(680)}>
            <span className="grid h-9 w-9 place-items-center rounded-tile bg-green-tint text-brand">
              <Lock size={16} />
            </span>
            <div>
              <div className="text-[13px] font-bold text-ink">October payroll</div>
              <div className="text-[11.5px] text-muted-foreground">Kenya approved · files ready</div>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}
