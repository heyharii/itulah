import { DockChoice } from "@/components/shell/dock-tools"
import { useLayout } from "@/lib/layout"
import { cn } from "@/lib/utils"

/// The slices of one People screen — Requests / Balances / Holidays, Today /
/// Monthly sheet / Fixes — the hub's `SubTabs`
/// (`frontend-hub/src/components/ui/sub-tabs.tsx`).
///
/// **On a phone these are the dock's status chip** (`DockChoice`): one button
/// over the bottom bar with the current slice, opening a sheet that lists them
/// with their counts — never a strip of tabs to swipe, and nothing at the top
/// of the page (owner, 2026-10-06). From 48rem up, an underline on a hairline:
/// these are slices of one screen, not a setting.
///
/// A screen that mounts this must not also mount a `DockTools` `status` — the
/// dock has one chip; the screen's own filters go behind the ⚙ (`views`,
/// `filter`).
///
/// Plain buttons rather than Base UI's tabs: a tab here swaps what is drawn
/// below and owns no panel. Under a finger each tab grows to the 44px floor.
export function PeopleTabs<T extends string>({
  tabs,
  value,
  onChange,
  title = "Show",
  className,
  plainCount = false,
  zeros = false,
}: {
  tabs: readonly {
    readonly value: T
    readonly label: string
    /// A count beside the label — how many rows are waiting in that slice.
    readonly count?: number
  }[]
  value: T
  onChange: (value: T) => void
  /// The sheet's title on a phone: what is being chosen.
  title?: string
  className?: string
  /// The count as plain grey text after the word, the hub's "To receive 2" —
  /// no pill behind the figure.
  plainCount?: boolean
  /// Say "0" too, where a tab that holds nothing is still news ("Found 0"):
  /// by default a count shows only while there is something in it.
  zeros?: boolean
}) {
  const phone = useLayout() === "phone"
  if (phone) {
    return (
      <DockChoice
        title={title}
        value={value}
        onChange={(next) => onChange(next as T)}
        options={tabs.map((tab) => ({
          value: tab.value,
          short: tab.label,
          label: (
            <span className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate">{tab.label}</span>
              {tab.count !== undefined && tab.count > 0 && (
                <span className="text-body tabular-nums">{tab.count}</span>
              )}
            </span>
          ),
        }))}
      />
    )
  }
  return (
    <div
      role="tablist"
      className={cn(
        "sub-tabs mb-[1.125rem] flex flex-wrap gap-0.5 border-b border-hairline",
        className,
      )}
    >
      {tabs.map((tab) => {
        const on = tab.value === value
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(tab.value)}
            className={cn(
              "sub-tab -mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 pt-2 pb-2.5 text-[0.9375rem] font-medium whitespace-nowrap transition-colors pointer-coarse:min-h-11",
              on
                ? "border-ink text-ink"
                : "border-transparent text-body hover:text-ink",
            )}
          >
            {tab.label}
            {tab.count !== undefined && (tab.count > 0 || zeros) && plainCount && (
              <span className="text-mute tabular-nums">{tab.count}</span>
            )}
            {tab.count !== undefined && (tab.count > 0 || zeros) && !plainCount && (
              <span className="rounded-full bg-soft-2 px-1.5 text-[0.875rem] leading-[1.125rem] font-semibold text-body tabular-nums">
                {tab.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
