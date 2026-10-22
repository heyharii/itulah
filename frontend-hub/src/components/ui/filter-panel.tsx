import { ListFilters } from "@/components/ui/list-filters"
import type { FilterState } from "@/lib/filters"

/// A list's filters — now the one standard `<ListFilters>` draws (owner,
/// 2026-10-20: every list filters the way Purchase Orders does).
///
/// The Filter button, its sheet and the right-hand rail at 96rem are gone: the
/// owner asked for no Filter button (2026-10-14) and no filter on the right
/// (2026-10-12). The name stays so the screens that render it keep working;
/// what they get is search with names, date boxes, a line of icon chips and
/// switches, in that order, in the screen's own bar.
///
/// A screen with its own search box should hand its text over as `search`
/// and drop the box, so the one box both searches and offers names.
export function FilterPanel({
  model,
  table,
  search,
  className,
}: {
  readonly model: FilterState
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
      model={model}
      table={table}
      search={search}
      className={className}
    />
  )
}
