import { useSettings, type ThemeMode } from '../store/settings';
import { RHYTHM_MAX, RHYTHM_MIN, dwellFactor, rhythmLabel } from '../engine/pacer';

/* A sentence chosen to exercise every rest the model knows about: a comma, a
   dash, a long word and a full stop. */
const SAMPLE = 'Reading has a pulse, a rhythm — unhurried, deliberate. Then it rests.'.split(' ');

function RhythmPreview({ rhythm }: { rhythm: number }) {
  const factors = SAMPLE.map((w) => dwellFactor(w, rhythm));
  const peak = Math.max(...factors);
  return (
    <div className="rhythm-preview" aria-hidden>
      {SAMPLE.map((word, i) => (
        <div key={i} className="cell" style={{ flexGrow: factors[i] }}>
          <div className="bar" style={{ height: 3 + (factors[i] / peak) * 13 }} />
          <div className="word">{word}</div>
        </div>
      ))}
    </div>
  );
}

const THEMES: { id: ThemeMode; label: string; bg: string; ink: string }[] = [
  { id: 'paper', label: 'Paper', bg: '#FAF7F2', ink: '#1A1714' },
  { id: 'sepia', label: 'Sepia', bg: '#F3E9D8', ink: '#3A2E22' },
  { id: 'ink', label: 'Ink', bg: '#0E0D0C', ink: '#EDE7DE' },
  { id: 'auto', label: 'Auto', bg: 'linear-gradient(135deg,#FAF7F2 50%,#0E0D0C 50%)', ink: '#B4763A' },
];

export function ReaderSettings() {
  const s = useSettings();

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <div className="eyebrow" style={{ marginBottom: 16 }}>
        Reading
      </div>

      <div className="row">
        <div>
          <div className="label">Theme</div>
          <div className="hint">Auto follows the system appearance</div>
        </div>
        <div className="swatches">
          {THEMES.map((t) => (
            <button
              key={t.id}
              className={`swatch${s.mode === t.id ? ' on' : ''}`}
              style={{ background: t.bg, color: t.ink }}
              aria-label={t.label}
              onClick={() => s.set('mode', t.id)}
            />
          ))}
        </div>
      </div>

      <div className="row">
        <div style={{ flex: 1 }}>
          <div className="label">Text size</div>
          <input
            type="range"
            min={14}
            max={30}
            step={1}
            value={s.fontSize}
            style={{ width: '100%', marginTop: 8 }}
            onChange={(e) => s.set('fontSize', Number(e.target.value))}
          />
        </div>
        <div className="num" style={{ width: 46, textAlign: 'right', fontSize: 14 }}>
          {s.fontSize}px
        </div>
      </div>

      <div className="row">
        <div style={{ flex: 1 }}>
          <div className="label">Line spacing</div>
          <input
            type="range"
            min={1.3}
            max={2.1}
            step={0.02}
            value={s.lineHeight}
            style={{ width: '100%', marginTop: 8 }}
            onChange={(e) => s.set('lineHeight', Number(e.target.value))}
          />
        </div>
        <div className="num" style={{ width: 46, textAlign: 'right', fontSize: 14 }}>
          {s.lineHeight.toFixed(2)}
        </div>
      </div>

      <div className="row">
        <div style={{ flex: 1 }}>
          <div className="label">Margins</div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={s.margin}
            style={{ width: '100%', marginTop: 8 }}
            onChange={(e) => s.set('margin', Number(e.target.value))}
          />
        </div>
      </div>

      <div className="row">
        <div className="label">Typeface</div>
        <div className="segment">
          <button className={s.serif ? 'on' : ''} onClick={() => s.set('serif', true)}>
            Serif
          </button>
          <button className={!s.serif ? 'on' : ''} onClick={() => s.set('serif', false)}>
            Sans
          </button>
        </div>
      </div>

      <div className="row">
        <div className="label">Alignment</div>
        <div className="segment">
          <button className={s.justify ? 'on' : ''} onClick={() => s.set('justify', true)}>
            Justified
          </button>
          <button className={!s.justify ? 'on' : ''} onClick={() => s.set('justify', false)}>
            Ragged
          </button>
        </div>
      </div>

      <div className="eyebrow" style={{ margin: '28px 0 4px' }}>
        Pacer
      </div>

      <div className="row" style={{ display: 'block' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div className="label">Natural rhythm</div>
            <div className="hint">
              How much longer the pacer rests on long words and at punctuation
            </div>
          </div>
          <div className="num" style={{ fontSize: 13, color: 'var(--ink-2)' }}>
            {rhythmLabel(s.pacer.rhythm)}
          </div>
        </div>
        <input
          type="range"
          min={RHYTHM_MIN}
          max={RHYTHM_MAX}
          step={0.1}
          value={s.pacer.rhythm}
          style={{ width: '100%', marginTop: 10 }}
          onChange={(e) => s.setPacer({ rhythm: Number(e.target.value) })}
        />
        <RhythmPreview rhythm={s.pacer.rhythm} />
        <div className="hint" style={{ marginTop: 8 }}>
          Bar width is the time each word gets. The average always holds at{' '}
          {s.pacer.wpm} WPM.
        </div>
      </div>

      <div className="row">
        <div>
          <div className="label">Warm-up ramp</div>
          <div className="hint">Ease from a comfortable speed to the target over a minute</div>
        </div>
        <div className="segment">
          <button
            className={s.pacer.ramp ? 'on' : ''}
            onClick={() => s.setPacer({ ramp: true })}
          >
            On
          </button>
          <button
            className={!s.pacer.ramp ? 'on' : ''}
            onClick={() => s.setPacer({ ramp: false })}
          >
            Off
          </button>
        </div>
      </div>

      <div className="row">
        <div>
          <div className="label">Dim unread words</div>
          <div className="hint">Fades text ahead of the pacer to sharpen focus</div>
        </div>
        <div className="segment">
          <button className={s.dim ? 'on' : ''} onClick={() => s.set('dim', true)}>
            On
          </button>
          <button className={!s.dim ? 'on' : ''} onClick={() => s.set('dim', false)}>
            Off
          </button>
        </div>
      </div>

      <div className="row">
        <div>
          <div className="label">Auto page turn</div>
          <div className="hint">Turn the page when the pacer reaches the edge</div>
        </div>
        <div className="segment">
          <button className={s.autoTurn ? 'on' : ''} onClick={() => s.set('autoTurn', true)}>
            On
          </button>
          <button className={!s.autoTurn ? 'on' : ''} onClick={() => s.set('autoTurn', false)}>
            Off
          </button>
        </div>
      </div>

      <div className="row">
        <div>
          <div className="label">Keep screen awake</div>
          <div className="hint">Prevents auto-lock while the pacer is running</div>
        </div>
        <div className="segment">
          <button
            className={s.keepAwake ? 'on' : ''}
            onClick={() => s.set('keepAwake', true)}
          >
            On
          </button>
          <button
            className={!s.keepAwake ? 'on' : ''}
            onClick={() => s.set('keepAwake', false)}
          >
            Off
          </button>
        </div>
      </div>
    </div>
  );
}
