import { useSyncExternalStore } from "react"
import { deviceHint } from "@/lib/device"
import { isWhiteLook } from "@/lib/look"

/// What the app is being worked ON, expressed as a width rather than a device.
///
/// "iPad" is not a width. iPadOS ships 768, 820, 834, 1024, 1180 and 1366 CSS
/// px across its models and its two orientations, and a phone held sideways is
/// 844 — the same problem as a tablet held upright. So there are three answers
/// here and they are named after what the shell can afford, not after hardware:
///
///  - `phone`   — under 48rem. Room for a list, not for a list's columns.
///  - `tablet`  — 48rem to 64rem. A table fits; a 15.5rem sidebar docked
///                beside it does not.
///  - `desktop` — 64rem to 96rem. The app as it was drawn.
///  - `monitor` — 96rem up. Enough glass for a record to stand BESIDE the list
///                that produced it rather than over it, which is the only
///                thing this tier changes. See `<Sheet>`.
///
/// The three thresholds ARE Tailwind's `md`, `lg` and `2xl`, deliberately: a
/// component that writes `md:flex-row` in a class and a component that asks
/// this hook have to break at the same pixel, and two numbers in two
/// vocabularies that must agree is a bug with a fuse on it.
export type Layout = "phone" | "tablet" | "desktop" | "monitor"

/// Written in range syntax, which is what Tailwind v4 itself emits for
/// `max-md:` — `min-width: 48rem` and `max-width: 48rem` both match at exactly
/// 768px, and a shell that is briefly in two tiers at once flickers.
const PHONE = "(width < 48rem)"
const NARROW = "(width < 64rem)"
/// 1536px: the sidebar (248), a list wide enough to still be a list (~830),
/// and the 27.5rem record beside it with its gutters (472). Below this the
/// record has to cover something, so it goes back to covering the list.
const WIDE = "(width >= 96rem)"

/// A desk too narrow to stand the screens panel beside the page: an iPad held
/// sideways (1024–1194) is `desktop` to the shell, and a 14.5rem panel plus the
/// 4.25rem rail leaves a table ~930px; a record cannot then stand beside it
/// either. Under 80rem the panel floats over the page on demand instead of
/// being a column (owner, 2026-10-05).
const COMPACT = "(width < 80rem)"
/// A finger rather than a mouse.
const COARSE = "(pointer: coarse)"

export function useLayout(): Layout {
  const phone = useMedia(PHONE)
  const narrow = useMedia(NARROW)
  const wide = useMedia(WIDE)
  return phone ? "phone" : narrow ? "tablet" : wide ? "monitor" : "desktop"
}

/// Whether the screens panel floats rather than stands. See `COMPACT`.
export function useCompactDesk(): boolean {
  return useMedia(COMPACT)
}

/// Whether the layout is at least this wide.
///
/// So a caller that means "the sidebar is a column here" says that, rather
/// than listing the tiers where it happens to be true — the list that has to
/// be found and extended every time a tier is added, and is the reason adding
/// `monitor` would otherwise have quietly undocked the sidebar on the widest
/// screens in the building.
const ORDER: readonly Layout[] = ["phone", "tablet", "desktop", "monitor"]

export function atLeast(layout: Layout, tier: Layout): boolean {
  return ORDER.indexOf(layout) >= ORDER.indexOf(tier)
}

/// ── the page's own width ────────────────────────────────────────────────
///
/// The two panels that stand BESIDE a list — the filter panel and an open
/// record — ask how wide the PAGE is, not the window. They used to ask the
/// window, with the sidebar's 248px subtracted in the comment beside the
/// number; then the shell grew a second column and a ⌘B that folds one away,
/// and the window stopped saying anything reliable about the page. At 1440px
/// with both columns open the filter panel docked into 1100px and squeezed
/// the table it was filtering.
///
/// So the shell measures the column the page lives in (`app-shell.tsx`) and
/// publishes it here, and the thresholds are the page widths the panels need:
///
///  - filter panel: 1000px of page — a list of ~720 plus the 16rem panel and
///    its gutter (276). Lower than a list "wants", on the owner's ruling
///    (2026-09-24) that a laptop keeps its filter panel: at 1366 and 1440 with
///    both columns open the page is ~1040 and ~1110. A table narrower than its
///    columns relays or scrolls inside itself (`<DataTable>`); a panel that
///    vanishes into a button on every laptop was the worse trade.
///  - record: a list (~830) plus the 27.5rem record and its gutters (472) —
///    1300px.
const FILTERS_BESIDE = 1000
const RECORD_BESIDE = 1300

let pageWidth = typeof window === "undefined" ? 0 : window.innerWidth
const pageListeners = new Set<() => void>()

/// Called by the shell's ResizeObserver, and by nothing else.
export function publishPageWidth(width: number) {
  const next = Math.round(width)
  // The attribute before the early return: the first measurement can equal
  // the guess `pageWidth` started from, and the classes must still be told.
  document.documentElement.toggleAttribute(
    "data-dock",
    next >= FILTERS_BESIDE && !isWhiteLook()
  )
  if (next === pageWidth) return
  pageWidth = next
  for (const listener of pageListeners) listener()
}

function subscribePage(onChange: () => void) {
  pageListeners.add(onChange)
  return () => pageListeners.delete(onChange)
}

/// Whether the page is at least `px` wide. Subscribes to the answer, not the
/// width, so a screen re-renders when the answer flips rather than on every
/// pixel of a window being dragged.
function usePageAtLeast(px: number): boolean {
  return useSyncExternalStore(
    subscribePage,
    () => pageWidth >= px,
    () => false
  )
}

/// Whether there is room for the filter panel to stand BESIDE the list.
///
/// Asked in JavaScript rather than left to CSS, because a panel hidden by CSS
/// is still MOUNTED, and the sheets it carries are portalled out of it — so a
/// screen that put the narrow-width `<FilterPanel>` beside a display:none
/// `<DockedFilters>` had two components rendering a dialog under the same
/// `?filters=` key, and opening either opened both. One of the two exists at
/// a time now, which is the only way that stays true.
///
/// Never in the All white look (owner, 2026-10-12: "filternya make jg consistent ya
/// jangan filter kanan"): every list narrows from its toolbar, at the left —
/// the Filter button and its chips — at every width, and the figures the
/// column carried stand over the list as its KPI cards (`DockedFilters`).
export function usePanelDock(): boolean {
  return usePageAtLeast(FILTERS_BESIDE) && !isWhiteLook()
}

/// Whether an open record stands beside the list rather than over it.
export function useRecordBeside(): boolean {
  return usePageAtLeast(RECORD_BESIDE)
}

/// True when the pointer cannot hover: a finger, a stylus, a scanner's thumb —
/// not a mouse.
///
/// A different question from the width, and it has to stay one. An iPad in
/// landscape is 1180px and gets the desktop shell, and a 38px row is still the
/// wrong size for a thumb on it; a 1180px browser window on a laptop is the
/// same width and wants the dense one. **Width decides the layout, pointer
/// decides the size of what you press** — which is why this app does not need
/// a second set of screens for touch.
export function useCoarsePointer(): boolean {
  return useMedia(COARSE)
}

/// Whether a picker opens as a sheet from the bottom edge rather than as a
/// panel hanging off its field: a phone-width page. The width of the page
/// alone (owner, 2026-10-06) — a phone-sized window on a desk is a phone as far
/// as the page can tell, and a thumb on a phone always satisfies it. An iPad
/// has the room for the desk's panel. See `components/ui/picker-sheet.tsx`.
export function usePickerSheet(): boolean {
  return useLayout() === "phone"
}

/// One `MediaQueryList` per query, for the life of the tab.
///
/// `matchMedia` allocates a live object with a listener list; calling it inside
/// a snapshot read — which React does on every render — would build one per
/// render and leave the old ones to be collected. Cached here, and keyed by the
/// query text, the subscribe function also keeps its identity, which is the
/// thing `useSyncExternalStore` compares to decide whether to resubscribe.
const lists = new Map<string, MediaQueryList>()
const subscribers = new Map<string, (onChange: () => void) => () => void>()

function listFor(query: string): MediaQueryList {
  let list = lists.get(query)
  if (!list) {
    list = window.matchMedia(query)
    lists.set(query, list)
  }
  return list
}

function subscriberFor(query: string) {
  let subscribe = subscribers.get(query)
  if (!subscribe) {
    subscribe = (onChange: () => void) => {
      const list = listFor(query)
      list.addEventListener("change", onChange)
      return () => list.removeEventListener("change", onChange)
    }
    subscribers.set(query, subscribe)
  }
  return subscribe
}

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    subscriberFor(query),
    () => listFor(query).matches,
    () => guessFor(query)
  )
}

/// The server's answer, and the hydrating render's: the width the browser
/// last reported, or the usual one for the kind of device (`lib/device.ts`),
/// asked the same questions the window would be.
function guessFor(query: string): boolean {
  const { phone, width } = deviceHint()
  switch (query) {
    case PHONE:
      return width < 768
    case NARROW:
      return width < 1024
    case WIDE:
      return width >= 1536
    case COMPACT:
      return width < 1280
    case COARSE:
      return phone
    default:
      return false
  }
}
