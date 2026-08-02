/* Rating a book.
 *
 * One number that is the verdict, five that are the reasons, a colour for
 * how it felt, and a line for your future self. Nothing here is required
 * except the verdict — a rating you had to fill in completely is a rating
 * you would not have bothered to make.
 *
 * The design problem this screen actually solves is the middle of the
 * scale. Left to a bare 0–10, everyone's ratings collapse into 7, 8 and 9,
 * because five reads as a failing grade rather than as "fine". So the
 * number is always shown with the word for it, and the axes are separate
 * pips rather than a slider, because tapping "6 for pacing" is a judgement
 * and dragging a handle is a shrug.
 */

import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Sheet } from './Sheet';
import { Radar } from './Charts';
import { IconStar, IconTrash } from './Icons';
import {
  AXES,
  MOODS,
  clampScore,
  moodColor,
  scoreLabel,
  type AxisKey,
  type MoodKey,
  type RatingRecord,
} from '../engine/rating';
import { useRatings, type Rateable } from '../store/ratings';

interface Props {
  open: boolean;
  /** the book being rated — omitted when editing an existing rating */
  subject?: Rateable | null;
  existing?: RatingRecord | null;
  dark: boolean;
  onClose: () => void;
}

interface Draft {
  overall: number;
  axes: Partial<Record<AxisKey, number>>;
  mood?: MoodKey;
  note: string;
  favourite: boolean;
}

const blank = (): Draft => ({ overall: 7, axes: {}, note: '', favourite: false });

const fromRecord = (r: RatingRecord): Draft => ({
  overall: r.overall,
  axes: { ...r.axes },
  ...(r.mood ? { mood: r.mood } : {}),
  note: r.note ?? '',
  favourite: Boolean(r.favourite),
});

export function RatingSheet({ open, subject, existing, dark, onClose }: Props) {
  const { rate, update, remove } = useRatings();
  const [draft, setDraft] = useState<Draft>(blank);

  /* Reset whenever the sheet opens on something new, not on every render of
     the parent — otherwise typing a note would be undone by the next
     unrelated state change upstairs. */
  useEffect(() => {
    if (!open) return;
    setDraft(existing ? fromRecord(existing) : blank());
  }, [open, existing?.id, subject?.key]);

  const title = existing?.title ?? subject?.title ?? '';
  const author = existing?.author ?? subject?.author ?? '';

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  const setAxis = (key: AxisKey, value: number) =>
    setDraft((d) => {
      const axes = { ...d.axes };
      // tapping the pip that is already set clears it: unjudged is a
      // meaningful state and there has to be a way back to it
      if (axes[key] === value) delete axes[key];
      else axes[key] = value;
      return { ...d, axes };
    });

  const save = async () => {
    if (existing) {
      await update(existing.id, {
        overall: draft.overall,
        axes: draft.axes,
        mood: draft.mood,
        note: draft.note.trim() || undefined,
        favourite: draft.favourite,
      });
    } else if (subject) {
      await rate({
        bookId: subject.bookId,
        deviceBookId: subject.deviceBookId,
        title: subject.title,
        author: subject.author,
        words: subject.words,
        overall: draft.overall,
        axes: draft.axes,
        mood: draft.mood,
        note: draft.note,
        favourite: draft.favourite,
      });
    }
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="rating-editor">
        <header>
          <div className="eyebrow">{existing ? 'Your rating' : 'Rate'}</div>
          <h2 className="display" style={{ fontSize: 'clamp(20px,3vw,27px)', marginTop: 6 }}>
            {title}
          </h2>
          {author && (
            <p className="muted" style={{ fontSize: 13, marginTop: 5 }}>
              {author}
            </p>
          )}
        </header>

        <ScoreDial value={draft.overall} onChange={(overall) => patch({ overall })} />

        <div className="rating-cols">
          <div>
            <div className="label" style={{ marginBottom: 10 }}>
              Why
            </div>
            {AXES.map((a) => (
              <AxisRow
                key={a.key}
                label={a.label}
                hint={a.hint}
                value={draft.axes[a.key]}
                onChange={(v) => setAxis(a.key, v)}
              />
            ))}
          </div>
          <div className="rating-radar">
            <Radar values={draft.axes} size={190} />
            <p className="muted" style={{ fontSize: 11.5, textAlign: 'center', marginTop: 6 }}>
              {Object.keys(draft.axes).length === 0
                ? 'Nothing judged yet'
                : 'Tap a mark again to unset it'}
            </p>
          </div>
        </div>

        <div className="label" style={{ marginTop: 4 }}>
          How it felt
        </div>
        <div className="mood-grid">
          {MOODS.map((m) => (
            <button
              key={m.key}
              className={`mood-swatch${draft.mood === m.key ? ' on' : ''}`}
              style={{ '--c': moodColor(m, dark) } as React.CSSProperties}
              aria-pressed={draft.mood === m.key}
              onClick={() => patch({ mood: draft.mood === m.key ? undefined : m.key })}
              title={m.note}
            >
              <i aria-hidden />
              <span>{m.label}</span>
            </button>
          ))}
        </div>

        <label className="field" style={{ marginTop: 20 }}>
          <span>A line for your future self</span>
          <input
            type="text"
            value={draft.note}
            maxLength={240}
            placeholder="What you'll want to remember"
            onChange={(e) => patch({ note: e.target.value })}
          />
        </label>

        <div className="rating-actions">
          <button
            className={`btn${draft.favourite ? ' primary' : ''}`}
            onClick={() => patch({ favourite: !draft.favourite })}
            aria-pressed={draft.favourite}
          >
            <IconStar size={16} solid={draft.favourite} />
            {draft.favourite ? 'A favourite' : 'Mark favourite'}
          </button>
          <div style={{ flex: 1 }} />
          {existing && (
            <button
              className="btn ghost"
              onClick={() => {
                void remove(existing.id);
                onClose();
              }}
            >
              <IconTrash size={16} /> Remove
            </button>
          )}
          <button className="btn primary" onClick={() => void save()}>
            {existing ? 'Save' : 'Add to the shelf'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/* ── the verdict ─────────────────────────────────────────────────── */

/* A rail rather than stars. Ten stars can't express 7.5, twenty half-stars
   are a fiddly target on a touch screen, and neither can show you where the
   number you are about to pick sits relative to the ones you have already
   given. Dragging a single handle across a labelled scale can. */
function ScoreDial({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const set = (e: ReactPointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const t = (e.clientX - box.left) / Math.max(1, box.width);
    onChange(clampScore(Math.max(0, Math.min(1, t)) * 10));
  };

  const notches = useMemo(() => Array.from({ length: 21 }, (_, i) => i / 2), []);

  return (
    <div className="score-dial">
      <div className="score-read">
        <b>{value % 1 === 0 ? value : value.toFixed(1)}</b>
        <span>/ 10</span>
        <em>{scoreLabel(value)}</em>
      </div>
      <div
        className="score-rail"
        role="slider"
        tabIndex={0}
        aria-valuemin={0}
        aria-valuemax={10}
        aria-valuenow={value}
        aria-label="Overall rating"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          set(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) set(e);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') onChange(clampScore(value - 0.5));
          if (e.key === 'ArrowRight') onChange(clampScore(value + 0.5));
        }}
      >
        <i className="fill" style={{ width: `${value * 10}%` }} />
        {notches.map((n) => (
          <s key={n} className={n % 1 === 0 ? 'whole' : ''} style={{ left: `${n * 10}%` }} />
        ))}
        <span className="knob" style={{ left: `${value * 10}%` }} />
      </div>
      <div className="score-scale">
        <span>Abandon hope</span>
        <span>Fine</span>
        <span>A book of your life</span>
      </div>
    </div>
  );
}

/* ── one axis ────────────────────────────────────────────────────── */

function AxisRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="axis">
      <div className="axis-head">
        <span>{label}</span>
        <b>{value ?? '—'}</b>
      </div>
      <div className="pips">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            className={value !== undefined && value >= n ? 'on' : ''}
            aria-label={`${label} ${n} out of 10`}
            onClick={() => onChange(n)}
          />
        ))}
      </div>
      <div className="axis-hint">{hint}</div>
    </div>
  );
}
