import { cn } from "@/lib/utils"

/// In-page sub-navigation: switch datasets *within* a screen.
///
/// Underlined rather than a segmented pill, because a segment reads as a filter
/// on one dataset and these are different datasets. Which tab is open is UI
/// state, so it belongs in the URL's search params on any screen where a
/// colleague might be sent a link — not in `useState` by default.
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
    <div
      role="tablist"
      className={cn(
        "mb-[1.125rem] flex gap-0.5 overflow-x-auto border-b border-hairline",
        className
      )}
    >
      {tabs.map((tab) => (
        <button
          key={tab.value}
          role="tab"
          type="button"
          aria-selected={tab.value === value}
          onClick={() => onChange(tab.value)}
          className={cn(
            "-mb-px border-b-2 px-3 pt-2 pb-2.5 text-[0.8125rem] font-medium whitespace-nowrap transition-colors",
            tab.value === value
              ? "border-ink text-ink"
              : "border-transparent text-body hover:text-ink"
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
