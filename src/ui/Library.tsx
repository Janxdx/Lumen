import { useMemo, useRef, useState } from 'react';
import { useLibrary } from '../store/library';
import { useRatings } from '../store/ratings';
import { BookCover } from './BookCover';
import { IconCloud, IconImage, IconPlus, IconStar, IconTrash } from './Icons';
import { formatDuration, relativeDate } from '../engine/stats';
import { RatingSheet } from './RatingSheet';
import { ScanSheet } from './ScanSheet';
import { Sheet } from './Sheet';
import { useDarkTheme } from './theme';
import type { BookRecord } from '../db';

export function Library({ onOpen }: { onOpen: (id: string) => void }) {
  const { books, progress, covers, sessions, importFile, importing, remove, saveProgress } =
    useLibrary();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [detail, setDetail] = useState<BookRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* Rating from the library, not only from the shelf tab. The moment you
     want to rate a book is the moment you close it, and that moment ends
     here — a feature reachable only from its own tab is a feature nobody
     remembers exists. */
  const [rating, setRating] = useState<BookRecord | null>(null);
  /* The paper copy is the other place a book gets read. Scanning a page of
     it is how the app catches up with a week away from the screen. */
  const [scanning, setScanning] = useState<BookRecord | null>(null);
  const ratings = useRatings((s) => s.ratings);
  const dark = useDarkTheme();
  const ratingFor = (id: string) => ratings.find((r) => r.bookId === id);

  const recent = useMemo(() => {
    const withProgress = books
      .map((b) => ({ b, p: progress[b.id] }))
      .filter((x) => x.p && x.p.percent > 0.002 && x.p.percent < 0.99);
    withProgress.sort((a, b) => (b.p?.updatedAt ?? 0) - (a.p?.updatedAt ?? 0));
    return withProgress[0] ?? null;
  }, [books, progress]);

  const timePerBook = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of sessions) map[s.bookId] = (map[s.bookId] ?? 0) + s.ms;
    return map;
  }, [sessions]);

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (!/\.epub$/i.test(file.name)) {
        setError(`${file.name} isn’t an EPUB file.`);
        continue;
      }
      try {
        await importFile(file);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'That file could not be read.');
      }
    }
  };

  return (
    <div
      className="scroller"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void handleFiles(e.dataTransfer.files);
      }}
    >
      <div className="wrap">
        <div className="lib-head">
          <div>
            <div className="eyebrow">Library</div>
            <h1 className="display" style={{ marginTop: 6 }}>
              {books.length === 0
                ? 'Nothing here yet'
                : `${books.length} ${books.length === 1 ? 'book' : 'books'}`}
            </h1>
          </div>
          <button className="btn primary" onClick={() => fileInput.current?.click()}>
            <IconPlus size={17} />
            {importing ? 'Importing…' : 'Add EPUB'}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".epub,application/epub+zip"
            multiple
            hidden
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        {recent && (
          <button className="hero" onClick={() => onOpen(recent.b.id)}>
            <div className="cover">
              <BookCover book={recent.b} url={covers[recent.b.id]} />
            </div>
            <div className="body">
              <div className="eyebrow">Continue reading</div>
              <h2
                className="display"
                style={{ fontSize: 'clamp(20px,2.6vw,28px)', marginTop: 8 }}
              >
                {recent.b.meta.title}
              </h2>
              <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                {recent.b.meta.author}
              </p>
              <div className="progress-rail" style={{ marginTop: 14 }}>
                <i style={{ width: `${(recent.p?.percent ?? 0) * 100}%` }} />
              </div>
              <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                {Math.round((recent.p?.percent ?? 0) * 100)}% ·{' '}
                {formatDuration(timePerBook[recent.b.id] ?? 0)} read · last opened{' '}
                {relativeDate(recent.p?.updatedAt ?? Date.now())}
              </p>
            </div>
          </button>
        )}

        {books.length === 0 ? (
          <div className="empty">
            <p style={{ fontFamily: 'var(--font-read)', fontSize: 20, color: 'var(--ink-2)' }}>
              Drop an EPUB here
            </p>
            <p style={{ fontSize: 13, marginTop: 8 }}>
              or use Add EPUB to pick one from Files
            </p>
          </div>
        ) : (
          <div className="shelf">
            {books.map((b, i) => {
              const p = progress[b.id];
              return (
                <div
                  key={b.id}
                  className="book"
                  style={{ animationDelay: `${Math.min(i, 12) * 28}ms` }}
                >
                  <button
                    style={{ display: 'block', width: '100%' }}
                    onClick={() => onOpen(b.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setDetail(b);
                    }}
                  >
                    <div className="cover">
                      <BookCover book={b} url={covers[b.id]} />
                      {/* synced from another device, file not fetched yet */}
                      {b.fileMissing && (
                        <span className="cloud-badge" title="Downloads when opened">
                          <IconCloud size={14} />
                        </span>
                      )}
                    </div>
                    <div className="meta">
                      <div className="t">{b.meta.title}</div>
                      <div className="a">{b.meta.author}</div>
                      {p && p.percent > 0.002 && (
                        <div className="progress-rail">
                          <i style={{ width: `${p.percent * 100}%` }} />
                        </div>
                      )}
                    </div>
                  </button>
                  <button
                    className="btn ghost"
                    style={{ height: 28, padding: '0 8px', fontSize: 11.5, marginTop: 2 }}
                    onClick={() => setDetail(b)}
                  >
                    Details
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {dragging && <div className="dropzone">Drop to import</div>}
      {error && (
        <div className="toast" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      <Sheet open={!!detail} onClose={() => setDetail(null)}>
        {detail && (
          <div style={{ maxWidth: 620, margin: '0 auto' }}>
            <div style={{ display: 'flex', gap: 20 }}>
              <div
                className="cover"
                style={{
                  width: 96,
                  flex: 'none',
                  aspectRatio: '2/3',
                  borderRadius: '3px 8px 8px 3px',
                  overflow: 'hidden',
                  position: 'relative',
                  boxShadow: 'var(--shadow-2)',
                }}
              >
                <BookCover book={detail} url={covers[detail.id]} />
              </div>
              <div style={{ minWidth: 0 }}>
                <h2 className="display" style={{ fontSize: 24 }}>
                  {detail.meta.title}
                </h2>
                <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
                  {detail.meta.author}
                </p>
                <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                  {detail.spine.length} chapters ·{' '}
                  {detail.totalWords.toLocaleString()} words · about{' '}
                  {formatDuration((detail.totalWords / 250) * 60_000, true)} at 250 wpm
                </p>
              </div>
            </div>

            {detail.meta.description && (
              <p
                style={{
                  marginTop: 20,
                  fontSize: 14,
                  lineHeight: 1.55,
                  color: 'var(--ink-2)',
                  maxHeight: 160,
                  overflow: 'auto',
                }}
              >
                {detail.meta.description}
              </p>
            )}

            <div className="row" style={{ marginTop: 12 }}>
              <div>
                <div className="label">Time spent</div>
                <div className="hint">{formatDuration(timePerBook[detail.id] ?? 0, true)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="label">Progress</div>
                <div className="hint">
                  {Math.round((progress[detail.id]?.percent ?? 0) * 100)}%
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
              <button
                className="btn primary"
                style={{ flex: 1, justifyContent: 'center', minWidth: 120 }}
                onClick={() => {
                  const id = detail.id;
                  setDetail(null);
                  onOpen(id);
                }}
              >
                Read
              </button>
              <button
                className="btn"
                onClick={() => {
                  const book = detail;
                  setDetail(null);
                  setRating(book);
                }}
              >
                <IconStar size={16} solid={Boolean(ratingFor(detail.id))} />
                {ratingFor(detail.id) ? `Rated ${ratingFor(detail.id)?.overall}` : 'Rate'}
              </button>
              {!detail.fileMissing && (
                <button
                  className="btn"
                  onClick={() => {
                    const book = detail;
                    setDetail(null);
                    setScanning(book);
                  }}
                >
                  <IconImage size={16} /> Find my place
                </button>
              )}
              <button
                className="btn"
                onClick={() => {
                  void remove(detail.id);
                  setDetail(null);
                }}
              >
                <IconTrash size={16} /> Remove
              </button>
            </div>
          </div>
        )}
      </Sheet>

      {scanning && (
        <ScanSheet
          open
          onClose={() => setScanning(null)}
          bookId={scanning.id}
          spine={scanning.spine}
          title={scanning.meta.title}
          action="Open the book here"
          describe={(locus) => {
            const chapter =
              scanning.toc.find((t) => t.spineIndex === locus.spineIndex)?.label ??
              `Chapter ${locus.spineIndex + 1}`;
            return `${chapter} · ${Math.round(locus.percent * 100)}% through`;
          }}
          onLocated={async (locus) => {
            const id = scanning.id;
            await saveProgress({
              bookId: id,
              spineIndex: locus.spineIndex,
              wordIndex: locus.wordIndex,
              percent: locus.percent,
              updatedAt: Date.now(),
            });
            setScanning(null);
            onOpen(id);
          }}
        />
      )}

      <RatingSheet
        open={Boolean(rating)}
        existing={rating ? (ratingFor(rating.id) ?? null) : null}
        subject={
          rating
            ? {
                key: `b:${rating.id}`,
                bookId: rating.id,
                title: rating.meta.title,
                author: rating.meta.author ?? '',
                words: rating.totalWords,
                finished: Boolean(rating.finishedAt),
                percent: progress[rating.id]?.percent ?? 0,
              }
            : null
        }
        dark={dark}
        onClose={() => setRating(null)}
      />
    </div>
  );
}
