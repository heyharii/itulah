import { ClearFilters, FilterChips } from "@/components/ui/filter-bar"
import { dockSortOf } from "@/components/ui/data-table"
import { ListOptionsSheet } from "@/components/ui/list-chrome"
import type { FilterState } from "@/lib/filters"
import { cn } from "@/lib/utils"

/// A desk list's filters, the way Purchase Orders wears them: no column beside
/// the rows, but one button on the toolbar's line (filter and sort, in the same
/// sheet the phone gets) and, under the toolbar, the clauses in force as chips.
///
/// Two pieces rather than one because they stand in different places — the
/// button with the search and the primary action, the chips on a line of their
/// own so a long supplier or campaign name never pushes the toolbar onto two.
/// A filter nobody can see is a list that lies, which is why the chips are
/// always drawn while anything is set.

/// The button. Draws nothing on a phone, where the dock's own filter and sort
/// do the same job.
export function DeskFilterButton({
  model,
  filterModel,
  table,
  className,
}: {
  readonly model: FilterState
  /// The same state with the server's facet counts folded into its fields.
  readonly filterModel?: FilterState
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly table?: any
  readonly className?: string
}) {
  const fm = filterModel ?? model
  if (fm.fields.length === 0) return null
  return (
    <ListOptionsSheet
      model={model}
      filterModel={fm}
      table={table}
      sortChoices={table === undefined ? undefined : dockSortOf(table)?.choices}
      className={cn("max-md:hidden", className)}
    />
  )
}

/// The clauses in force, each editable where it is read, and Clear at the end.
export function DeskFilterChips({
  model,
  filterModel,
  table,
  className,
}: {
  readonly model: FilterState
  readonly filterModel?: FilterState
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly table?: any
  readonly className?: string
}) {
  const fm = filterModel ?? model
  if (model.filters.length === 0) return null
  return (
    <div
      className={cn(
        "mb-3 flex min-w-0 flex-wrap items-center gap-[0.4375rem] max-md:hidden",
        className
      )}
    >
      <FilterChips model={fm} table={table} />
      <ClearFilters model={model} />
    </div>
  )
}
