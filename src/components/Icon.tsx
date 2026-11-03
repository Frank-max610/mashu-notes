import type { ReactNode, SVGProps } from 'react';

/**
 * Tiny inline icon set (Lucide-style geometry, ~24px grid). Kept as local SVGs
 * so the app has zero icon-font/network dependencies and works offline.
 */
const ICONS = {
  notes: (
    <>
      <path d="M8 3.5h7l4 4V20.5H8z" />
      <path d="M15 3.5V7.5h4" />
      <path d="M11 12h5M11 15.5h5" />
    </>
  ),
  graph: (
    <>
      <circle cx="6" cy="17" r="2.4" />
      <circle cx="12" cy="6" r="2.4" />
      <circle cx="18.5" cy="16" r="2.4" />
      <path d="m7.6 14.9 3-6.6M13.9 7.6l3.4 6.3M8.4 17.4h7.7" />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m15.5 15.5 4.2 4.2" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h4M12 7h8M4 17h8M16 17h4" />
      <circle cx="10" cy="7" r="2" />
      <circle cx="14" cy="17" r="2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  back: <path d="M15 4.5 7.5 12l7.5 7.5" />,
  pin: (
    <>
      <path d="M9.2 3h5.6v6l2.9 2.9V14H6.3v-2.1L9.2 9z" />
      <path d="M12 14v7" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  tag: (
    <>
      <path d="M4 4h7.2l8.6 8.6-6.2 6.2L4 10.2z" />
      <circle cx="8.3" cy="8.3" r="1.2" />
    </>
  ),
  link: (
    <>
      <path d="m10 14 4-4" />
      <path d="M11.5 6.8 13 5.3a3.9 3.9 0 0 1 5.5 5.5l-1.5 1.5" />
      <path d="M12.5 17.2 11 18.7a3.9 3.9 0 0 1-5.5-5.5L7 11.7" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V4.5h5V7" />
      <path d="m6.8 7 1 13h8.4l1-13" />
      <path d="M10.5 11v5.5M13.5 11v5.5" />
    </>
  ),
  download: <path d="M12 4v11m0 0 4.2-4.2M12 15 7.8 10.8M5 20h14" />,
  upload: <path d="M12 15V4m0 0 4.2 4.2M12 4 7.8 8.2M5 20h14" />,
  bold: (
    <>
      <path d="M7.5 4.5h5.2a3.6 3.6 0 0 1 0 7.2H7.5z" />
      <path d="M7.5 11.7h6.1a3.9 3.9 0 0 1 0 7.8H7.5z" />
    </>
  ),
  heading: <path d="M6 4.5v15M18 4.5v15M6 12h12" />,
  italic: <path d="M10.5 4h7M6.5 20h7M14.8 4 9.2 20" />,
  quote: (
    <>
      <path d="M9.5 6.5H6A1.5 1.5 0 0 0 4.5 8v2.5A1.5 1.5 0 0 0 6 12h1.5c0 1.6-.8 2.8-2.2 3.6" />
      <path d="M19 6.5h-3.5A1.5 1.5 0 0 0 14 8v2.5a1.5 1.5 0 0 0 1.5 1.5H17c0 1.6-.8 2.8-2.2 3.6" />
    </>
  ),
  list: (
    <>
      <path d="M9 6.5h11M9 12h11M9 17.5h11" />
      <circle cx="4.6" cy="6.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.6" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.6" cy="17.5" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  check: <path d="m5 12.8 4.4 4.4L19 6.6" />,
  checkbox: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="m8.2 12.2 2.6 2.6 5-5.6" />
    </>
  ),
  code: <path d="m9 7.5-4.5 4.5L9 16.5M15 7.5l4.5 4.5L15 16.5M13.6 4.8l-3.2 14.4" />,
  eye: (
    <>
      <path d="M2.5 12S6 6.2 12 6.2 21.5 12 21.5 12 18 17.8 12 17.8 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  edit: (
    <>
      <path d="m4.5 19.5 1-4.6L16.3 4.1a2 2 0 0 1 2.8 0l.8.8a2 2 0 0 1 0 2.8L9.1 18.5z" />
      <path d="m14.6 5.8 3.6 3.6" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  chevronDown: <path d="m6 9.5 6 6 6-6" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4.1" />
      <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.4 5.4l1.7 1.7M16.9 16.9l1.7 1.7M18.6 5.4l-1.7 1.7M7.1 16.9l-1.7 1.7" />
    </>
  ),
  moon: <path d="M20.4 14.6A8.4 8.4 0 0 1 9.4 3.6a8.5 8.5 0 1 0 11 11z" />,
  sparkles: (
    <>
      <path d="M12 3.5 13.7 8.4 18.6 10.1 13.7 11.8 12 16.7 10.3 11.8 5.4 10.1 10.3 8.4z" />
      <path d="m18.4 15.8.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11.2A8.2 8.2 0 1 0 17.6 17" />
      <path d="M20 4.6v6.6h-6.6" />
    </>
  ),
  zoomIn: (
    <>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m15.5 15.5 4.2 4.2M10.8 8v5.6M8 10.8h5.6" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m15.5 15.5 4.2 4.2M8 10.8h5.6" />
    </>
  ),
  fit: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 11v5.4M12 7.8h.01" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="2.8" />
      <path d="M5 6v12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6" />
      <path d="M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8" />
    </>
  ),
  book: (
    <>
      <path d="M4.5 5.2A2.7 2.7 0 0 1 7.2 2.5H20v19H7.2a2.7 2.7 0 0 1-2.7-2.7z" />
      <path d="M8 2.5v19" />
    </>
  ),
  heart: (
    <path d="M12 20.2S4.6 15.6 4.6 10.6A4.1 4.1 0 0 1 12 7.4a4.1 4.1 0 0 1 7.4 3.2c0 5-7.4 9.6-7.4 9.6Z" />
  ),
  flower: (
    <>
      <circle cx="12" cy="6.6" r="2.9" />
      <circle cx="16.8" cy="10.2" r="2.9" />
      <circle cx="14.9" cy="15.8" r="2.9" />
      <circle cx="9.1" cy="15.8" r="2.9" />
      <circle cx="7.2" cy="10.2" r="2.9" />
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.6V12l3 1.8" />
    </>
  ),
  arrowRight: <path d="M4.5 12h15m0 0-5.4-5.4M19.5 12l-5.4 5.4" />,
  phone: (
    <g>
      <rect x="7" y="3" width="10" height="18" rx="1.5" />
      <path d="M10.5 18.5h3" />
    </g>
  ),
  external: (
    <>
      <path d="M13.5 4.5H19.5V10.5" />
      <path d="M19.5 4.5 11 13" />
      <path d="M18 14.5v4a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" />
    </>
  ),
  warn: (
    <>
      <path d="M12 4 21 19.5H3z" />
      <path d="M12 9.5v4.5M12 16.9h.01" />
    </>
  ),
  hash: <path d="M9.5 3.5 7.5 20.5M16.5 3.5l-2 17M4 8.5h15.5M3.5 15.5H19" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 22, strokeWidth = 1.7, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {ICONS[name]}
    </svg>
  );
}
