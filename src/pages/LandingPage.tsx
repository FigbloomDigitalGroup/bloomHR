import { useEffect, useMemo, useRef, useState } from 'react';
import { SEO, SITE, type PreviewKey } from '../lib/landing';
import BuiltIn from '../components/Landing/BuiltIn';
import { LandingContext } from '../components/Landing/context';
import Faq from '../components/Landing/Faq';
import Features from '../components/Landing/Features';
import FinalCta from '../components/Landing/FinalCta';
import Hero from '../components/Landing/Hero';
import { jumpTo, useReduceMotion, useRevealOnScroll, useSpotlight } from '../components/Landing/hooks';
import HowItWorks from '../components/Landing/HowItWorks';
import LandingFooter from '../components/Landing/LandingFooter';
import LandingHeader from '../components/Landing/LandingHeader';
import Outcomes from '../components/Landing/Outcomes';
import PayrollBand from '../components/Landing/PayrollBand';
import Pricing from '../components/Landing/Pricing';
import Roles from '../components/Landing/Roles';
import TalkToUs from '../components/Landing/TalkToUs';
import { Security } from '../components/Landing/Trust';
import Why from '../components/Landing/Why';

// The public landing page, shown at "/" to someone who is not signed in (src/lib/landingRoute.ts decides; src/bootLanding.tsx
// starts it). Its words live in src/lib/landing.ts, each claim next to the files that back it. Its links are plain
// addresses: /create-company and /login open the app fresh. There is no app in this page.

/** The title and canonical address of the page. index.html carries the description and sharing tags for crawlers that run no scripts. */
function useDocumentHead() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = SEO.title;
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const created = !link;
    if (!link) {
      link = document.createElement('link');
      link.rel = 'canonical';
      document.head.appendChild(link);
    }
    const previousHref = link.getAttribute('href');
    link.href = `${SITE.origin}/`;
    return () => {
      document.title = previousTitle;
      if (created) link?.remove();
      else if (previousHref !== null) link?.setAttribute('href', previousHref);
    };
  }, []);
}

export default function LandingPage() {
  const reduce = useReduceMotion();
  const [tab, setTab] = useState<PreviewKey>('people');
  const root = useRef<HTMLDivElement>(null);
  useDocumentHead();
  useRevealOnScroll(root, reduce);
  useSpotlight(root, reduce);

  // the page is drawn after the browser has looked for "#faq" and found nothing: go there now
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) window.requestAnimationFrame(() => jumpTo(id, true));
  }, []);

  const state = useMemo(() => ({ tab, setTab, reduce }), [tab, reduce]);

  return (
    <LandingContext.Provider value={state}>
      <div ref={root} className="lp relative isolate min-h-screen font-sans" data-motion={reduce ? 'off' : 'on'}>
        <a href="#main" className="lp-skip">
          Skip to content
        </a>
        <LandingHeader />
        <main id="main" tabIndex={-1} className="outline-none">
          <Hero />
          <BuiltIn />
          <Outcomes />
          <Why />
          <Features />
          <PayrollBand />
          <HowItWorks />
          <Roles />
          <Security />
          <Pricing />
          <TalkToUs />
          <Faq />
          <FinalCta />
        </main>
        <LandingFooter />
      </div>
    </LandingContext.Provider>
  );
}
