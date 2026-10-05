import { ArrowDownUp, ChevronRight, ListFilter, Search, X } from "lucide-react"
import { useRef } from "react"
import { flushSync } from "react-dom"

import { DockPortal, useDock } from "@/components/shell/dock"
import { cn } from "@/lib/utils"

/// A list's search, filter and sort, in the drawer over the bottom bar (owner,
/// 2026-10-05).
///
/// At rest it is one round button in the row, after the tabs. Pressed, the
/// drawer grows into a short list — Search, Filter, Sort — rather than
/// guessing which of the three was meant; a phone has no room for three
/// buttons in the row, and a button that opened a sheet of everything at once
/// was the thing that read as odd. Search turns the drawer into the field (the
/// keyboard comes up with it, and the drawer is lifted clear of it); Filter and
/// Sort open the screen's own sheet, which already has them in full.
///
/// A screen with only a search skips the list: the button goes straight to the
/// field.
export function DockTools({
  search,
  filter,
  sort,
}: {
  search: {
    value: string
    onChange: (value: string) => void
    /// What is searched: "Search Orders".
    label: string
  }
  filter?: { count: number; onOpen: () => void }
  sort?: { label: string; onOpen: () => void }
}) {
  const dock = useDock()
  const view = dock?.view ?? "rest"
  const setView = dock?.setView
  const input = useRef<HTMLInputElement>(null)
  const several = filter !== undefined || sort !== undefined
  const active = search.value !== "" || (filter?.count ?? 0) > 0

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

  return (
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
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === "Escape")
                  closeSearch()
              }}
              aria-label={search.label}
              placeholder={search.label}
              // 16px: iOS zooms the page into any field set smaller, and a page
              // that has zoomed itself is a worse search than none.
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
            onClick={closeSearch}
            className="h-10 shrink-0 rounded-full px-3 text-[0.875rem] font-semibold text-accent active:opacity-60"
          >
            Done
          </button>
        </div>
      ) : view === "menu" ? (
        <div className={cn("flex flex-col gap-1.5", arrive)}>
          <div className="flex items-center justify-between pr-0.5 pl-3">
            <span className="text-[1rem] font-semibold text-ink">
              Search and Filter
            </span>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setView?.("rest")}
              className="grid size-9 place-items-center rounded-full bg-soft-2 text-body active:scale-[0.94]"
            >
              <X className="size-4" />
            </button>
          </div>
          <Row
            icon={Search}
            label="Search"
            value={search.value === "" ? undefined : search.value}
            onClick={toSearch}
          />
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
