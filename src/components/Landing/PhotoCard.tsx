import { useState, type ReactNode } from 'react';
import BrandMark from './BrandMark';
import { PHOTOS, type PhotoKey } from './photos';

// A photograph with product cards floating over it. The cards are real markup, never text baked into the picture, so
// they stay sharp, readable by screen readers and in step with the page. The photo is cropped with `position` so faces
// stay in frame, and if it fails to load a tinted tile with the brand mark takes its place.

interface PhotoCardProps {
  photo: PhotoKey;
  /** the sizes attribute: how wide the photo is shown at each screen width */
  sizes: string;
  /** above the fold: load it first */
  eager?: boolean;
  /** CSS aspect ratio of the frame, when it should differ from the photograph's; null leaves it to the classes (aspect-*) */
  ratio?: string | null;
  /** the same photograph appears elsewhere on the page and is already described there: a screen reader skips this one */
  repeat?: boolean;
  className?: string;
  children?: ReactNode;
}

export default function PhotoCard({ photo, sizes, eager = false, ratio, repeat = false, className = '', children }: PhotoCardProps) {
  const [failed, setFailed] = useState(false);
  const p = PHOTOS[photo];
  // React 18 does not know fetchPriority, but the browser reads the lower-case attribute
  const priority = eager ? ({ fetchpriority: 'high' } as Record<string, string>) : {};
  return (
    <figure
      className={`relative isolate m-0 overflow-hidden rounded-[28px] bg-green-tint ${className}`}
      style={ratio === null ? undefined : { aspectRatio: ratio ?? `${p.width} / ${p.height}` }}
    >
      {failed ? (
        <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-green-tint via-white to-green-tint" aria-hidden="true">
          <BrandMark className="h-24 w-24 text-brand/25" />
        </div>
      ) : (
        <img
          src={p.src}
          srcSet={p.srcSet}
          sizes={sizes}
          width={p.width}
          height={p.height}
          alt={repeat ? '' : p.alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition: p.position }}
          {...priority}
        />
      )}
      {children}
    </figure>
  );
}

/**
 * A card that floats over a photo. Place it with className (absolute offsets); it adds the glass, border and shadow.
 * It is a picture of the product, so screen readers skip it: the page's own text says everything it shows.
 */
export function FloatingCard({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <div
      aria-hidden="true"
      className={`lp-float absolute rounded-card border border-white/70 bg-white/90 p-3.5 shadow-[0_24px_60px_-18px_rgba(14,38,25,0.45)] backdrop-blur-md ${className}`}
    >
      {children}
    </div>
  );
}
