import { ReactNode } from 'react';

// Wrap a wide table in this so it scrolls sideways inside its box on small screens, instead of its
// columns being cut off or the whole page scrolling sideways.
export default function TableScroll({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`w-full overflow-x-auto ${className}`}>{children}</div>;
}
