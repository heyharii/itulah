import { useId, type CSSProperties } from "react"

import { cn } from "@/lib/utils"

/// A department drawn the matte way (owner, 2026-10-18 `hub-mobile-grid-options.html`
/// round 10, "nah ini bagus"; 2026-10-20 on the rail, `po-matte-options.html`
/// Soft cards: "kalo di desk iconnya touch saja"): each part darkens toward
/// its foot, no shine, one yellow accent, a soft contact shadow. Shown only in
/// the Soft style (`.look-soft-only`, `styles/soft.css`); the line icon stays
/// for Now.
///
/// The pictures are drawn on a 48 box from four parts: `.b` the base, `.d` the
/// shade, `.l` the light, `.w` off-white, `.a`/`.sa` the one accent. `tone`
/// "grey" keeps the shape and drops the colour — the departments you are not
/// in, so only where you are carries colour.

/// Gojek's few colours, sampled from its Home (the grid's Family palette):
/// base, shade, light. Grey for a department you are not in.
const FAMILY = {
  green: ["#30a830", "#1e7a22", "#4cc03c"],
  red: ["#ec2d3a", "#9c2a30", "#f2525c"],
  blue: ["#00a8cc", "#00799a", "#22bfe0"],
  orange: ["#f08c1a", "#b5620c", "#f6a640"],
  grey: ["#b4b4ba", "#8e8e93", "#d8d8dc"],
} as const

type Family = keyof typeof FAMILY

/// The pastel square a picture steps out of on the phone's Home grid: each
/// family's own ground, sampled from the same Home.
const GROUND: Record<Family, string> = {
  green: "#def6cc",
  red: "#fcdede",
  blue: "#d2f0f6",
  orange: "#fdead2",
  grey: "#f2f2f5",
}

const ART: Record<string, { readonly family: Family; readonly svg: string }> = {
  home: {
    family: "orange",
    svg: `<path class="b" d="M8 20 L24 7 L40 20 V41 A3 3 0 0 1 37 44 H11 A3 3 0 0 1 8 41 Z"/><path class="d" d="M24 3.5 L45.5 21 L42.5 24.5 L24 9.5 L5.5 24.5 L2.5 21 Z"/><rect class="l" x="19" y="28" width="10" height="16" rx="2"/><rect class="a" x="31" y="23" width="5.5" height="5.5" rx="1.2"/>`,
  },
  executive: {
    family: "blue",
    svg: `<rect class="l" x="6" y="26" width="10" height="17" rx="3"/><rect class="b" x="19" y="17" width="10" height="26" rx="3"/><rect class="d" x="32" y="7" width="10" height="36" rx="3"/><path class="sa" d="M5 19 L17 10.5 L24 14.5 L37 3.5"/><path class="a" d="M33 2 H40 V9 Z"/>`,
  },
  buying: {
    family: "green",
    svg: `<rect class="a" x="20" y="4" width="14" height="12" rx="2.5" transform="rotate(-10 27 10)"/><path class="sd" d="M3 9 H9 L11 14"/><path class="b" d="M11 14 H43 L38.5 31 H15.5 Z" stroke="#000" stroke-width="3" stroke-linejoin="round"/><path class="sw" d="M21 18 V27 M28 18 V27 M35 18 V27"/><path class="sd" d="M15.5 31 L17 36 H38"/><circle class="d" cx="19" cy="40" r="4"/><circle class="d" cx="36" cy="40" r="4"/><circle class="w" cx="19" cy="40" r="1.5"/><circle class="w" cx="36" cy="40" r="1.5"/>`,
  },
  merchandise: {
    family: "red",
    svg: `<path class="b" d="M17 6 L9 9.5 L2.5 18 L9 23.5 L12 21 V41 A2.5 2.5 0 0 0 14.5 43.5 H33.5 A2.5 2.5 0 0 0 36 41 V21 L39 23.5 L45.5 18 L39 9.5 L31 6 C30 9.5 27.5 11.5 24 11.5 C20.5 11.5 18 9.5 17 6 Z" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/><path class="d" d="M17 6 C18 9.5 20.5 11.5 24 11.5 C27.5 11.5 30 9.5 31 6 C29 7.6 26.8 8.4 24 8.4 C21.2 8.4 19 7.6 17 6 Z"/><rect class="a" x="12" y="25" width="24" height="5"/>`,
  },
  ops: {
    family: "green",
    svg: `<rect class="b" x="2" y="10" width="27" height="23" rx="3"/><rect class="l" x="2" y="15" width="27" height="3"/><path class="d" d="M29 17 H37.5 A3 3 0 0 1 40 18.4 L45 26 V33 H29 Z"/><path class="w" d="M31.5 20 H37 L40.5 25.5 H31.5 Z" fill-opacity=".9"/><rect class="d" x="2" y="31" width="43" height="4.5" rx="2"/><circle cx="13" cy="37" r="5.2" fill="#1d1d1f"/><circle cx="36" cy="37" r="5.2" fill="#1d1d1f"/><circle class="w" cx="13" cy="37" r="2"/><circle class="w" cx="36" cy="37" r="2"/><rect class="a" x="42.5" y="27.5" width="2.5" height="3.5" rx="1"/>`,
  },
  inventory: {
    family: "green",
    svg: `<rect class="b" x="3" y="23" width="21" height="20" rx="2.5"/><rect class="d" x="24" y="23" width="21" height="20" rx="2.5"/><rect class="l" x="13" y="5" width="22" height="18" rx="2.5"/><rect class="a" x="11.5" y="23" width="4" height="8"/><rect class="a" x="32.5" y="23" width="4" height="8"/><rect class="b" x="22" y="5" width="4" height="8"/>`,
  },
  marketing: {
    family: "red",
    svg: `<path class="sa" d="M39 15 Q42.5 22 39 29"/><path class="sa" d="M43.5 11 Q49 22 43.5 33"/><rect class="l" x="4" y="16" width="8" height="12" rx="3"/><path class="b" d="M11 16.5 L31 7 V37 L11 27.5 Z" stroke="#000" stroke-width="3" stroke-linejoin="round"/><ellipse class="d" cx="32" cy="22" rx="3.6" ry="15"/><path class="d" d="M14 27.5 L18 38.5 A2 2 0 0 0 19.9 40 H22.5 A1.6 1.6 0 0 0 24 37.8 L20.8 30.4 Z"/>`,
  },
  selling: {
    family: "red",
    svg: `<rect class="l" x="6" y="19" width="36" height="24" rx="2.5"/><rect class="b" x="3" y="8" width="42" height="12" rx="3"/><rect class="w" x="11.4" y="8" width="8.4" height="12" fill-opacity=".9"/><rect class="w" x="28.2" y="8" width="8.4" height="12" fill-opacity=".9"/><circle class="b" cx="7.2" cy="20" r="4.2"/><circle class="w" cx="15.6" cy="20" r="4.2"/><circle class="b" cx="24" cy="20" r="4.2"/><circle class="w" cx="32.4" cy="20" r="4.2"/><circle class="b" cx="40.8" cy="20" r="4.2"/><rect class="d" x="19.5" y="29" width="9" height="14" rx="1.5"/><rect class="a" x="10" y="29" width="7" height="7" rx="1.5"/><rect class="w" x="31" y="29" width="7" height="7" rx="1.5"/>`,
  },
  finance: {
    family: "blue",
    svg: `<path class="d" d="M24 3 L44 13.5 V17 H4 V13.5 Z" stroke="#000" stroke-width="2" stroke-linejoin="round"/><circle class="a" cx="24" cy="11" r="2.8"/><rect class="l" x="5" y="17" width="38" height="3" rx="1"/><rect class="b" x="8" y="21" width="5.5" height="15" rx="1.5"/><rect class="b" x="17" y="21" width="5.5" height="15" rx="1.5"/><rect class="b" x="25.5" y="21" width="5.5" height="15" rx="1.5"/><rect class="b" x="34.5" y="21" width="5.5" height="15" rx="1.5"/><rect class="d" x="5" y="36" width="38" height="4" rx="1.5"/><rect class="b" x="2.5" y="40" width="43" height="4" rx="1.5"/>`,
  },
  hr: {
    family: "blue",
    svg: `<circle class="l" cx="32.5" cy="13.5" r="6.5"/><path class="l" d="M21 38 C21 29.5 26 24.5 32.5 24.5 C39 24.5 44 29.5 44 38 V39 A2 2 0 0 1 42 41 H23 A2 2 0 0 1 21 39 Z"/><circle class="b" cx="18.5" cy="16.5" r="7.5"/><path class="b" d="M5 41 C5 32 11 26.5 18.5 26.5 C26 26.5 32 32 32 41 V42 A2 2 0 0 1 30 44 H7 A2 2 0 0 1 5 42 Z"/><path class="a" d="M16 26.8 L18.5 33 L21 26.8 Z"/>`,
  },
  ga: {
    family: "blue",
    svg: `<rect class="d" x="29" y="17" width="12" height="26" rx="2"/><rect class="b" x="8" y="5" width="22" height="38" rx="2.5"/><rect class="a" x="12" y="10" width="5" height="5" rx="1"/><rect class="a" x="21" y="10" width="5" height="5" rx="1"/><rect class="a" x="12" y="18" width="5" height="5" rx="1"/><rect class="a" x="21" y="18" width="5" height="5" rx="1"/><rect class="a" x="12" y="26" width="5" height="5" rx="1"/><rect class="a" x="21" y="26" width="5" height="5" rx="1"/><rect class="l" x="32.5" y="22" width="5" height="4" rx="1"/><rect class="l" x="32.5" y="29" width="5" height="4" rx="1"/><rect class="d" x="16" y="35" width="6" height="8" rx="1"/><rect class="d" x="4" y="42" width="40" height="3" rx="1.5"/>`,
  },
  master: {
    family: "orange",
    svg: `<rect class="d" x="10" y="5" width="30" height="38" rx="3"/><rect class="w" x="13" y="8" width="26" height="34" rx="2"/><rect class="b" x="8" y="4" width="27" height="36" rx="3"/><rect class="d" x="8" y="4" width="5.5" height="36" rx="2.5"/><rect class="l" x="18" y="11" width="12" height="6" rx="1.5"/><path class="a" d="M27 38 V46 L30 43.5 L33 46 V38 Z"/>`,
  },
}

ART.library = {
  family: "orange",
  svg: `<path class="d" d="M4 12 A3 3 0 0 1 7 9 H17.5 L21.5 13 H41 A3 3 0 0 1 44 16 V38 A3 3 0 0 1 41 41 H7 A3 3 0 0 1 4 38 Z"/><rect class="w" x="9" y="14" width="29" height="20" rx="1.5"/><rect class="a" x="13" y="18" width="16" height="2.4" rx="1.2"/><rect class="l" x="13" y="23" width="11" height="2.4" rx="1.2"/><path class="b" d="M3 21 A3 3 0 0 1 6 18 H42 A3 3 0 0 1 45 21.3 L43.4 38.3 A3 3 0 0 1 40.4 41 H7.6 A3 3 0 0 1 4.6 38.3 Z"/>`,
}
ART.reports = {
  family: "red",
  svg: `<rect class="b" x="7" y="7" width="32" height="38" rx="3.5"/><rect class="w" x="11" y="12" width="24" height="29" rx="1.5"/><rect class="d" x="16" y="3.5" width="14" height="7" rx="2.5"/><rect class="l" x="15" y="29" width="4.5" height="8" rx="1"/><rect class="b" x="21" y="23" width="4.5" height="14" rx="1"/><rect class="a" x="27" y="17" width="4.5" height="20" rx="1"/>`,
}
/// System (administration): a gear.
ART.system = {
  family: "orange",
  svg: `<rect class="b" x="20.5" y="4" width="7" height="9" rx="2" transform="rotate(0 24 24)"/><rect class="b" x="20.5" y="4" width="7" height="9" rx="2" transform="rotate(45 24 24)"/><rect class="b" x="20.5" y="4" width="7" height="9" rx="2" transform="rotate(90 24 24)"/><rect class="b" x="20.5" y="4" width="7" height="9" rx="2" transform="rotate(135 24 24)"/><rect class="b" x="20.5" y="4" width="7" height="9" rx="2" transform="rotate(180 24 24)"/><rect class="b" x="20.5" y="4" width="7" height="9" rx="2" transform="rotate(225 24 24)"/><rect class="b" x="20.5" y="4" width="7" height="9" rx="2" transform="rotate(270 24 24)"/><rect class="b" x="20.5" y="4" width="7" height="9" rx="2" transform="rotate(315 24 24)"/><circle class="b" cx="24" cy="24" r="14"/><circle class="d" cx="24" cy="24" r="8"/><circle class="a" cx="24" cy="24" r="3.6"/>`,
}

/// Whether a matte picture exists for this id (a department's, or "home").
export function hasMattePicture(id: string): boolean {
  return id in ART
}

/// Mixes two #rrggbb colours, `weight` of the first.
function mix(a: string, b: string, weight: number): string {
  const parts = (hex: string) =>
    [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16))
  const [x, y] = [parts(a), parts(b)]
  return `#${x
    .map((value, at) =>
      Math.round(value * weight + y[at] * (1 - weight))
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`
}

export function MattePicture({
  id,
  tone = "colour",
  className,
}: {
  id: string
  tone?: "colour" | "grey"
  className?: string
}) {
  const uid = useId().replace(/:/g, "")
  const art = ART[id]
  if (art === undefined) return null
  const [base, shade, light] = FAMILY[tone === "grey" ? "grey" : art.family]
  const stops = (key: string, list: readonly [number, string][]) =>
    `<linearGradient id="${uid}${key}" x1="0" y1="0" x2=".25" y2="1">${list
      .map(([at, colour]) => `<stop offset="${at}" stop-color="${colour}"/>`)
      .join("")}</linearGradient>`
  const defs =
    stops("b", [
      [0, mix(base, light, 0.78)],
      [0.45, base],
      [1, mix(base, shade, 0.45)],
    ]) +
    stops("d", [
      [0, mix(shade, base, 0.8)],
      [1, mix(shade, "#000000", 0.72)],
    ]) +
    stops("l", [
      [0, light],
      [1, mix(light, base, 0.5)],
    ])
  return (
    <svg
      viewBox="0 0 48 48"
      aria-hidden
      className={cn("matte-picture shrink-0 overflow-visible", className)}
      style={
        {
          "--mp-b": `url(#${uid}b)`,
          "--mp-d": `url(#${uid}d)`,
          "--mp-l": `url(#${uid}l)`,
          "--mp-shade": shade,
          "--mp-accent": tone === "grey" ? "#d1d1d6" : "#f7b928",
        } as CSSProperties
      }
      dangerouslySetInnerHTML={{
        __html: `<defs>${defs}</defs><ellipse cx="26" cy="46" rx="16" ry="2.4" fill="${shade}" opacity=".3"/>${art.svg}`,
      }}
    />
  )
}

/// A department on the phone's Home grid (owner, 2026-10-18,
/// `hub-mobile-grid-options.html` round 10, "nah ini bagus"; 2026-10-21 "grid
/// home hp kenapa belum memakai matte"): a pastel square at the top-left and
/// the picture stepping out of it to the bottom-right, straight, never tilted
/// — Gojek's own layout — and what is waiting as a red tag with a tail at the
/// square's corner.
export function MatteTile({
  id,
  count,
  className,
}: {
  id: string
  count?: number | null
  className?: string
}) {
  const art = ART[id]
  if (art === undefined) return null
  return (
    <span className={cn("relative block h-[3.75rem] w-16 shrink-0", className)}>
      <span
        aria-hidden
        className="absolute top-0 left-0 size-[3.125rem] rounded-[0.9375rem]"
        style={{ background: GROUND[art.family] }}
      />
      <MattePicture
        id={id}
        className="absolute top-[0.6875rem] left-[0.9375rem] size-[3.0625rem]"
      />
      {typeof count === "number" && count > 0 && (
        <span className="matte-tag">{count > 99 ? "99+" : count}</span>
      )}
    </span>
  )
}
