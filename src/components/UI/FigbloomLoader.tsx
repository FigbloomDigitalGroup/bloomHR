// The Figbloom "Orbit" loader: the logo's ring sweeps round (green to orange) while the leaf folds away and
// springs back. Shown while a page or the app is loading. Its animation is in index.css (.fb-loader…); it stands
// still for people who ask for reduced motion.

interface Props {
  /** what is loading, read by screen readers and shown under the logo */
  label?: string;
  /** cover the whole screen (while the app or a page loads) */
  fullScreen?: boolean;
  /** width and height of the logo, in px */
  size?: number;
}

export default function FigbloomLoader({ label = 'Getting things ready', fullScreen = false, size = 120 }: Props) {
  const loader = (
    <div className="fb-loader" role="status" aria-live="polite">
      <svg viewBox="8 5 48 48" aria-hidden="true" style={{ width: size, height: size }}>
        <circle className="fb-arc" cx="32" cy="29" r="19" pathLength={360} fill="none" stroke="#0E4F27" strokeWidth="5.5" strokeLinecap="round" />
        <circle className="fb-bowl" cx="32" cy="29" r="9" fill="none" stroke="#0E4F27" strokeWidth="6.5" />
        <path className="fb-leaf" d="M33 14.5 C33 8.5 38 5.5 43 5.5 C43 11.5 39 14.5 33 14.5 Z" fill="#0E4F27" />
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
  return <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-white/90">{loader}</div>;
}
