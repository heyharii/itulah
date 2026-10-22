import { useId } from "react"

import { cn } from "@/lib/utils"

/// The matte language, drawn once (owner, 2026-10-20: "customer app deep",
/// `customer-app-matte.html`).
///
/// Everything here is a picture, not a control: the app icon, the icon's C on
/// its own, the small objects that stand beside a row or a shortcut, and the
/// tab bar's filled glyphs. Every part of every picture darkens toward its
/// foot and none of it shines; the one gold accent is the only second colour.
/// The pictures are the hub phone grid's department pictures in the member
/// app's subjects — the same pastel square at the top-left, the same object
/// stepping out of it, so the two apps read as one family.

/// A gradient id this component alone owns. `useId` is unique per render
/// tree, but its punctuation changes between React versions and not all of
/// it is safe inside `url(#…)`.
function useGradientId(): string {
  return useId().replace(/[^a-zA-Z0-9_-]/g, "")
}

/// Two stops of a vertical gradient, coloured from CSS custom properties so
/// the colours stay tokens (`styles/index.css`), not literals in this file.
function Stops({ from, to }: { from: string; to: string }) {
  return (
    <>
      <stop offset="0" style={{ stopColor: `var(${from})` }} />
      <stop offset="1" style={{ stopColor: `var(${to})` }} />
    </>
  )
}

/// The C, as the icon draws it (frontend-hub `brand-mark.tsx`, 100 viewBox).
const C_PATH =
  "M64.32 28.88A28.25 28.25 0 1 0 64.32 68.12A7.25 7.25 0 0 0 53.89 58.05A13.75 13.75 0 1 1 53.89 38.95A7.25 7.25 0 0 0 64.32 28.88Z"

/// The app icon: Matte · Deep. A matte blue tile darkening toward its foot,
/// the pale C standing on it with a soft contact shadow, the yellow dot in
/// its mouth. The same picture frontend-hub's `BrandMark` and its PWA icons
/// draw, so the mark here is the one on the member's home screen.
export function CentralMark({ className }: { className?: string }) {
  const id = useGradientId()
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden
      className={cn("shrink-0", className)}
    >
      <defs>
        <linearGradient id={`${id}t`} x1="0" y1="0" x2="0" y2="1">
          <Stops from="--mark-top" to="--mark-foot" />
        </linearGradient>
        <linearGradient id={`${id}c`} x1="0" y1="0" x2="0" y2="1">
          <Stops from="--canvas" to="--m-pale" />
        </linearGradient>
        <linearGradient id={`${id}d`} x1="0" y1="0" x2="0" y2="1">
          <Stops from="--m-gold-top" to="--m-gold-foot" />
        </linearGradient>
        <filter id={`${id}s`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.8" />
        </filter>
      </defs>
      <rect width="100" height="100" rx="23.4" fill={`url(#${id}t)`} />
      <ellipse
        cx="48"
        cy="84"
        rx="25"
        ry="3.4"
        style={{ fill: "var(--mark-shadow)" }}
        opacity=".4"
        filter={`url(#${id}s)`}
      />
      <path d={C_PATH} fill={`url(#${id}c)`} />
      <circle cx="75.5" cy="48.5" r="8" fill={`url(#${id}d)`} />
    </svg>
  )
}

/// The icon's C and dot with no tile, standing as an object on whatever blue
/// it is drawn on — the member card's face, its small brand mark. `floor`
/// draws the contact shadow under it; a mark the size of a word has none.
export function MatteC({
  className,
  floor = true,
}: {
  className?: string
  floor?: boolean
}) {
  const id = useGradientId()
  return (
    <svg viewBox="8 14 84 84" aria-hidden className={cn("shrink-0", className)}>
      <defs>
        <linearGradient id={`${id}c`} x1="0" y1="0" x2="0" y2="1">
          <Stops from="--canvas" to="--m-pale" />
        </linearGradient>
        <linearGradient id={`${id}d`} x1="0" y1="0" x2="0" y2="1">
          <Stops from="--m-gold-top" to="--m-gold-foot" />
        </linearGradient>
        <filter id={`${id}s`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>
      {floor && (
        <ellipse
          cx="48"
          cy="86"
          rx="27"
          ry="3.6"
          style={{ fill: "var(--m-shade)" }}
          opacity=".6"
          filter={`url(#${id}s)`}
        />
      )}
      <path d={C_PATH} fill={`url(#${id}c)`} />
      <circle cx="75.5" cy="48.5" r="8" fill={`url(#${id}d)`} />
    </svg>
  )
}

export type MatteArt =
  | "gift"
  | "card"
  | "receipt"
  | "bag"
  | "tag"
  | "shield"
  | "notify"
  | "profile"
  | "undo"
  | "spark"
  | "store"
  | "flag"
  | "adjust"
  | "logout"
  | "inbox"

export type MatteTone = "deep" | "mute" | "bad" | "ok"

/// The objects, on a 48 grid. `b` body, `d` the side turned away, `l` the
/// face toward the sky, `w` cream, `a` the gold accent; `sd`/`sw`/`ws`/`sa`
/// are the same colours as strokes.
const ART: Record<MatteArt, React.ReactNode> = {
  gift: (
    <>
      <rect className="b" x="7" y="21" width="34" height="22" rx="3" />
      <rect className="d" x="7" y="21" width="34" height="3.5" />
      <rect className="l" x="4" y="13" width="40" height="9" rx="2.5" />
      <rect className="a" x="21" y="13" width="6" height="30" />
      <path
        className="a"
        d="M24 13.5 C19 5 10 6.5 12.5 11.5 C14 14 18.5 13.5 24 13.5 Z"
      />
      <path
        className="a"
        d="M24 13.5 C29 5 38 6.5 35.5 11.5 C34 14 29.5 13.5 24 13.5 Z"
      />
    </>
  ),
  card: (
    <>
      <rect className="d" x="6" y="13" width="40" height="27" rx="4.5" />
      <rect className="b" x="3" y="9" width="40" height="27" rx="4.5" />
      <rect className="l" x="3" y="15" width="40" height="5" />
      <rect className="a" x="8" y="24" width="8" height="6" rx="1.5" />
      <rect className="w" x="20" y="26" width="17" height="3" rx="1.5" />
    </>
  ),
  receipt: (
    <>
      <path
        className="l"
        d="M11 4 H37 A2 2 0 0 1 39 6 V43 L35.5 40.5 L32 43 L28.5 40.5 L25 43 L21.5 40.5 L18 43 L14.5 40.5 L11 43 L9 41.5 V6 A2 2 0 0 1 11 4 Z"
      />
      <rect className="b" x="14" y="11" width="18" height="3.4" rx="1.7" />
      <rect className="b" x="14" y="18" width="11" height="3.4" rx="1.7" />
      <rect className="d" x="14" y="28" width="20" height="4" rx="2" />
      <circle className="a" cx="32" cy="19.7" r="3.2" />
    </>
  ),
  bag: (
    <>
      <path className="sd" d="M17 18 V13.5 A7 7 0 0 1 31 13.5 V18" />
      <path
        className="b"
        d="M8 17 H40 L38 41.5 A2.5 2.5 0 0 1 35.5 44 H12.5 A2.5 2.5 0 0 1 10 41.5 Z"
      />
      <rect className="l" x="8" y="17" width="32" height="4.5" />
      <rect className="a" x="26" y="27" width="9" height="11" rx="1.6" />
      <circle className="w" cx="30.5" cy="30" r="1.3" />
    </>
  ),
  tag: (
    <>
      <path
        className="b"
        d="M5 7 A2 2 0 0 1 7 5 H22 L43 26 A2.5 2.5 0 0 1 43 29.5 L29.5 43 A2.5 2.5 0 0 1 26 43 L5 22 Z"
      />
      <path
        className="d"
        d="M5 22 L26 43 A2.5 2.5 0 0 0 29.5 43 L31 41.5 L8 18.5 Z"
      />
      <circle className="w" cx="13.5" cy="13.5" r="3.5" />
      <rect
        className="a"
        x="17"
        y="24"
        width="18"
        height="4.5"
        rx="2.2"
        transform="rotate(45 26 26.25)"
      />
    </>
  ),
  shield: (
    <>
      <path
        className="b"
        d="M24 4 L41 10.5 V22 C41 33 33.5 40.5 24 44 C14.5 40.5 7 33 7 22 V10.5 Z"
      />
      <path
        className="d"
        d="M24 4 L41 10.5 V22 C41 33 33.5 40.5 24 44 Z"
        opacity=".5"
      />
      <path className="sa" d="M16.5 23.5 L22 29 L31.5 18.5" />
    </>
  ),
  notify: (
    <>
      <circle className="d" cx="24" cy="5.5" r="2.8" />
      <path
        className="b"
        d="M24 6.5 C16.5 6.5 11.5 12 11.5 19.5 V28 L7.5 33.5 V36 H40.5 V33.5 L36.5 28 V19.5 C36.5 12 31.5 6.5 24 6.5 Z"
      />
      <rect className="d" x="7.5" y="33.5" width="33" height="3.5" rx="1.75" />
      <circle className="a" cx="24" cy="41.5" r="4.5" />
      <path
        className="l"
        d="M15.5 19.5 C15.5 14.5 18.5 11 22.5 10.3 C19.5 12.5 18.5 15.5 18.5 19.5 V27 H15.5 Z"
      />
    </>
  ),
  profile: (
    <>
      <rect className="l" x="3" y="9" width="42" height="31" rx="4.5" />
      <rect className="d" x="19" y="5" width="10" height="7" rx="2.5" />
      <circle className="b" cx="15" cy="21" r="5.5" />
      <path
        className="b"
        d="M6.5 34.5 C6.5 29 10.5 26.5 15 26.5 C19.5 26.5 23.5 29 23.5 34.5 Z"
      />
      <rect className="d" x="27" y="18" width="13" height="3.2" rx="1.6" />
      <rect className="w" x="27" y="24" width="10" height="3.2" rx="1.6" />
      <rect className="a" x="27" y="30" width="7" height="3.2" rx="1.6" />
    </>
  ),
  undo: (
    <>
      <circle className="b" cx="24" cy="25" r="18" />
      <path className="d" d="M24 7 A18 18 0 0 1 24 43 Z" opacity=".35" />
      <path className="ws" d="M16.5 21 H28 A7 7 0 0 1 28 35 H21" />
      <path className="ws" d="M21 16.5 L16.5 21 L21 25.5" />
    </>
  ),
  spark: (
    <>
      <path
        className="b"
        d="M21 5 C22.6 16 25 18.4 36 20 C25 21.6 22.6 24 21 35 C19.4 24 17 21.6 6 20 C17 18.4 19.4 16 21 5 Z"
      />
      <path className="l" d="M21 5 C22.6 16 25 18.4 36 20 H21 Z" />
      <path
        className="a"
        d="M36 27 C36.8 31.4 37.6 32.2 42 33 C37.6 33.8 36.8 34.6 36 39 C35.2 34.6 34.4 33.8 30 33 C34.4 32.2 35.2 31.4 36 27 Z"
      />
    </>
  ),
  store: (
    <>
      <rect className="l" x="6" y="19" width="36" height="24" rx="2.5" />
      <rect className="b" x="3" y="8" width="42" height="12" rx="3" />
      <rect className="w" x="11.4" y="8" width="8.4" height="12" opacity=".9" />
      <rect className="w" x="28.2" y="8" width="8.4" height="12" opacity=".9" />
      <circle className="b" cx="7.2" cy="20" r="4.2" />
      <circle className="w" cx="15.6" cy="20" r="4.2" />
      <circle className="b" cx="24" cy="20" r="4.2" />
      <circle className="w" cx="32.4" cy="20" r="4.2" />
      <circle className="b" cx="40.8" cy="20" r="4.2" />
      <rect className="d" x="19.5" y="29" width="9" height="14" rx="1.5" />
      <rect className="a" x="10" y="29" width="7" height="7" rx="1.5" />
      <rect className="w" x="31" y="29" width="7" height="7" rx="1.5" />
    </>
  ),
  flag: (
    <>
      <rect className="d" x="8" y="5" width="4" height="39" rx="2" />
      <path className="b" d="M12 7 H38 L32 15.5 L38 24 H12 Z" />
      <path className="l" d="M12 7 H38 L35 11 H12 Z" />
      <rect className="a" x="16" y="14" width="10" height="3.4" rx="1.7" />
    </>
  ),
  adjust: (
    <>
      <rect className="l" x="5" y="12" width="38" height="5" rx="2.5" />
      <rect className="l" x="5" y="31" width="38" height="5" rx="2.5" />
      <circle className="b" cx="16" cy="14.5" r="6.5" />
      <circle className="d" cx="32" cy="33.5" r="6.5" />
      <circle className="a" cx="16" cy="14.5" r="2.2" />
    </>
  ),
  logout: (
    <>
      <rect className="d" x="5" y="5" width="23" height="38" rx="3" />
      <rect className="l" x="8.5" y="8.5" width="16" height="31" rx="1.5" />
      <circle className="a" cx="21" cy="25" r="1.8" />
      <path className="b" d="M23 20.5 H35 V15 L44 24 L35 33 V27.5 H23 Z" />
    </>
  ),
  inbox: (
    <>
      <path
        className="l"
        d="M10 6 H38 L44 26 V39 A3 3 0 0 1 41 42 H7 A3 3 0 0 1 4 39 V26 Z"
      />
      <rect className="a" x="17" y="13" width="14" height="3.4" rx="1.7" />
      <path
        className="b"
        d="M4 26 H16 L19 31 H29 L32 26 H44 V39 A3 3 0 0 1 41 42 H7 A3 3 0 0 1 4 39 Z"
      />
    </>
  ),
}

/// One matte picture: the pastel square at the top-left, the object stepping
/// out of it, its shadow on the floor. `size` is in px, the whole picture's
/// box; `tone` colours it — `deep` is the app, `mute` something that no
/// longer counts (a cancelled sale), `bad` the one way out, `ok` a gain.
export function MattePicture({
  art,
  size = 44,
  tone = "deep",
  className,
}: {
  art: MatteArt
  size?: number
  tone?: MatteTone
  className?: string
}) {
  const id = useGradientId()
  const style = {
    "--s": `${size / 16}rem`,
    "--gb": `url(#${id}b)`,
    "--gd": `url(#${id}d)`,
    "--gl": `url(#${id}l)`,
  } as React.CSSProperties
  return (
    <span
      aria-hidden
      className={cn("mpic", `pic-${tone}`, className)}
      style={style}
    >
      <span className="mpic-ground" />
      <svg viewBox="0 0 48 48">
        <defs>
          <linearGradient id={`${id}b`} x1="0" y1="0" x2=".25" y2="1">
            <stop offset="0" style={{ stopColor: "var(--p-b0)" }} />
            <stop offset=".45" style={{ stopColor: "var(--p-b1)" }} />
            <stop offset="1" style={{ stopColor: "var(--p-b2)" }} />
          </linearGradient>
          <linearGradient id={`${id}d`} x1="0" y1="0" x2=".25" y2="1">
            <Stops from="--p-d0" to="--p-d1" />
          </linearGradient>
          <linearGradient id={`${id}l`} x1="0" y1="0" x2=".25" y2="1">
            <Stops from="--p-l0" to="--p-l1" />
          </linearGradient>
        </defs>
        <ellipse className="floor" cx="26" cy="46" rx="16" ry="2.4" />
        {ART[art]}
      </svg>
    </span>
  )
}

export type GlyphName = "home" | "gift" | "receipt" | "user" | "bell"

/// The tab bar's (and the bell chip's) filled glyphs on a 24 grid. A `cut`
/// is a line drawn out of the shape in the card's white.
const GLYPH: Record<GlyphName, React.ReactNode> = {
  home: (
    <path d="M3.5 10.4 11.1 3.9a1.4 1.4 0 0 1 1.8 0l7.6 6.5c.3.3.5.7.5 1.1V20a1.5 1.5 0 0 1-1.5 1.5h-4.3v-5.7a1 1 0 0 0-1-1h-4.4a1 1 0 0 0-1 1v5.7H4.5A1.5 1.5 0 0 1 3 20v-8.5c0-.4.2-.8.5-1.1z" />
  ),
  gift: (
    <>
      <rect x="2.5" y="7.5" width="19" height="5" rx="1.3" />
      <path d="M4 13.8h7.2v7.7H5.5A1.5 1.5 0 0 1 4 20zM12.8 13.8H20V20a1.5 1.5 0 0 1-1.5 1.5h-5.7z" />
      <path d="M11.2 7.3C9 3.5 5.3 4 6 6.2c.4 1.2 2.6 1.3 5.2 1.1zM12.8 7.3C15 3.5 18.7 4 18 6.2c-.4 1.2-2.6 1.3-5.2 1.1z" />
    </>
  ),
  receipt: (
    <>
      <path d="M5 2.8c0-.4.4-.7.8-.5l1.8 1 2.1-1.1a.8.8 0 0 1 .7 0l1.6.9 1.6-.9a.8.8 0 0 1 .7 0l2.1 1.1 1.8-1c.4-.2.8.1.8.5v18.4c0 .4-.4.7-.8.5l-1.8-1-2.1 1.1a.8.8 0 0 1-.7 0l-1.6-.9-1.6.9a.8.8 0 0 1-.7 0l-2.1-1.1-1.8 1c-.4.2-.8-.1-.8-.5z" />
      <path className="cut" d="M8.5 8h7M8.5 12h7M8.5 16h4.5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="7.8" r="4.8" />
      <path d="M3.5 20.2c0-4.3 3.8-7.2 8.5-7.2s8.5 2.9 8.5 7.2c0 .7-.6 1.3-1.3 1.3H4.8c-.7 0-1.3-.6-1.3-1.3z" />
    </>
  ),
  bell: (
    <>
      <path d="M12 2.5c-3.9 0-6.5 2.9-6.5 6.8v3.9L3.6 16c-.4.6 0 1.5.8 1.5h15.2c.8 0 1.2-.9.8-1.5l-1.9-2.8V9.3c0-3.9-2.6-6.8-6.5-6.8z" />
      <circle className="clapper" cx="12" cy="20.4" r="2.2" />
    </>
  ),
}

/// A filled glyph. Active, it wears the matte gradient; otherwise it stands
/// back in the faint grey.
export function Glyph({
  name,
  active = true,
  className,
}: {
  name: GlyphName
  active?: boolean
  className?: string
}) {
  const id = useGradientId()
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={cn("glyph shrink-0", active && "glyph-on", className)}
      style={{ "--glyph-fill": `url(#${id}g)` } as React.CSSProperties}
    >
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1">
          <Stops from="--m-top" to="--m-foot" />
        </linearGradient>
      </defs>
      {GLYPH[name]}
    </svg>
  )
}
