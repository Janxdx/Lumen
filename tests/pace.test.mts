import {
  recentWpm, readingPace, timeForWords, formatEta, formatDuration, DEFAULT_WPM,
} from '../src/engine/stats.ts';
import type { Session } from '../src/engine/stats.ts';

let fails = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fails++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${name}`);
};
const near = (name: string, got: number, want: number, tol = 1e-9) => {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) { fails++; console.log(`FAIL ${name}: got ${got} want ~${want}`); }
  else console.log(`ok   ${name}`);
};

const DAY = 86_400_000;
const session = (
  bookId: string,
  daysAgo: number,
  minutes: number,
  wordsPerMinute: number
): Session => ({
  bookId,
  start: Date.now() - daysAgo * DAY,
  end: Date.now() - daysAgo * DAY + minutes * 60_000,
  ms: minutes * 60_000,
  words: minutes * wordsPerMinute,
  pages: minutes,
  pacedMs: 0,
});

/* ── recentWpm ──────────────────────────────────────────────────── */

eq('no sessions means no measurement', recentWpm([]), 0);
eq('one steady session reads back its own pace', recentWpm([session('a', 0, 30, 240)]), 240);

// too short or too few words to mean anything
eq('short sessions are ignored', recentWpm([session('a', 0, 0.5, 240)]), 0);
eq('thin sessions are ignored', recentWpm([{ ...session('a', 0, 30, 240), words: 40 }]), 0);

/* Recency weighting: same amount of reading at two speeds, one of them
   four half-lives ago, must land far nearer the recent speed than the
   midpoint of 300. */
const mixed = [session('a', 56, 30, 200), session('a', 0, 30, 400)];
const w = recentWpm(mixed);
eq('recent reading dominates the average', w > 380 && w <= 400, true);
eq('lifetime average would have said 300', Math.round((200 + 400) / 2), 300);

// with an infinite half-life the same input is the plain average
near('a long half-life degrades to the plain average', recentWpm(mixed, 1e9), 300, 1);

/* ── readingPace ────────────────────────────────────────────────── */

eq('no history falls back, and says so', readingPace([]), {
  wpm: DEFAULT_WPM, measured: false, ownBook: false,
});

const library = [
  session('a', 1, 30, 200), session('a', 2, 30, 200), session('a', 3, 30, 200),
  session('b', 1, 30, 400),
];
eq('a book with enough of its own sessions uses them', readingPace(library, 'a').ownBook, true);
eq('...and reads at its own pace', readingPace(library, 'a').wpm, 200);
eq('one session is not enough to go it alone', readingPace(library, 'b').ownBook, false);
eq('an unknown book uses the whole library', readingPace(library, 'zzz').ownBook, false);
eq('the library estimate is measured', readingPace(library, 'b').measured, true);

/* ── projections ────────────────────────────────────────────────── */

eq('90k words at 250 wpm is six hours', timeForWords(90_000, 250), 6 * 3_600_000);
eq('a finished book takes no time', timeForWords(0, 250), 0);
eq('no pace means no projection', timeForWords(1000, 0), 0);

eq('hours and minutes, short', formatDuration(timeForWords(90_000, 250)), '6h');
eq('under an hour stays in minutes', formatEta(timeForWords(2000, 250)), '8m');
eq('an hour and change', formatEta(timeForWords(20_000, 250)), '1h 20m');
eq('the last few seconds do not read as zero', formatEta(20_000), '<1m');

console.log(fails ? `\n${fails} failing` : '\nall passing');
process.exit(fails ? 1 : 0);
