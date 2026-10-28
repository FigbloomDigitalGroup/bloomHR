import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import BrandMark from './BrandMark';
import { Eyebrow } from './previews/parts';

// Layout pieces every section of the landing page uses.

const TONES = {
  page: 'bg-page text-ink',
  white: 'bg-white text-ink',
  tint: 'bg-green-tint/60 text-ink',
  brand: 'lp-dark bg-brand text-white',
} as const;

interface SectionProps {
  id?: string;
  /** the id of the heading inside, so the section has a name for screen readers */
  labelledBy?: string;
  tone?: keyof typeof TONES;
  className?: string;
  children: ReactNode;
}

export function Section({ id, labelledBy, tone = 'page', className = '', children }: SectionProps) {
  return (
    <section id={id} tabIndex={id ? -1 : undefined} aria-labelledby={labelledBy} className={`relative scroll-mt-16 overflow-hidden outline-none ${TONES[tone]} ${className}`}>
      {children}
    </section>
  );
}

/** The page's width: wide enough for the product, with a gutter that never drops below 20px. */
export function Container({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`mx-auto w-full max-w-[1240px] px-5 sm:px-8 ${className}`}>{children}</div>;
}

interface HeadingProps {
  id: string;
  eyebrow: string;
  title: string;
  text?: string;
  dark?: boolean;
  className?: string;
}

export function SectionHeading({ id, eyebrow, title, text, dark = false, className = '' }: HeadingProps) {
  return (
    <div className={`max-w-[44rem] ${className}`} data-reveal>
      <Eyebrow className={dark ? 'text-white/70' : 'text-brand'}>{eyebrow}</Eyebrow>
      <h2 id={id} className="m-0 mt-3 text-[clamp(2rem,1.25rem+2.6vw,3.35rem)] font-semibold leading-[1.05] tracking-[-0.032em]">
        {title}
      </h2>
      {text && <p className={`m-0 mt-4 max-w-[38rem] text-[17px] leading-relaxed ${dark ? 'text-white/75' : 'text-gray-600'}`}>{text}</p>}
    </div>
  );
}

/** A tinted stage that a product picture sits on. */
export function Stage({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-[28px] bg-green-tint/70 p-5 sm:p-8 ${className}`}>
      <BrandMark outline className="pointer-events-none absolute -bottom-20 -right-16 h-72 w-72 text-brand/[0.08]" />
      <div className="relative">{children}</div>
    </div>
  );
}

// written out in full so the stylesheet keeps each one (see the components layer in index.css)
const VARIANTS = {
  primary: 'lp-btn-primary',
  secondary: 'lp-btn-secondary',
  light: 'lp-btn-light',
  'ghost-light': 'lp-btn-ghost-light',
} as const;

interface CtaProps {
  href: string;
  variant?: keyof typeof VARIANTS;
  arrow?: boolean;
  className?: string;
  children: ReactNode;
}

/** A call to action. A plain link: it leads to a page of the app, which opens fresh. */
export function Cta({ href, variant = 'primary', arrow = false, className = '', children }: CtaProps) {
  return (
    <a href={href} className={`lp-btn ${VARIANTS[variant]} ${className}`}>
      {children}
      {arrow && <ArrowRight size={17} strokeWidth={2.2} className="lp-btn-arrow" aria-hidden="true" />}
    </a>
  );
}
