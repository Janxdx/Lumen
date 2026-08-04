/* The colours a book actually is.
 *
 * A generated spine is honest but arbitrary — `book.hue` is a number derived
 * from an id, so a Penguin and a Suhrkamp get whatever the hash felt like.
 * Reading the cover instead is the single change that makes a shelf look
 * like a shelf: the orange stays orange, the yellow Reclam stays yellow, and
 * a run of books from one publisher lines up the way it does on a real one.
 *
 * ─── why this can work at all ──────────────────────────────────────
 *
 * Only because the cover is served from our own origin. `getImageData` on a
 * canvas that has drawn a cross-origin image throws a SecurityError — the
 * canvas is *tainted*, and no amount of crossOrigin juggling fixes it when
 * the far end doesn't send the header. Proxying the cover through the
 * Worker into R2 was mostly done for the User-Agent and the API key; this
 * is the part that would have forced it anyway.
 *
 * ─── the algorithm, and why not a better one ───────────────────────
 *
 * Bucket into a coarse cube, drop the near-greys, take the fullest buckets.
 * k-means would give prettier centroids and it is not worth it: this runs
 * once per book on an iPad, the input is a 64-pixel-wide thumbnail, and the
 * question being asked is "roughly what colour is this", which a histogram
 * answers exactly as well.
 */

/** Colours per book. Enough for a ground, a band and an ink. */
const WANT = 4;

/* Downscale target. Small on purpose: it is 4096 pixels to walk instead of
   half a million, and averaging away the type and the texture is a feature
   — a cover's *colour* is what survives being squinted at. */
const SAMPLE = 64;

/** Bits kept per channel when bucketing. Five would separate shades nobody
    can tell apart; three collapses a cover into eight boxes. */
const BITS = 4;
const SHIFT = 8 - BITS;

export interface Swatch {
  hex: string;
  /** 0–1, share of the sampled pixels */
  weight: number;
  /** perceived lightness, 0–1 — what decides whether ink goes light or dark */
  luma: number;
}

const luminance = (r: number, g: number, b: number): number =>
  (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

const hex = (r: number, g: number, b: number): string =>
  `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

/**
 * The dominant colours of an image, most common first.
 *
 * Returns an empty array rather than throwing when anything goes wrong —
 * a decode failure, a tainted canvas, a browser without OffscreenCanvas.
 * Every caller's fallback is the generated spine it was already drawing,
 * so a failure here costs nothing and must not take a shelf down with it.
 */
export async function extractPalette(blob: Blob): Promise<Swatch[]> {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob);

    const scale = Math.min(1, SAMPLE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return [];
    ctx.drawImage(bitmap, 0, 0, w, h);

    const { data } = ctx.getImageData(0, 0, w, h);
    return quantize(data);
  } catch {
    return [];
  } finally {
    /* Explicitly, in a finally, for the same reason the OCR path does it:
       an ImageBitmap holds decoded pixels outside the JS heap, so leaving
       it to the collector means a shelf of sixty books can hold sixty
       full-size decoded covers in memory at once. */
    bitmap?.close();
  }
}

function quantize(data: Uint8ClampedArray): Swatch[] {
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  let counted = 0;

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    // transparent corners are the frame, not the cover
    if (a < 128) continue;

    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    /* Near-white and near-black are dropped before bucketing. Almost every
       cover has a white margin and black type, and both would win on
       volume and tell you nothing — "this book is mostly paper" is true of
       all of them. Put back at the end if nothing else survives. */
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;
    if (max > 242 || max < 26 || (chroma < 16 && (max > 220 || max < 40))) continue;

    const key = ((r >> SHIFT) << (BITS * 2)) | ((g >> SHIFT) << BITS) | (b >> SHIFT);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      bucket.n++;
    } else {
      buckets.set(key, { r, g, b, n: 1 });
    }
    counted++;
  }

  if (!counted) return [];

  return [...buckets.values()]
    .sort((x, y) => y.n - x.n)
    .slice(0, WANT)
    .map((c) => {
      /* The bucket's mean rather than its centre: the centre is a rounding
         artefact and lands slightly off every time, which is visible when
         the colour is meant to match a printed one. */
      const r = c.r / c.n;
      const g = c.g / c.n;
      const b = c.b / c.n;
      return { hex: hex(r, g, b), weight: c.n / counted, luma: luminance(r, g, b) };
    });
}

/* Turning a palette into a spine happens in engine/spine.ts, which is
   browser-free and therefore cannot live in this file — `extractPalette`
   needs a canvas, and everything under engine/ must not. */
