import { cn } from "@/lib/utils"

/// The row of tabs a People screen switches its slices with — the hub's
/// `SubTabs` (`frontend-hub/src/components/ui/sub-tabs.tsx`), which is the
/// prototype's `chips()`: Today / Monthly sheet / Fixes & swaps, Claims /
/// Advances, Uniforms / BPJS.
///
/// An underline on a hairline rather than the segmented pill in
/// `segmented.tsx`: these are slices of one screen, not a setting, and the
/// hub draws them this way on every screen they appear.
///
/// Plain buttons rather than Base UI's tabs: a tab here swaps what is drawn
/// below and owns no panel, and the one thing worth keeping from a tab
/// primitive — arrow-key focus — is not how anybody moves on a counter tablet.
/// Under a finger each tab grows to the 44px floor.
export function PeopleTabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: readonly {
    readonly value: T
    readonly label: React.ReactNode
    /// A count beside the label — how many rows are waiting in that slice.
    readonly count?: number
  }[]
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "mb-[1.125rem] flex [scrollbar-width:none] gap-0.5 overflow-x-auto border-b border-hairline [&::-webkit-scrollbar]:hidden",
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
              "-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 pt-2 pb-2.5 text-[0.8125rem] font-medium whitespace-nowrap transition-colors pointer-coarse:min-h-11",
              on
                ? "border-ink text-ink"
                : "border-transparent text-body hover:text-ink",
            )}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className="rounded-full bg-soft-2 px-1.5 text-[0.6875rem] leading-[1.125rem] font-semibold text-body tabular-nums">
                {tab.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
