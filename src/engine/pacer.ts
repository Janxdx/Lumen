/* The reading pacer.

   A uniform 60000/wpm per word feels mechanical and is genuinely harder to
   follow than natural prose rhythm — the eye expects to rest at punctuation and
   to spend longer on long words. So dwell time is modelled:

     dwell = base × lengthFactor × punctuationFactor

   The average still converges on the target WPM; only the distribution
   changes. Timing runs off requestAnimationFrame with an accumulator rather
   than setTimeout, so drift doesn't build up over a long session. */

export interface PacerConfig {
  wpm: number;
  /** ease from a comfortable speed up to the target over the first minute */
  ramp: boolean;
  /**
   * How strongly prose rhythm is applied, 0–2.
   *   0    metronome — every word gets exactly the same time
   *   1    the modelled rhythm at natural strength
   *   2    the same shape, squared: unmistakable pauses at every full stop
   * The value is an exponent on the dwell multiplier, so the curve keeps its
   * shape and only its contrast changes.
   */
  rhythm: number;
}

export const DEFAULT_PACER: PacerConfig = { wpm: 300, ramp: false, rhythm: 1.2 };

export const RHYTHM_MIN = 0;
export const RHYTHM_MAX = 2;

/** Human name for a rhythm strength — shown next to the slider. */
export function rhythmLabel(rhythm: number): string {
  if (rhythm <= 0.05) return 'Metronome';
  if (rhythm < 0.7) return 'Subtle';
  if (rhythm < 1.35) return 'Natural';
  if (rhythm < 1.75) return 'Pronounced';
  return 'Dramatic';
}

const RAMP_MS = 60_000;
const RAMP_FROM = 0.68;

/** The multiplier applied to the base dwell for a single word. */
export function dwellFactor(word: string, rhythm = 1): number {
  if (rhythm <= 0) return 1;

  const letters = word.replace(/[^\p{L}\p{N}]/gu, '').length;
  const lengthFactor = Math.min(1.6, Math.max(0.75, 1 + (letters - 5) * 0.03));

  let punctuation = 1;
  const tail = word.slice(-2);
  if (/[.!?]["'”’)\]]?$/.test(tail)) punctuation = 2.4;
  else if (/[;:]["'”’)\]]?$/.test(tail)) punctuation = 1.8;
  else if (/[,–—]["'”’)\]]?$/.test(tail)) punctuation = 1.5;

  return Math.pow(lengthFactor * punctuation, rhythm);
}

export function dwellFor(word: string, baseMs: number, rhythm = 1): number {
  return baseMs * dwellFactor(word, rhythm);
}

/** Mean multiplier across a body of text — used to keep the target WPM honest. */
export function meanFactor(words: string[], rhythm = 1): number {
  if (rhythm <= 0 || words.length === 0) return 1;
  let total = 0;
  for (const w of words) total += dwellFactor(w, rhythm);
  return total / words.length;
}

type Listener = (index: number) => void;

export class Pacer {
  private words: string[] = [];
  private index = 0;
  private running = false;
  private raf = 0;
  private lastFrame = 0;
  private debt = 0; // ms still owed on the current word
  private startedAt = 0;
  private config: PacerConfig = { ...DEFAULT_PACER };
  /** normaliser so the *average* dwell still lands on the target WPM */
  private mean = 1;

  /** ms actually spent pacing — feeds the statistics */
  pacedMs = 0;

  constructor(
    private onWord: Listener,
    private onFinish: () => void
  ) {}

  load(words: string[], startAt = 0): void {
    this.stop();
    this.words = words;
    this.index = Math.min(Math.max(0, startAt), Math.max(0, words.length - 1));
    this.debt = 0;
    this.mean = meanFactor(words, this.config.rhythm);
  }

  setConfig(next: Partial<PacerConfig>): void {
    const before = this.config.rhythm;
    this.config = { ...this.config, ...next };
    // the normaliser depends on the strength, so a change re-measures the
    // chapter — otherwise the average would drift off the target WPM
    if (this.config.rhythm !== before) {
      this.mean = meanFactor(this.words, this.config.rhythm);
      this.debt = Math.min(this.debt, this.currentDwell());
    }
  }

  getConfig(): PacerConfig {
    return { ...this.config };
  }

  get position(): number {
    return this.index;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** WPM being applied right now — differs from target while ramping. */
  get effectiveWpm(): number {
    if (!this.config.ramp || !this.running) return this.config.wpm;
    const t = Math.min(1, (performance.now() - this.startedAt) / RAMP_MS);
    return this.config.wpm * (RAMP_FROM + (1 - RAMP_FROM) * t);
  }

  seek(index: number): void {
    this.index = Math.min(Math.max(0, index), Math.max(0, this.words.length - 1));
    this.debt = 0;
    this.onWord(this.index);
  }

  play(): void {
    if (this.running || this.words.length === 0) return;
    this.running = true;
    this.startedAt = performance.now();
    this.lastFrame = this.startedAt;
    if (this.debt <= 0) this.debt = this.currentDwell();
    this.onWord(this.index);
    this.raf = requestAnimationFrame(this.tick);
  }

  pause(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  stop(): void {
    this.pause();
    this.index = 0;
    this.debt = 0;
  }

  toggle(): void {
    this.running ? this.pause() : this.play();
  }

  private currentDwell(): number {
    const base = 60_000 / Math.max(30, this.effectiveWpm);
    const rhythm = this.config.rhythm;
    if (rhythm <= 0) return base;
    // dividing by the chapter's mean factor means a target of 300 wpm really
    // delivers 300 wpm on average, while the rhythm still varies word to word
    const dwell = (base * dwellFactor(this.words[this.index] ?? '', rhythm)) / (this.mean || 1);
    // at high strength the short words get very short — keep them legible
    return Math.max(34, dwell);
  }

  private tick = (now: number): void => {
    if (!this.running) return;

    // clamp: a backgrounded tab can hand us a huge delta
    const delta = Math.min(250, now - this.lastFrame);
    this.lastFrame = now;
    this.pacedMs += delta;
    this.debt -= delta;

    // a very fast WPM can consume more than one word per frame
    let guard = 0;
    while (this.debt <= 0 && guard++ < 12) {
      if (this.index >= this.words.length - 1) {
        this.running = false;
        cancelAnimationFrame(this.raf);
        this.onFinish();
        return;
      }
      this.index++;
      this.debt += this.currentDwell();
      this.onWord(this.index);
    }

    this.raf = requestAnimationFrame(this.tick);
  };
}
