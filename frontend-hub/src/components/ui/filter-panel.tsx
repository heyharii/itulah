import { ListFilter } from "lucide-react"

import {
  ClearFilters,
  FilterChips,
  FilterControls,
} from "@/components/ui/filter-bar"
import { Sheet } from "@/components/ui/sheet"
import { CHIP } from "@/lib/filter-chrome"
import type { FilterState } from "@/lib/filters"
import { useCoarsePointer } from "@/lib/layout"
import { useSheet } from "@/lib/sheets"
import { cn } from "@/lib/utils"

/// Where the filter controls LIVE: beside the list on a monitor, over it
/// everywhere else.
///
/// The owner asked for one thing — "filter muncul di sheet kalau di laptop dan
/// kalau di monitor sebagai rightbar" — and it is a statement about width, not
/// about two features. So this is ONE panel drawn in two places, and the place
/// is decided where every other width question in this app is decided: at
/// 96rem, by `lib/layout.ts`, which is the tier that has enough glass for a
/// second thing to stand BESIDE a list rather than over it.
///
/// `<Sheet>` already knows how to be both of those, and reusing it rather than
/// writing a second overlay is the point: at 96rem it drops its veil, stops
/// being modal and lets the shell narrow the page into what is left, and below
/// that it is the sheet the rest of the app uses — up from the bottom edge on a
/// phone, inset on the right on a laptop. Nothing here re-implements any of it,
/// and nothing here re-decides 96rem.
///
/// **The chips do not come with it.** `<FilterChips>` stays above the table at
/// every width, because a filter that is narrowing a list while nothing on
/// screen says so is how somebody reads a filtered list as the whole list —
/// the panel is dismissible, and what it must never take away with it is the
/// evidence that the list is short for a reason.
///
/// ## What a screen has to do to get one
///
/// Four lines, and three of them are `useFilters`' existing contract. For a
/// screen that draws a `<DataTable>` and has no filters yet:
///
///  1. Put `meta: { filter: { kind: "option" | "text" | … } }` on each column
///     worth asking a question about. The declaration lives on the column
///     deliberately — see `lib/filters.ts` for the drift that a separate list
///     of fields caused in the app this one replaces.
///  2. `const filters = useFilters(columns)` above the table.
///  3. Hand the table `columns: filters.columns` and
///     `state: { columnFilters: filters.columnFilters, … }`. The first is not
///     optional: v9 resolves an unnamed `filterFn` by data type and would
///     quietly match nothing.
///  4. Render `<FilterPanel model={filters} table={table} />` in the `<Toolbar>`
///     where the screen's other controls sit.
///
/// Everything else arrives with it: the URL encoding, the reload, the shareable
/// link, the docked column, the sheet below 96rem, the touch sizing, and the
/// chips above the table.
///
/// A screen narrowed at the SERVER passes the `FilterState` from
/// `useFilterState(fields)` and no table at all — the props are typed for that
/// case, and such a screen declares `counted` options on its fields instead of
/// having a faceted row model to count.
export function FilterPanel({
  model,
  table,
  className,
}: {
  readonly model: FilterState
  /// The table, when there is one, read for facet counts only. `useTable`'s
  /// return type is generic over its feature set and invariant in v9, so
  /// naming it would lock the panel to one table's columns.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly table?: any
  readonly className?: string
}) {
  /// Open or shut in the URL, like every other panel in this app. A filtered
  /// list is the unit of work people hand each other, and the panel as they
  /// left it is part of what they are handing over — so `?filters=` survives
  /// the reload a shop's browser gets each morning and travels in the link.
  /// Declared in `SHEET_PARAMS`, without which the root route's validator drops
  /// it on the way in and the panel shuts itself on every navigation.
  const panel = useSheet("filters")
  /// **Width decides the layout, pointer decides the size of what you press.**
  /// A 1180px iPad takes the wide layout above and still needs a target a thumb
  /// can hit, which is a different question and is asked separately.
  const touch = useCoarsePointer()
  const { filters, fields } = model

  if (fields.length === 0) return null

  return (
    <>
      <div
        className={cn(
          "flex min-w-0 flex-wrap items-center gap-[0.4375rem]",
          className
        )}
      >
        <FilterChips model={model} table={table} />

        <button
          type="button"
          onClick={() => (panel.isOpen ? panel.close() : panel.open(true))}
          aria-expanded={panel.isOpen}
          className={cn(
            CHIP,
            "items-center gap-1.5 border border-dashed border-hairline-strong px-2.5 text-body transition-colors hover:bg-soft-2 hover:text-ink",
            // Pressed-looking while the panel stands, so the docked column has
            // a visible origin on the screen it belongs to rather than reading
            // as a second thing that happens to be open.
            panel.isOpen && "border-solid bg-soft-2 text-ink",
            touch && "h-11 px-3.5"
          )}
        >
          <ListFilter className="size-3.5" />
          Filter
          {filters.length > 0 && (
            <span className="text-mute tabular-nums">{filters.length}</span>
          )}
        </button>
      </div>

      <Sheet
        open={panel.isOpen}
        onOpenChange={(open) => {
          if (!open) panel.close()
        }}
        title="Filters"
        // Clear is pinned to the foot rather than sitting at the end of the
        // stack, because the fullest panel is exactly the one where it would
        // have scrolled out of sight — and a panel full of clauses is when
        // somebody most wants to drop the lot. The header and this footer hold
        // still; only the clause list between them scrolls.
        footer={
          filters.length > 0 ? (
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-meta text-mute">
                {filters.length === 1
                  ? "1 clause is narrowing this list"
                  : `${filters.length} clauses are narrowing this list`}
              </span>
              <ClearFilters model={model} touch={touch} label="Clear all" />
            </div>
          ) : undefined
        }
      >
        <FilterControls
          model={model}
          table={table}
          stacked
          touch={touch}
          withClear={false}
        />
        {filters.length === 0 && (
          <p className="mt-3 text-meta text-mute">
            Nothing is narrowing this list. Pick a column to ask it a question —
            what it is, what it is not, or whether it is empty at all.
          </p>
        )}
      </Sheet>
    </>
  )
}
