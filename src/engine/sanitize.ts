/* Chapter sanitiser.

   Publisher CSS is deliberately discarded. Every book is then set in the same
   considered typography, which is both a design decision and what makes
   column pagination and word-level pacing reliable. Semantic structure is
   kept; presentation is ours. */

import type { EpubZip } from './epub/zip';
import { mimeFor, resolvePath } from './epub/zip';

const ALLOWED = new Set([
  'P', 'DIV', 'SPAN', 'BR', 'HR',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'EM', 'I', 'STRONG', 'B', 'U', 'S', 'SMALL', 'SUB', 'SUP', 'MARK',
  'BLOCKQUOTE', 'CITE', 'Q',
  'UL', 'OL', 'LI', 'DL', 'DT', 'DD',
  'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD',
  'FIGURE', 'FIGCAPTION', 'IMG', 'A',
  'CODE', 'PRE', 'SECTION', 'ARTICLE', 'HEADER', 'ASIDE',
]);

const DROP_ENTIRELY = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'HEAD', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'AUDIO', 'VIDEO']);

export interface Chapter {
  html: string;
  /** object URLs created for images — revoke when the chapter unmounts */
  objectUrls: string[];
}

export function sanitizeChapter(zip: EpubZip, chapterPath: string): Chapter {
  const raw = zip.text(chapterPath);
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  const body = doc.body ?? doc.createElement('body');
  const objectUrls: string[] = [];

  const clean = (node: Element): void => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toUpperCase();

      if (DROP_ENTIRELY.has(tag)) {
        child.remove();
        continue;
      }

      // SVG-wrapped cover images are common — pull the href out and keep the image
      if (tag === 'SVG') {
        const img = child.querySelector('image');
        const href =
          img?.getAttribute('href') ?? img?.getAttribute('xlink:href') ?? null;
        if (href) {
          const el = doc.createElement('img');
          el.setAttribute('src', href);
          child.replaceWith(el);
          resolveImage(el);
        } else {
          child.remove();
        }
        continue;
      }

      if (!ALLOWED.has(tag)) {
        // keep the text, drop the wrapper
        child.replaceWith(...Array.from(child.childNodes));
        continue;
      }

      // strip every attribute, then re-add the few that carry meaning
      const src = child.getAttribute('src');
      const href = child.getAttribute('href');
      const alt = child.getAttribute('alt');
      const colspan = child.getAttribute('colspan');
      for (const attr of Array.from(child.attributes)) child.removeAttribute(attr.name);

      if (tag === 'IMG' && src) {
        child.setAttribute('src', src);
        if (alt) child.setAttribute('alt', alt);
        resolveImage(child as HTMLImageElement);
      }
      if (tag === 'A' && href) {
        // internal links become inert; external links open in a new tab
        if (/^[a-z]+:/i.test(href) && !href.startsWith('file:')) {
          child.setAttribute('href', href);
          child.setAttribute('target', '_blank');
          child.setAttribute('rel', 'noreferrer noopener');
        }
      }
      if ((tag === 'TD' || tag === 'TH') && colspan) child.setAttribute('colspan', colspan);

      clean(child);
    }
  };

  const resolveImage = (el: HTMLImageElement): void => {
    const src = el.getAttribute('src');
    if (!src) return;
    if (/^(data|https?):/i.test(src)) return;
    const path = resolvePath(chapterPath, src);
    const blob = zip.blob(path, mimeFor(path));
    if (!blob) {
      el.remove();
      return;
    }
    const url = URL.createObjectURL(blob);
    objectUrls.push(url);
    el.setAttribute('src', url);
  };

  clean(body);

  // collapse empty paragraphs left behind by unwrapping
  for (const p of Array.from(body.querySelectorAll('p, div, span'))) {
    if (!p.textContent?.trim() && !p.querySelector('img')) p.remove();
  }

  return { html: body.innerHTML, objectUrls };
}
