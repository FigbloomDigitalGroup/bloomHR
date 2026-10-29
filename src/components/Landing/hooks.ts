import { useEffect, useRef, useState, type RefObject } from 'react';
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

/** Whether the page can animate things on arrival: motion is wanted and the browser can tell when something is on screen. */
export const canAnimate = (reduce: boolean): boolean => !reduce && typeof IntersectionObserver !== 'undefined';

/**
 * Lights a row of steps one after another. A step is lit once it has come into view and the one before it has been lit
 * for `gap` ms, so four steps that arrive together play in turn, and steps that arrive one by one (a phone) light as they
 * are reached. `live` says whether the page is animating at all: when it is not, every step is lit and nothing is hidden,
 * so the page reads the same without scripts, without IntersectionObserver and for a visitor who wants less motion.
 * Each element to watch carries data-step="<its index>" inside `root`.
 */
export function useStepSequence(root: RefObject<HTMLElement>, count: number, reduce: boolean, gap = 800): { lit: number; live: boolean } {
  const live = canAnimate(reduce);
  const [lit, setLit] = useState(0);
  const [seen, setSeen] = useState<readonly number[]>([]);

  useEffect(() => {
    const container = root.current;
    if (!container || !live) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number((entry.target as HTMLElement).dataset.step);
          observer.unobserve(entry.target);
          setSeen((current) => (current.includes(index) ? current : [...current, index]));
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.3 }
    );
    container.querySelectorAll('[data-step]').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [root, live]);

  useEffect(() => {
    if (!live || lit >= count || !seen.includes(lit)) return;
    const timer = window.setTimeout(() => setLit(lit + 1), lit === 0 ? 250 : gap);
    return () => window.clearTimeout(timer);
  }, [live, lit, seen, count, gap]);

  return { lit: live ? lit : count, live };
}

/** True once the element has been on screen, for good. Always true when the page is not animating (see canAnimate). */
export function useSeen(ref: RefObject<Element>, reduce: boolean): boolean {
  const live = canAnimate(reduce);
  const [seen, setSeen] = useState(!live);
  useEffect(() => {
    const el = ref.current;
    if (!el || !live || seen) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { threshold: 0.4 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, live, seen]);
  return seen || !live;
}

/**
 * A number that runs to its target instead of jumping: after the first draw, each new target is reached in `ms`. It
 * starts at the target, ends exactly on it, and is simply the target when the visitor wants less motion.
 */
export function useTween(target: number, reduce: boolean, ms = 400): number {
  const [value, setValue] = useState(target);
  const shown = useRef(target);
  shown.current = value;
  useEffect(() => {
    if (reduce || typeof window.requestAnimationFrame !== 'function') {
      setValue(target);
      return;
    }
    const from = shown.current;
    if (from === target) return;
    const started = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / ms);
      setValue(t === 1 ? target : from + (target - from) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [target, reduce, ms]);
  return value;
}

/**
 * A soft light that follows the mouse across an element marked data-spot (the styles are in index.css, .lp [data-spot]).
 * It only listens for a real mouse: a finger or a pen gets no light, and there is nothing to follow without hover. The
 * position is divided by the page's zoom (the Accessibility text size), or the light would land off the pointer.
 */
export function useSpotlight(root: RefObject<HTMLElement>, reduce: boolean): void {
  useEffect(() => {
    const container = root.current;
    if (!container || reduce) return;
    let frame = 0;
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-spot]') : null;
      if (!target) return;
      const { clientX, clientY } = event;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const box = target.getBoundingClientRect();
        const zoom = target.offsetWidth ? box.width / target.offsetWidth : 1;
        target.style.setProperty('--mx', `${(clientX - box.left) / zoom}px`);
        target.style.setProperty('--my', `${(clientY - box.top) / zoom}px`);
      });
    };
    container.addEventListener('pointermove', move, { passive: true });
    return () => {
      container.removeEventListener('pointermove', move);
      window.cancelAnimationFrame(frame);
    };
  }, [root, reduce]);
}
