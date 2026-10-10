import { Check, ChevronDown, ListFilter, Search, X } from "lucide-react"
import { useRef, useState } from "react"
import { createPortal } from "react-dom"

import { DockPortal, useDock } from "@/components/shell/dock"
import {
  ListOptionsSheet,
  SHEET_ROW,
  SheetSortRows,
  type SortChoices,
} from "@/components/ui/list-chrome"
import { BottomSheet } from "@/components/ui/picker-sheet"
import type { FilterState } from "@/lib/filters"
import { count } from "@/lib/format"
import { cn } from "@/lib/utils"

/// What the filter sheet needs to read and write a list's filter: the filter's
/// state, the same state with the server's facet counts folded into its
/// fields, and the table the options are read from.
export interface DockFilterPanel {
  readonly model: FilterState
  readonly filterModel?: FilterState
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly table?: any
}

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

/// What a list can be sorted by, as the sort sheet lists it: a named order
/// per column, and the list's own order when nothing is chosen.
export type DockSortChoices = SortChoices

/// A list's status, search, filter and sort, as the row over the bottom bar
/// and the sheets it opens (owner, 2026-10-05; sheets 2026-10-06).
///
/// ## The dock is the shortcut, the sheet is the place
///
/// Every choice opens the same bottom sheet — status, the Filter/Sort menu, the
/// filter's fields and its calendar, sort, and search — so the flow is one
/// thing to learn and a calendar has the room it needs. The row never changes
/// shape: it only says where each of them is.
///
/// ## Status is a place, not a filter
///
/// Active, Completed and Cancelled are three different lists, so the row says
/// which one this is and always says it: one button with the current word and
/// a chevron, which opens the list of statuses — each with its count, which
/// three tabs in 343px had no room for.
///
/// ## The row
///
///   [ Active ▾ ]  [ 🔍 Search orders…  ⚙ ]  [ + ]
///
/// The field opens the search sheet (above the keyboard, over a list that
/// narrows as it is typed). The ⚙ at its end opens the Filter/Sort menu, or
/// goes straight to the one a list has.
///
/// A screen with no status keeps the older row: a round button that opens the
/// list (or goes to the field, if search is all it has).
export function DockTools({
  search,
  filter,
  sort,
  status,
  actions,
}: {
  search?: {
    value: string
    onChange: (value: string) => void
    /// What is searched: "Search Orders".
    label: string
  }
  /// Filter is either a sheet the screen opens itself (`onOpen`) or, with
  /// `panel`, the filter sheet of the kit.
  filter?: { count: number; onOpen?: () => void; panel?: DockFilterPanel }
  /// Sort is either a sheet the screen opens itself (`onOpen`) or, with
  /// `choices`, the sort sheet of the kit — nothing at the top of the page.
  sort?: {
    label: string
    onOpen?: () => void
    choices?: DockSortChoices
  }
  status?: DockStatus
  /// Acts on the list as a whole, as rows at the foot of the ⚙ menu: Export,
  /// Sync. Shown on the sheet of a list that has a filter panel.
  actions?: readonly { readonly label: string; readonly onClick: () => void }[]
}) {
  const dock = useDock()
  const [sheet, setSheet] = useState<"status" | "search" | "sort" | null>(null)
  /// The Filter/Sort sheet's page, opened from the ⚙.
  const [showAt, setShowAt] = useState<"menu" | "filter" | "sort" | null>(null)
  /// A field the keyboard can be raised from inside the press that asked for
  /// it. iOS only shows the keyboard for a focus made in the gesture, and the
  /// sheet's own field is not mounted until after it: this one is, and hands
  /// the focus over when the sheet's field takes it.
  const proxy = useRef<HTMLInputElement>(null)
  const several = filter !== undefined || sort !== undefined
  const current = status?.options.find((one) => one.value === status.value)

  const toSearch = () => {
    proxy.current?.focus()
    setSheet("search")
  }
  const query = search ?? { value: "", onChange: () => undefined, label: "" }
  // The ⚙ of a list with only a sort goes straight to it: a menu of one row
  // is a tap for nothing.
  const toTools = () => {
    if (filter?.panel !== undefined) {
      setShowAt(sort?.choices !== undefined ? "menu" : "filter")
      return
    }
    if (sort?.choices !== undefined) {
      setSheet("sort")
      return
    }
    ;(filter?.onOpen ?? sort?.onOpen)?.()
  }

  return (
    <>
      {status !== undefined && (
        <DockPortal slot="tabs">
          <button
            type="button"
            onClick={() => setSheet("status")}
            aria-haspopup="dialog"
            aria-label={`Status: ${current?.label ?? ""}`}
            className="inline-flex h-11 max-w-full items-center gap-1 rounded-full bg-soft-2 pr-3 pl-4 text-[0.875rem] font-medium text-ink transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.97]"
          >
            <span className="truncate">{current?.label}</span>
            <ChevronDown className="size-4 shrink-0 text-line-ico" />
          </button>
        </DockPortal>
      )}

      {search === undefined && several && (
        <DockPortal slot="search">
          <button
            type="button"
            aria-label="Filter and sort"
            onClick={toTools}
            className={cn(
              "relative grid size-11 shrink-0 place-items-center rounded-full transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.92]",
              (filter?.count ?? 0) > 0
                ? "bg-accent-bg text-accent"
                : "bg-soft-2 text-body"
            )}
          >
            <ListFilter className="size-4" />
          </button>
        </DockPortal>
      )}
      {search !== undefined && (
        <DockPortal slot="search">
          {/* The field: it says what is searched, or what was. */}
          {/* Tinted while a search is narrowing the list: the list is not the
        whole one, and the row says so where the thumb is. */}
          <div
            className={cn(
              "dock-field flex h-11 min-w-0 items-center rounded-full pr-1 pl-3.5 transition-colors duration-150",
              query.value === "" ? "bg-soft-2" : "bg-accent-bg"
            )}
          >
            <button
              type="button"
              onClick={toSearch}
              aria-label={query.label}
              className="flex h-full min-w-0 flex-1 items-center gap-2 text-left text-[0.875rem]"
            >
              <Search
                className={cn(
                  "size-4 shrink-0",
                  query.value === "" ? "text-mute" : "text-accent"
                )}
              />
              <span
                className={cn(
                  "truncate",
                  query.value === "" ? "text-mute" : "font-medium text-ink"
                )}
              >
                {query.value === "" ? query.label : query.value}
              </span>
            </button>
            {query.value !== "" && (
              // One tap to widen the list again: it took a tap into the field,
              // then another on its ✕, to undo a search.
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => query.onChange("")}
                // 36 to see, 44 to press (`after`), inside a 44px field.
                className="relative grid size-9 shrink-0 place-items-center rounded-full text-body transition-[scale] duration-(--t-press) ease-(--ease-out) after:absolute after:-inset-1 after:content-[''] active:scale-[0.92]"
              >
                <X className="size-4" />
              </button>
            )}
            {several && (
              <button
                type="button"
                aria-label="Filter and sort"
                onClick={toTools}
                className={cn(
                  // 36 to see, 44 to press (`after`), inside a 44px field.
                  "relative grid size-9 shrink-0 place-items-center rounded-full transition-[scale] duration-(--t-press) ease-(--ease-out) after:absolute after:-inset-1 after:content-[''] active:scale-[0.92]",
                  (filter?.count ?? 0) > 0
                    ? "bg-accent-bg text-accent"
                    : "text-body"
                )}
              >
                <ListFilter className="size-4" />
              </button>
            )}
          </div>
        </DockPortal>
      )}

      {dock?.available === true && (
        <>
          {/* The field the keyboard is raised from (see `proxy`). Not inside
              the dock: while somebody types the dock steps aside, and a field
              that stepped aside with it would drop the keyboard. */}
          {search !== undefined &&
            createPortal(
              <input
                ref={proxy}
                type="search"
                inputMode="search"
                aria-hidden
                tabIndex={-1}
                className="pointer-events-none fixed top-0 left-0 size-px opacity-0"
              />,
              document.body
            )}

          {status !== undefined && (
            <BottomSheet
              open={sheet === "status"}
              onOpenChange={(next) => !next && setSheet(null)}
              title="Status"
            >
              <div className="min-h-0 overflow-y-auto overscroll-contain px-2 pb-3">
                {status.options.map((one) => {
                  const on = one.value === status.value
                  return (
                    <button
                      key={one.value}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        status.onChange(one.value)
                        setSheet(null)
                      }}
                      className={cn(SHEET_ROW, on && "font-medium text-accent")}
                    >
                      <span className="flex-1">{one.label}</span>
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
            </BottomSheet>
          )}

          {search !== undefined && (
            <BottomSheet
              live
              open={sheet === "search"}
              onOpenChange={(next) => !next && setSheet(null)}
              title="Search"
              action={
                <button
                  type="button"
                  // Pressed without taking the focus off the field: a press that
                  // did closed the keyboard first, the sheet came down with it,
                  // and the tap was lost — Done closed only the keyboard and
                  // had to be pressed again (owner, 2026-10-06).
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setSheet(null)}
                  className="h-tap shrink-0 rounded-inner px-3 text-[0.9375rem] font-semibold text-accent active:opacity-60"
                >
                  Done
                </button>
              }
            >
              <div className="px-4 pb-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-mute" />
                  <input
                    autoFocus
                    type="search"
                    enterKeyHint="search"
                    // A PO number or a supplier's code is searched as typed: no
                    // capital for the first letter, no correction into a word.
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={query.value}
                    onChange={(event) => query.onChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") setSheet(null)
                    }}
                    aria-label={query.label}
                    placeholder={query.label}
                    // 16px: iOS zooms the page into any field set smaller, and
                    // a page that has zoomed itself is a worse search than none.
                    className="h-11 w-full rounded-full bg-soft-2 pr-9 pl-9 text-base text-ink outline-none placeholder:text-mute [&::-webkit-search-cancel-button]:hidden"
                  />
                  {query.value !== "" && (
                    <button
                      type="button"
                      aria-label="Clear search"
                      // Keeps the focus: a clear that blurred the field would
                      // drop the keyboard just when somebody is about to type
                      // again.
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => query.onChange("")}
                      className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-full bg-mute/20 text-body after:absolute after:-inset-2.5 after:content-['']"
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </BottomSheet>
          )}

          {filter?.panel !== undefined && (
            <ListOptionsSheet
              hideTrigger
              openAt={showAt}
              onOpenAtChange={setShowAt}
              model={filter.panel.model}
              filterModel={filter.panel.filterModel}
              table={filter.panel.table}
              sortChoices={sort?.choices}
              actions={actions}
            />
          )}

          {filter?.panel === undefined && sort?.choices !== undefined && (
            <BottomSheet
              open={sheet === "sort"}
              onOpenChange={(next) => !next && setSheet(null)}
              title="Sort by"
            >
              <div className="min-h-0 overflow-y-auto overscroll-contain px-2 pb-3">
                <SheetSortRows
                  choices={sort.choices}
                  withDefault
                  onDone={() => setSheet(null)}
                />
              </div>
            </BottomSheet>
          )}
        </>
      )}
    </>
  )
}

/// A list's one-of-a-few choice as the dock's status button — the chip and the
/// sheet it opens — for a screen that has a choice and no search to put beside
/// it: the in-page tabs on a phone (`SubTabs`), which are a row that scrolls
/// sideways until they are this (owner, 2026-10-06).
export function DockChoice({
  value,
  options,
  onChange,
  title = "Status",
}: {
  /// The sheet's title: what is being chosen ("Unit", "Day").
  title?: string
  value: string
  options: readonly {
    readonly value: string
    readonly label: React.ReactNode
    /// A plain word for the chip and a screen reader, where `label` carries
    /// more than words.
    readonly short?: string
  }[]
  onChange: (value: string) => void
}) {
  const dock = useDock()
  const [open, setOpen] = useState(false)
  const current = options.find((one) => one.value === value)
  return (
    <>
      <DockPortal slot="tabs">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label={`Status: ${current?.short ?? ""}`}
          className="inline-flex h-11 max-w-full items-center gap-1 rounded-full bg-soft-2 pr-3 pl-4 text-[0.875rem] font-medium text-ink transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.97]"
        >
          <span className="truncate">{current?.short ?? current?.label}</span>
          <ChevronDown className="size-4 shrink-0 text-line-ico" />
        </button>
      </DockPortal>
      {dock?.available === true && (
        <BottomSheet open={open} onOpenChange={setOpen} title={title}>
          <div className="min-h-0 overflow-y-auto overscroll-contain px-2 pb-3">
            {options.map((one) => {
              const on = one.value === value
              return (
                <button
                  key={one.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    onChange(one.value)
                    setOpen(false)
                  }}
                  className={cn(SHEET_ROW, on && "font-medium text-accent")}
                >
                  <span className="flex-1">{one.label}</span>
                  <Check
                    className={cn("size-4 shrink-0", on ? "" : "opacity-0")}
                  />
                </button>
              )
            })}
          </div>
        </BottomSheet>
      )}
    </>
  )
}
