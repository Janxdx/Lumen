/* The taste card, on screen and on the way out.
 *
 * The markup rendered here is the same string that gets rasterised, so
 * there is no possibility of the saved image disagreeing with the preview.
 * `dangerouslySetInnerHTML` is doing something narrow and safe: the SVG is
 * built by our own code from our own records, and every piece of user text
 * in it went through an escape on the way in.
 */

import { useMemo, useState } from 'react';
import { CARD_H, CARD_W, tasteCardSvg } from '../engine/tasteCard';
import { sortRatings, tasteProfile, type RatingRecord } from '../engine/rating';
import { saveFile, svgToPng } from './exportImage';
import { readPalette, useDarkTheme } from './theme';
import { IconImage } from './Icons';

type Period = 'year' | 'all';

export function TasteCard({ ratings }: { ratings: RatingRecord[] }) {
  const dark = useDarkTheme();
  const [period, setPeriod] = useState<Period>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scoped = useMemo(() => {
    if (period === 'all') return ratings;
    const since = Date.now() - 365 * 86_400_000;
    return ratings.filter((r) => r.ratedAt >= since);
  }, [ratings, period]);

  /* Rebuilt on every theme flip as well as every edit: the palette is baked
     into the markup as literals, so a card generated on the light theme
     would otherwise stay light after the room got dark. */
  const svg = useMemo(() => {
    if (!scoped.length) return '';
    return tasteCardSvg({
      profile: tasteProfile(scoped),
      ratings: sortRatings(scoped, 'rating'),
      palette: readPalette(),
      dark,
      period: period === 'year' ? 'Last 12 months' : 'All time',
    });
  }, [scoped, dark, period]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const png = await svgToPng(svg, CARD_W, CARD_H, 2);
      await saveFile(png, `lumen-taste-${period === 'year' ? 'year' : 'all-time'}.png`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The card could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  if (!scoped.length) {
    return (
      <div className="panel">
        <h3>
          Taste card <span>nothing in this window</span>
        </h3>
        <p className="muted" style={{ fontSize: 13 }}>
          Nothing rated in the last twelve months yet.
        </p>
        <div className="segment" style={{ marginTop: 14, maxWidth: 260 }}>
          <button className={period === 'year' ? 'on' : ''} onClick={() => setPeriod('year')}>
            Last 12 months
          </button>
          <button className={period === 'all' ? 'on' : ''} onClick={() => setPeriod('all')}>
            All time
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel taste-panel">
      <h3>
        Taste card <span>{scoped.length} books</span>
      </h3>
      <div className="taste-layout">
        <div className="taste-card" dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="taste-side">
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
            Everything the shelf knows, on one page — the sentence, the average,
            your books as spines, where your scores actually land, and the colour
            of the whole year.
          </p>
          <div className="segment" style={{ marginTop: 16 }}>
            <button className={period === 'year' ? 'on' : ''} onClick={() => setPeriod('year')}>
              Last 12 months
            </button>
            <button className={period === 'all' ? 'on' : ''} onClick={() => setPeriod('all')}>
              All time
            </button>
          </div>
          <button
            className="btn primary"
            style={{ marginTop: 16, justifyContent: 'center' }}
            disabled={busy}
            onClick={() => void save()}
          >
            <IconImage size={16} /> {busy ? 'Rendering…' : 'Save as image'}
          </button>
          {error && (
            <p className="muted" style={{ fontSize: 12, marginTop: 10, color: 'var(--accent)' }}>
              {error}
            </p>
          )}
          <p className="muted" style={{ fontSize: 11.5, marginTop: 12 }}>
            Saved at 2160 × 2700, in whichever theme you are reading in.
          </p>
        </div>
      </div>
    </div>
  );
}
