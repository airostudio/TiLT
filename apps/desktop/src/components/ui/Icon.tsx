// Small stroke icon set (24x24, currentColor). Decorative by default (aria-hidden).
import type { SVGProps } from 'react'

const paths: Record<string, string> = {
  home: 'M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10M10 19.5v-5h4v5',
  floppy: 'M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-6h8v6',
  disk: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  hdd: 'M3 14h18v6H3zM5 14l2-9h10l2 9M7 17h.01M10 17h.01',
  chip: 'M7 7h10v10H7zM9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4',
  amiga: 'M4 18V9l4-4h8l4 4v9zM8 14h8M9 18v2M15 18v2',
  tools: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-2.4z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1-2 3.4-.2-.1a1.7 1.7 0 0 0-1.9.1l-.4.3a1.7 1.7 0 0 0-.7 1.5v.2h-4v-.2a1.7 1.7 0 0 0-.7-1.5l-.4-.3a1.7 1.7 0 0 0-1.9-.1l-.2.1-2-3.4.1-.1A1.7 1.7 0 0 0 4.6 15l-.1-.4A1.7 1.7 0 0 0 3.2 13H3v-4h.2a1.7 1.7 0 0 0 1.3-1.6l.1-.4a1.7 1.7 0 0 0-.3-1.8l-.1-.1 2-3.4.2.1a1.7 1.7 0 0 0 1.9-.1l.4-.3A1.7 1.7 0 0 0 9.4 1.9V2h4v-.1a1.7 1.7 0 0 0 .7 1.5l.4.3a1.7 1.7 0 0 0 1.9.1l.2-.1 2 3.4-.1.1a1.7 1.7 0 0 0-.3 1.8l.1.4A1.7 1.7 0 0 0 20.8 11h.2v4h-.2a1.7 1.7 0 0 0-1.3 1.6z',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1 1-1.1 1.8M12 17h.01',
  play: 'M7 4.5v15l12-7.5z',
  pause: 'M8 5v14M16 5v14',
  stop: 'M6 6h12v12H6z',
  reset: 'M4 4v6h6M20 20v-6h-6M5.6 15A8 8 0 0 0 20 12M18.4 9A8 8 0 0 0 4 12',
  power: 'M12 3v9M6.4 6.6a8 8 0 1 0 11.2 0',
  fullscreen: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  mouse: 'M12 3a5 5 0 0 0-5 5v8a5 5 0 0 0 10 0V8a5 5 0 0 0-5-5zM12 3v6',
  folder: 'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  copy: 'M9 9h11v11H9zM5 15V4h11',
  download: 'M12 4v12M7 11l5 5 5-5M5 20h14',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
  check: 'M5 12.5 10 17.5 19 7',
  warn: 'M12 3 2.5 20h19zM12 10v4.5M12 17.5h.01',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5h.01',
  x: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  star: 'M12 3.5l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.8l6-.8z',
  back: 'M14 6l-6 6 6 6',
  chevron: 'M9 6l6 6-6 6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.8-4.8',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  volume: 'M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  mute: 'M4 9v6h4l5 4V5L8 9zM17 9l4 6M21 9l-4 6',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z',
  gamepad: 'M6 9h12a3 3 0 0 1 3 3.2l-.6 4.3a2.2 2.2 0 0 1-3.8 1.2L15 15.5H9L7.400 18a2.200 2.200 0 0 1-3.800-1.200L3 12.200A3 3 0 0 1 6 9zM8 11.500v2M7 12.500h2M16 12h.01M18 13.500h.01',
  pinball: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 16.500l3 1.500M16 16.500l-3 1.500M12 8v.01',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  link: 'M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1',
  lock: 'M6 11h12v9H6zM8.500 11V8a3.500 3.500 0 0 1 7 0v3',
  eject: 'M5 15l7-10 7 10zM5 19h14',
  snapshot: 'M4 8h16v11H4zM8 8V5h8v3M12 17a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  keyboard: 'M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M7 14h10',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  box: 'M12 3 3 7.500v9L12 21l9-4.500v-9zM3 7.500 12 12l9-4.500M12 12v9',
}

export type IconName = keyof typeof paths

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={paths[name]} />
    </svg>
  )
}
