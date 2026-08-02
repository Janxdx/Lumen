/* The shelf.
 *
 * Every book you have rated, standing as a spine. Three properties are read
 * off it without a legend, because they are the properties a real shelf
 * already has:
 *
 *   colour     the mood you gave it
 *   height     the score — a ten stands a head above a five
 *   thickness  the length of the book
 *
 * That is the whole idea. A grid of cards with little star rows would carry
 * the same data and none of the meaning; a wall of cloth spines is legible
 * from across the room and tells you what a year of reading *felt* like
 * before you have read a single word of it.
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
import {
  moodColor,
  moodInk,
  moodOf,
  spineWeight,
  type RatingRecord,
} from '../engine/rating';

/* Thickness. Clamped hard at both ends: a novella and a doorstop should be
   visibly different, but a 400k-word omnibus must not become a wall of its
   own next to everything else you read that year. */
const MIN_W = 21;
const MAX_W = 52;
const THIN_BOOK = 25_000;
const THICK_BOOK = 260_000;

function widthOf(r: RatingRecord): number {
  const words = spineWeight(r);
  /* Logarithmic, because book lengths are: the step from 30k to 60k is the
     same *kind* of difference as 150k to 300k, and a linear map spends most
     of its range on the handful of long ones. */
  const t =
    (Math.log(Math.max(THIN_BOOK, Math.min(THICK_BOOK, words))) - Math.log(THIN_BOOK)) /
    (Math.log(THICK_BOOK) - Math.log(THIN_BOOK));
  return Math.round(MIN_W + t * (MAX_W - MIN_W));
}

/* Height, as a share of the slot. A nought still stands at 40%: a book you
   hated is still a book you finished, and a shelf where the bad ones vanish
   is a shelf that lies about how the year went. */
const heightOf = (r: RatingRecord): string =>
  `${(40 + (Math.max(0, Math.min(10, r.overall)) / 10) * 60).toFixed(1)}%`;

interface Props {
  ratings: RatingRecord[];
  dark: boolean;
  onOpen: (rating: RatingRecord) => void;
  /** highlighted while its sheet is open */
  activeId?: string | null;
}

export function SpineWall({ ratings, dark, onOpen, activeId }: Props) {
  /* Colours are recomputed only when the shelf or the theme changes — this
     runs over every spine and the wall re-renders on hover. */
  const spines = useMemo(
    () =>
      ratings.map((r) => {
        const mood = moodOf(r.mood);
        return {
          r,
          width: widthOf(r),
          height: heightOf(r),
          face: moodColor(mood, dark),
          edge: moodColor(mood, dark, -9),
          lip: moodColor(mood, dark, 7),
          ink: moodInk(mood, dark),
        };
      }),
    [ratings, dark]
  );

  return (
    <div className="wall" role="list">
      {spines.map(({ r, width, height, face, edge, lip, ink }, i) => (
        <div className="slot" key={r.id} role="listitem" style={{ width }}>
          <button
            className={`spine${activeId === r.id ? ' on' : ''}`}
            style={{
              height,
              // the animation staggers along the shelf, left to right
              animationDelay: `${Math.min(i, 24) * 22}ms`,
              background: `linear-gradient(100deg, ${lip} 0 8%, ${face} 22% 78%, ${edge} 100%)`,
              color: ink,
            }}
            onClick={() => onOpen(r)}
            title={`${r.title}${r.author ? ` — ${r.author}` : ''} · ${r.overall}/10`}
          >
            {/* raised bands, the way a bound spine is stitched */}
            <span className="band top" />
            <span className="band bottom" />
            {r.favourite && <span className="gilt" aria-hidden />}
            <span className="title">{r.title}</span>
            <span className="score">{r.overall}</span>
          </button>
        </div>
      ))}
    </div>
  );
}
