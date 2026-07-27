import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { db, type BookRecord } from '../db';
import { EpubZip } from '../engine/epub/zip';
import { sanitizeChapter } from '../engine/sanitize';
import { tokenizeInto } from '../engine/tokenize';
import { gutterFor, measure, pageOf, scrollToPage, type Geometry } from '../engine/paginate';
import { Pacer } from '../engine/pacer';
import { useSettings } from '../store/settings';
import { useLibrary } from '../store/library';
import { Sheet } from './Sheet';
import { ReaderSettings } from './ReaderSettings';
import {
  IconBack,
  IconList,
  IconMinus,
  IconPause,
  IconPlay,
  IconPlus,
  IconSliders,
} from './Icons';

const IDLE_MS = 90_000;
const HEARTBEAT_MS = 5_000;

export function Reader({ bookId, onClose }: { bookId: string; onClose: () => void }) {
  const settings = useSettings();
  // selectors, not the whole store: the reader must not re-render every time
  // a session is written back to the library
  const saveProgress = useLibrary((s) => s.saveProgress);
  const recordSession = useLibrary((s) => s.recordSession);

  const [book, setBook] = useState<BookRecord | null>(null);
  const [spineIndex, setSpineIndex] = useState(0);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [toc, setToc] = useState(false);
  const [prefs, setPrefs] = useState(false);
  const [ready, setReady] = useState(false);
  const [wordIndex, setWordIndex] = useState(0);

  const viewportRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  const zipRef = useRef<EpubZip | null>(null);
  const spansRef = useRef<HTMLElement[]>([]);
  const geoRef = useRef<Geometry | null>(null);
  const pageRef = useRef(0);
  const wordRef = useRef(0);
  const litRef = useRef(-1);
  const startWordRef = useRef(0);
  const landOnEndRef = useRef(false);
  const bookRef = useRef<BookRecord | null>(null);
  const spineRef = useRef(0);
  const lastActivityRef = useRef(Date.now());
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const sessionRef = useRef({
    start: Date.now(),
    activeMs: 0,
    pages: 0,
    startWords: 0,
    pacedMs: 0,
  });

  bookRef.current = book;
  spineRef.current = spineIndex;

  /* ── absolute position in the book, in words ─────────────────── */
  const globalWords = useCallback((si: number, wi: number): number => {
    const b = bookRef.current;
    if (!b) return 0;
    let before = 0;
    for (let i = 0; i < si; i++) before += b.spine[i].words;
    const chapterWords = b.spine[si]?.words ?? 0;
    const rendered = spansRef.current.length || chapterWords || 1;
    return before + Math.round((wi / rendered) * chapterWords);
  }, []);

  /* ── load the book ───────────────────────────────────────────── */
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [record, file, progress] = await Promise.all([
        db.books.get(bookId),
        db.files.get(bookId),
        db.progress.get(bookId),
      ]);
      if (!record || !file || !alive) return;
      zipRef.current = await EpubZip.open(file.data);
      if (!alive) return;
      startWordRef.current = progress?.wordIndex ?? 0;
      bookRef.current = record;
      setBook(record);
      setSpineIndex(Math.min(progress?.spineIndex ?? 0, record.spine.length - 1));
      sessionRef.current = {
        start: Date.now(),
        activeMs: 0,
        pages: 0,
        startWords: 0,
        pacedMs: 0,
      };
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [bookId]);

  /* ── page navigation ─────────────────────────────────────────── */
  const goto = useCallback((target: number) => {
    const geo = geoRef.current;
    const el = columnsRef.current;
    if (!geo || !el) return;
    const p = Math.min(Math.max(0, target), geo.pages - 1);
    scrollToPage(el, p, geo);
    if (p !== pageRef.current) sessionRef.current.pages++;
    pageRef.current = p;
    setPage(p);
  }, []);

  /** first word span on a given page — binary search over document order */
  const firstWordOnPage = useCallback((target: number): number => {
    const spans = spansRef.current;
    const el = columnsRef.current;
    const geo = geoRef.current;
    if (!el || !geo || spans.length === 0) return 0;
    let lo = 0;
    let hi = spans.length - 1;
    let answer = spans.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (pageOf(spans[mid], el, geo) >= target) {
        answer = mid;
        hi = mid - 1;
      } else lo = mid + 1;
    }
    return answer;
  }, []);

  const highlight = useCallback((index: number) => {
    const spans = spansRef.current;
    const previous = spans[litRef.current];
    if (previous) {
      previous.classList.remove('lit');
      previous.classList.add('said');
    }
    const current = spans[index];
    if (current) current.classList.add('lit');
    litRef.current = index;
  }, []);

  /* ── layout ──────────────────────────────────────────────────── */
  const relayout = useCallback(
    (targetWord: number, toEnd = false) => {
      const el = columnsRef.current;
      const vp = viewportRef.current;
      if (!el || !vp) return;

      const gap = Math.round(gutterFor(vp.clientWidth) * (0.5 + settings.margin));
      vp.style.paddingLeft = `${gap / 2}px`;
      vp.style.paddingRight = `${gap / 2}px`;
      el.style.fontSize = `${settings.fontSize}px`;
      el.style.lineHeight = String(settings.lineHeight);
      // reading clientWidth flushes the padding change before we size columns
      el.style.columnWidth = `${Math.max(160, el.clientWidth)}px`;
      el.style.columnGap = `${gap}px`;

      const geo = measure(el, gap);
      geoRef.current = geo;
      setPages(geo.pages);

      const span = spansRef.current[targetWord];
      const target = toEnd ? geo.pages - 1 : span ? pageOf(span, el, geo) : 0;
      goto(target);
      const landed = toEnd ? firstWordOnPage(target) : targetWord;
      wordRef.current = landed;
      setWordIndex(landed);
      highlight(landed);
    },
    [settings.margin, settings.fontSize, settings.lineHeight, goto, firstWordOnPage, highlight]
  );

  /* ── render the current chapter ──────────────────────────────── */
  useLayoutEffect(() => {
    if (!ready || !book || !zipRef.current) return;
    const el = columnsRef.current;
    if (!el) return;

    let chapter;
    try {
      chapter = sanitizeChapter(zipRef.current, book.spine[spineIndex].href);
    } catch {
      chapter = { html: '<p>This chapter could not be opened.</p>', objectUrls: [] };
    }

    el.innerHTML = chapter.html;
    tokenizeInto(el);
    spansRef.current = Array.from(el.querySelectorAll<HTMLElement>('.w'));
    litRef.current = -1;

    const start = Math.min(startWordRef.current, Math.max(0, spansRef.current.length - 1));
    const toEnd = landOnEndRef.current;
    startWordRef.current = 0;
    landOnEndRef.current = false;

    relayout(start, toEnd);
    pacer.load(
      spansRef.current.map((s) => s.textContent ?? ''),
      wordRef.current
    );

    // images arrive late and change the column count
    const images = Array.from(el.querySelectorAll('img'));
    let pending = images.filter((i) => !i.complete).length;
    const onLoad = () => {
      if (--pending <= 0) relayout(wordRef.current);
    };
    for (const img of images) {
      if (!img.complete) {
        img.addEventListener('load', onLoad, { once: true });
        img.addEventListener('error', onLoad, { once: true });
      }
    }

    return () => {
      for (const url of chapter.objectUrls) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, book, spineIndex]);

  /* ── typography changes reflow the chapter ───────────────────── */
  useLayoutEffect(() => {
    if (!ready) return;
    relayout(wordRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.fontSize, settings.lineHeight, settings.margin, settings.serif, settings.justify]);

  useEffect(() => {
    const onResize = () => relayout(wordRef.current);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [relayout]);

  /* ── chapter navigation ──────────────────────────────────────── */
  const goChapter = useCallback(
    (index: number, word = 0, toEnd = false) => {
      const b = bookRef.current;
      if (!b) return false;
      if (index < 0 || index >= b.spine.length) return false;
      startWordRef.current = word;
      landOnEndRef.current = toEnd;
      setSpineIndex(index);
      return true;
    },
    []
  );

  const turn = useCallback(
    (delta: number) => {
      lastActivityRef.current = Date.now();
      const geo = geoRef.current;
      if (!geo) return;
      const next = pageRef.current + delta;
      if (next < 0) {
        goChapter(spineRef.current - 1, 0, true);
        return;
      }
      if (next >= geo.pages) {
        if (!goChapter(spineRef.current + 1)) pacer.pause();
        return;
      }
      goto(next);
      const landed = firstWordOnPage(next);
      wordRef.current = landed;
      setWordIndex(landed);
      if (!pacer.isRunning) highlight(landed);
      else pacer.seek(landed);
    },
    [goto, firstWordOnPage, goChapter, highlight]
  );

  /* ── pacer ───────────────────────────────────────────────────── */
  const pacer = useMemo(
    () =>
      new Pacer(
        (index) => {
          wordRef.current = index;
          lastActivityRef.current = Date.now();
          highlight(index);

          const el = columnsRef.current;
          const geo = geoRef.current;
          const span = spansRef.current[index];
          if (el && geo && span && useSettings.getState().autoTurn) {
            const p = pageOf(span, el, geo);
            if (p !== pageRef.current && p < geo.pages) goto(p);
          }
          if (index % 24 === 0) setWordIndex(index);
        },
        () => {
          // end of chapter: keep going into the next one
          setPlaying(false);
          const b = bookRef.current;
          if (b && spineRef.current < b.spine.length - 1) {
            startWordRef.current = 0;
            setSpineIndex(spineRef.current + 1);
            requestAnimationFrame(() => {
              pacer.play();
              setPlaying(true);
            });
          }
        }
      ),
    // built once per reader mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    pacer.setConfig(settings.pacer);
  }, [pacer, settings.pacer]);

  /** stop the pacer where it stands; returns false if it wasn't running */
  const stopPacer = useCallback(
    (revealChrome = false) => {
      lastActivityRef.current = Date.now();
      if (!pacer.isRunning) return false;
      pacer.pause();
      setPlaying(false);
      setWordIndex(pacer.position);
      highlight(pacer.position);
      if (revealChrome) setChrome(true);
      return true;
    },
    [pacer, highlight]
  );

  const togglePlay = useCallback(() => {
    lastActivityRef.current = Date.now();
    if (pacer.isRunning) {
      pacer.pause();
      setPlaying(false);
      setWordIndex(pacer.position);
    } else {
      pacer.seek(wordRef.current);
      pacer.play();
      setPlaying(true);
      setChrome(false);
    }
  }, [pacer]);

  useEffect(() => () => pacer.pause(), [pacer]);

  /* ── screen wake lock while pacing ───────────────────────────── */
  useEffect(() => {
    const want = playing && settings.keepAwake;
    const request = async () => {
      try {
        if (want && !wakeLockRef.current && 'wakeLock' in navigator) {
          wakeLockRef.current = await navigator.wakeLock.request('screen');
          wakeLockRef.current.addEventListener('release', () => {
            wakeLockRef.current = null;
          });
        }
      } catch {
        /* denied — not fatal */
      }
    };
    if (want) void request();
    else {
      void wakeLockRef.current?.release();
      wakeLockRef.current = null;
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible' && want) void request();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [playing, settings.keepAwake]);

  /* ── session tracking ────────────────────────────────────────── */
  useEffect(() => {
    if (!ready) return;
    sessionRef.current.startWords = globalWords(spineRef.current, wordRef.current);
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastActivityRef.current < IDLE_MS) {
        sessionRef.current.activeMs += HEARTBEAT_MS;
      }
    }, HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [ready, globalWords]);

  const flushSession = useCallback(() => {
    const s = sessionRef.current;
    const words = Math.max(0, globalWords(spineRef.current, wordRef.current) - s.startWords);
    void recordSession({
      bookId,
      start: s.start,
      end: Date.now(),
      ms: s.activeMs,
      words,
      pages: s.pages,
      pacedMs: Math.round(pacer.pacedMs),
    });
    s.start = Date.now();
    s.activeMs = 0;
    s.pages = 0;
    s.startWords = globalWords(spineRef.current, wordRef.current);
    pacer.pacedMs = 0;
  }, [bookId, globalWords, pacer, recordSession]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushSession();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      flushSession();
    };
  }, [flushSession]);

  /* ── progress persistence (debounced) ────────────────────────── */
  useEffect(() => {
    if (!ready || !book) return;
    const id = window.setTimeout(() => {
      const total = book.totalWords || 1;
      void saveProgress({
        bookId,
        spineIndex,
        wordIndex: wordRef.current,
        percent: Math.min(1, globalWords(spineIndex, wordRef.current) / total),
        updatedAt: Date.now(),
      });
    }, 1200);
    return () => window.clearTimeout(id);
  }, [ready, book, bookId, spineIndex, page, wordIndex, globalWords, saveProgress]);

  /* ── input ───────────────────────────────────────────────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (toc || prefs) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') turn(1);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') turn(-1);
      else if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [turn, togglePlay, onClose, toc, prefs]);

  /**
   * Touches that land on the chrome (or anything interactive) belong to that
   * control, not to the page. On iOS the click is synthesized *after*
   * pointerup and re-hit-tests the DOM: if we hide the chrome here first, the
   * button is `pointer-events: none` by then and the click evaporates — the
   * bar just blinks out and nothing happens. Desktop dispatches the click from
   * the same gesture, which is why it only broke on iPad.
   */
  const isControl = (target: EventTarget | null): boolean => {
    const el = target as HTMLElement | null;
    if (!el?.closest) return false;
    // book content is never a control, even where it contains links
    if (el.closest('.columns')) return false;
    return !!el.closest('.chrome, .sheet, .scrim, button, input, select, textarea, a, label');
  };

  const swipeRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const onPointerDown = (e: ReactPointerEvent) => {
    if (isControl(e.target)) {
      swipeRef.current = null;
      return;
    }
    swipeRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  };
  const onPointerCancel = () => {
    swipeRef.current = null;
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const s = swipeRef.current;
    swipeRef.current = null;
    if (!s || isControl(e.target)) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > 46 && Math.abs(dx) > Math.abs(dy) * 1.6) {
      turn(dx < 0 ? 1 : -1);
      return;
    }
    if (Math.abs(dx) > 12 || Math.abs(dy) > 12 || Date.now() - s.t > 500) return;

    // while the pacer is running, a tap anywhere on the page stops it — and
    // does nothing else, so it never doubles as a page turn
    if (stopPacer(true)) return;

    // Edge taps turn the page, the middle toggles the chrome. Resolved from
    // geometry rather than a click on the tap-zone divs — iOS does not
    // reliably synthesize click on plain, non-interactive elements.
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < rect.width * 0.22) turn(-1);
    else if (x > rect.width * 0.78) turn(1);
    else setChrome((c) => !c);
  };

  /* ── derived display values ──────────────────────────────────── */
  const percent = book
    ? Math.min(1, globalWords(spineIndex, wordIndex) / (book.totalWords || 1))
    : 0;
  const chapterTitle =
    book?.toc.slice().reverse().find((t) => t.spineIndex >= 0 && t.spineIndex <= spineIndex)
      ?.label ?? `Chapter ${spineIndex + 1}`;
  const remainingWords = book ? Math.max(0, book.totalWords - globalWords(spineIndex, wordIndex)) : 0;
  const minutesLeft = Math.round(remainingWords / Math.max(120, settings.pacer.wpm));

  const columnClass = [
    'columns',
    settings.serif ? '' : 'sans',
    settings.justify ? '' : 'ragged',
    settings.dim && playing ? 'dim' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const pad = Math.round(28 + settings.margin * 26);

  return (
    <div className="reader">
      <div
        className="page-area"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <div
          className="viewport"
          ref={viewportRef}
          style={{ paddingTop: pad, paddingBottom: pad + 14 }}
        >
          <div className={columnClass} ref={columnsRef} />
        </div>

        {/* affordance only — the turn itself is resolved in onPointerUp */}
        <div className="tapzone l" />
        <div className="tapzone r" />

        <div className={`chrome top${chrome ? '' : ' hidden'}`}>
          <button className="icon-btn" onClick={onClose} aria-label="Back to library">
            <IconBack />
          </button>
          <button className="icon-btn" onClick={() => setToc(true)} aria-label="Contents">
            <IconList />
          </button>
          <div className="title">{book?.meta.title ?? ''}</div>
          <button className="icon-btn" onClick={() => setPrefs(true)} aria-label="Settings">
            <IconSliders />
          </button>
        </div>

        <div className={`chrome bottom${chrome ? '' : ' hidden'}`}>
          <div className="pacer">
            <button className="play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Start pacer'}>
              {playing ? <IconPause size={18} /> : <IconPlay size={18} />}
            </button>
            <button
              className="icon-btn"
              onClick={() =>
                settings.setPacer({ wpm: Math.max(80, settings.pacer.wpm - 25) })
              }
              aria-label="Slower"
            >
              <IconMinus size={17} />
            </button>
            <input
              type="range"
              min={80}
              max={900}
              step={5}
              value={settings.pacer.wpm}
              style={{ flex: 1 }}
              onChange={(e) => settings.setPacer({ wpm: Number(e.target.value) })}
            />
            <button
              className="icon-btn"
              onClick={() =>
                settings.setPacer({ wpm: Math.min(900, settings.pacer.wpm + 25) })
              }
              aria-label="Faster"
            >
              <IconPlus size={17} />
            </button>
            <div className="wpm">
              <b className="num">{settings.pacer.wpm}</b>
              <span>WPM</span>
            </div>
          </div>

          <div className="seek">
            <span className="num">{Math.round(percent * 100)}%</span>
            <input
              type="range"
              min={0}
              max={Math.max(0, (book?.spine.length ?? 1) - 1)}
              step={1}
              value={spineIndex}
              onChange={(e) => goChapter(Number(e.target.value))}
            />
            <span className="num" style={{ minWidth: 96, textAlign: 'right' }}>
              {page + 1}/{pages} · {minutesLeft}m left
            </span>
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--ink-3)',
              marginTop: 6,
              textAlign: 'center',
            }}
          >
            {chapterTitle}
          </div>
        </div>
      </div>

      <Sheet open={toc} onClose={() => setToc(false)} side>
        <div className="eyebrow" style={{ marginBottom: 14 }}>
          Contents
        </div>
        {book?.toc.map((entry, i) => (
          <button
            key={`${entry.href}-${i}`}
            className={`toc-item${entry.spineIndex === spineIndex ? ' on' : ''}`}
            style={{ paddingLeft: 12 + entry.depth * 14 }}
            onClick={() => {
              if (entry.spineIndex >= 0) {
                pacer.pause();
                setPlaying(false);
                goChapter(entry.spineIndex);
              }
              setToc(false);
            }}
          >
            {entry.label}
          </button>
        ))}
      </Sheet>

      <Sheet open={prefs} onClose={() => setPrefs(false)}>
        <ReaderSettings />
      </Sheet>
    </div>
  );
}
