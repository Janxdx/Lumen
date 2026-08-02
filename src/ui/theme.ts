import { useEffect, useState } from 'react';
import { resolveTheme, useSettings } from '../store/settings';
import type { CardPalette } from '../engine/tasteCard';

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

/**
 * The current theme's colours as literal values.
 *
 * The taste card is rasterised into a canvas, which has no stylesheet, so
 * every colour in it must be a literal rather than a `var(--ink)`. Reading
 * them off the live document rather than keeping a copy is what stops the
 * exported image from slowly drifting away from the themes as they are
 * tuned — there is only ever one definition, in tokens.css.
 */
export function readPalette(): CardPalette {
  const s = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string): string =>
    s.getPropertyValue(name).trim() || fallback;
  return {
    bg: get('--bg', '#FAF7F2'),
    surface: get('--surface', '#FFFFFF'),
    ink: get('--ink', '#1A1714'),
    ink2: get('--ink-2', '#514840'),
    ink3: get('--ink-3', '#8C8074'),
    /* `--line` is an rgba() with alpha, which SVG handles but which reads
       as almost nothing on the card's flat ground — so the hairlines get a
       solid stand-in rather than the UI's near-invisible rule. */
    line: get('--line-strong', 'rgba(26,23,20,0.16)'),
    accent: get('--accent', '#B4763A'),
  };
}
