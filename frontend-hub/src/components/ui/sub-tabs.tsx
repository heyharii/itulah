import { Tabs } from "@base-ui/react/tabs"
import type { LucideIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { DockPortal, useDock } from "@/components/shell/dock"
import { cn } from "@/lib/utils"

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
}

export function SubTabs({
  tabs,
  value,
  onChange,
  className,
  dock = false,
}: {
  tabs: readonly SubTab[]
  value: string
  onChange: (value: string) => void
  className?: string
  /// On a phone, draw the tabs in the context row over the bottom bar
  /// (`components/shell/dock.tsx`) instead of at the top of the page, where a
  /// thumb has to leave its place to reach them. Everywhere else they stay
  /// where they were.
  dock?: boolean
}) {
  const shell = useDock()
  if (dock && shell?.phone) {
    return (
      <DockPortal slot="tabs">
        <DockTabs tabs={tabs} value={value} onChange={onChange} />
      </DockPortal>
    )
  }
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
          "mb-[1.125rem] flex [scrollbar-width:none] gap-0.5 overflow-x-auto shadow-[inset_0_-1px_0_var(--color-hairline)] [&::-webkit-scrollbar]:hidden",
          className
        )}
      >
        {tabs.map((tab) => (
          <Tabs.Tab
            key={tab.value}
            value={tab.value}
            className={cn(
              "border-b-2 px-3 pt-2 pb-2.5 text-[0.875rem] font-medium whitespace-nowrap transition-colors",
              tab.value === value
                ? "border-ink text-ink"
                : "border-transparent text-body hover:text-ink"
            )}
          >
            {tab.label}
          </Tabs.Tab>
        ))}
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
          "flex h-9 min-w-0 [scrollbar-width:none] items-center gap-0.5 overflow-x-auto rounded-full bg-soft-2 p-0.5 [&::-webkit-scrollbar]:hidden",
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
                "flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full text-[0.875rem] font-medium whitespace-nowrap transition-colors duration-150",
                Icon ? "w-10" : "flex-1 px-2.5",
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
