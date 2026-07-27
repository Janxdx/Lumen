import type { CSSProperties } from 'react';
import type { BookRecord } from '../db';

/** Generated covers are derived from the book's stored hue, so a given book
    always looks the same — the library stays recognisable at a glance. */
export function BookCover({ book, url }: { book: BookRecord; url?: string }) {
  if (url) return <img src={url} alt="" loading="lazy" />;
  const h = book.hue;
  return (
    <div
      className="cover-fallback"
      style={
        {
          '--c1': `hsl(${h} 34% 42%)`,
          '--c2': `hsl(${(h + 42) % 360} 30% 24%)`,
        } as CSSProperties
      }
    >
      <div className="t">{book.meta.title}</div>
      <div className="a">{book.meta.author}</div>
    </div>
  );
}
