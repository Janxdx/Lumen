/* The taste card.
 *
 * One picture of a year of reading: the sentence, the average, the shelf in
 * miniature, the curve, the colours. Built as a string of SVG rather than
 * as React, for one reason — the same string is both what you see on screen
 * and what gets saved as a PNG. Rendering the card twice, once in JSX and
 * once in a canvas drawing routine, is how the exported image quietly
 * drifts from the one you were looking at.
 *
 * Two constraints follow from being exportable, and they explain most of
 * what looks unusual below.
 *
 *   No CSS variables. A canvas rasterising this has no stylesheet, so every
 *   colour has to be a literal. The palette is read off the live document
 *   at call time and passed in, which keeps the card matching the theme
 *   without a second copy of the theme living here.
 *
 *   No external anything. No web fonts, no images, no <foreignObject>.
 *   Which also means no CSS text wrapping, hence the hand-rolled wrap
 *   below: it estimates from an average glyph width, which is imprecise and
 *   entirely good enough for three lines of display type.
 */

import {
  moodColor,
  moodOf,
  spineWeight,
  type MoodKey,
  type RatingRecord,
  type TasteProfile,
} from './rating';

export interface CardPalette {
  bg: string;
  surface: string;
  ink: string;
  ink2: string;
  ink3: string;
  line: string;
  accent: string;
}

export const CARD_W = 1080;
export const CARD_H = 1350;

const SANS = "-apple-system, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif";
const SERIF = "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif";
const NUM = "ui-rounded, -apple-system, 'SF Pro Rounded', system-ui, sans-serif";

const M = 80; // margin
const W = CARD_W - M * 2;

/* A fixed grid, not a cursor that accumulates.
 *
 * Every band below sits at a stated y. The obvious alternative — lay out
 * each section under the previous one — is how the card ended up pushing
 * its footer off the bottom edge the first time somebody's tagline ran to
 * three lines. A canvas that cannot scroll wants a layout that cannot
 * grow: the tagline block is bottom-aligned inside its own band, so one
 * line and three lines both end in the same place and nothing downstream
 * has to know which happened. */
const Y = {
  masthead: 118,
  rule: 148,
  /** last baseline of the tagline; earlier lines stack upwards from here */
  taglineBottom: 396,
  taglineLeading: 78,
  statLabel: 486,
  statValue: 552,
  statSub: 590,
  /** the shelf the miniature spines stand on */
  wallBase: 900,
  wallCap: 236,
  wallCaption: 940,
  curveTop: 992,
  curveH: 118,
  ribbon: 1176,
  ribbonH: 22,
  footBar: 1236,
  footLabel: 1258,
  footTitle: 1300,
};

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* Greedy wrap against an estimated average glyph width. Real metrics would
   need a canvas measure pass; for three lines of display serif the error is
   a word at worst, and the card has slack for it. */
function wrap(text: string, fontSize: number, width: number, maxLines: number): string[] {
  const perChar = fontSize * 0.47;
  const limit = Math.max(8, Math.floor(width / perChar));
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > limit && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) return lines;
    } else {
      line = next;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

const truncate = (s: string, n: number): string =>
  s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;

export interface CardInput {
  profile: TasteProfile;
  /** already in the order they should stand, best first */
  ratings: RatingRecord[];
  palette: CardPalette;
  dark: boolean;
  /** the line under the mark, e.g. "2026" or "All time" */
  period: string;
}

export function tasteCardSvg({ profile, ratings, palette, dark, period }: CardInput): string {
  const p = palette;
  const parts: string[] = [];

  /* ── ground ── */
  parts.push(
    `<rect width="${CARD_W}" height="${CARD_H}" fill="${p.bg}"/>`,
    // a barely-there warm wash so the card is not a flat rectangle
    `<rect width="${CARD_W}" height="${CARD_H}" fill="url(#wash)"/>`
  );

  /* ── masthead ── */
  parts.push(
    text(M, Y.masthead, 'LUMEN', {
      family: SANS,
      size: 26,
      weight: 700,
      fill: p.ink3,
      letter: 6,
    }),
    text(CARD_W - M, Y.masthead, period.toUpperCase(), {
      family: SANS,
      size: 26,
      weight: 600,
      fill: p.ink3,
      letter: 4,
      anchor: 'end',
    }),
    line(M, Y.rule, CARD_W - M, Y.rule, p.line)
  );

  /* ── the sentence ── */
  const taglineLines = wrap(profile.tagline, 66, W, 3);
  taglineLines.forEach((l, i) => {
    // stacked upwards from a fixed last baseline
    const y = Y.taglineBottom - (taglineLines.length - 1 - i) * Y.taglineLeading;
    parts.push(text(M, y, l, { family: SERIF, size: 66, fill: p.ink, letter: -0.5 }));
  });

  /* ── three numbers ── */
  const cols = [
    { k: 'Average', v: profile.mean.toFixed(1), s: `median ${profile.median.toFixed(1)}` },
    {
      k: 'Books rated',
      v: String(profile.count),
      s: profile.thisYear ? `${profile.thisYear} this year` : 'across the shelf',
    },
    {
      k: 'Shelf leans',
      v: moodOf(profile.topMood)?.label ?? '—',
      s: profile.rewards ? `rewards ${profile.rewards}` : 'no clear bias yet',
    },
  ];
  cols.forEach((c, i) => {
    const x = M + (W / 3) * i;
    /* A word like "Contemplative" needs a smaller face than "8.4" — the
       column is 306px wide and the type has to live inside it. */
    const long = c.v.length > 10;
    const word = c.v.length > 4;
    parts.push(
      text(x, Y.statLabel, c.k.toUpperCase(), {
        family: SANS,
        size: 20,
        weight: 600,
        fill: p.ink3,
        letter: 2.2,
      }),
      text(x, Y.statValue, c.v, {
        family: word ? SERIF : NUM,
        size: long ? 40 : word ? 50 : 62,
        weight: word ? 400 : 500,
        fill: i === 0 ? p.accent : p.ink,
        letter: -1,
      }),
      text(x, Y.statSub, c.s, { family: SANS, size: 21, fill: p.ink3 })
    );
  });

  /* ── the shelf in miniature ── */
  const shown = ratings.slice(0, 26);
  if (shown.length) {
    const gap = 5;
    const room = W - gap * (shown.length - 1);
    const weights = shown.map(spineWeight);
    const total = weights.reduce((a, b) => a + b, 0);

    /* Proportional to length, then clamped, then re-fitted. The clamp
       stops a novella becoming a hairline at one end and three books
       becoming three doors at the other; the re-fit is what guarantees the
       row still lands inside the margins after clamping moved it. */
    let widths = weights.map((w) => Math.min(72, Math.max(13, (w / total) * room)));
    const clamped = widths.reduce((a, b) => a + b, 0);
    if (clamped > room) widths = widths.map((w) => (w * room) / clamped);

    const span = widths.reduce((a, b) => a + b, 0) + gap * (shown.length - 1);
    let x = M + (W - span) / 2; // a short shelf sits centred rather than adrift

    shown.forEach((r, i) => {
      const w = widths[i];
      const h = (0.4 + (Math.max(0, Math.min(10, r.overall)) / 10) * 0.6) * Y.wallCap;
      const top = Y.wallBase - h;
      const face = moodColor(moodOf(r.mood), dark);
      const edge = moodColor(moodOf(r.mood), dark, -9);
      parts.push(
        `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${face}"/>`,
        `<rect x="${(x + w - Math.min(4, w / 4)).toFixed(1)}" y="${top.toFixed(1)}" width="${Math.min(4, w / 4).toFixed(1)}" height="${h.toFixed(1)}" fill="${edge}" opacity="0.9"/>`
      );
      x += w + gap;
    });

    parts.push(
      line(M, Y.wallBase + 3, CARD_W - M, Y.wallBase + 3, p.ink3),
      text(M, Y.wallCaption, 'TALLER IS BETTER · WIDER IS LONGER · COLOUR IS MOOD', {
        family: SANS,
        size: 18,
        weight: 600,
        fill: p.ink3,
        letter: 1.6,
      })
    );
  }

  /* ── the curve ── */
  const peak = Math.max(1, ...profile.histogram);
  const bw = W / profile.histogram.length;
  const curveFloor = Y.curveTop + Y.curveH;
  profile.histogram.forEach((count, score) => {
    const h = (count / peak) * Y.curveH;
    parts.push(
      `<rect x="${(M + score * bw + bw * 0.15).toFixed(1)}" y="${(curveFloor - h).toFixed(1)}" ` +
        `width="${(bw * 0.7).toFixed(1)}" height="${Math.max(count ? 4 : 0, h).toFixed(1)}" rx="3" ` +
        `fill="${p.accent}" opacity="${count ? (0.35 + 0.6 * (count / peak)).toFixed(2) : 0.12}"/>`
    );
  });
  parts.push(
    line(M, curveFloor + 2, CARD_W - M, curveFloor + 2, p.line),
    text(M, curveFloor + 32, 'RATED 0', { family: SANS, size: 18, weight: 600, fill: p.ink3, letter: 1.6 }),
    text(CARD_W - M, curveFloor + 32, '10', {
      family: SANS,
      size: 18,
      weight: 600,
      fill: p.ink3,
      letter: 1.6,
      anchor: 'end',
    })
  );

  /* ── the mood ribbon ── */
  if (profile.moods.length) {
    let x = M;
    const bars: string[] = [];
    for (const m of profile.moods) {
      const w = Math.max(2, m.share * W);
      bars.push(
        `<rect x="${x.toFixed(1)}" y="${Y.ribbon}" width="${w.toFixed(1)}" height="${Y.ribbonH}" ` +
          `fill="${moodColor(moodOf(m.mood as MoodKey), dark)}"/>`
      );
      x += m.share * W;
    }
    // clipped rather than stroked, so the rounded ends cut the cloth itself
    parts.push(`<g clip-path="url(#ribbon)">${bars.join('')}</g>`);
  }

  /* ── the one you loved most ── */
  if (profile.best) {
    const mood = moodOf(profile.best.mood);
    parts.push(
      `<rect x="${M}" y="${Y.footBar}" width="8" height="74" rx="4" fill="${moodColor(mood, dark)}"/>`,
      text(M + 28, Y.footLabel, 'THE ONE YOU LOVED MOST', {
        family: SANS,
        size: 18,
        weight: 600,
        fill: p.ink3,
        letter: 1.8,
      }),
      text(M + 28, Y.footTitle, truncate(profile.best.title, 38), {
        family: SERIF,
        size: 36,
        fill: p.ink,
      }),
      text(CARD_W - M, Y.footTitle - 2, String(profile.best.overall), {
        family: NUM,
        size: 44,
        weight: 500,
        fill: p.accent,
        anchor: 'end',
      })
    );
  }

  const defs =
    `<defs>` +
    `<linearGradient id="wash" x1="0" y1="0" x2="0.4" y2="1">` +
    `<stop offset="0%" stop-color="${p.accent}" stop-opacity="${dark ? 0.07 : 0.05}"/>` +
    `<stop offset="60%" stop-color="${p.accent}" stop-opacity="0"/>` +
    `</linearGradient>` +
    `<clipPath id="ribbon">` +
    `<rect x="${M}" y="${Y.ribbon}" width="${W}" height="${Y.ribbonH}" rx="${Y.ribbonH / 2}"/>` +
    `</clipPath>` +
    `</defs>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" ` +
    `viewBox="0 0 ${CARD_W} ${CARD_H}" role="img" aria-label="Reading taste card">` +
    defs +
    parts.join('') +
    `</svg>`
  );
}

/* ── small builders ─────────────────────────────────────────────── */

interface TextOpts {
  family: string;
  size: number;
  weight?: number;
  fill: string;
  letter?: number;
  anchor?: 'start' | 'middle' | 'end';
}

const text = (x: number, y: number, body: string, o: TextOpts): string =>
  `<text x="${x}" y="${y}" font-family="${o.family}" font-size="${o.size}" ` +
  `font-weight="${o.weight ?? 400}" fill="${o.fill}" ` +
  `letter-spacing="${o.letter ?? 0}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}>` +
  `${esc(body)}</text>`;

const line = (x1: number, y1: number, x2: number, y2: number, stroke: string): string =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="1.5"/>`;
