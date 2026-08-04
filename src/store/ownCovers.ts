/* Own-cover palettes, as React sees them.
 *
 * The same shape as `store/editions.ts` for the same reason: the actual work
 * — reading `db.covers`, running the canvas — lives in `meta/ownCover.ts`
 * and is plain async code with its own cache, so this is only the reactive
 * layer that makes a shelf re-render once an extraction lands.
 */

import { create } from 'zustand';
import { ownCoverPalette } from '../meta/ownCover';

interface OwnCoverState {
  /** by book id. Absent means "not asked yet"; `null` means asked and
      nothing usable came back — both are distinct from a real palette. */
  byId: Record<string, string[] | null>;
  ensure(bookId: string): Promise<void>;
}

export const useOwnCovers = create<OwnCoverState>((set, get) => ({
  byId: {},

  async ensure(bookId) {
    if (bookId in get().byId) return;
    const palette = await ownCoverPalette(bookId);
    set((s) => ({ byId: { ...s.byId, [bookId]: palette } }));
  },
}));
