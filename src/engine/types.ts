/* Shared engine types. This module (and everything under engine/) must stay
   free of React and of any browser API that a native WKWebView shell wouldn't
   have — it is the portable core. */

export interface ManifestItem {
  id: string;
  href: string; // resolved, zip-relative path
  type: string; // media type
  properties: string;
}

export interface SpineEntry {
  idref: string;
  href: string;
  linear: boolean;
  /** words counted at import — lets us show progress before a chapter is opened */
  words: number;
}

export interface TocEntry {
  label: string;
  href: string; // zip-relative, may include #fragment
  spineIndex: number; // -1 if unresolved
  depth: number;
}

export interface BookMeta {
  title: string;
  author: string;
  publisher?: string;
  language?: string;
  description?: string;
  published?: string;
  identifier?: string;
  subjects: string[];
}

export interface ParsedBook {
  meta: BookMeta;
  spine: SpineEntry[];
  toc: TocEntry[];
  manifest: Record<string, ManifestItem>;
  coverPath?: string;
  coverBlob?: Blob;
  totalWords: number;
}
