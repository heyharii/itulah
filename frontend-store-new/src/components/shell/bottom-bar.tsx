import { Link, useRouterState } from "@tanstack/react-router"
import { Ellipsis } from "lucide-react"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
} from "react"

import { useDock, useDockRow } from "@/components/shell/dock"
import { moduleForPath, phoneTabs } from "@/lib/navigation"
import { cn } from "@/lib/utils"

/// The phone's navigation: the hub's bottom bar
/// (`frontend-hub/src/components/shell/bottom-bar.tsx`) — a hairline over a
/// translucent strip, icon over word, the lit tab in the accent with a wash
/// and a bar on top — holding the four modules a shift reaches for most. The
/// fifth tab, More, opens the navigation drawer, which is where the rest of
/// the shop's menu lives.
///
/// Over it, the dock: a floating card that carries what the screen under it is
/// about — its status, search, and the one thing it makes (`dock.tsx`). Both
/// stand in one fixed stack at the thumb's edge.
///
/// No motion on a tab change. Tabs are pressed dozens of times a session, and
/// motion there reads as lag by the tenth (Emil Kowalski's frequency rule): the
/// lit tab changes colour, and the press itself gives (`active:scale`).
///
/// Out of the way while the keyboard is up — five tabs riding on a keyboard
/// take a fifth of what is left of the glass, over the field being typed into.
export function BottomBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const current = moduleForPath(pathname).id
  const typing = useTyping()
  const onTab = phoneTabs.some((module) => module.id === current)

  const dock = useDock()
  const attach = dock?.attach
  const tabsRef = useCallback(
    (element: HTMLDivElement | null) => attach?.("tabs", element),
    [attach],
  )
  const actionRef = useCallback(
    (element: HTMLDivElement | null) => attach?.("action", element),
    [attach],
  )
  const searchRef = useCallback(
    (element: HTMLDivElement | null) => attach?.("search", element),
    [attach],
  )
  const row = useDockRow()

  return (
    <div
      // The drawer and the bar under it, one fixed stack. A fade, not a
      // vanish: the sheet that is rising over it takes 450ms, and a dock that
      // pops out of existence under it reads as a glitch.
      inert={typing ? true : undefined}
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 transition-opacity duration-150 ease-(--ease-out) motion-reduce:transition-none md:hidden",
        typing && "pointer-events-none opacity-0",
      )}
    >
      <DockDrawer
        row={row}
        searchRef={searchRef}
        tabsRef={tabsRef}
        actionRef={actionRef}
      />
      <nav
        aria-label="Main"
        hidden={typing}
        // A material, not a slab: translucent white over a strong blur, so the
        // list scrolling under it stays faintly present, and a hairline of
        // light at its top edge rather than a grey rule.
        className="border-t border-black/[0.06] bg-canvas/80 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-xl backdrop-saturate-150"
      >
        <ul className="grid h-[3.25rem] grid-cols-5">
          {phoneTabs.map((module) => {
            const on = module.id === current
            return (
              <li key={module.id}>
                <Link
                  to={module.home as never}
                  aria-current={on ? "page" : undefined}
                  className={tabClass(on)}
                >
                  <TabFace on={on} icon={module.icon} label={module.label} />
                </Link>
              </li>
            )
          })}
          <li>
            <button
              type="button"
              onClick={onOpenMenu}
              aria-haspopup="dialog"
              aria-current={onTab ? undefined : "page"}
              className={cn(tabClass(!onTab), "w-full")}
            >
              <TabFace on={!onTab} icon={Ellipsis} label="More" />
            </button>
          </li>
        </ul>
      </nav>
    </div>
  )
}

/// The drawer over the bar: a floating card that holds what the screen is
/// about — its status, its search, its one action — and changes its own height
/// when the content changes, the way a phone's own drawers do.
///
/// The card's height is MEASURED, not guessed: the inside is laid out at its
/// natural size, a `ResizeObserver` reports it, and the card's `height` follows
/// with a transition. Changing what is in it then moves the card's edge
/// smoothly rather than snapping, which is the whole effect.
function DockDrawer({
  row,
  searchRef,
  tabsRef,
  actionRef,
}: {
  row: boolean
  searchRef: (element: HTMLDivElement | null) => void
  tabsRef: (element: HTMLDivElement | null) => void
  actionRef: (element: HTMLDivElement | null) => void
}) {
  const inside = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | undefined>(undefined)
  useLayoutEffect(() => {
    const element = inside.current
    if (element === null) return
    // The card's own 1px border is outside what the inside measures.
    const measure = () => setHeight(element.offsetHeight + 2)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return (
    <div className={cn("px-2 pb-2", row ? "block" : "hidden")}>
      <div
        style={{ height }}
        className="group/dock overflow-hidden rounded-[1.75rem] border border-black/[0.06] bg-canvas/95 shadow-float backdrop-blur-xl transition-[height] duration-300 ease-(--ease-drawer) motion-reduce:transition-none"
      >
        <div ref={inside} className="flex items-center gap-1.5 p-2">
          <div
            ref={tabsRef}
            className="flex min-w-0 items-center gap-1.5 empty:hidden has-[[role=tablist]]:flex-1"
          />
          <div
            ref={searchRef}
            className="shrink-0 empty:hidden has-[.dock-field]:min-w-0 has-[.dock-field]:flex-1"
          />
          <div
            ref={actionRef}
            className="shrink-0 empty:hidden has-[.dock-wide]:flex-1"
          />
        </div>
      </div>
    </div>
  )
}

const tabClass = (on: boolean) =>
  cn(
    "group relative flex h-full w-full flex-col items-center justify-center gap-0.5 text-[0.875rem] font-medium tracking-[0.005em] transition-colors",
    on ? "text-accent" : "text-mute",
  )

/// What a tab looks like: the lit one has the wash, the bar on top and a filled
/// icon. 14px labels — nothing in this app is smaller.
function TabFace({
  on,
  icon: Icon,
  label,
}: {
  on: boolean
  icon: ComponentType<{ className?: string }>
  label: string
}) {
  return (
    <>
      {on && (
        <>
          {/* The wash: the accent at the top edge, gone by the middle of the
              tab. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-b from-accent/15 to-transparent"
          />
          <span
            aria-hidden
            className="absolute top-0 h-[3px] w-10 rounded-b-full bg-accent"
          />
        </>
      )}
      <span className="relative transition-[scale] duration-(--t-press) ease-(--ease-out) group-active:scale-[0.9]">
        <Icon
          className={cn(
            "size-[1.375rem]",
            on ? "fill-accent stroke-accent" : "stroke-[1.7]",
          )}
        />
      </span>
      <span className="relative max-w-full truncate px-1">{label}</span>
    </>
  )
}

/// Whether a text field on the page has the keyboard. Focus rather than the
/// viewport's height: iOS does not resize the layout for its keyboard, and the
/// visual viewport shrinks for the URL bar as well as the keyboard, so a height
/// rule guesses where focus knows.
///
/// A scan field holds focus for a hardware scanner, not for a thumb — it is
/// focused on arrival, and treating that as typing would take the navigation
/// off every screen with a scanner on it.
function useTyping(): boolean {
  const [typing, setTyping] = useState(false)
  useEffect(() => {
    const editable = (node: EventTarget | null) =>
      node instanceof HTMLElement &&
      node.dataset.scan === undefined &&
      (node.isContentEditable ||
        node instanceof HTMLTextAreaElement ||
        (node instanceof HTMLInputElement &&
          ![
            "checkbox",
            "radio",
            "button",
            "submit",
            "range",
            "file",
            "color",
          ].includes(node.type)))
    const onIn = (event: FocusEvent) => setTyping(editable(event.target))
    const onOut = () =>
      // The next field may take focus in the same tick; read where focus
      // landed rather than assuming it left.
      requestAnimationFrame(() => setTyping(editable(document.activeElement)))
    document.addEventListener("focusin", onIn)
    document.addEventListener("focusout", onOut)
    return () => {
      document.removeEventListener("focusin", onIn)
      document.removeEventListener("focusout", onOut)
    }
  }, [])
  return typing
}
