import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useIsMobile } from '../../hooks/use-mobile';

// The admin sidebar's phone drawer (below md): whether we're on a phone, whether the drawer is open,
// and the handlers. The drawer closes by itself once the person has picked a page.
export function useMobileNav() {
  const isMobile = useIsMobile();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  const openNav = useCallback(() => setOpen(true), []);
  const closeNav = useCallback(() => setOpen(false), []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return { isMobile, open, openNav, closeNav };
}
