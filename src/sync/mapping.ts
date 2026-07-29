/* Row shapes on the wire, and the translation to and from local records.

   Kept apart from the sync loop so the loop reads as pull → merge → push
   without twenty field assignments in the middle of it, and so that swapping
   the backend later means rewriting one small file. */

import type { BookRecord, BookmarkRecord, ProgressRecord } from '../db';
import type { Session } from '../engine/stats';
import type { BookMeta, SpineEntry, TocEntry } from '../engine/types';

export interface BookRow {
  user_id: string;
  id: string;
  title: string;
  author: string;
  meta: BookMeta;
  spine: SpineEntry[];
  toc: TocEntry[];
  total_words: number;
  hue: number;
  added_at: number;
  finished_at: number | null;
  file_path: string | null;
  file_size: number | null;
  cover_path: string | null;
  updated_at: number;
  deleted: boolean;
  synced_at?: string;
}

export interface ProgressRow {
  user_id: string;
  book_id: string;
  spine_index: number;
  word_index: number;
  percent: number;
  updated_at: number;
  synced_at?: string;
}

export interface SessionRow {
  user_id: string;
  uid: string;
  book_id: string;
  start_at: number;
  end_at: number;
  ms: number;
  words: number;
  pages: number;
  paced_ms: number;
  synced_at?: string;
}

export interface BookmarkRow {
  user_id: string;
  uid: string;
  book_id: string;
  spine_index: number;
  word_index: number;
  excerpt: string;
  created_at: number;
  updated_at: number;
  deleted: boolean;
  synced_at?: string;
}

export interface SettingsRow {
  user_id: string;
  data: Record<string, unknown>;
  updated_at: number;
  synced_at?: string;
}

/* ── books ─────────────────────────────────────────────────────── */

export const bookToRow = (b: BookRecord, userId: string): BookRow => ({
  user_id: userId,
  id: b.id,
  title: b.meta.title ?? '',
  author: b.meta.author ?? '',
  meta: b.meta,
  spine: b.spine,
  toc: b.toc,
  total_words: b.totalWords,
  hue: b.hue,
  added_at: b.addedAt,
  finished_at: b.finishedAt ?? null,
  file_path: b.filePath ?? null,
  file_size: null,
  cover_path: b.coverPath ?? null,
  updated_at: b.updatedAt ?? b.addedAt,
  deleted: false,
});

export const rowToBook = (r: BookRow): BookRecord => ({
  id: r.id,
  meta: r.meta,
  spine: r.spine ?? [],
  toc: r.toc ?? [],
  totalWords: r.total_words,
  addedAt: r.added_at,
  hue: r.hue,
  ...(r.finished_at ? { finishedAt: r.finished_at } : {}),
  updatedAt: r.updated_at,
  ...(r.file_path ? { filePath: r.file_path } : {}),
  ...(r.cover_path ? { coverPath: r.cover_path } : {}),
});

/* ── progress ──────────────────────────────────────────────────── */

export const progressToRow = (p: ProgressRecord, userId: string): ProgressRow => ({
  user_id: userId,
  book_id: p.bookId,
  spine_index: p.spineIndex,
  word_index: p.wordIndex,
  percent: p.percent,
  updated_at: p.updatedAt,
});

export const rowToProgress = (r: ProgressRow): ProgressRecord => ({
  bookId: r.book_id,
  spineIndex: r.spine_index,
  wordIndex: r.word_index,
  percent: r.percent,
  updatedAt: r.updated_at,
});

/* ── sessions ──────────────────────────────────────────────────── */

export const sessionToRow = (s: Session, userId: string): SessionRow => ({
  user_id: userId,
  uid: s.uid as string,
  book_id: s.bookId,
  start_at: s.start,
  end_at: s.end,
  ms: Math.round(s.ms),
  words: Math.round(s.words),
  pages: Math.round(s.pages),
  paced_ms: Math.round(s.pacedMs),
});

export const rowToSession = (r: SessionRow): Session => ({
  uid: r.uid,
  bookId: r.book_id,
  start: r.start_at,
  end: r.end_at,
  ms: r.ms,
  words: r.words,
  pages: r.pages,
  pacedMs: r.paced_ms,
});

/* ── bookmarks ─────────────────────────────────────────────────── */

export const bookmarkToRow = (m: BookmarkRecord, userId: string): BookmarkRow => ({
  user_id: userId,
  uid: m.uid as string,
  book_id: m.bookId,
  spine_index: m.spineIndex,
  word_index: m.wordIndex,
  excerpt: m.excerpt,
  created_at: m.createdAt,
  updated_at: m.updatedAt ?? m.createdAt,
  deleted: false,
});

export const rowToBookmark = (r: BookmarkRow): BookmarkRecord => ({
  uid: r.uid,
  bookId: r.book_id,
  spineIndex: r.spine_index,
  wordIndex: r.word_index,
  excerpt: r.excerpt,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
