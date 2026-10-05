import {
  ArrowDownUp,
  Check,
  ChevronDown,
  ChevronRight,
  ListFilter,
  Search,
  X,
} from "lucide-react"
import { useRef } from "react"
import { flushSync } from "react-dom"

import { DockPortal, useDock } from "@/components/shell/dock"
import { count } from "@/lib/format"
import { cn } from "@/lib/utils"

/// What a list can be narrowed to by its status ("Active", "Completed"): one
/// of a few, with the figure each holds.
export interface DockStatus {
  readonly value: string
  readonly options: readonly {
    readonly value: string
    readonly label: string
    readonly count?: number
  }[]
  readonly onChange: (value: string) => void
}

/// A list's status, search, filter and sort, in the drawer over the bottom bar
/// (owner, 2026-10-05).
///
/// ## Status is a place, not a filter
///
/// Active, Completed and Cancelled are three different lists, so the row says
/// which one this is and always says it: one button with the current word and
/// a chevron, which opens the drawer into the list of statuses — each with its
/// count, which three tabs in 343px had no room for. One button instead of
/// three tabs is also what leaves room for the search to be a field you can
/// see, and not an icon you have to know about.
///
/// ## The row
///
///   [ Active ▾ ]  [ 🔍 Search orders…  ⚙ ]  [ + ]
///
/// The field goes straight to typing (the drawer grows, the keyboard comes up,
/// the drawer is lifted clear of it). The ⚙ at its end opens a short list —
/// Filter, Sort — whose rows open the screen's own sheet, which already has
/// them in full.
///
/// A screen with no status keeps the older row: a round button that opens the
/// list (or goes to the field, if search is all it has).
export function DockTools({
  search,
  filter,
  sort,
  status,
}: {
  search: {
    value: string
    onChange: (value: string) => void
    /// What is searched: "Search Orders".
    label: string
  }
  filter?: { count: number; onOpen: () => void }
  sort?: { label: string; onOpen: () => void }
  status?: DockStatus
}) {
  const dock = useDock()
  const view = dock?.view ?? "rest"
  const setView = dock?.setView
  const input = useRef<HTMLInputElement>(null)
  const several = filter !== undefined || sort !== undefined
  const active = search.value !== "" || (filter?.count ?? 0) > 0
  const current = status?.options.find((one) => one.value === status.value)

  const toSearch = () => {
    // Committed before the focus, inside the press: iOS only raises the
    // keyboard for a focus that happens in the gesture that asked for it.
    flushSync(() => setView?.("search"))
    input.current?.focus()
  }
  const closeSearch = () => {
    input.current?.blur()
    setView?.("rest")
  }

  // Motion for a view arriving: a short rise and fade with a little blur to
  // hide the seam of one view being swapped for another, while the drawer's
  // own edge moves.
  const arrive =
    "transition-[opacity,translate,filter] duration-200 ease-(--ease-out) starting:translate-y-1 starting:opacity-0 starting:blur-[3px] motion-reduce:transition-none"

  const heading = (title: string) => (
    <div className="flex items-center justify-between pr-0.5 pl-3">
      <span className="text-[1rem] font-semibold text-ink">{title}</span>
      <button
        type="button"
        aria-label="Close"
        onClick={() => setView?.("rest")}
        className="grid size-9 place-items-center rounded-full bg-soft-2 text-body active:scale-[0.94]"
      >
        <X className="size-4" />
      </button>
    </div>
  )

  return (
    <>
      {status !== undefined && (
        <DockPortal slot="tabs">
          <button
            type="button"
            onClick={() => setView?.("status")}
            aria-haspopup="dialog"
            aria-label={`Status: ${current?.label ?? ""}`}
            className="inline-flex h-9 max-w-full items-center gap-1 rounded-full bg-soft-2 pr-2.5 pl-3.5 text-[0.875rem] font-medium text-ink transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.97]"
          >
            <span className="truncate">{current?.label}</span>
            <ChevronDown className="size-4 shrink-0 text-line-ico" />
          </button>
        </DockPortal>
      )}

      <DockPortal slot="search">
        {view === "search" ? (
          <div className={cn("flex items-center gap-2", arrive)}>
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-mute" />
              <input
                ref={input}
                type="search"
                enterKeyHint="search"
                // A PO number or a supplier's code is searched as typed: no
                // capital for the first letter, no correction into a word.
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={search.value}
                onChange={(event) => search.onChange(event.target.value)}
                // The keyboard went down — by Done, by a swipe, by tapping the
                // list — so the field has nothing left to be for: the drawer
                // shuts. Waiting for a tap on Done does not do it on a phone,
                // where the field blurring moves the bar and the tap lands
                // where the button was.
                onBlur={() => setView?.("rest")}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === "Escape")
                    closeSearch()
                }}
                aria-label={search.label}
                placeholder={search.label}
                // 16px: iOS zooms the page into any field set smaller, and a
                // page that has zoomed itself is a worse search than none.
                className="h-10 w-full rounded-full bg-soft-2 pr-9 pl-9 text-base text-ink outline-none placeholder:text-mute [&::-webkit-search-cancel-button]:hidden"
              />
              {search.value !== "" && (
                <button
                  type="button"
                  aria-label="Clear search"
                  // Keeps the focus: a clear that blurred the field would drop
                  // the keyboard just when somebody is about to type again.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    search.onChange("")
                    input.current?.focus()
                  }}
                  className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-full bg-mute/20 text-body"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <button
              type="button"
              // Pressed without taking the focus off the field: the press that
              // blurred it first would move the bar from under the finger
              // before the tap could land.
              onPointerDown={(event) => event.preventDefault()}
              onMouseDown={(event) => event.preventDefault()}
              onClick={closeSearch}
              className="h-10 shrink-0 rounded-full px-3 text-[0.875rem] font-semibold text-accent active:opacity-60"
            >
              Done
            </button>
          </div>
        ) : view === "status" && status !== undefined ? (
          <div className={cn("flex flex-col gap-1.5", arrive)}>
            {heading("Status")}
            {status.options.map((one) => {
              const on = one.value === status.value
              return (
                <button
                  key={one.value}
                  type="button"
                  onClick={() => {
                    status.onChange(one.value)
                    setView?.("rest")
                  }}
                  aria-pressed={on}
                  className={cn(
                    "flex h-12 w-full items-center gap-3 rounded-2xl px-4 text-left text-[0.9375rem] transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.985]",
                    on ? "bg-accent-bg text-accent" : "bg-soft-2 text-ink"
                  )}
                >
                  <span className="flex-1 font-medium">{one.label}</span>
                  {one.count !== undefined && (
                    <span className="text-body tabular-nums">
                      {count(one.count)}
                    </span>
                  )}
                  <Check
                    className={cn("size-4 shrink-0", on ? "" : "opacity-0")}
                  />
                </button>
              )
            })}
          </div>
        ) : view === "menu" ? (
          <div className={cn("flex flex-col gap-1.5", arrive)}>
            {heading(
              status === undefined ? "Search and Filter" : "Filter and Sort"
            )}
            {status === undefined && (
              <Row
                icon={Search}
                label="Search"
                value={search.value === "" ? undefined : search.value}
                onClick={toSearch}
              />
            )}
            {filter !== undefined && (
              <Row
                icon={ListFilter}
                label="Filter"
                value={filter.count === 0 ? undefined : String(filter.count)}
                onClick={() => {
                  setView?.("rest")
                  filter.onOpen()
                }}
              />
            )}
            {sort !== undefined && (
              <Row
                icon={ArrowDownUp}
                label="Sort"
                value={sort.label}
                onClick={() => {
                  setView?.("rest")
                  sort.onOpen()
                }}
              />
            )}
          </div>
        ) : status !== undefined ? (
          // The field: it says what is searched, or what was.
          // Tinted while a search is narrowing the list: the list is not the
          // whole one, and the row says so where the thumb is.
          <div
            className={cn(
              "dock-field flex h-9 min-w-0 items-center rounded-full pr-1 pl-3 transition-colors duration-150",
              search.value === "" ? "bg-soft-2" : "bg-accent-bg"
            )}
          >
            <button
              type="button"
              onClick={toSearch}
              aria-label={search.label}
              className="flex h-full min-w-0 flex-1 items-center gap-2 text-left text-[0.875rem]"
            >
              <Search
                className={cn(
                  "size-4 shrink-0",
                  search.value === "" ? "text-mute" : "text-accent"
                )}
              />
              <span
                className={cn(
                  "truncate",
                  search.value === "" ? "text-mute" : "font-medium text-ink"
                )}
              >
                {search.value === "" ? search.label : search.value}
              </span>
            </button>
            {search.value !== "" && (
              // One tap to widen the list again: it took a tap into the field,
              // then another on its ✕, to undo a search.
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => search.onChange("")}
                className="grid size-7 shrink-0 place-items-center rounded-full text-body transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.92]"
              >
                <X className="size-4" />
              </button>
            )}
            {several && (
              <button
                type="button"
                aria-label="Filter and sort"
                onClick={() => setView?.("menu")}
                className={cn(
                  "relative grid size-7 shrink-0 place-items-center rounded-full transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.92]",
                  (filter?.count ?? 0) > 0
                    ? "bg-accent-bg text-accent"
                    : "text-body"
                )}
              >
                <ListFilter className="size-4" />
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => (several ? setView?.("menu") : toSearch())}
            aria-label={several ? "Search, filter and sort" : search.label}
            title={several ? "Search, filter and sort" : search.label}
            className={cn(
              "relative grid size-9 place-items-center rounded-full transition-[scale,background-color] duration-(--t-press) ease-(--ease-out) active:scale-[0.94]",
              active ? "bg-accent-bg text-accent" : "bg-soft-2 text-body"
            )}
          >
            <Search className="size-4" />
            {active && (
              <span
                aria-hidden
                className="absolute top-0.5 right-0.5 size-2 rounded-full bg-accent ring-2 ring-canvas"
              />
            )}
          </button>
        )}
      </DockPortal>
    </>
  )
}

/// One line of the drawer's list: what it does, what it is set to now, and a
/// chevron — the way a phone's own option lists read.
function Row({
  icon: Icon,
  label,
  value,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-12 w-full items-center gap-3 rounded-2xl bg-soft-2 px-4 text-left text-[0.9375rem] text-ink transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.985]"
    >
      <Icon className="size-4 shrink-0 text-line-ico" />
      <span className="flex-1">{label}</span>
      {value !== undefined && (
        <span className="max-w-[45%] truncate text-body">{value}</span>
      )}
      <ChevronRight className="size-4 shrink-0 text-line-ico" />
    </button>
  )
}
