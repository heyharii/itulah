import { Tabs } from "@base-ui/react/tabs"
import type { LucideIcon } from "lucide-react"
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react"

import { DockPortal, useDock } from "@/components/shell/dock"
import { DockChoice } from "@/components/shell/dock-tools"
import { useInDoor } from "@/components/ui/door-status"
import { Select } from "@/components/ui/field"
import { ToolbarLead } from "@/components/ui/segmented"
import { cn } from "@/lib/utils"

export { DoorHead } from "@/components/ui/door-status"

/// In-page sub-navigation: switch datasets *within* a screen.
///
/// Underlined rather than a segmented pill, because a segment reads as a filter
/// on one dataset and these are different datasets. Which tab is open is UI
/// state, so it belongs in the URL's search params on any screen where a
/// colleague might be sent a link — not in `useState` by default.
///
/// Base UI's tabs draw it, so the row is one tab stop and the arrow keys move
/// along it — a row of plain buttons with `role="tab"` claims that behaviour
/// to a screen reader without having it. There are no `Tabs.Panel`s: every
/// caller renders its own body below, and the root is `display: contents` so
/// the list is still the element the caller's `className` lands on and the
/// box its layout sees.
export interface SubTab {
  readonly value: string
  readonly label: React.ReactNode
  /// What the phone's context row says instead of `label`: one plain word.
  /// The row is a fixed width — three tabs and a button in 351px — so it
  /// carries no figures (owner, 2026-10-05); the page's own cards say them.
  readonly short?: string
  /// Drawn instead of the word in the context row, for the tab nobody opens
  /// twice a day ("Cancelled"): `short` is then its name for a screen reader
  /// and a tooltip.
  readonly icon?: LucideIcon
  /// What waits in this tab for somebody, as the sidebar says it: a red
  /// round count after the word, none at zero (owner, 2026-10-16). Where the
  /// tabs become a choice it is the figure after the word.
  readonly alert?: number
}

/// The word with its figure, for a choice that can only hold text.
function plain(tab: SubTab): React.ReactNode {
  return tab.alert && typeof tab.label === "string"
    ? `${tab.label} ${tab.alert}`
    : tab.label
}

export function SubTabs({
  tabs,
  value,
  onChange,
  className,
  dock,
}: {
  tabs: readonly SubTab[]
  value: string
  onChange: (value: string) => void
  className?: string
  /// On a phone, draw the tabs in the context row over the bottom bar
  /// (`components/shell/dock.tsx`) instead of at the top of the page, where a
  /// thumb has to leave its place to reach them. Everywhere else they stay
  /// where they were. Left out, a phone gets them as the dock's status button
  /// and sheet; `false` keeps them at the top there too.
  dock?: boolean
}) {
  const shell = useDock()
  /// On a screen that is a door's tab, the door already draws the one row of
  /// tabs (owner, 2026-10-16: "cuma satu baris tab"); the screen's own become a
  /// choice, first in its toolbar (`Toolbar`'s `lead`) — on a phone, first in
  /// the Filters sheet that toolbar becomes. Tabs standing on their own stay
  /// the dock's button on a phone, and a sheet's tabs are its own.
  const lead = useContext(ToolbarLead)
  const inDoor = useInDoor()
  /// Whether these tabs stand inside a sheet or a dialog, found once they are in
  /// the document: a sheet's tabs are its own and never belong in the dock.
  const probe = useRef<HTMLSpanElement>(null)
  const [inside, setInside] = useState<boolean | null>(null)
  useLayoutEffect(() => {
    setInside(probe.current?.closest('[role="dialog"]') != null)
  }, [])
  if (dock === true && shell?.phone) {
    return (
      <DockPortal slot="tabs">
        <DockTabs tabs={tabs} value={value} onChange={onChange} />
      </DockPortal>
    )
  }
  // On a phone every other row of tabs is the dock's status button and its
  // sheet, not a strip that scrolls sideways (owner, 2026-10-06). A screen that
  // hides its tabs on a phone (`max-md:hidden`) because it draws the status in
  // its own `DockTools` is left alone, or the dock would carry two.
  if (
    dock === undefined &&
    shell?.available === true &&
    inside === false &&
    !(className ?? "").includes("max-md:hidden")
  ) {
    return (
      <DockChoice
        value={value}
        onChange={onChange}
        options={tabs.map((tab) => ({
          value: tab.value,
          label: plain(tab),
          short:
            tab.short ??
            (typeof tab.label === "string" ? tab.label : undefined),
        }))}
      />
    )
  }
  // `!== true` rather than `=== false`: the server's render and the first
  // one here draw the choice too, so a page load never flashes the tabs.
  if (inDoor && (lead || (inside !== true && shell?.phone !== true))) {
    return (
      <>
        <span ref={probe} hidden aria-hidden />
        <div className={cn("w-56 shrink-0", className)}>
          <Select value={value} onChange={onChange} aria-label="Show">
            {tabs.map((tab) => (
              <option key={tab.value} value={tab.value}>
                {plain(tab)}
              </option>
            ))}
          </Select>
        </div>
      </>
    )
  }
  return (
    <>
      <span ref={probe} hidden aria-hidden />
      <TopTabs
        tabs={tabs}
        value={value}
        onChange={onChange}
        className={className}
      />
    </>
  )
}

function TopTabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: readonly SubTab[]
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <Tabs.Root
      value={value}
      onValueChange={(next, details) => {
        // Only a click or a key moves the tab. The fallbacks Base UI runs on
        // its own are for uncontrolled roots; this one is always controlled.
        if (details.reason === "none") onChange(next as string)
      }}
      className="contents"
    >
      <Tabs.List
        className={cn(
          // The rule under the tabs is an inset shadow, not a border the
          // tabs are pulled over with `-mb-px`: pulled over, they stood a
          // pixel outside a box that scrolls sideways, and a browser showing
          // scrollbars drew a vertical one beside the tabs for that pixel.
          // The active tab's own 2px border paints over the shadow.
          "sub-tabs relative mb-[1.125rem] flex [scrollbar-width:none] gap-0.5 overflow-x-auto shadow-[inset_0_-1px_0_var(--color-hairline)] [&::-webkit-scrollbar]:hidden",
          className
        )}
      >
        {tabs.map((tab) => (
          <Tabs.Tab
            key={tab.value}
            value={tab.value}
            className={cn(
              "sub-tab border-b-2 border-transparent px-3 pt-2 pb-2.5 text-[0.9375rem] font-medium whitespace-nowrap transition-colors duration-(--t-hover) ease-(--ease-out) pointer-coarse:min-h-11",
              tab.value === value ? "text-ink" : "text-body hover:text-ink"
            )}
          >
            {tab.label}
            {tab.alert !== undefined && tab.alert > 0 && (
              <span className="ml-1.5 inline-grid h-5 min-w-5 place-items-center rounded-full bg-bad-fg px-1.5 align-[1px] text-[0.9375rem] leading-none font-semibold text-white tabular-nums">
                {tab.alert > 99 ? "99+" : tab.alert}
              </span>
            )}
          </Tabs.Tab>
        ))}
        {/* One rule under the chosen tab, that MOVES to the next one rather
            than one tab's border going out as another's comes in (Emil:
            spatial consistency — the eye follows where the choice went). The
            rule spans the row and is clipped to the chosen tab, so only
            `clip-path` animates — no width, no layout. The strong ease-in-out
            because it travels on screen; 200ms, a tab being chosen tens of
            times a day. Reduced motion: it jumps. */}
        <Tabs.Indicator
          renderBeforeHydration
          className="sub-tab-indicator pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-ink transition-[clip-path] duration-(--t-panel) ease-(--ease-in-out) [clip-path:inset(0_var(--active-tab-right)_0_var(--active-tab-left))] motion-reduce:transition-none"
        />
      </Tabs.List>
    </Tabs.Root>
  )
}

/// The tabs as the context row draws them: a rounded track with the lit tab
/// raised in it. Equal shares of the width, never squeezed below their word —
/// past that the track scrolls, and keeps the lit tab in view.
///
/// Words only, no counts: three tabs and a button have to fit in 351px, and
/// "Active 6 · Completed 12 · Cancelled 1" beside "Add New" did not.
function DockTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly SubTab[]
  value: string
  onChange: (value: string) => void
}) {
  const list = useRef<HTMLDivElement>(null)
  // More tabs to the right than the track shows: a fade says so, where a
  // clipped word would only look like a mistake.
  const [more, setMore] = useState(false)
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ inline: "nearest", block: "nearest" })
  }, [value])
  useEffect(() => {
    const element = list.current
    if (element === null) return
    const measure = () =>
      setMore(
        element.scrollLeft + element.clientWidth < element.scrollWidth - 2
      )
    measure()
    element.addEventListener("scroll", measure, { passive: true })
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => {
      element.removeEventListener("scroll", measure)
      observer.disconnect()
    }
  }, [tabs.length])
  return (
    <Tabs.Root
      value={value}
      onValueChange={(next, details) => {
        if (details.reason === "none") onChange(next as string)
      }}
      className="min-w-0"
    >
      <Tabs.List
        ref={list}
        className={cn(
          // 44: a 40px tab in the track's 2px rim (D1).
          "flex h-11 min-w-0 [scrollbar-width:none] items-center gap-0.5 overflow-x-auto rounded-full bg-soft-2 p-0.5 [&::-webkit-scrollbar]:hidden",
          more &&
            "[mask-image:linear-gradient(to_right,black_calc(100%-1.75rem),transparent)]"
        )}
      >
        {tabs.map((tab) => {
          const on = tab.value === value
          const Icon = tab.icon
          return (
            <Tabs.Tab
              key={tab.value}
              value={tab.value}
              aria-label={Icon ? tab.short : undefined}
              title={Icon ? tab.short : undefined}
              className={cn(
                // `after` makes the track's rim part of the target: the whole
                // 44px is the tab.
                "relative flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full text-[0.9375rem] font-medium whitespace-nowrap transition-colors duration-150 after:absolute after:inset-x-0 after:-inset-y-0.5 after:content-['']",
                Icon ? "w-11" : "flex-1 px-3",
                on
                  ? "bg-canvas text-ink shadow-soft"
                  : "text-body active:bg-canvas/60"
              )}
            >
              {Icon ? <Icon className="size-4" /> : (tab.short ?? tab.label)}
            </Tabs.Tab>
          )
        })}
      </Tabs.List>
    </Tabs.Root>
  )
}
