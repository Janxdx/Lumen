/* Hand-drawn SVG charts.

   No chart library: these are simple enough to draw directly, and doing so
   keeps the visual language exactly consistent with the rest of the app
   (same accent, same corner radii, same restraint). */

import type { DayBucket } from '../engine/stats';

/** Minutes-per-day columns. */
export function DailyBars({ days }: { days: DayBucket[] }) {
  const max = Math.max(1, ...days.map((d) => d.ms));
  const w = 100 / days.length;
  return (
    <svg className="spark" viewBox="0 0 100 34" preserveAspectRatio="none" role="img">
      {days.map((d, i) => {
        const h = (d.ms / max) * 30;
        return (
          <rect
            key={d.key}
            x={i * w + w * 0.18}
            y={32 - h}
            width={w * 0.64}
            height={Math.max(d.ms > 0 ? 1.2 : 0, h)}
            rx={Math.min(0.9, w * 0.3)}
            fill="var(--accent)"
            opacity={d.ms > 0 ? 0.9 : 0.18}
          />
        );
      })}
      <line x1="0" y1="32.6" x2="100" y2="32.6" stroke="var(--line)" strokeWidth="0.4" />
    </svg>
  );
}

/** WPM over successive sessions. */
export function TrendLine({ values }: { values: number[] }) {
  if (values.length < 2) {
    return (
      <p className="muted" style={{ fontSize: 12.5, padding: '12px 0' }}>
        Read a couple more sessions and your pace trend will appear here.
      </p>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = 30 - ((v - min) / span) * 26;
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
  const area = `${line} L100 34 L0 34 Z`;
  return (
    <svg className="spark" viewBox="0 0 100 34" preserveAspectRatio="none" role="img">
      <defs>
        <linearGradient id="trendfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#trendfill)" />
      <path
        d={line}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.1"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Reading time by hour of day, as a 24-spoke radial. */
export function ClockDial({ hours }: { hours: number[] }) {
  const max = Math.max(1, ...hours);
  const cx = 50;
  const cy = 50;
  return (
    <svg viewBox="0 0 100 100" style={{ width: '100%', maxWidth: 210, display: 'block', margin: '0 auto' }} role="img">
      <circle cx={cx} cy={cy} r="19" fill="none" stroke="var(--line)" strokeWidth="0.6" />
      <circle cx={cx} cy={cy} r="42" fill="none" stroke="var(--line)" strokeWidth="0.6" />
      {hours.map((v, h) => {
        const angle = ((h / 24) * 360 - 90) * (Math.PI / 180);
        const inner = 19;
        const outer = 19 + (v / max) * 23;
        return (
          <line
            key={h}
            x1={cx + Math.cos(angle) * inner}
            y1={cy + Math.sin(angle) * inner}
            x2={cx + Math.cos(angle) * outer}
            y2={cy + Math.sin(angle) * outer}
            stroke="var(--accent)"
            strokeWidth="3.2"
            strokeLinecap="round"
            opacity={v > 0 ? 0.92 : 0.14}
          />
        );
      })}
      {['12a', '6a', '12p', '6p'].map((label, i) => {
        const angle = ((i / 4) * 360 - 90) * (Math.PI / 180);
        return (
          <text
            key={label}
            x={cx + Math.cos(angle) * 47.5}
            y={cy + Math.sin(angle) * 47.5 + 2}
            textAnchor="middle"
            fontSize="5"
            fill="var(--ink-3)"
            fontFamily="var(--font-ui)"
          >
            {label}
          </text>
        );
      })}
    </svg>
  );
}

/** Progress ring, used for per-book completion. */
export function Ring({ value, size = 44 }: { value: number; size?: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox="0 0 44 44">
      <circle cx="22" cy="22" r={r} fill="none" stroke="var(--line)" strokeWidth="3.4" />
      <circle
        cx="22"
        cy="22"
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeDasharray={`${c * value} ${c}`}
        transform="rotate(-90 22 22)"
      />
    </svg>
  );
}
