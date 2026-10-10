/**
 * 素描感细线图标。颜色跟随文字（currentColor）。
 * 用法：<Icon name="bell" size={19} />
 */
const P = {
  home: <><path d="M4 11.2 12 4.5l8 6.7" /><path d="M6.2 9.8V19.5h11.6V9.8" /><path d="M10 19.5v-5h4v5" /></>,
  room: <><path d="M5 19.5V9l7-4.5L19 9v10.5" /><rect x="8.5" y="11" width="7" height="5" rx=".5" /><path d="M12 11v5M8.5 13.5h7" /></>,
  chat: <><path d="M4.5 7.5h15v9.5h-15z" /><path d="m4.8 7.8 7.2 5.4 7.2-5.4" /></>,
  tide: <><path d="M3 9.5c2-1.6 3.5-1.6 5.5 0s3.5 1.6 5.5 0 3.5-1.6 5.5 0" /><path d="M3 14c2-1.6 3.5-1.6 5.5 0s3.5 1.6 5.5 0 3.5-1.6 5.5 0" /><path d="M6 18.5c1.6-1 2.8-1 4.4 0" /></>,
  desk: <><circle cx="12" cy="12" r="2.6" /><path d="M12 3.5v2.6M12 17.9v2.6M3.5 12h2.6M17.9 12h2.6M6 6l1.8 1.8M16.2 16.2 18 18M6 18l1.8-1.8M16.2 7.8 18 6" /></>,
  bell: <><path d="M7 16.5V11a5 5 0 0 1 10 0v5.5l1.5 1.5h-13z" /><path d="M10.5 20.5h3" /></>,
  search: <><circle cx="11" cy="11" r="6" /><path d="m15.5 15.5 4 4" /></>,
  calendar: <><rect x="4.5" y="6" width="15" height="13.5" rx="1" /><path d="M4.5 10h15M9 4v3.5M15 4v3.5" /></>,
  arrow: <path d="M5 12h13M14 8l4 4-4 4" />,
  back: <path d="M15 5l-7 7 7 7" />,
  cloud: <path d="M7.5 17.5h9.2a3.6 3.6 0 0 0 .4-7.2 5 5 0 0 0-9.6 1.2 3 3 0 0 0 0 6z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></>,
  rain: <><path d="M7.5 14.5h9.2a3.6 3.6 0 0 0 .4-7.2 5 5 0 0 0-9.6 1.2 3 3 0 0 0 0 6z" /><path d="M9 17.5l-1 2M13 17.5l-1 2M17 17.5l-1 2" /></>,
  snow: <><path d="M7.5 14.5h9.2a3.6 3.6 0 0 0 .4-7.2 5 5 0 0 0-9.6 1.2 3 3 0 0 0 0 6z" /><path d="M9 18.5h.01M13 19.5h.01M17 18.5h.01" strokeWidth="2.2" /></>,
  fog: <path d="M4 9h16M6 13h12M4 17h16" />,
  moon: <><path d="M16.5 15.8A6.5 6.5 0 0 1 9 6.2a6.5 6.5 0 1 0 7.5 9.6z" /><path d="M17.5 5.5v2M16.5 6.5h2" /></>,
  leaf: <><path d="M6 18c0-7 4.5-11.5 13-12-.5 8.5-5 13-12 13z" /><path d="M6 18l7-7" /></>,
  photo: <><rect x="5" y="4.5" width="14" height="15.5" rx=".6" /><rect x="7" y="6.5" width="10" height="9" rx=".3" /><path d="m7.5 14 3-3 2.4 2.2 1.6-1.4 2 2" /></>,
  play: <path d="M9 7.5v9l7.5-4.5z" fill="currentColor" />,
  pause: <path d="M9.5 7.5v9M14.5 7.5v9" />,
  plus: <path d="M12 5v14M5 12h14" />,
  pen: <><path d="M5 19l1-4L16 5l3 3L9 18z" /><path d="M14 7l3 3" /></>,
  terminal: <><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="m7 10 3 2-3 2M12 15h5" /></>,
  down: <path d="m7 10 5 5 5-5" />,
  alert: <><circle cx="12" cy="12" r="8" /><path d="M12 8v5M12 16h.01" strokeWidth="1.8" /></>,
  redo: <><path d="M19 12a7 7 0 1 1-2.1-5" /><path d="M19 4v4h-4" /></>,
  file: <><path d="M7 3.5h7l4 4V20H7z" /><path d="M14 3.5V8h4" /></>,
  image: <><rect x="4" y="5" width="16" height="14" rx="1.5" /><circle cx="9" cy="10" r="1.6" /><path d="m4 17 5-4 4 3 3-2 4 3" /></>,
  camera: <><path d="M4 8h3l1.5-2h7L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.4" /></>,
  smile: <><circle cx="12" cy="12" r="8" /><path d="M9 14q3 2.5 6 0" /><path d="M9.5 10h.01M14.5 10h.01" strokeWidth="2" /></>,
  mic: <><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M6 11.5a6 6 0 0 0 12 0M12 17.5V20.5" /></>,
  send: <><path d="M4 12 20 4l-5 16-3-7z" /><path d="m12 13 8-9" /></>,
  feather: <><path d="M19 5c-6 0-11 4-12 11l-2 3" /><path d="M19 5c0 6-4 10-10 11" /><path d="M9 12h5" /></>,
  stop: <rect x="7.5" y="7.5" width="9" height="9" rx="1.5" fill="currentColor" />,
  more: <><circle cx="6" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="18" cy="12" r="1.2" fill="currentColor" /></>,
  quote: <path d="M5 17V12q0-5 5-6M13 17V12q0-5 5-6" />,
  copy: <><rect x="8" y="8" width="11" height="11" rx="1.5" /><path d="M5 15V6a1 1 0 0 1 1-1h9" /></>,
  trash: <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />,
  heart: <path d="M12 19s-7-4.4-7-9.5A3.8 3.8 0 0 1 12 7a3.8 3.8 0 0 1 7 2.5C19 14.6 12 19 12 19z" />,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  archive: <><rect x="4" y="5" width="16" height="4" rx="1" /><path d="M5.5 9v10h13V9M10 13h4" /></>,
  pin: <><path d="M9 4h6l-1 5 3 3H7l3-3z" /><path d="M12 12v8" /></>,
  window: <><rect x="4" y="5" width="16" height="13" rx="1.5" /><path d="M4 9h16" /></>,
  group: <><circle cx="9" cy="9" r="3" /><circle cx="16.5" cy="10" r="2.5" /><path d="M3.5 19c.5-3 3-5 5.5-5s5 2 5.5 5M14 15c2.5-.3 5 1.2 6 4" /></>,
  flame: <path d="M12 21c-4 0-6.5-2.6-6.5-6 0-3.5 3-5.5 3.5-9 2.2 1.4 3.4 3.4 3.5 5.5 1-1 1.5-2.3 1.4-3.8 2.6 2 4.6 4.6 4.6 7.3 0 3.4-2.5 6-6.5 6z" />,
  gift: <><rect x="4" y="9" width="16" height="11" rx="1" /><path d="M3 9h18M12 9v11M12 9c-2-4-6-4-6-1.5S10 9 12 9zm0 0c2-4 6-4 6-1.5S14 9 12 9z" /></>,
  sparkle: <path d="M12 3.5c.6 4.4 2.1 5.9 6.5 6.5-4.4.6-5.9 2.1-6.5 6.5-.6-4.4-2.1-5.9-6.5-6.5 4.4-.6 5.9-2.1 6.5-6.5zM18 16.5c.3 1.8.9 2.4 2.5 2.7-1.6.3-2.2.9-2.5 2.6-.3-1.7-.9-2.3-2.5-2.6 1.6-.3 2.2-.9 2.5-2.7z" />,
  check: <path d="m6 12.5 4 4 8-9" />,
  lock: <><rect x="6" y="11" width="12" height="9" rx="1.5" /><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" /></>,
  prev: <path d="M7 6v12M18 6l-8 6 8 6z" fill="currentColor" />,
  next: <path d="M17 6v12M6 6l8 6-8 6z" fill="currentColor" />,
  sync: <><path d="M5 12a7 7 0 0 1 12-5l2 2M19 12a7 7 0 0 1-12 5l-2-2" /><path d="M19 4v5h-5M5 20v-5h5" /></>,
  expand: <path d="M14 5h5v5M10 19H5v-5M19 5l-6 6M5 19l6-6" />,
  plug: <><path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0z" /><path d="M12 16v5" /></>,
  brush: <><path d="M14.5 4.5 19.5 9.5 11 18l-5-5z" /><path d="M6 13c-2 0-3 1.5-3 3.5S2 20 2 20s3 .5 5-1 1.5-3.5 1-4" /></>,
  tool: <path d="M14.5 5.5a4 4 0 0 0-5 5L4 16l4 4 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z" />,
  chev: <path d="M9 6l6 6-6 6" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
};

export default function Icon({ name, size = 20, stroke = 1.3, className, style }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={style}>
      {P[name]}
    </svg>
  );
}
