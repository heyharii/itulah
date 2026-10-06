import { X } from "lucide-react"

import { DockPortal } from "@/components/shell/dock"

/// The dock while rows are ticked (owner, 2026-10-06): the status, search and
/// filter step aside and the row says what is held and what to do with it —
///
///   [ ✕  3 selected ]  [ Make Allotment ]
///
/// the way a phone's own lists do in edit mode, in the same row as every other
/// list's tools rather than as a second bar floating over the last row. The ✕
/// puts the ticks down and brings the tools back.
export function DockSelection({
  summary,
  onClear,
  action,
}: {
  /// What is held: "3 selected".
  summary: string
  onClear: () => void
  action: { label: string; onClick: () => void }
}) {
  return (
    <>
      <DockPortal slot="search">
        <div className="dock-field flex h-9 min-w-0 items-center rounded-full bg-accent-bg pr-3 pl-1">
          <button
            type="button"
            aria-label="Clear selection"
            onClick={onClear}
            className="grid size-7 shrink-0 place-items-center rounded-full text-accent transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.92]"
          >
            <X className="size-4" />
          </button>
          <span className="ml-1 truncate text-[0.875rem] font-medium text-ink tabular-nums">
            {summary}
          </span>
        </div>
      </DockPortal>
      <DockPortal slot="action">
        <button
          type="button"
          onClick={action.onClick}
          className="dock-wide inline-flex h-9 w-full items-center justify-center rounded-full bg-cta px-4 text-[0.875rem] font-semibold text-cta-fg shadow-soft transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.96]"
        >
          <span className="truncate">{action.label}</span>
        </button>
      </DockPortal>
    </>
  )
}
