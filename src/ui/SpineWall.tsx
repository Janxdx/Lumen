/* The shelf.
 *
 * Every book you have rated, standing as a spine. It draws two ways, and
 * which one is a real choice rather than a display option — see the note at
 * the top of engine/spine.ts, where the trade lives.
 *
 *   Data     colour is the mood, height is the score, thickness is the
 *            length. Three properties read off a shelf without a legend,
 *            because they are properties a real shelf already has.
 *
 *   Shelf    the books as objects: the cover's own colours, the paper's own
 *            thickness, the series' own livery, and the title running the
 *            way that language's spines run. The score survives as the
 *            number stamped at the foot.
 *
 * Layout note. Each spine sits in a fixed-height slot with no horizontal
 * gap, so the slots' bottom edges form one continuous shelf line per row.
 * The line itself is a repeating gradient on the wall rather than a border
 * on the slots: rows have a constant pitch (slot height plus row gap), so
 * the gradient lands exactly on every baseline including the ones that
 * wrapping has not created yet, and the last row of a ragged wall gets a
 * full-width shelf rather than one that stops under the final book.
 */

import { useMemo } from 'react';
import { spineLook, type ShelfMode } from '../engine/spine';
import type { RatingRecord } from '../engine/rating';
import type { EditionData } from '../engine/edition';

/** What the wall needs to know about a book beyond its rating. Supplied by
    the tab, which is the thing holding the stores. */
export interface SpineExtras {
  edition?: EditionData;
  publisher?: string;
  language?: string;
}

interface Props {
  ratings: RatingRecord[];
  dark: boolean;
  mode: ShelfMode;
  /** by rating id — absent means "nothing known", which is a normal state */
  extras: Record<string, SpineExtras>;
  onOpen: (rating: RatingRecord) => void;
  /** highlighted while its sheet is open */
  activeId?: string | null;
}

export function SpineWall({ ratings, dark, mode, extras, onOpen, activeId }: Props) {
  /* Recomputed only when the shelf, the mode or the theme changes — this
     runs over every spine and the wall re-renders on hover. `extras` is in
     the dependency list by identity, so the tab must hand over a new object
     when a lookup lands; it builds one with useMemo, which does. */
  const spines = useMemo(
    () =>
      ratings.map((r) => ({
        r,
        look: spineLook({
          rating: r,
          mode,
          dark,
          edition: extras[r.id]?.edition,
          publisher: extras[r.id]?.publisher,
          language: extras[r.id]?.language,
        }),
      })),
    [ratings, dark, mode, extras]
  );

  return (
    <div className="wall" role="list">
      {spines.map(({ r, look }, i) => (
        <div className="slot" key={r.id} role="listitem" style={{ width: look.width }}>
          <button
            className={`spine p-${look.pattern}${look.real ? ' real' : ''}${activeId === r.id ? ' on' : ''}`}
            style={{
              height: look.height,
              // the animation staggers along the shelf, left to right
              animationDelay: `${Math.min(i, 24) * 22}ms`,
              background: look.background,
              color: look.ink,
              '--accent': look.accent,
            } as React.CSSProperties}
            onClick={() => onOpen(r)}
            title={`${r.title}${r.author ? ` — ${r.author}` : ''} · ${r.overall}/10`}
          >
            {/* raised bands, the way a bound spine is stitched */}
            <span className="band top" />
            <span className="band bottom" />
            {r.favourite && <span className="gilt" aria-hidden />}
            <span className={`title${look.direction === 'up' ? ' up' : ''}`}>{r.title}</span>
            {/* The publisher's mark, when the book is bound in a livery that
                has one. Small and at the foot, where it sits on the real
                thing — and skipped on a spine too narrow to hold it, which
                is what a Reclam at 8 mm is. */}
            {look.imprint && look.width >= 26 && (
              <span className="imprint">{look.imprint}</span>
            )}
            <span className="score">{r.overall}</span>
          </button>
        </div>
      ))}
    </div>
  );
}
