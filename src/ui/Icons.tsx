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
