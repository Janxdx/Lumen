/* Turning a string of SVG into a file the user can keep.
 *
 * The whole trick is that a browser will decode SVG through an <img>, and
 * anything an <img> can decode can be drawn into a canvas. So the card is
 * authored once, as markup, and the export is a rasterisation of exactly
 * what is on screen rather than a second drawing of the same thing.
 *
 * Three details that are easy to get wrong:
 *
 *   The SVG must carry explicit width and height attributes. A viewBox
 *   alone is enough for the DOM, which can consult the parent for a size,
 *   but an <img> has no parent — Safari renders nothing and Chrome guesses.
 *
 *   It has to reference nothing external. A remote font or image would
 *   either fail to load or taint the canvas, and a tainted canvas refuses
 *   toBlob(). Everything the card needs is inline, which is why the palette
 *   is baked in as literals.
 *
 *   The blob URL is revoked in a finally, including on the error path. A
 *   leaked object URL pins the whole decoded bitmap for the life of the
 *   document.
 */

/** Rasterise SVG markup to a PNG blob at `scale`× its intrinsic size. */
export async function svgToPng(svg: string, width: number, height: number, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('The card could not be rendered.'));
      img.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot export images.');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png')
    );
    if (!blob) throw new Error('The card could not be saved.');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Hand a blob to the user under a given name.
 *
 * Share first where it exists: on an iPad "save this picture" means the
 * share sheet — Photos, Messages, Files — and a download lands in a folder
 * most people will never open. Falls back to an anchor everywhere else,
 * and if the user dismisses the share sheet that is a decision, not an
 * error, so it is not retried as a download.
 */
export async function saveFile(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: blob.type });
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
    share?: (data: ShareData) => Promise<void>;
  };

  if (nav.canShare?.({ files: [file] }) && nav.share) {
    try {
      await nav.share({ files: [file] });
      return;
    } catch (e) {
      // dismissing the sheet throws AbortError; anything else falls through
      if ((e as Error)?.name === 'AbortError') return;
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // give the click a turn to be handled before the URL goes away
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
