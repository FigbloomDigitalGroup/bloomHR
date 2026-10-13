import { useEffect, useState } from 'react';

// The Figbloom "Orbit" loader: the logo's ring sweeps round (green to orange) while the leaf folds away and
// springs back. Shown while a page or the app is loading. Its animation is in index.css (.fb-loader…); it stands
// still for people who ask for reduced motion.
//
// Loaders often follow one another (the page's code arrives, then the page loads its data), so they don't restart:
// every loader runs on the same clock, so the next one carries on where the last left off; and one that comes
// right after another shows at once, while a first one fades in after a moment, so a quick load shows none.
// It takes the page palette: the page colour behind it, the brand green (white on a dark page) and the page’s text grey.

interface Props {
  /** what is loading, read by screen readers and shown under the logo */
  label?: string;
  /** cover the whole screen (while the app or a page loads) */
  fullScreen?: boolean;
  /** width and height of the logo, in px */
  size?: number;
}

const CYCLE_MS = 2200; // the length of the animation in index.css
const FOLLOW_ON_MS = 600; // a loader within this long of another carries straight on
let shown = 0;
let lastHiddenAt = -Infinity;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function useLoaderTiming() {
  const [timing] = useState(() => {
    const t = now();
    return { phase: -(t % CYCLE_MS), followsOn: shown > 0 || t - lastHiddenAt < FOLLOW_ON_MS };
  });
  useEffect(() => {
    shown += 1;
    return () => {
      shown -= 1;
      lastHiddenAt = now();
    };
  }, []);
  return timing;
}

export default function FigbloomLoader({ label = 'Getting things ready', fullScreen = false, size = 120 }: Props) {
  const { phase, followsOn } = useLoaderTiming();
  const loader = (
    <div className={followsOn ? 'fb-loader' : 'fb-loader fb-loader--fade-in'} role="status" aria-live="polite"
      style={{ ['--fb-phase' as string]: `${phase}ms` }}>
      <svg viewBox="8 5 48 48" aria-hidden="true" style={{ width: size, height: size }}>
        <circle className="fb-arc" cx="32" cy="29" r="19" pathLength={360} fill="none" strokeWidth="5.5" strokeLinecap="round" />
        <circle className="fb-bowl" cx="32" cy="29" r="9" fill="none" strokeWidth="6.5" />
        <path className="fb-leaf" d="M33 14.5 C33 8.5 38 5.5 43 5.5 C43 11.5 39 14.5 33 14.5 Z" />
      </svg>
      <div className="fb-loader__text">
        {label}
        <span className="fb-loader__dot">.</span>
        <span className="fb-loader__dot">.</span>
        <span className="fb-loader__dot">.</span>
      </div>
    </div>
  );
  if (!fullScreen) return loader;
  return <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-page/90">{loader}</div>;
}
