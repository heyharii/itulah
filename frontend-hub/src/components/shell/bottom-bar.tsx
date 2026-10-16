import { Link, useRouter, useRouterState } from "@tanstack/react-router"
import {
  Ellipsis,
  House,
  LayoutGrid,
  type LucideIcon,
} from "lucide-react"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"

import { AppSheet } from "@/components/shell/app-sheet"
import { useDock, useDockRow } from "@/components/shell/dock"
import type { AppTile } from "@/lib/apps"
import { primaryItems, type AppModule, type NavItem } from "@/lib/navigation"

import { cn } from "@/lib/utils"

/// The phone's navigation: tabs at the thumb's edge.
///
/// Under 48rem the rail and the sidebar were one drawer behind a hamburger in
/// the top-left corner — the one place on a phone a thumb does not reach —
/// and the chat, discussions and bell were three icons squeezed into the top
/// bar beside it. The owner's shape (2026-09-25), a super-app's: Apps (the
/// launcher, `/apps`), Messages (chat and discussions), Notifications, and
/// Profile. Messages, Notifications and Profile are the account orb's since
/// 2026-10-16 (`account-orb.tsx`, the same on every device), which rests just
/// above this bar; the bar keeps the navigation — Home, and inside a
/// department its screens. From 48rem up nothing here is drawn; the rail is
/// the navigation.
///
/// No motion on a tab change. Tabs are pressed dozens of times a session, and
/// motion there reads as lag by the tenth (Emil Kowalski's frequency rule):
/// the lit tab changes colour, and the press itself gives (`active:scale`).
const TABS = [
  {
    to: "/apps",
    label: "Home",
    icon: LayoutGrid,
    // Lit only on the launcher itself (owner, 2026-10-05): inside an app none
    // of the tabs is "where you are", and a lit Home there read as if the
    // screen were Home.
    owns: (path: string) => within(path, "/apps"),
  },
] as const

function within(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`)
}

export function BottomBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const typing = useTyping()

  const dock = useDock()
  const attach = dock?.attach
  const tabsRef = useCallback(
    (element: HTMLDivElement | null) => attach?.("tabs", element),
    [attach]
  )
  const actionRef = useCallback(
    (element: HTMLDivElement | null) => attach?.("action", element),
    [attach]
  )
  const searchRef = useCallback(
    (element: HTMLDivElement | null) => attach?.("search", element),
    [attach]
  )
  const row = useDockRow()
  const view = dock?.view ?? "rest"
  const searching = view !== "rest"
  const lift = useKeyboardLift(view === "search")

  return (
    <div
      // The drawer and the bar under it, one fixed stack. Out of the way while
      // the keyboard is up — four tabs riding on a keyboard take a fifth of what
      // is left of the glass, over the field being typed into — except while
      // the drawer is itself the search field, when it stays and is lifted
      // clear of the keyboard.
      inert={typing && !searching ? true : undefined}
      // The account orb's floor: it rests above this stack, dock and all.
      data-shell-bar="bottom"
      style={searching && lift > 0 ? { bottom: lift } : undefined}
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 transition-opacity duration-150 ease-(--ease-out) motion-reduce:transition-none md:hidden",
        // A fade, not a vanish: the sheet that is rising over it takes 450ms,
        // and a dock that pops out of existence under it reads as a glitch.
        typing && !searching && "pointer-events-none opacity-0"
      )}
    >
      <DockDrawer
        row={row}
        searching={searching}
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
        {dock?.department != null ? (
          <DepartmentTabs
            key={dock.department.id}
            tile={dock.department}
            pathname={pathname}
          />
        ) : (
          // Chat and Activity were tabs here, each with its dot; they are
          // tiles of the account orb now, whose one badge counts both (owner,
          // 2026-10-16: `account-orb.tsx`). The House button beside Home went
          // with them — both led to the launcher, and with nothing between
          // them the bar read "Home Home".
          <ul className="grid h-[3.25rem] grid-cols-1">
            {TABS.map((tab) => {
              const on = tab.owns(pathname)
              return (
                <li key={tab.to}>
                  <Link
                    to={tab.to as string}
                    aria-current={on ? "page" : undefined}
                    aria-label={tab.label}
                    className={tabClass(on)}
                  >
                    <TabFace
                      on={on}
                      icon={tab.icon}
                      label={tab.label}
                      dot={false}
                    />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </nav>
    </div>
  )
}

/// The drawer over the bar (owner, 2026-10-05): a floating card that holds what
/// the screen is about — its tabs, its one action, its search — and changes
/// its own height when the content changes, the way a phone's own drawers do.
///
/// The card's height is MEASURED, not guessed: the inside is laid out at its
/// natural size, a `ResizeObserver` reports it, and the card's `height`
/// follows with a transition. Changing a view then moves the card's edge
/// smoothly rather than snapping it, which is the whole effect; the content
/// swaps underneath it and fades in (`dock-search.tsx`).
function DockDrawer({
  row,
  searching,
  searchRef,
  tabsRef,
  actionRef,
}: {
  row: boolean
  searching: boolean
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
        data-searching={searching || undefined}
        style={{ height }}
        className="group/dock overflow-hidden rounded-[1.75rem] border border-black/[0.06] bg-canvas/95 shadow-float backdrop-blur-xl transition-[height] duration-300 ease-(--ease-drawer) motion-reduce:transition-none"
      >
        {/* 44px, the least a thumb is asked to hit (owner, 2026-10-06, D1).
            The controls in the slots are drawn at 44; the floor on each slot's
            children is the net under any a screen draws by hand at 36, so a
            chip nobody remembered cannot be the one that is missed. */}
        <div ref={inside} className="flex items-center gap-1.5 p-2">
          <div
            ref={tabsRef}
            className="flex min-w-0 items-center gap-1.5 group-data-[searching]/dock:hidden empty:hidden has-[[role=tablist]]:flex-1 [&>*]:min-h-11 [&>*]:min-w-11"
          />
          <div
            ref={searchRef}
            className="shrink-0 group-data-[searching]/dock:flex-1 empty:hidden has-[.dock-field]:min-w-0 has-[.dock-field]:flex-1 [&>*]:min-h-11 [&>*]:min-w-11"
          />
          <div
            ref={actionRef}
            // A row of its own children: the reload (`RefreshStamp`) stands
            // beside the screen's one action, and a wide action takes what
            // the reload leaves.
            className="flex shrink-0 items-center gap-1.5 group-data-[searching]/dock:hidden empty:hidden has-[.dock-wide]:flex-1 [&>*]:min-h-11 [&>*]:min-w-11 [&>.dock-wide]:w-auto [&>.dock-wide]:min-w-0 [&>.dock-wide]:flex-1"
          />
        </div>
      </div>
    </div>
  )
}

const tabClass = (on: boolean) =>
  cn(
    "group relative flex h-full w-full flex-col items-center justify-center gap-0.5 text-[0.9375rem] leading-[1.2] font-medium tracking-[0.005em] transition-colors",
    on ? "text-accent" : "text-mute"
  )

/// What a tab looks like: the lit one has the wash, the bar on top and a
/// filled icon; a dot, never a count, says something is waiting.
function TabFace({
  on,
  icon: Icon,
  label,
  dot,
}: {
  on: boolean
  icon: LucideIcon
  label: string
  dot: boolean
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
            on ? "fill-accent stroke-accent" : "stroke-[1.7]"
          )}
        />
        {dot && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-1 size-2.5 rounded-full bg-accent ring-2 ring-canvas"
          />
        )}
      </span>
      {/* 14px, the floor, and a label that is longer than its fifth of the
          bar asks the others for the room instead of being cut: see the
          columns of `DepartmentTabs`. */}
      <span className="relative max-w-[6rem] truncate px-0.5">{label}</span>
    </>
  )
}

/// Inside a department the bar is the department's (owner, 2026-10-05): Home,
/// then its screens, the one on show lit. Four screens fit beside Home; a
/// department with more keeps three and a More that opens the full list. Chat
/// and Activity are the account orb's (owner, 2026-10-16).
function DepartmentTabs({
  tile,
  pathname,
}: {
  tile: AppTile
  pathname: string
}) {
  const audiences = useAudiences(tile.modules)
  const [more, setMore] = useState(false)
  const seen = new Set<string>()
  const items = tile.modules.flatMap((module, index) =>
    primaryItems(module, audiences[index])
      .filter((item) => !item.soon)
      // Two modules of one department can each open on an "Overview": the
      // second is named for its module, so no two tabs read alike.
      .map((item) => {
        const name = item.short ?? item.label
        const dup = seen.has(name)
        seen.add(name)
        return dup ? { ...item, short: module.label } : item
      })
  )
  const shown = items.length > 4 ? items.slice(0, 3) : items
  // The row that IS this screen first; then a door that claims it
  // (`alsoLights`, its tabs' other screens — HR's People door sits at the
  // module's base, so by prefix alone it would light on every HR screen);
  // then the longest path that holds this one, so a screen under another's
  // path lights its own row only. The sidebar reads them the same way.
  const claim = (item: (typeof items)[number]) =>
    Math.max(
      -1,
      ...(item.alsoLights ?? [])
        .filter((path) => within(pathname, path))
        .map((path) => path.length)
    )
  const current =
    items.find((item) => item.path === pathname) ??
    items
      .filter((item) => claim(item) >= 0)
      .sort((left, right) => claim(right) - claim(left))[0] ??
    items
      .filter((item) => within(pathname, item.path))
      .sort((left, right) => right.path.length - left.path.length)[0]
  const slots = 1 + shown.length + (items.length > 4 ? 1 : 0)
  return (
    <>
      <ul
        className="grid h-[3.25rem]"
        // Equal fifths, except that a word wider than its fifth takes what it
        // needs from the rest (a 14px label does not fit 75px at 375 wide:
        // "Exceptions", "Promotions", "New Articles"). The label's own cap
        // (6rem) keeps the sum inside the bar.
        style={{
          gridTemplateColumns: `repeat(${slots}, minmax(min-content, 1fr))`,
        }}
      >
        <li>
          <HomeButton fallback="/apps" />
        </li>
        {shown.map((item) => (
          <li key={item.path}>
            <ItemTab item={item} on={item === current} />
          </li>
        ))}
        {items.length > 4 && (
          <li>
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => setMore(true)}
              className={tabClass(
                current !== undefined && !shown.includes(current)
              )}
            >
              <TabFace
                on={current !== undefined && !shown.includes(current)}
                icon={Ellipsis}
                label="More"
                dot={false}
              />
            </button>
          </li>
        )}
      </ul>
      <AppSheet tile={tile} open={more} onOpenChange={setMore} />
    </>
  )
}

function ItemTab({ item, on }: { item: NavItem; on: boolean }) {
  const waiting = (item.useCount ?? noCount)()
  const dot = typeof waiting === "number" && waiting > 0
  return (
    <Link
      to={item.path as string}
      // The router's own "active" is a prefix match, so a door at the
      // module's base (HR's People, `/people`) was current on every HR
      // screen beside the tab `on` names.
      activeOptions={{ exact: true }}
      aria-current={on ? "page" : undefined}
      aria-label={dot ? `${item.label}, something waiting` : item.label}
      className={tabClass(on)}
    >
      <TabFace
        on={on}
        icon={item.icon}
        label={item.short ?? item.label}
        dot={dot}
      />
    </Link>
  )
}

function noCount(): null {
  return null
}
function noAudience(): null {
  return null
}

/// One audience per module of the department. The modules are fixed for a
/// department and the bar is keyed by it, so the hooks run in the same order
/// every render.
function useAudiences(modules: readonly AppModule[]) {
  return modules.map((module) => (module.useAudience ?? noAudience)())
}

/// How far a phone's keyboard stands above the bottom of the layout, while
/// something at the bottom is being typed into. iOS does not resize the page
/// for its keyboard; it slides the visual viewport over it, so a bar fixed to
/// the bottom is left behind the keyboard unless it is lifted by the gap.
function useKeyboardLift(active: boolean): number {
  const [lift, setLift] = useState(0)
  useEffect(() => {
    const viewport = window.visualViewport
    if (!active || viewport === null) return
    const update = () =>
      setLift(
        Math.max(
          0,
          Math.round(window.innerHeight - viewport.height - viewport.offsetTop)
        )
      )
    update()
    viewport.addEventListener("resize", update)
    viewport.addEventListener("scroll", update)
    return () => {
      viewport.removeEventListener("resize", update)
      viewport.removeEventListener("scroll", update)
    }
  }, [active])
  return lift
}

/// Home, in the thumb's row (owner, 2026-10-05; Home not Back, 2026-10-06).
/// Moving between a department's screens was a menu in the header, the part
/// of a phone's screen a thumb reaches last; the way out of a department is
/// a button in the bar, and it leads to the launcher every time — which a
/// home-screen app (no browser bar, no back arrow) otherwise has no button
/// for at all.
function HomeButton({ fallback = "/apps" }: { fallback?: string }) {
  const router = useRouter()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  return (
    <button
      type="button"
      // Always Home (owner, 2026-10-06): a button that says Back and goes to
      // wherever the last tap came from is a different place every time. It
      // is greyed only on Home itself, where there is nowhere to go.
      disabled={within(pathname, fallback)}
      onClick={() => void router.navigate({ to: fallback as never })}
      className="group relative flex h-full w-full flex-col items-center justify-center gap-0.5 text-[0.9375rem] leading-[1.2] font-medium tracking-[0.005em] text-mute transition-opacity disabled:opacity-40"
    >
      <span className="transition-[scale] duration-(--t-press) ease-(--ease-out) group-active:scale-[0.9]">
        <House className="size-[1.375rem] stroke-[1.7]" />
      </span>
      Home
    </button>
  )
}

/// Whether a text field on the page has the keyboard. Focus rather than the
/// viewport's height: iOS does not resize the layout for its keyboard, and
/// the visual viewport shrinks for the URL bar as well as the keyboard, so a
/// height rule guesses where focus knows.
function useTyping(): boolean {
  const [typing, setTyping] = useState(false)
  useEffect(() => {
    const editable = (node: EventTarget | null) =>
      node instanceof HTMLElement &&
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
