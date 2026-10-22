/// Line icons, drawn the way `prototypes/pos` draws them: 24px grid,
/// `currentColor` stroke, sized by `svg.icon` in `pos.css`.
const PATHS = {
  scan: "M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M7 8v8M10 8v8M14 8v8M17 8v8",
  search: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM16 16l4 4",
  user: "M12 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM5 21v-2a7 7 0 0 1 14 0v2",
  tag: "M3 3h7l11 11-7 7L3 10zM7 6.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1Z",
  card: "M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM2 10h20M6 15h3",
  cash: "M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM6 12h.01M18 12h.01",
  wallet: "M3 7a2 2 0 0 1 2-2h12v4M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H5a2 2 0 0 1-2-2ZM17 13.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1Z",
  qr: "M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h2v2h-2zM21 14v3M14 21h3M20 20h1v1",
  voucher: "M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4ZM14 5v14",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  back: "M20 12H4m6-6-6 6 6 6",
  x: "m6 6 12 12M6 18 18 6",
  check: "m5 12 4 4L19 6",
  hold: "M9 5v14M15 5v14",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  print: "M6 9V3h12v6M6 17H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M6 14h12v7H6z",
  receipt: "M5 3v18l3-2 4 2 4-2 3 2V3l-3 2-4-2-4 2zM9 9h6M9 13h6",
  return: "M9 4 4 9l5 5M4 9h9a7 7 0 0 1 0 14",
  void: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM5.6 5.6l12.8 12.8",
  lock: "M7 10h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2ZM8 10V7a4 4 0 0 1 8 0v3M12 14v3",
  rfid: "M3 8a9 9 0 0 1 0 8M21 8a9 9 0 0 0 0 8M6 10a5 5 0 0 1 0 4M18 10a5 5 0 0 0 0 4M11 6h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z",
  bag: "M5 8h14l1 13H4zM9 8V6a3 3 0 0 1 6 0v2",
  star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z",
  monitor: "M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM9 21h6M12 17v4",
  settings: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z",
  logout: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11",
  alert: "M12 4 2 20h20ZM12 10v5M12 18h.01",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3 2",
  finger: "M12 11v4a6 6 0 0 1-1 3.5M8 7.5A5 5 0 0 1 17 11v2M7 11a5 5 0 0 1 .3-1.7M16.6 16A10 10 0 0 1 15 20M4.5 8a9 9 0 0 1 15.3.5M20 13v-1M8 14.5V11a4 4 0 0 1 4-4",
  plug: "M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4",
  down: "m6 9 6 6 6-6",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  del: "M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1ZM17 9l-4 6M13 9l4 6",
  "bag-paper": "M5.5 8.5h13l-1.1 12.5H6.6zM9 8.5V7a3 3 0 0 1 6 0v1.5",
  "bag-plastic": "M5 4h3.2v2.6a3.8 3.8 0 0 0 7.6 0V4H19v15.2a1.8 1.8 0 0 1-1.8 1.8H6.8A1.8 1.8 0 0 1 5 19.2z",
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={size === undefined ? undefined : { width: size, height: size }}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
