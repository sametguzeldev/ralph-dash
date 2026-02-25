import { useState, useEffect } from 'react';

const MD_BREAKPOINT = 768;

/** Returns true when viewport is below Tailwind's `md` breakpoint (768px). */
export function useIsMobile(): boolean {
  const mql = typeof window !== 'undefined' ? window.matchMedia(`(max-width: ${MD_BREAKPOINT - 1}px)`) : null;
  const [isMobile, setIsMobile] = useState(() => mql?.matches ?? false);

  useEffect(() => {
    if (!mql) return;
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [mql]);

  return isMobile;
}
