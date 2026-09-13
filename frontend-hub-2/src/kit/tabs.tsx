import { cn } from "@/lib/cn"

/// The tab strip — one list, sliced by the one dimension that changes what a
/// row IS.
///
/// ## Why a tab and not another filter
///
/// A filter narrows a list you are already reading. A tab says which list you
/// are reading — and the test for which one you have is whether the COLUMNS
/// change. Here they do: only a bank ever receives a statement, so on cash the
/// Statement and Difference columns are two columns of em dashes, and on bank
/// they are the whole point. A dimension that changes the shape of the table
/// is not a filter, it is a tab.
///
/// It also removes a column. When every row on screen is a cashier float, a
/// column repeating "Cashier float" fourteen times is a column spent saying
/// what the tab above it already said.
///
/// ## The counts are not decoration
///
/// They come from the server, over everything the SEARCH matches — so a tab
/// that would be empty says so before it is pressed. Without them a tab strip
/// is five guesses.
export interface Tab {
  readonly value: string
  readonly label: string
  readonly count?: number
  /// The colour this slice carries in the data, drawn as a dot. Absent on the
  /// "everything" tab, which is not a slice and has no colour of its own.
  readonly tone?: string
}

export function Tabs({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: readonly Tab[]
  /// The empty string is the "everything" tab.
  value: string
  onChange: (value: string) => void
  label: string
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="border-line flex shrink-0 [scrollbar-width:none] items-center gap-1 overflow-x-auto border-b px-3 [&::-webkit-scrollbar]:hidden"
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
              // The live tab is marked by a rule under it rather than a fill:
              // a filled tab beside outlined tags is a second kind of chip,
              // and the eye has to work out which one means "you are here".
              "text-ctl -mb-px flex shrink-0 items-center gap-2 border-b-2 px-2.5 py-2 whitespace-nowrap transition-colors",
              on
                ? "border-ink text-ink font-semibold"
                : "text-ink-3 hover:text-ink border-transparent font-medium",
            )}
          >
            {tab.tone && (
              <span
                aria-hidden
                className="size-[7px] shrink-0 rounded-full"
                style={{ background: tab.tone }}
              />
            )}
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span
                className={cn("tabular-nums", on ? "text-ink-3" : "text-ink-4")}
              >
                {tab.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
