import { useEffect, useState } from 'react';
import { resolveTheme, useSettings } from '../store/settings';

/**
 * Whether the dark theme is currently showing.
 *
 * Almost nothing in the app needs to ask: the three themes are expressed as
 * CSS variables, and a component that uses `var(--ink)` is theme-aware for
 * free. The mood palette is the exception — those colours are data, not
 * chrome, and they have to be lifted on a near-black background to still
 * read as cloth rather than as eight shades of dark.
 *
 * `auto` is why this is a hook and not a function call. The setting can say
 * "follow the system" and the system can change while the shelf is on
 * screen, so the media query has to be listened to, not merely read.
 */
export function useDarkTheme(): boolean {
  const mode = useSettings((s) => s.mode);
  const [dark, setDark] = useState(() => resolveTheme(mode) === 'ink');

  useEffect(() => {
    const apply = () => setDark(resolveTheme(mode) === 'ink');
    apply();
    if (mode !== 'auto') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [mode]);

  return dark;
}
