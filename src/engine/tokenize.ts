/* Word tokenisation.

   Every word in a rendered chapter is wrapped in its own <span class="w">.
   That single decision powers three things at once: the pacer can highlight a
   word by index, pagination can ask which page a word landed on, and word
   counts for statistics are exact rather than estimated. */

export const HAS_CONTENT = /[\p{L}\p{N}]/u;

/** Readable text from chapter markup. Anything that counts or indexes words
    has to strip the markup the same way, or the indices stop agreeing with
    the spans on the page — so there is exactly one place that does it. */
export function plainText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ');
}

/** Count words in a raw HTML/XHTML string (used at import time). */
export function countWords(html: string): number {
  const text = plainText(html);
  let n = 0;
  for (const token of text.split(/\s+/)) if (HAS_CONTENT.test(token)) n++;
  return n;
}

/** Words that should not be wrapped (their layout is fragile). */
const SKIP = new Set(['CODE', 'PRE', 'SCRIPT', 'STYLE', 'SVG']);

/**
 * Wrap every word inside `root` in `<span class="w" data-i="n">`.
 * Returns the ordered list of word strings — index n in this array
 * corresponds to `[data-i="n"]` in the DOM.
 */
export function tokenizeInto(root: HTMLElement): string[] {
  const words: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || SKIP.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const targets: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    targets.push(current as Text);
    current = walker.nextNode();
  }

  for (const node of targets) {
    const parts = (node.nodeValue ?? '').split(/(\s+)/);
    const frag = document.createDocumentFragment();
    for (const part of parts) {
      if (part === '') continue;
      if (!HAS_CONTENT.test(part)) {
        frag.appendChild(document.createTextNode(part));
        continue;
      }
      const span = document.createElement('span');
      span.className = 'w';
      span.dataset.i = String(words.length);
      span.textContent = part;
      words.push(part);
      frag.appendChild(span);
    }
    node.parentNode?.replaceChild(frag, node);
  }

  return words;
}
