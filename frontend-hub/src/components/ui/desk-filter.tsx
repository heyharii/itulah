import { ListFilters } from "@/components/ui/list-filters"
import type { FilterState } from "@/lib/filters"

/// A desk list's filters, the way Purchase Orders wears them (owner,
/// 2026-10-20): everything on view in the screen's bar — see `<ListFilters>`.
/// Draws nothing on a phone, where the dock's own sheet does the same job.
export function DeskFilterButton({
  model,
  filterModel,
  table,
  search,
  className,
}: {
  readonly model: FilterState
  /// The same state with the server's facet counts folded into its fields.
  readonly filterModel?: FilterState
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly table?: any
  readonly search?: {
    readonly value: string
    readonly onChange: (value: string) => void
    readonly label: string
  }
  readonly className?: string
}) {
  return (
    <ListFilters
      model={filterModel ?? model}
      table={table}
      search={search}
      className={className ? `max-md:hidden ${className}` : "max-md:hidden"}
    />
  )
}

/// Was the line of clauses under the bar. The bar now shows every filter where
/// it is set, so this draws nothing; kept so the screens that render it build.
export function DeskFilterChips(_props: {
  readonly model: FilterState
  readonly filterModel?: FilterState
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly table?: any
  readonly className?: string
}) {
  return null
}
