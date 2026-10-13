import type { CSSProperties } from 'react';
const paths = {
  drive: 'M5 4h14l3 11v5H2v-5L5 4Zm-3 11h20M6 18h.01M10 18h.01',
  eject: 'm12 3 8 11H4L12 3ZM4 18h16v3H4v-3Z',
  drawing: 'M3 3h18v18H3V3Zm3 14 4-10 8 10H6Zm1-4h10M6 5h.01',
  terminal: 'M3 4h18v16H3V4Zm4 5 3 3-3 3m6 0h4',
  folder: 'M3 7V5a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z',
  file: 'M14 3H5v18h14V8l-5-5Zm0 0v5h5',
  image: 'M3 3h18v18H3V3Zm0 14 6-6 4 4 3-3 5 5M16 7h.01',
  model: 'm12 3 9 5v8l-9 5-9-5V8l9-5Zm0 9 9-4M12 12 3 8m9 4v9',
  archive: 'M4 3h16v18H4V3Zm7 0v3h2v3h-2v3h2v3h-2v3h2',
  pdf: 'M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 13h8m-8 4h5',
  code: 'm8 7-5 5 5 5m8-10 5 5-5 5m-3-12-2 14',
  data: 'M3 4h18v16H3V4Zm0 5h18M9 4v16m6-16v16m-12-6h18',
  audio:
    'M9 18V5l11-2v13M9 5l11-2M6 16a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm11-2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  video: 'M3 5h18v14H3V5Zm7 4 5 3-5 3V9Z',
  list: 'M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01',
  grid: 'M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z',
  columns: 'M3 4h18v16H3V4Zm6 0v16m6-16v16',
  gallery: 'M3 3h18v13H3V3Zm0 18h4m3 0h4m3 0h4m-17-9 4-4 4 4 3-3 5 5',
  left: 'm15 5-7 7 7 7',
  right: 'm9 5 7 7-7 7',
  up: 'm5 15 7-7 7 7',
  down: 'm5 9 7 7 7-7',
  plus: 'M12 5v14M5 12h14',
  close: 'm6 6 12 12M6 18 18 6',
  search: 'M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15ZM16 16l5 5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  star: 'm12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6Z',
  home: 'm3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8',
  disk: 'M4 3h16v18H4V3Zm0 12h16M8 18h.01m4 0h.01',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 3v6l4 2',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  link: 'm9 15 6-6M9 6l3-3a4 4 0 0 1 6 6l-3 3M15 18l-3 3a4 4 0 0 1-6-6l3-3',
  frame: 'M3 9V3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6',
  dock: 'M3 4h18v16H3V4Zm0 4h18',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
  copy: 'M9 9h12v12H9V9ZM5 15H3V3h12v2',
  move: 'M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3',
  rename: 'M16 3h6m-3 0v18m-3 0h6M3 7h11v10H3V7Z',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-6v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1',
  moon: 'M20 14A9 9 0 0 1 10 4a9 9 0 1 0 10 10Z',
  check: 'm4 12 5 5L20 6',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 8v6m0-10h.01',
  refresh: 'M20 8a8 8 0 1 0 1 7M20 3v5h-5',
  external: 'M14 3h7v7m0-7L10 14M10 3H3v18h18v-7',
  alias: 'M4 20v-4a5 5 0 0 1 5-5h11m-5-5 5 5-5 5',
  play: 'm7 3 14 9-14 9V3Z',
  pause: 'M6 4h4v16H6V4Zm8 0h4v16h-4V4Z',
  wireframe: 'M3 3h18v18H3V3Zm0 0 18 18M3 21 21 3M12 3v18M3 12h18',
  warning: 'm12 3 10 18H2L12 3Zm0 6v5m0 3h.01',
  sidebar: 'M3 4h18v16H3V4Zm6 0v16M5 8h2m-2 4h2',
  command:
    'M8 8h8v8H8V8ZM8 8H5a2 2 0 1 1 2-2v2m9 0V5a2 2 0 1 1 2 2h-2m0 9h3a2 2 0 1 1-2 2v-2m-9 0v3a2 2 0 1 1-2-2h2',
  settings:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3Z',
};
export type IconName = keyof typeof paths;
export function Icon({
  name,
  size = 18,
  className,
  style,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      aria-hidden="true"
      pointerEvents="none"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
    >
      {name === 'more' ? (
        [5, 12, 19].map((cx) => (
          <circle key={cx} cx={cx} cy={12} r={1.6} fill="currentColor" stroke="none" />
        ))
      ) : (
        <path d={paths[name]} />
      )}
    </svg>
  );
}
