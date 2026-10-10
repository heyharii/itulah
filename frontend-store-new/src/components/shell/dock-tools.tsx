import { ChevronDown, ChevronRight, ListFilter, Search, X } from "lucide-react"
import { useRef, useState } from "react"
import { createPortal } from "react-dom"

import { DockPortal, useDock } from "@/components/shell/dock"
import {
  SHEET_ROW,
  SheetChoiceRows,
  SheetSortRows,
  type SortChoices,
} from "@/components/ui/list-chrome"
import { BottomSheet, MorphHeight } from "@/components/ui/picker-sheet"
import { count } from "@/lib/format"
import { cn } from "@/lib/utils"

/// What a list can be narrowed to by its status or its division ("Active",
/// "Pria"): one of a few, with the figure each holds.
export interface DockStatus {
  readonly value: string
  readonly options: readonly {
    readonly value: string
    readonly label: string
    readonly count?: number
  }[]
  readonly onChange: (value: string) => void
}

/// What a list can be sorted by, as the sort sheet lists it: a named order per
/// column, and the list's own order when nothing is chosen.
export type DockSortChoices = SortChoices

/// Another one-of-a-few choice that is not the list's status — a view switch
/// ("By article / By SKU"), a unit ("Pieces / Boxes"). Drawn as a row of the ⚙
/// sheet with the current answer on it, and opening its own page of rows.
export interface DockViewChoice {
  /// What is being chosen: the row's name and the page's title.
  readonly title: string
  readonly value: string
  readonly options: readonly {
    readonly value: string
    readonly label: string
  }[]
  readonly onChange: (value: string) => void
}

/// A list's status, search, filter and sort, as the row over the bottom bar and
/// the sheets it opens — the hub's `DockTools`
/// (`frontend-hub/src/components/shell/dock-tools.tsx`), slimmed.
///
/// ## The dock is the shortcut, the sheet is the place
///
/// Every choice opens the same bottom sheet — status, the ⚙ menu, sort, and
/// search — so the flow is one thing to learn. The row never changes shape: it
/// only says where each of them is.
///
/// ## Status is a place, not a filter
///
/// Pria, Wanita and Everything are three different lists, so the row says which
/// one this is and always says it: one button with the current word and a
/// chevron, which opens the list of statuses — each with its count, which
/// three tabs in 343px had no room for.
///
/// ## The row
///
///   [ Everything ▾ ]  [ 🔍 Search articles…  ⚙ ]  [ + ]
///
/// The field opens the search sheet (above the keyboard, over a list that
/// narrows as it is typed). The ⚙ at its end opens the options sheet — Filter,
/// Sort by, the screen's own view choices and `actions` as rows — or goes
/// straight to the one thing a list has.
///
/// A screen with no search keeps a round ⚙ button on its own. The screen opens
/// its own filter sheet (`filter.onOpen`); there is no shared filter state here.
export function DockTools({
  search,
  filter,
  sort,
  status,
  views,
  actions,
}: {
  search?: {
    value: string
    onChange: (value: string) => void
    /// What is searched: "Search articles".
    label: string
  }
  /// A sheet the screen opens itself. `count` is how many filters are on: the
  /// ⚙ is tinted while it is more than nothing.
  filter?: {
    count: number
    onOpen: () => void
    /// What is narrowed by, said on the ⚙ sheet's row: "Tags". Defaults to
    /// "Filter".
    label?: string
  }
  /// `label` is the order in force, said in a word ("Range"): it stands on the
  /// ⚙ sheet's row. With `choices` the sort sheet of the kit lists them; with
  /// `onOpen` the screen opens its own.
  sort?: {
    label: string
    onOpen?: () => void
    choices?: DockSortChoices
    /// Whether pressing the order in force turns it over. Off for orders that
    /// say their direction in their name ("Cheapest", "Dearest").
    directional?: boolean
  }
  status?: DockStatus
  /// Further one-of-a-few choices, as rows of the ⚙ sheet.
  views?: readonly DockViewChoice[]
  /// Acts on the list as a whole, as rows at the foot of the ⚙ sheet: Export,
  /// Sync.
  actions?: readonly { readonly label: string; readonly onClick: () => void }[]
}) {
  const dock = useDock()
  const [sheet, setSheet] = useState<"status" | "search" | "sort" | null>(null)
  /// The ⚙ sheet: closed, or open on its menu, on sort, or on one view.
  const [tools, setTools] = useState<"menu" | "sort" | `view:${number}` | null>(
    null,
  )
  /// A field the keyboard can be raised from inside the press that asked for
  /// it. iOS only shows the keyboard for a focus made in the gesture, and the
  /// sheet's own field is not mounted until after it: this one is, and hands
  /// the focus over when the sheet's field takes it.
  const proxy = useRef<HTMLInputElement>(null)
  const viewList = views ?? []
  const rowsOfMenu =
    (filter !== undefined ? 1 : 0) +
    (sort !== undefined ? 1 : 0) +
    viewList.length
  const several =
    rowsOfMenu > 0 || (actions !== undefined && actions.length > 0)
  const current = status?.options.find((one) => one.value === status.value)

  const toSearch = () => {
    proxy.current?.focus()
    setSheet("search")
  }
  const query = search ?? { value: "", onChange: () => undefined, label: "" }

  // The ⚙ of a list with only one thing goes straight to it: a menu of one row
  // is a tap for nothing.
  const toTools = () => {
    const only = (actions?.length ?? 0) === 0 && rowsOfMenu === 1
    if (only) {
      if (filter !== undefined) filter.onOpen()
      else if (sort?.choices !== undefined) setTools("sort")
      else if (sort?.onOpen !== undefined) sort.onOpen()
      else if (viewList.length === 1) setTools("view:0")
      return
    }
    setTools("menu")
  }
  const single = rowsOfMenu === 1 && (actions?.length ?? 0) === 0
  const viewAt = tools?.startsWith("view:")
    ? viewList[Number(tools.slice(5))]
    : undefined

  const gear = (small: boolean) => (
    <button
      type="button"
      aria-label="Filter and sort"
      onClick={toTools}
      className={cn(
        "relative grid shrink-0 place-items-center rounded-full transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.92]",
        small ? "size-7" : "size-9",
        (filter?.count ?? 0) > 0
          ? "bg-accent-bg text-accent"
          : small
            ? "text-body"
            : "bg-soft-2 text-body",
      )}
    >
      <ListFilter className="size-4" />
    </button>
  )

  return (
    <>
      {status !== undefined && (
        <DockPortal slot="tabs">
          <StatusChip
            label={current?.label ?? ""}
            onClick={() => setSheet("status")}
          />
        </DockPortal>
      )}

      {search === undefined && several && (
        <DockPortal slot="search">{gear(false)}</DockPortal>
      )}
      {search !== undefined && (
        <DockPortal slot="search">
          {/* The field: it says what is searched, or what was. Tinted while a
              search is narrowing the list: the list is not the whole one, and
              the row says so where the thumb is. */}
          <div
            className={cn(
              "dock-field flex h-9 min-w-0 items-center rounded-full pr-1 pl-3 transition-colors duration-150",
              query.value === "" ? "bg-soft-2" : "bg-accent-bg",
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
                  query.value === "" ? "text-mute" : "text-accent",
                )}
              />
              <span
                className={cn(
                  "truncate",
                  query.value === "" ? "text-mute" : "font-medium text-ink",
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
                className="grid size-7 shrink-0 place-items-center rounded-full text-body transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.92]"
              >
                <X className="size-4" />
              </button>
            )}
            {several && gear(true)}
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
              document.body,
            )}

          {status !== undefined && (
            <BottomSheet
              open={sheet === "status"}
              onOpenChange={(next) => !next && setSheet(null)}
              title="Show"
            >
              <div className="min-h-0 overflow-y-auto overscroll-contain px-2 pb-3">
                <SheetChoiceRows
                  options={status.options.map((one) => ({
                    value: one.value,
                    label: one.label,
                    trailing:
                      one.count !== undefined ? count(one.count) : undefined,
                  }))}
                  value={status.value}
                  onPick={(value) => {
                    status.onChange(value)
                    setSheet(null)
                  }}
                />
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
                  // Pressed without taking the focus off the field: a press
                  // that did closed the keyboard first, the sheet came down
                  // with it, and the tap was lost.
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
                    // A SKU or a barcode is searched as typed: no capital for
                    // the first letter, no correction into a word.
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
                      className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-full bg-mute/20 text-body"
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </BottomSheet>
          )}

          {several && (
            <BottomSheet
              open={tools !== null}
              onOpenChange={(next) => !next && setTools(null)}
              title={
                tools === "sort"
                  ? "Sort by"
                  : (viewAt?.title ?? "Filter and sort")
              }
              // A page past the menu has a way back to it — unless the menu
              // was skipped because the list has only the one thing.
              onBack={
                tools !== "menu" && !single ? () => setTools("menu") : undefined
              }
            >
              <MorphHeight page={tools ?? "menu"} back={tools === "menu"}>
                <div className="px-2 pb-3">
                  {tools === "menu" || tools === null ? (
                    <>
                      {filter !== undefined && (
                        <button
                          type="button"
                          onClick={() => {
                            setTools(null)
                            filter.onOpen()
                          }}
                          className={SHEET_ROW}
                        >
                          <span className="flex-1">
                            {filter.label ?? "Filter"}
                          </span>
                          <span
                            className={cn(
                              filter.count > 0
                                ? "font-medium text-accent"
                                : "text-body",
                            )}
                          >
                            {filter.count > 0 ? count(filter.count) : "Any"}
                          </span>
                          <ChevronRight className="size-4 shrink-0 text-line-ico" />
                        </button>
                      )}
                      {sort !== undefined && (
                        <button
                          type="button"
                          onClick={() => {
                            if (sort.choices !== undefined) setTools("sort")
                            else {
                              setTools(null)
                              sort.onOpen?.()
                            }
                          }}
                          className={SHEET_ROW}
                        >
                          <span className="flex-1">Sort by</span>
                          <span className="text-body">{sort.label}</span>
                          <ChevronRight className="size-4 shrink-0 text-line-ico" />
                        </button>
                      )}
                      {viewList.map((view, index) => (
                        <button
                          key={view.title}
                          type="button"
                          onClick={() => setTools(`view:${index}`)}
                          className={SHEET_ROW}
                        >
                          <span className="flex-1">{view.title}</span>
                          <span className="text-body">
                            {view.options.find(
                              (one) => one.value === view.value,
                            )?.label ?? ""}
                          </span>
                          <ChevronRight className="size-4 shrink-0 text-line-ico" />
                        </button>
                      ))}
                      {actions !== undefined && actions.length > 0 && (
                        <>
                          {rowsOfMenu > 0 && (
                            <div className="mx-3 my-1 border-t border-hairline" />
                          )}
                          {actions.map((one) => (
                            <button
                              key={one.label}
                              type="button"
                              onClick={() => {
                                setTools(null)
                                one.onClick()
                              }}
                              className={cn(SHEET_ROW, "font-medium")}
                            >
                              {one.label}
                            </button>
                          ))}
                        </>
                      )}
                    </>
                  ) : tools === "sort" && sort?.choices !== undefined ? (
                    <SheetSortRows
                      choices={sort.choices}
                      directional={sort.directional}
                      onDone={() => setTools(null)}
                    />
                  ) : viewAt !== undefined ? (
                    <SheetChoiceRows
                      options={viewAt.options}
                      value={viewAt.value}
                      onPick={(value) => {
                        viewAt.onChange(value)
                        setTools(null)
                      }}
                    />
                  ) : null}
                </div>
              </MorphHeight>
            </BottomSheet>
          )}
        </>
      )}
    </>
  )
}

/// The dock's status button: the current word and a chevron.
function StatusChip({
  label,
  onClick,
}: {
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-label={`Show: ${label}`}
      className="inline-flex h-9 max-w-full items-center gap-1 rounded-full bg-soft-2 pr-2.5 pl-3.5 text-[0.875rem] font-medium text-ink transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.97]"
    >
      <span className="truncate">{label}</span>
      <ChevronDown className="size-4 shrink-0 text-line-ico" />
    </button>
  )
}

/// A list's one-of-a-few choice as the dock's status button — the chip and the
/// sheet it opens — for a screen that has a choice and no search to put beside
/// it: the in-page tabs on a phone, which are a row that scrolls sideways until
/// they are this.
export function DockChoice({
  value,
  options,
  onChange,
  title = "Show",
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
        <StatusChip
          label={
            current?.short ??
            (typeof current?.label === "string" ? current.label : "")
          }
          onClick={() => setOpen(true)}
        />
      </DockPortal>
      {dock?.available === true && (
        <BottomSheet open={open} onOpenChange={setOpen} title={title}>
          <div className="min-h-0 overflow-y-auto overscroll-contain px-2 pb-3">
            <SheetChoiceRows
              options={options}
              value={value}
              onPick={(next) => {
                onChange(next)
                setOpen(false)
              }}
            />
          </div>
        </BottomSheet>
      )}
    </>
  )
}
