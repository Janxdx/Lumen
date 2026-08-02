/* Line icons, 24px grid, 1.6 stroke — drawn inline so they inherit `color`
   and never cost a network request. */

interface P {
  size?: number;
  className?: string;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const IconLibrary = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H9v16H5.5A1.5 1.5 0 0 1 4 18.5z" />
    <path d="M9 4h4.5A1.5 1.5 0 0 1 15 5.5v13a1.5 1.5 0 0 1-1.5 1.5H9z" />
    <path d="m16.6 6.3 2.6 12.2" />
  </svg>
);

export const IconStats = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 20h16" />
    <path d="M6.5 20v-6" />
    <path d="M11 20V7" />
    <path d="M15.5 20v-9" />
    <path d="M20 20V4" />
  </svg>
);

export const IconPlay = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className} fill="currentColor" stroke="none">
    <path d="M8 5.6c0-.8.9-1.3 1.6-.9l8.2 5.5c.6.4.6 1.3 0 1.7l-8.2 5.5c-.7.4-1.6-.1-1.6-.9z" />
  </svg>
);

export const IconPause = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className} fill="currentColor" stroke="none">
    <rect x="7" y="5" width="3.6" height="14" rx="1.3" />
    <rect x="13.4" y="5" width="3.6" height="14" rx="1.3" />
  </svg>
);

export const IconList = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 6.5h16M4 12h16M4 17.5h10" />
  </svg>
);

export const IconSliders = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 8h10M18 8h2M4 16h4M12 16h8" />
    <circle cx="16" cy="8" r="2.1" />
    <circle cx="10" cy="16" r="2.1" />
  </svg>
);

export const IconClose = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" />
  </svg>
);

export const IconBack = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M14.5 5.5 8 12l6.5 6.5" />
  </svg>
);

export const IconPlus = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconTrash = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4.5 7h15M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7" />
    <path d="M6.5 7l.8 11.6A1.5 1.5 0 0 0 8.8 20h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7" />
  </svg>
);

export const IconGauge = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4.4 17a8.5 8.5 0 1 1 15.2 0" />
    <path d="m12 13.5 4-4.2" />
    <circle cx="12" cy="14.4" r="1.4" fill="currentColor" stroke="none" />
  </svg>
);

export const IconFlame = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3.5s5 3.6 5 8.2a5 5 0 0 1-10 0c0-1.6.8-2.9 1.6-3.8.3 1 .9 1.7 1.6 1.7 1.4 0 1-3.9 1.8-6.1z" />
  </svg>
);

export const IconMinus = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M5 12h14" />
  </svg>
);

export const IconAccount = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="8.4" r="3.6" />
    <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
  </svg>
);

export const IconCloud = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M7 18.5a4 4 0 0 1-.4-8A5.2 5.2 0 0 1 16.6 9 3.8 3.8 0 0 1 17 18.5z" />
  </svg>
);

export const IconSync = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M20 11.5A8 8 0 0 0 6.3 6.3L4 8.5" />
    <path d="M4 4.5v4h4" />
    <path d="M4 12.5a8 8 0 0 0 13.7 5.2L20 15.5" />
    <path d="M20 19.5v-4h-4" />
  </svg>
);

export const IconCheck = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

export const IconDownload = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 4v11" />
    <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
    <path d="M5 20h14" />
  </svg>
);

export const IconExit = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M14 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H14" />
    <path d="M17 8.5 20.5 12 17 15.5" />
    <path d="M20 12h-9" />
  </svg>
);

/* an e-ink reader: a slab with a page of text and a page-turn bar */
export const IconDevice = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="5" y="3" width="14" height="18" rx="2.2" />
    <path d="M8.5 7.5h7" />
    <path d="M8.5 10.5h7" />
    <path d="M8.5 13.5h4.5" />
    <path d="M10 17.6h4" />
  </svg>
);

export const IconTimer = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="13.5" r="7.5" />
    <path d="M12 9.5v4l2.6 1.8" />
    <path d="M9.5 2.5h5" />
  </svg>
);

export const IconLink = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M10.5 13.5a3.6 3.6 0 0 0 5.2.3l2.6-2.6a3.7 3.7 0 0 0-5.2-5.2l-1.4 1.4" />
    <path d="M13.5 10.5a3.6 3.6 0 0 0-5.2-.3l-2.6 2.6a3.7 3.7 0 0 0 5.2 5.2l1.4-1.4" />
  </svg>
);

export const IconStop = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className} fill="currentColor" stroke="none">
    <rect x="6" y="6" width="12" height="12" rx="2.4" />
  </svg>
);

export const IconKey = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="8.2" cy="8.2" r="3.7" />
    <path d="m10.9 10.9 7.6 7.6" />
    <path d="m16.2 16.2 1.8-1.8" />
    <path d="m18.5 18.5 1.8-1.8" />
  </svg>
);

/* One star, drawn once and filled or not. Two separate paths would drift
   apart the first time either is nudged. */
const STAR =
  'M12 3.6l2.42 4.9 5.41.79-3.92 3.82.93 5.39L12 15.95l-4.84 2.55.93-5.39L4.17 9.29l5.41-.79z';

export const IconStar = ({ size = 20, className, solid }: P & { solid?: boolean }) => (
  <svg {...base(size)} className={className} {...(solid ? { fill: 'currentColor' } : {})}>
    <path d={STAR} />
  </svg>
);

/** A shelf of standing books — the rating tab's own mark. */
export const IconShelf = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 20h16" />
    <rect x="5" y="9" width="3.4" height="9" rx="1" />
    <rect x="10" y="6" width="3.4" height="12" rx="1" />
    <rect x="15" y="11" width="3.4" height="7" rx="1" />
  </svg>
);

/** Save an image. */
export const IconImage = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2.6" />
    <circle cx="8.6" cy="9.6" r="1.5" />
    <path d="m4.2 16.6 4.3-4a1.6 1.6 0 0 1 2.2 0l3.1 3 1.6-1.5a1.6 1.6 0 0 1 2.2 0l2.2 2.1" />
  </svg>
);

export const IconPencil = ({ size = 20, className }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4.5 19.5h3l9.6-9.6a2.1 2.1 0 0 0-3-3L4.5 16.5z" />
    <path d="m14.4 5.6 3 3" />
  </svg>
);
