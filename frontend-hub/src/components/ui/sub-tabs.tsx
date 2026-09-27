import { Tabs } from "@base-ui/react/tabs"

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
export function SubTabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: readonly { readonly value: string; readonly label: React.ReactNode }[]
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
          "mb-[1.125rem] flex gap-0.5 overflow-x-auto border-b border-hairline",
          className
        )}
      >
        {tabs.map((tab) => (
          <Tabs.Tab
            key={tab.value}
            value={tab.value}
            className={cn(
              "-mb-px border-b-2 px-3 pt-2 pb-2.5 text-[0.875rem] font-medium whitespace-nowrap transition-colors",
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
