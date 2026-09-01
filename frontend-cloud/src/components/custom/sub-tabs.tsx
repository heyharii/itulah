import { cn } from "@/lib/utils"

/// Navigation *within* a screen, drawn as an underline on a hairline baseline.
///
/// This is the third and last of the three switches in the language, and the
/// three are not interchangeable. `Segmented` changes the dataset a screen is
/// looking at and stays inside a control; a `Chip` narrows a list; `SubTabs`
/// changes the screen's whole subject. Because it is the loudest of the three
/// it gets the quietest paint the system has: no fill, no pill, no colour —
/// the active tab is simply darker and sits on a 2px ink underline that
/// overlaps the baseline hairline by exactly the tab's own `-1px` bottom
/// margin, so the two lines read as one continuous rule with a notch in it.
///
/// Commercial currently says this with three `variant="outline"` buttons,
/// which paints navigation as a set of actions and gives four routes four
/// competing pills.
export function SubTabs<T extends string>({
  value,
  onChange,
  tabs,
  className,
}: {
  value: T
  onChange: (value: T) => void
  tabs: readonly { id: T; label: React.ReactNode }[]
  className?: string
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "mb-[1.125rem] flex gap-0.5 overflow-x-auto",
        "border-b border-[var(--os-hairline,#ececef)]",
        className,
      )}
    >
      {tabs.map((tab) => {
        const on = tab.id === value
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(tab.id)}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 pt-2 pb-2.5",
              "text-[0.8125rem] font-medium whitespace-nowrap transition-colors",
              on
                ? "border-b-[var(--os-ink,#1d1d1f)] text-[var(--os-ink,#1d1d1f)]"
                : "border-b-transparent text-[var(--os-body,#74747b)] hover:text-[var(--os-ink,#1d1d1f)]",
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
