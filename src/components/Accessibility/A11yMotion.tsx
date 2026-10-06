import { useEffect, useState, type ReactNode } from 'react';
import { MotionConfig } from 'framer-motion';
import { A11Y_CHANGED, loadA11y } from '../../lib/a11y';

/** CSS cannot stop framer-motion (it animates inline styles), so "Reduce motion" is passed to it here. */
export default function A11yMotion({ children }: { children: ReactNode }) {
  const [reduce, setReduce] = useState(() => loadA11y().reduceMotion);
  useEffect(() => {
    const sync = () => setReduce(loadA11y().reduceMotion);
    window.addEventListener(A11Y_CHANGED, sync);
    return () => window.removeEventListener(A11Y_CHANGED, sync);
  }, []);
  return <MotionConfig reducedMotion={reduce ? 'always' : 'user'}>{children}</MotionConfig>;
}
