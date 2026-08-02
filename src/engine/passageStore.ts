/* Making a passage index small enough to keep.

   `buildPassageIndex` returns a `Map<number, number[]>` of postings, which is
   the right shape to search and the wrong shape to store. A 150k-word novel
   has on the order of 150k distinct shingles, and a Map holding 150k
   single-element arrays costs well over ten megabytes of heap — most of it
   object headers rather than data. Written to IndexedDB as-is, that is what
   gets serialised.

   So the stored form is CSR: the keys in one sorted Int32Array, the postings
   concatenated into a second, and an offset table saying where each key's run
   begins. Four bytes per number and not one byte of overhead, which brings
   the same novel to roughly 2.5 MB. The Map is rebuilt on the way out, in
   memory, only for as long as a scan takes.

   Sorting the keys is not decoration: it makes the packed form canonical, so
   two builds of the same book produce byte-identical rows and a diff of the
   cache means something.

   No React, no browser APIs — engine code. */

import type { PassageIndex } from './passage';
import { HAS_CONTENT } from './tokenize';

export interface PackedPassageIndex {
  /** schema version, so a later change can invalidate rather than misread */
  v: 1;
  tokens: Int32Array;
  spineStarts: Int32Array;
  spineOf: Int32Array;
  /** distinct shingle hashes, ascending */
  keys: Int32Array;
  /** keys.length + 1 offsets into `values`; run i is [starts[i], starts[i+1]) */
  starts: Int32Array;
  /** every posting, grouped by key in the order `keys` gives */
  values: Int32Array;
}

export const PACKED_VERSION = 1;

/** Bytes the packed form occupies, near enough for an eviction policy. */
export function packedSize(p: PackedPassageIndex): number {
  return (
    p.tokens.byteLength +
    p.spineStarts.byteLength +
    p.spineOf.byteLength +
    p.keys.byteLength +
    p.starts.byteLength +
    p.values.byteLength
  );
}

export function packIndex(index: PassageIndex): PackedPassageIndex {
  const keys = Int32Array.from(index.postings.keys());
  keys.sort();

  const starts = new Int32Array(keys.length + 1);
  let total = 0;
  for (let i = 0; i < keys.length; i++) {
    starts[i] = total;
    total += (index.postings.get(keys[i]) as number[]).length;
  }
  starts[keys.length] = total;

  const values = new Int32Array(total);
  for (let i = 0; i < keys.length; i++) {
    const list = index.postings.get(keys[i]) as number[];
    values.set(list, starts[i]);
  }

  return {
    v: PACKED_VERSION,
    tokens: index.tokens,
    spineStarts: Int32Array.from(index.spineStarts),
    spineOf: Int32Array.from(index.spineOf),
    keys,
    starts,
    values,
  };
}

export function unpackIndex(p: PackedPassageIndex): PassageIndex {
  const postings = new Map<number, number[]>();
  for (let i = 0; i < p.keys.length; i++) {
    const from = p.starts[i];
    const to = p.starts[i + 1];
    const list: number[] = new Array(to - from);
    for (let j = from; j < to; j++) list[j - from] = p.values[j];
    postings.set(p.keys[i], list);
  }

  return {
    tokens: p.tokens,
    spineStarts: Array.from(p.spineStarts),
    spineOf: Array.from(p.spineOf),
    postings,
  };
}

/* ── showing the match ─────────────────────────────────────────────── */

/**
 * The book's own words either side of a position, for a person to check.
 *
 * A confidence score is a number, and a number is not evidence. When a match
 * is only probable, the honest thing to show is the sentence the app thinks
 * you stopped at — recognising it takes a reader about a second, and no
 * threshold we could pick is worth more than that second.
 *
 * Indices count content words only, exactly as `foldTokens` and the chapter
 * renderer do, so `at` means the same thing here as it does everywhere else.
 */
export function excerptAt(
  chapterText: string,
  at: number,
  before = 24,
  after = 6
): { text: string; markAt: number } {
  const words = chapterText.split(/\s+/).filter((w) => HAS_CONTENT.test(w));
  if (!words.length) return { text: '', markAt: 0 };

  const i = Math.max(0, Math.min(at, words.length - 1));
  const from = Math.max(0, i - before);
  const to = Math.min(words.length, i + after + 1);

  return { text: words.slice(from, to).join(' '), markAt: i - from };
}

/* A row written by an older build. Dexie hands back whatever was stored, so
   the version tag is checked rather than trusted — a mismatch means rebuild,
   which costs a second and is always correct. */
export function isCurrentPacked(p: unknown): p is PackedPassageIndex {
  return (
    !!p &&
    typeof p === 'object' &&
    (p as PackedPassageIndex).v === PACKED_VERSION &&
    (p as PackedPassageIndex).tokens instanceof Int32Array
  );
}
