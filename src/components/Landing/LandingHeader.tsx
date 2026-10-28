import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { ChevronDown, Menu, X } from 'lucide-react';
import { AccessibilityButton } from '../Accessibility/AccessibilityModal';
import { CTA, FEATURES, LINKS, NAV, type PreviewKey } from '../../lib/landing';
import BrandMark from './BrandMark';
import { useLanding } from './context';
import { FEATURE_ICONS } from './featureIcons';
import { jumpTo, useScrolled } from './hooks';
import { Container, Cta } from './Section';

// The top bar: fixed, plain at the top of the page, with a border and a soft blur once the page has moved. One list opens
// (Features) and it jumps to the matching tab of the showcase; everything else is a place on this page, because the page
// has no others. Sign in and Create your company are the two ways into the app.

export default function LandingHeader() {
  const { setTab, reduce } = useLanding();
  const marker = useRef<HTMLDivElement>(null);
  const scrolled = useScrolled(marker);
  const [menu, setMenu] = useState(false);
  const [features, setFeatures] = useState(false);
  const featuresBox = useRef<HTMLDivElement>(null);
  const featuresButton = useRef<HTMLButtonElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const menuPanel = useRef<HTMLDivElement>(null);

  // the Features list closes with Escape (focus goes back to its button if it was in the list), a click anywhere else, or
  // when the keyboard leaves it (see onBlur below)
  useEffect(() => {
    if (!features) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const focusInside = featuresBox.current?.contains(document.activeElement);
      setFeatures(false);
      if (focusInside) featuresButton.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!featuresBox.current?.contains(event.target as Node)) setFeatures(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [features]);

  // the phone menu closes with Escape too; focus would otherwise fall to the top of the page when the link it was on is hidden
  useEffect(() => {
    if (!menu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const focusInside = menuPanel.current?.contains(document.activeElement);
      setMenu(false);
      if (focusInside) menuButton.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menu]);

  const go = (id: string) => (event: ReactMouseEvent) => {
    event.preventDefault();
    setMenu(false);
    setFeatures(false);
    jumpTo(id, reduce);
  };
  const openFeature = (tab: PreviewKey) => (event: ReactMouseEvent) => {
    event.preventDefault();
    setTab(tab);
    setMenu(false);
    setFeatures(false);
    jumpTo('features', reduce);
  };

  return (
    <>
      <div ref={marker} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 h-3 w-full" />
      <header className="lp-header lp-bar fixed inset-x-0 top-0 z-40" data-scrolled={scrolled || menu}>
        <Container className="flex h-16 items-center gap-3">
          <a href="#top" onClick={go('top')} aria-label="FigbloomHR, back to the top" className="flex shrink-0 items-center gap-2.5 rounded-tile">
            <BrandMark className="h-8 w-8 text-brand" />
            <span className="lp-bar-word text-[20px] font-semibold tracking-[-0.02em] text-ink">
              Figbloom<span className="font-light text-ink/60">HR</span>
            </span>
          </a>

          {/* What the bar shows depends on the bar's own width (container queries in index.css), not the screen's: with larger
              text the page is zoomed and the screen's width says "wide" while the bar has little room. The full menu needs
              about 1100px; narrower than that the phone menu takes over. */}
          <nav aria-label="Main" className="lp-bar-nav ml-6 items-center gap-0.5">
            <div
              ref={featuresBox}
              className="relative"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFeatures(false);
              }}
            >
              <button
                ref={featuresButton}
                type="button"
                aria-expanded={features}
                aria-controls="lp-features-list"
                onClick={() => setFeatures((open) => !open)}
                className="lp-nav-link gap-1"
              >
                Features
                <ChevronDown size={15} aria-hidden="true" className={`transition-transform duration-200 ${features ? 'rotate-180' : ''}`} />
              </button>
              {/* always in the page, so the button's aria-controls always points at something; "hidden" keeps it out of sight and out of the Tab order */}
              <div id="lp-features-list" hidden={!features} className="lp-pop absolute left-0 top-full mt-2">
                <ul className="m-0 grid w-[420px] list-none grid-cols-2 gap-1 rounded-card border border-border bg-white p-2 shadow-[0_28px_60px_-24px_rgba(14,38,25,0.45)]">
                  {FEATURES.map((feature) => {
                    const Icon = FEATURE_ICONS[feature.id];
                    return (
                      <li key={feature.id}>
                        <a href="#features" onClick={openFeature(feature.id)} className="flex min-h-11 items-center gap-2.5 rounded-tile px-3 text-[14px] font-semibold text-ink hover:bg-green-tint">
                          <Icon size={16} className="text-brand" aria-hidden="true" />
                          {feature.label}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
            {NAV.links.map((link) => (
              <a key={link.id} href={`#${link.id}`} onClick={go(link.id)} className="lp-nav-link">
                {link.label}
              </a>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            <AccessibilityButton className="grid h-11 w-11 place-items-center rounded-full text-ink/70 transition-colors hover:bg-ink/5 hover:text-ink" />
            <a href={LINKS.signIn} className="lp-nav-link lp-bar-actions">
              {CTA.signIn}
            </a>
            <Cta href={LINKS.create} className="lp-bar-actions !min-h-11 !px-4 !text-[14px]">
              {CTA.primary}
            </Cta>
            <button
              ref={menuButton}
              type="button"
              aria-expanded={menu}
              aria-controls="lp-mobile-menu"
              aria-label="Menu"
              onClick={() => setMenu((open) => !open)}
              className="lp-bar-burger grid h-11 w-11 place-items-center rounded-full text-ink transition-colors hover:bg-ink/5"
            >
              {menu ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
            </button>
          </div>
        </Container>

        <div ref={menuPanel} id="lp-mobile-menu" hidden={!menu} className="lp-bar-panel lp-pop border-y border-border bg-white shadow-[0_24px_40px_-24px_rgba(22,32,26,0.35)]">
          {/* --screen-h, not 100vh: larger text (CSS zoom) scales vh, and the bar is fixed, so a taller panel could not be scrolled to */}
          <Container className="flex max-h-[calc(var(--screen-h)-4rem)] flex-col gap-1 overflow-y-auto py-4">
            <div className="px-3 pb-1 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Features</div>
            <ul className="m-0 grid list-none grid-cols-2 gap-1 p-0">
              {FEATURES.map((feature) => {
                const Icon = FEATURE_ICONS[feature.id];
                return (
                  <li key={feature.id}>
                    <a href="#features" onClick={openFeature(feature.id)} className="flex min-h-11 items-center gap-2 rounded-tile px-3 text-[14.5px] font-semibold text-ink hover:bg-green-tint">
                      <Icon size={16} className="text-brand" aria-hidden="true" />
                      {feature.label}
                    </a>
                  </li>
                );
              })}
            </ul>
            <div className="my-2 h-px bg-border" />
            {NAV.links.map((link) => (
              <a key={link.id} href={`#${link.id}`} onClick={go(link.id)} className="flex min-h-11 items-center rounded-tile px-3 text-[15px] font-semibold text-ink hover:bg-green-tint">
                {link.label}
              </a>
            ))}
            <div className="lp-bar-panel-actions mt-3 grid gap-2">
              <Cta href={LINKS.signIn} variant="secondary">
                {CTA.signIn}
              </Cta>
              <Cta href={LINKS.create}>{CTA.primary}</Cta>
            </div>
          </Container>
        </div>
      </header>
    </>
  );
}
