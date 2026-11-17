// The Figbloom "g" mark: a leaf over a ring over a curved arc, drawn from the same shapes as the loader
// (components/UI/FigbloomLoader.tsx), so it is crisp at any size and takes its colour from the text colour around it.
// "outline" is a thin line version for large decorative use.

const LEAF = 'M33 14.5 C33 8.5 38 5.5 43 5.5 C43 11.5 39 14.5 33 14.5 Z';

interface BrandMarkProps {
  className?: string;
  outline?: boolean;
  /** read aloud; leave out when the mark sits beside the name or is decoration */
  title?: string;
}

export default function BrandMark({ className = '', outline = false, title }: BrandMarkProps) {
  const thin = 0.4;
  return (
    <svg
      viewBox="8 5 48 48"
      className={className}
      fill="none"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {/* the arc under the ring: 80 of the circle's 360, turned to sit at the bottom */}
      <circle cx="32" cy="29" r="19" pathLength={360} stroke="currentColor" strokeWidth={outline ? thin : 5.5} strokeLinecap="round" strokeDasharray="80 280" strokeDashoffset={-50} />
      <circle cx="32" cy="29" r="9" stroke="currentColor" strokeWidth={outline ? thin : 6.5} />
      <path d={LEAF} fill={outline ? 'none' : 'currentColor'} stroke={outline ? 'currentColor' : undefined} strokeWidth={outline ? thin : undefined} />
    </svg>
  );
}
