import { STRENGTH, tagHue, type StrengthKey } from "@/components/dashboard/data"
import { cn } from "@/lib/utils"

/** A category chip. Fill, text and border are all derived from one base hue. */
export function Tag({ name, className }: { name: string; className?: string }) {
  return (
    <span
      style={{ "--tag": tagHue(name) } as React.CSSProperties}
      className={cn(
        "inline-flex h-[22px] max-w-[112px] shrink-0 items-center overflow-hidden text-ellipsis whitespace-nowrap rounded-[7px] border px-[7px] text-xs font-medium",
        "border-[color-mix(in_srgb,var(--tag)_26%,var(--surface))]",
        "text-[color-mix(in_srgb,var(--tag)_62%,var(--ink))]",
        "bg-[color-mix(in_srgb,var(--tag)_13%,var(--surface))]",
        className
      )}
    >
      {name}
    </span>
  )
}

export function TagList({ tags, limit = 3 }: { tags: string[]; limit?: number }) {
  const shown = tags.slice(0, limit)
  const hidden = tags.length - shown.length

  return (
    <div className="flex min-w-0 items-center gap-1 overflow-hidden">
      {shown.map((tag) => (
        <Tag key={tag} name={tag} />
      ))}
      {hidden > 0 && (
        <span
          title={tags.slice(limit).join(", ")}
          className="inline-flex h-[22px] shrink-0 items-center rounded-md border border-line-strong bg-inset px-1.5 font-mono text-[10.5px] text-ink-4"
        >
          +{hidden}
        </span>
      )}
    </div>
  )
}

/** Connection strength as a 3-segment meter — a shape you read at a glance. */
export function Meter({ strength }: { strength: StrengthKey }) {
  const { color, bars } = STRENGTH[strength]

  return (
    <span
      style={{ "--meter": color } as React.CSSProperties}
      className="inline-flex shrink-0 gap-0.5"
    >
      {[1, 2, 3].map((i) => (
        <i
          key={i}
          className={cn(
            "block h-3 w-1 rounded-[1.5px]",
            i <= bars ? "bg-(--meter)" : "bg-line-strong"
          )}
        />
      ))}
    </span>
  )
}

export function Strength({ strength }: { strength: StrengthKey }) {
  return (
    <span className="inline-flex items-center gap-2 text-ink-2">
      <Meter strength={strength} />
      {STRENGTH[strength].label}
    </span>
  )
}

const ICON_BASE = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const

/** Line icons, sized and weighted to sit on the same optical grid. */
export function Icon({
  path,
  size = 16,
  width = 1.8,
  className,
}: {
  path: React.ReactNode
  size?: number
  width?: number
  className?: string
}) {
  return (
    <svg
      {...ICON_BASE}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      strokeWidth={width}
      className={className}
      aria-hidden="true"
    >
      {path}
    </svg>
  )
}

export const paths = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  check: <path d="m5 12 4 4L19 6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  arrowUp: <path d="M12 19V5M6 11l6-6 6 6" />,
  download: (
    <>
      <path d="M12 3v12" />
      <path d="m8 11 4 4 4-4" />
      <path d="M4 19h16" />
    </>
  ),
  external: <path d="M14 5h5v5M19 5l-8 8" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </>
  ),
  panel: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M9 4v16" />
    </>
  ),
  table: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M3 10h18M9 10v10" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.6" />
      <rect x="14" y="3" width="7" height="5" rx="1.6" />
      <rect x="14" y="12" width="7" height="9" rx="1.6" />
      <rect x="3" y="16" width="7" height="5" rx="1.6" />
    </>
  ),
  bag: (
    <>
      <path d="M4 7h16l-1.4 11.2A2 2 0 0 1 16.6 20H7.4a2 2 0 0 1-2-1.8Z" />
      <path d="M9 7V5a3 3 0 0 1 6 0v2" />
    </>
  ),
  chart: <path d="M5 20V10M12 20V4M19 20v-7" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 14.1a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9.9 3H10a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.3Z" />
    </>
  ),
  sound: (
    <>
      <path d="M11 5 6 9H3v6h3l5 4Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </>
  ),
  workspace: (
    <>
      <path d="M12 3a4 4 0 0 1 4 4v3a4 4 0 0 1-8 0V7a4 4 0 0 1 4-4Z" />
      <path d="M12 14v7" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16h.01" />
    </>
  ),
  healthy: (
    <>
      <path d="M20 12a8 8 0 1 1-8-8" />
      <path d="m9 12 2.5 2.5L21 5" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
  doc: (
    <>
      <path d="M6 3h8l4 4v14H6Z" />
      <path d="M14 3v4h4M9 12h6M9 16h6" />
    </>
  ),
  sheet: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M4 10h16M10 10v10" />
    </>
  ),
  slide: (
    <>
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <path d="M12 17v3M9 20h6" />
    </>
  ),
  pdf: (
    <>
      <path d="M6 3h8l4 4v14H6Z" />
      <path d="M14 3v4h4" />
      <path d="M9.5 17v-4.5h1.2a1.3 1.3 0 0 1 0 2.6H9.5" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.4" />
      <path d="m4 17 5-4.5 5 4 2.5-2L21 18" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m10.5 9.5 5 2.5-5 2.5Z" />
    </>
  ),
  archive: (
    <>
      <rect x="3" y="4" width="18" height="4.5" rx="1.5" />
      <path d="M5 8.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5" />
      <path d="M10 12.5h4" />
    </>
  ),
  star: <path d="m12 4 2.5 5.2 5.5.8-4 4 1 5.5-5-2.7-5 2.7 1-5.5-4-4 5.5-.8Z" />,
  list: (
    <>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </>
  ),
  upload: (
    <>
      <path d="M12 19V7" />
      <path d="m8 11 4-4 4 4" />
      <path d="M4 20h16" />
    </>
  ),
  people: (
    <>
      <path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="3.4" />
      <path d="M17 4.5a3.4 3.4 0 0 1 0 6.6M22 20v-2a4 4 0 0 0-3-3.8" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  cloud: <path d="M7 18a4 4 0 0 1-.4-8A5.5 5.5 0 0 1 17 9.5a3.8 3.8 0 0 1 .5 8.5Z" />,
  tag: (
    <>
      <path d="M3 11V4h7l10 10-7 7L3 11Z" />
      <circle cx="7.5" cy="7.5" r="1.2" />
    </>
  ),
  reply: <path d="M9 17H6a3 3 0 0 1-3-3V9m0 0 4-4M3 9l4 4M21 7v5a3 3 0 0 1-3 3h-3" />,
  heart: <path d="M12 20s-7-4.4-7-9.3A4 4 0 0 1 12 8a4 4 0 0 1 7-.7c0 4.9-7 12.7-7 12.7Z" />,
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" />
    </>
  ),
  bookmark: <path d="M6 4h12v17l-6-4-6 4Z" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="19" cy="12" r="1.4" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  pin: <path d="M9 3h6l-1 6 4 3v2H6v-2l4-3-1-6ZM12 14v7" />,
  rows: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M3 10h18" />
    </>
  ),
}
