import { useEffect, useState, type RefObject } from 'react';
import { A11Y_CHANGED, loadA11y } from '../../lib/a11y';

// Small behaviours the landing page shares. Motion is only ever decoration here: content is visible without any of
// this, so a failed script, a missing IntersectionObserver or a visitor who asks for less motion still gets the page.

const reduceNow = () =>
  loadA11y().reduceMotion || (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

/**
 * Whether this visitor wants less motion: the operating system setting or the app's own "Reduce motion" switch
 * (src/lib/a11y.ts, the same one the app obeys). The app's global rule only zeroes CSS transitions; this also lets the
 * page skip the JavaScript that sets them up.
 */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(reduceNow);
  useEffect(() => {
    const update = () => setReduce(reduceNow());
    const query = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    query?.addEventListener?.('change', update);
    window.addEventListener(A11Y_CHANGED, update);
    return () => {
      query?.removeEventListener?.('change', update);
      window.removeEventListener(A11Y_CHANGED, update);
    };
  }, []);
  return reduce;
}

/** Scroll to a section of the page and move keyboard focus there. The address gains "#id" without a jump or a history entry. */
export function jumpTo(id: string, reduce: boolean): void {
  const target = document.getElementById(id);
  if (!target) return;
  target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  if (window.location.hash !== `#${id}`) window.history.replaceState(null, '', `#${id}`);
  target.focus({ preventScroll: true });
}

/**
 * True once the page has scrolled past a marker at its top. An IntersectionObserver watches the marker, so there is no
 * scroll listener; without one the header simply stays in its resting style.
 */
export function useScrolled(marker: RefObject<HTMLElement>): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const el = marker.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    // several readings can arrive in one call, oldest first: the last one is where the marker is now
    const observer = new IntersectionObserver((entries) => setScrolled(!entries[entries.length - 1].isIntersecting));
    observer.observe(el);
    return () => observer.disconnect();
  }, [marker]);
  return scrolled;
}

/**
 * Fade and lift elements marked data-reveal as they scroll into view. An element that is already on screen when the
 * page opens is never hidden, and nothing is hidden at all unless IntersectionObserver exists and motion is wanted, so
 * the page reads the same without scripts. The styles are in index.css (.lp [data-reveal-state]).
 */
export function useRevealOnScroll(root: RefObject<HTMLElement>, reduce: boolean): void {
  useEffect(() => {
    const container = root.current;
    if (!container || reduce || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.revealState = 'shown';
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -6% 0px', threshold: 0.06 }
    );
    const hidden: HTMLElement[] = [];
    container.querySelectorAll<HTMLElement>('[data-reveal]').forEach((el) => {
      if (el.getBoundingClientRect().top < window.innerHeight) return;
      el.dataset.revealState = 'pending';
      hidden.push(el);
      observer.observe(el);
    });
    return () => {
      observer.disconnect();
      hidden.forEach((el) => delete el.dataset.revealState);
    };
  }, [root, reduce]);
}
