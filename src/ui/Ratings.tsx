/* The shelf tab.
 *
 * Two things, in this order: the wall of what you have read, and the
 * arithmetic underneath it. The wall comes first deliberately — the numbers
 * are interesting but the shelf is the reason to open the tab, and a screen
 * that opens on a grid of statistics is a screen you check once.
 */

import { useMemo, useState } from 'react';
import { MoodRibbon, Radar, ScoreCurve } from './Charts';
import { SpineWall } from './SpineWall';
import { TasteCard } from './TasteCard';
import { RatingSheet } from './RatingSheet';
import { Sheet } from './Sheet';
import { IconPencil, IconPlus, IconStar } from './Icons';
import { useDarkTheme } from './theme';
import { useRatings, rateableBooks, type Rateable } from '../store/ratings';
import { useLibrary } from '../store/library';
import { useDevice } from '../store/device';
import {
  MOODS,
  SORTS,
  moodColor,
  moodOf,
  sortRatings,
  tasteProfile,
  type RatingRecord,
  type SortKey,
} from '../engine/rating';
import { relativeDate } from '../engine/stats';

export function Ratings() {
  const ratings = useRatings((s) => s.ratings);
  const dark = useDarkTheme();

  const [sort, setSort] = useState<SortKey>('rating');
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<RatingRecord | null>(null);
  const [rating, setRating] = useState<Rateable | null>(null);

  /* Both stores are read here purely so this component re-renders when a
     book is imported or a reader book added — `rateableBooks()` reaches
     into them imperatively and would otherwise show a stale list. */
  useLibrary((s) => s.books);
  useDevice((s) => s.books);

  const profile = useMemo(() => tasteProfile(ratings), [ratings]);
  const wall = useMemo(() => sortRatings(ratings, sort), [ratings, sort]);
  const candidates = useMemo(() => (picking ? rateableBooks() : []), [picking]);

  const closeSheets = () => {
    setEditing(null);
    setRating(null);
  };

  return (
    <div className="scroller">
      <div className="wrap">
        <div className="lib-head">
          <div>
            <div className="eyebrow">The shelf</div>
            <h1 className="display" style={{ marginTop: 6 }}>
              {ratings.length === 0
                ? 'Nothing rated yet'
                : `${ratings.length} ${ratings.length === 1 ? 'book' : 'books'} rated`}
            </h1>
          </div>
          <button className="btn primary" onClick={() => setPicking(true)}>
            <IconPlus size={17} /> Rate a book
          </button>
        </div>

        {ratings.length === 0 ? (
          <div className="empty">
            <p style={{ fontFamily: 'var(--font-read)', fontSize: 20, color: 'var(--ink-2)' }}>
              An empty shelf
            </p>
            <p style={{ fontSize: 13, marginTop: 8, maxWidth: 400, marginInline: 'auto' }}>
              Give a book a score, five reasons and a colour. It comes back as a
              spine — taller when you liked it, thicker when it was long — and
              the shelf slowly becomes a picture of your taste.
            </p>
          </div>
        ) : (
          <>
            <p className="taste-line">{profile.tagline}</p>

            <div className="segment" style={{ marginBottom: 20 }}>
              {SORTS.map((s) => (
                <button
                  key={s.key}
                  className={sort === s.key ? 'on' : ''}
                  onClick={() => setSort(s.key)}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <SpineWall
              ratings={wall}
              dark={dark}
              activeId={editing?.id}
              onOpen={(r) => setEditing(r)}
            />

            <div className="stat-grid" style={{ marginTop: 'var(--s7)' }}>
              <div className="card">
                <div className="k">Average</div>
                <div className="v num">{profile.mean.toFixed(1)}</div>
                <div className="sub">median {profile.median.toFixed(1)}</div>
              </div>
              <div className="card">
                <div className="k">Range you use</div>
                <div className="v num">
                  ±{profile.spread.toFixed(1)}
                </div>
                <div className="sub">
                  {profile.spread < 1
                    ? 'a narrow band'
                    : profile.spread > 2.4
                      ? 'the whole scale'
                      : 'a healthy spread'}
                </div>
              </div>
              <div className="card">
                <div className="k">Rated this year</div>
                <div className="v num">{profile.thisYear}</div>
                <div className="sub">
                  {profile.count - profile.thisYear} before that
                </div>
              </div>
              <div className="card">
                <div className="k">Favourites</div>
                <div className="v num">{ratings.filter((r) => r.favourite).length}</div>
                <div className="sub">
                  {profile.topMood
                    ? `mostly ${moodOf(profile.topMood)?.label.toLowerCase()}`
                    : 'no mood yet'}
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gap: 'var(--s5)',
                gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))',
              }}
            >
              <div className="panel">
                <h3>
                  Your curve <span>where the scores land</span>
                </h3>
                <ScoreCurve histogram={profile.histogram} mean={profile.mean} />
                <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                  {profile.spread < 1
                    ? 'Almost everything gets the same score — the shelf is doing more work than the number is.'
                    : 'The dashed line is your average.'}
                </p>
              </div>

              <div className="panel">
                <h3>
                  What you reward <span>averaged across every rating</span>
                </h3>
                <Radar values={profile.axisMeans} size={200} />
                {profile.rewards && profile.punishes && (
                  <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                    You are kindest to {profile.rewards} and hardest on {profile.punishes}.
                  </p>
                )}
              </div>
            </div>

            <div className="panel">
              <h3>
                The colour of the shelf <span>by mood</span>
              </h3>
              <MoodRibbon moods={profile.moods} dark={dark} />
              <div className="mood-legend">
                {profile.moods.map((m) => (
                  <span key={m.mood}>
                    <i style={{ background: moodColor(moodOf(m.mood), dark) }} />
                    {MOODS.find((x) => x.key === m.mood)?.label} · {m.count}
                  </span>
                ))}
              </div>
            </div>

            <TasteCard ratings={ratings} />

            {profile.best && (
              <div className="panel">
                <h3>
                  Standouts <span>best and worst</span>
                </h3>
                <Standout rating={profile.best} kind="Highest" onEdit={setEditing} />
                {profile.worst && profile.worst.id !== profile.best.id && (
                  <Standout rating={profile.worst} kind="Lowest" onEdit={setEditing} />
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* pick something to rate */}
      <Sheet open={picking} onClose={() => setPicking(false)}>
        <div style={{ maxWidth: 620, margin: '0 auto' }}>
          <h2 className="display" style={{ fontSize: 22 }}>
            What did you read?
          </h2>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
            Everything on both shelves — finished books first.
          </p>
          <div style={{ marginTop: 18 }}>
            {candidates.length === 0 && (
              <p className="muted" style={{ fontSize: 13 }}>
                Import an EPUB or add a book to the reader shelf first.
              </p>
            )}
            {candidates.map((c) => {
              const already = c.bookId
                ? ratings.find((r) => r.bookId === c.bookId)
                : ratings.find((r) => r.deviceBookId === c.deviceBookId);
              return (
                <button
                  key={c.key}
                  className="pick-row"
                  onClick={() => {
                    setPicking(false);
                    if (already) setEditing(already);
                    else setRating(c);
                  }}
                >
                  <div className="n">
                    <div className="t">{c.title}</div>
                    <div className="a">
                      {c.author || 'Unknown'} ·{' '}
                      {c.finished ? 'finished' : `${Math.round(c.percent * 100)}% read`}
                    </div>
                  </div>
                  {already ? (
                    <span className="pick-score">{already.overall}</span>
                  ) : (
                    <IconPlus size={16} className="muted" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </Sheet>

      <RatingSheet
        open={Boolean(editing || rating)}
        existing={editing}
        subject={rating}
        dark={dark}
        onClose={closeSheets}
      />
    </div>
  );
}

function Standout({
  rating,
  kind,
  onEdit,
}: {
  rating: RatingRecord;
  kind: string;
  onEdit: (r: RatingRecord) => void;
}) {
  const dark = useDarkTheme();
  const mood = moodOf(rating.mood);
  return (
    <button className="standout" onClick={() => onEdit(rating)}>
      <i style={{ background: moodColor(mood, dark) }} aria-hidden />
      <div style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
        <div className="label">
          {kind}
          {rating.favourite && <IconStar size={12} solid />}
        </div>
        <div className="t">{rating.title}</div>
        {rating.note ? (
          <p className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
            “{rating.note}”
          </p>
        ) : (
          <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            rated {relativeDate(rating.ratedAt)}
          </p>
        )}
      </div>
      <span className="pick-score">{rating.overall}</span>
      <IconPencil size={15} className="muted" />
    </button>
  );
}
