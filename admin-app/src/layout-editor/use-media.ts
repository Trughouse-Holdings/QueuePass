import { useEffect, useState } from 'react';

/** Spec 039 FR-004 (research R14): whether a media query matches, following it as it changes. */
export function useMediaQuery(query: string): boolean {
  const read = (): boolean =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(query).matches;
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const list = window.matchMedia(query);
    const onChange = (): void => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** The theme's phone breakpoint: the editor is read-only at or under it. */
export const PHONE = '(max-width: 640px)';
