/// The look the hub is drawn in.
///
/// ALL WHITE (owner, 2026-10-13): "D · All white" from
/// `po-detail-variants.html`, for every department — "migrate semua
/// frontend-hub ke all white … abaikan lark look". One white surface, Apple's
/// ink, status as a dot and a word, KPI figures in one row, tables without a
/// frame, sheets on a white veil. It is drawn by `styles/white.css` on top of
/// the components' own classes, keyed on `<html data-look="white">`.
///
/// The Lark look it replaces (12 Oct) and its KPI palette picker are kept in
/// `outputs/lark-look-backup-2026-10-13/` for reference.
///
/// STILL OPEN (owner, 2026-10-14: "all white agak membingungkan jg kalau banyak
/// data"): which aids give a full screen back its structure. Each is an
/// attribute on <html> the owner switches on from the Look picker
/// (`look-picker.tsx`), on the real screens with the demo's data, and keeps in
/// this browser only; the ones he keeps become the default here.

export type LookName = "white"

export const LOOK: LookName = "white"

/// One aid each, and they combine.
/// "Layered menu" left the list on 14 Oct: the floating panel is the hub's
/// shell now (hub-ui-patterns, `po-shell-layers.html` A).
export type LookAid = "zebra" | "freeze" | "panel"

export const LOOK_AIDS: readonly {
  readonly value: LookAid
  readonly label: string
  readonly note: string
}[] = [
  {
    value: "zebra",
    label: "Row stripes",
    note: "Every other row faintly grey, the row under the pointer tinted",
  },
  {
    value: "freeze",
    label: "First column stays",
    note: "A wide table scrolls under its first column",
  },
  {
    value: "panel",
    label: "Tables on a panel",
    note: "The page light grey, each table on a white panel",
  },
]

/// None by default until the owner picks.
export const LOOK_AIDS_DEFAULT: readonly LookAid[] = []

const KEY = "hub.look.aids"

/// The picker is off the shell (owner, 2026-10-15: "hapus … icon paint ini"),
/// so a choice saved in a browser could never be changed back: everyone reads
/// the default again until an aid is chosen as the hub's own.
const PICKER_SHOWN = false

export function readAids(): LookAid[] {
  if (!PICKER_SHOWN) return [...LOOK_AIDS_DEFAULT]
  try {
    const raw = JSON.parse(
      window.localStorage.getItem(KEY) ?? "null"
    ) as unknown
    if (!Array.isArray(raw)) return [...LOOK_AIDS_DEFAULT]
    return LOOK_AIDS.map((aid) => aid.value).filter((aid) => raw.includes(aid))
  } catch {
    return [...LOOK_AIDS_DEFAULT]
  }
}

export function writeAids(aids: readonly LookAid[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(aids))
  } catch {
    // A private window: the choice lasts until the tab closes.
  }
  applyAids(aids)
}

function applyAids(aids: readonly LookAid[]) {
  const root = document.documentElement
  for (const { value } of LOOK_AIDS) {
    root.toggleAttribute(`data-aid-${value}`, aids.includes(value))
  }
}

/// Before the first paint (the client boot, `boot-client.ts`). `?aids=sidebar,zebra`
/// in the address sets and keeps a choice, so a link can carry one.
export function startLook() {
  if (typeof document === "undefined") return
  document.documentElement.dataset.look = LOOK
  const asked = new URLSearchParams(window.location.search).get("aids")
  if (asked !== null) {
    const parts = asked.split(",")
    writeAids(
      LOOK_AIDS.map((aid) => aid.value).filter((aid) => parts.includes(aid))
    )
  } else applyAids(readAids())
}

/// Whether the hub is drawn in All white — the screens that move a record's
/// verbs to its foot and stand the filters over the list ask this.
export function isWhiteLook(): boolean {
  // The server draws <html data-look> from `LOOK` (`routes/__root.tsx`), so it
  // answers from the same constant the browser's attribute was written from.
  if (typeof document === "undefined") return LOOK === "white"
  return document.documentElement.dataset.look === "white"
}
