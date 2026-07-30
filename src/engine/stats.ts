/* Statistics.

   Everything here is a pure function of the recorded sessions, so the numbers
   can never drift out of sync with what actually happened — no running totals
   to maintain, no migrations when a new metric is added. */

export interface Session {
  id?: number;
  /** stable identity across devices; the numeric `id` is local storage detail */
  uid?: string;
  bookId: string;
  /** epoch ms */
  start: number;
  end: number;
  /** active reading time, excluding idle gaps */
  ms: number;
  words: number;
  pages: number;
  /** portion of `ms` spent with the pacer running */
  pacedMs: number;
  /** where the reading happened. Absent means in this app, which is what
      every session recorded before the device shelf existed was. */
  source?: 'app' | 'device';
}

export interface DayBucket {
  key: string; // YYYY-MM-DD
  date: Date;
  ms: number;
  words: number;
}

export const dayKey = (t: number | Date): string => {
  const d = t instanceof Date ? t : new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
};

export const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

export function wpm(words: number, ms: number): number {
  if (ms < 1000 || words <= 0) return 0;
  return Math.round(words / (ms / 60_000));
}

/** Group sessions into calendar days. */
export function byDay(sessions: Session[]): Map<string, DayBucket> {
  const map = new Map<string, DayBucket>();
  for (const s of sessions) {
    const key = dayKey(s.start);
    const bucket = map.get(key) ?? { key, date: new Date(s.start), ms: 0, words: 0 };
    bucket.ms += s.ms;
    bucket.words += s.words;
    map.set(key, bucket);
  }
  return map;
}

/** Consecutive days with any reading, counting back from today. */
export function currentStreak(sessions: Session[]): number {
  const days = byDay(sessions);
  let streak = 0;
  const cursor = new Date();
  // today doesn't break the streak if it hasn't happened yet
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(dayKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function longestStreak(sessions: Session[]): number {
  const keys = [...byDay(sessions).keys()].sort();
  let best = 0;
  let run = 0;
  let previous: Date | null = null;
  for (const key of keys) {
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    if (previous && (date.getTime() - previous.getTime()) / 86_400_000 === 1) run++;
    else run = 1;
    previous = date;
    best = Math.max(best, run);
  }
  return best;
}

/** Minutes read per day for the last `days` days, oldest first. */
export function lastDays(sessions: Session[], days: number): DayBucket[] {
  const map = byDay(sessions);
  const out: DayBucket[] = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - (days - 1));
  for (let i = 0; i < days; i++) {
    const key = dayKey(cursor);
    out.push(map.get(key) ?? { key, date: new Date(cursor), ms: 0, words: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/** Reading time by hour of day, 0–23. */
export function byHour(sessions: Session[]): number[] {
  const hours = new Array(24).fill(0);
  for (const s of sessions) hours[new Date(s.start).getHours()] += s.ms;
  return hours;
}

export interface Totals {
  sessions: number;
  ms: number;
  words: number;
  pages: number;
  pacedMs: number;
  avgWpm: number;
  bestWpm: number;
  avgSessionMs: number;
  longestSessionMs: number;
  streak: number;
  best: number;
  daysRead: number;
}

export function totals(sessions: Session[]): Totals {
  const ms = sum(sessions.map((s) => s.ms));
  const words = sum(sessions.map((s) => s.words));
  const perSession = sessions
    .filter((s) => s.ms > 30_000 && s.words > 50)
    .map((s) => wpm(s.words, s.ms));
  return {
    sessions: sessions.length,
    ms,
    words,
    pages: sum(sessions.map((s) => s.pages)),
    pacedMs: sum(sessions.map((s) => s.pacedMs)),
    avgWpm: wpm(words, ms),
    bestWpm: perSession.length ? Math.max(...perSession) : 0,
    avgSessionMs: sessions.length ? Math.round(ms / sessions.length) : 0,
    longestSessionMs: sessions.length ? Math.max(...sessions.map((s) => s.ms)) : 0,
    streak: currentStreak(sessions),
    best: longestStreak(sessions),
    daysRead: byDay(sessions).size,
  };
}

/** WPM per session in chronological order — the trend line. */
export function wpmTrend(sessions: Session[]): number[] {
  return sessions
    .filter((s) => s.ms > 60_000 && s.words > 100)
    .sort((a, b) => a.start - b.start)
    .map((s) => wpm(s.words, s.ms));
}

/* ── formatting ─────────────────────────────────────────────────── */

export function formatDuration(ms: number, long = false): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return long ? `${minutes} min` : `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (long) return m ? `${h} hr ${m} min` : `${h} hr`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function relativeDate(t: number): string {
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}
