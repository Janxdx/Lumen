/* Pagination by CSS multi-column layout.

   The content element is a horizontally-overflowing multi-column box with
   `overflow: hidden`. It is still a scroll container, so `scrollWidth` reports
   the true extent of all columns and `scrollLeft` moves between pages — while
   the user cannot free-scroll it by hand and desync the page counter.

   Column geometry also gives a cheap "which page is this word on?" lookup,
   which is what lets the pacer turn pages by itself. */

export interface Geometry {
  /** width of one text column = one page */
  colWidth: number;
  /** gutter between columns */
  gap: number;
  /** scroll distance per page */
  stride: number;
  pages: number;
}

export function measure(columns: HTMLElement, gap: number): Geometry {
  const colWidth = Math.max(1, columns.clientWidth);
  const stride = colWidth + gap;
  const pages = Math.max(1, Math.round((columns.scrollWidth + gap) / stride));
  return { colWidth, gap, stride, pages };
}

/** Which page does this element sit on? */
export function pageOf(el: Element, columns: HTMLElement, geo: Geometry): number {
  const a = el.getBoundingClientRect();
  const b = columns.getBoundingClientRect();
  const x = a.left - b.left + columns.scrollLeft;
  return Math.max(0, Math.floor((x + geo.gap * 0.5) / geo.stride));
}

export function scrollLeftFor(page: number, geo: Geometry): number {
  return page * geo.stride;
}

/** Gutter scales with viewport: roomy on an iPad, tight on a phone. */
export function gutterFor(viewportWidth: number): number {
  if (viewportWidth < 480) return 30;
  if (viewportWidth < 820) return 48;
  return 76;
}

/**
 * Move to a page. Deliberately instant: a page turn is a cut, not a slide —
 * the eye re-fixates on the new first line straight away instead of tracking
 * moving text, and at high pacer speeds an animation would still be running
 * when the next turn is due.
 */
export function scrollToPage(el: HTMLElement, page: number, geo: Geometry): void {
  el.scrollLeft = scrollLeftFor(page, geo);
}
