/* The book's own cover, drawn on the spine when no catalogue has heard of
 * it.
 *
 * Google Books and Open Library answer most lookups, but not all — a
 * self-published or obscure title has no entry in either, and `ensureEdition`
 * still writes a row for that (`{ key }`, nothing else) so the app stops
 * asking. `knowsAnything` in `engine/spine.ts` is what reads that row and
 * says "nothing here" — and until now that meant the realistic shelf had
 * nothing to draw the spine with either: no cover, no metrics, so it fell
 * back to the mood colour exactly as if the shelf were still in Data mode.
 *
 * The EPUB's own cover is sitting on the device the whole time, though —
 * every imported book keeps one in `db.covers` — so on a definitive miss
 * this reads *that* cover's colours the same way `meta/editions.ts` reads a
 * catalogue cover's, and the spine draws in the book's own colours instead
 * of grey. Deliberately a last resort: a catalogue match is preferred
 * whenever `knowsAnything` says there is one, because it carries real
 * metrics (a page count, a trim height) and not just a colour guessed from
 * a thumbnail.
 *
 * No network here, unlike `meta/editions.ts` — the source is already on
 * disk — so there is no pacing, no trouble to report, and no server row to
 * write: the answer is cheap enough to hold in memory for the session and
 * recompute next launch, the same way a device book's own metadata does.
 */

import { coverToBlob, db } from '../db';
import { extractPalette } from './palette';

/** In memory only. Re-extracted each launch, which costs one canvas pass
    over one thumbnail per book actually shown on the realistic shelf — far
    cheaper than the round trip a catalogue cover pays for, so there is
    nothing here worth persisting. */
const cache = new Map<string, string[] | null>();
const inFlight = new Map<string, Promise<string[] | null>>();

/**
 * The dominant colours of a book's own cover, or null when the book has no
 * cover on this device or none of it survived the palette extractor.
 *
 * Cached and de-duplicated in flight the same way `ensureEdition` is: a
 * shelf full of spines can ask for the same book more than once in a tick.
 */
export async function ownCoverPalette(bookId: string): Promise<string[] | null> {
  if (cache.has(bookId)) return cache.get(bookId) ?? null;

  const started = inFlight.get(bookId);
  if (started) return started;

  const run = load(bookId).finally(() => inFlight.delete(bookId));
  inFlight.set(bookId, run);
  return run;
}

async function load(bookId: string): Promise<string[] | null> {
  let result: string[] | null = null;
  try {
    const record = await db.covers.get(bookId);
    if (record) {
      const swatches = await extractPalette(coverToBlob(record));
      if (swatches.length) result = swatches.map((s) => s.hex);
    }
  } catch {
    /* Same contract as the rest of this feature: a failure here is a spine
       drawn by mood, not an error the reader sees. */
  }
  cache.set(bookId, result);
  return result;
}
