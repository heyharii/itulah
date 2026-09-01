/*
 * The board's row model.
 *
 * The list used to filter and sort a plain array before handing it to the
 * `<table>` in `topic-list.tsx`. That is now TanStack Table's job, and the URL
 * is the only place its state lives: `category` and `tag` are column filters,
 * `query` is the global filter, and `sort` picks the sorted row model's one
 * entry. The markup is untouched — this hook hands back `Topic[]` in display
 * order, exactly what the table rendered before.
 */

import {
  createColumnHelper,
  createFilteredRowModel,
  createSortedRowModel,
  columnFilteringFeature,
  filterFns,
  globalFilteringFeature,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
  type ColumnFiltersState,
  type SortingState,
} from "@tanstack/react-table"

import type { Topic } from "@/components/forum/data"

/** The three orders the board offers, as sorted-row-model state. */
export type TopicSort = "latest" | "top" | "new"

export const TOPIC_SORTS: TopicSort[] = ["latest", "top", "new"]

export function isTopicSort(value: string): value is TopicSort {
  return (TOPIC_SORTS as string[]).includes(value)
}

/*
 * The records engine publishes no ordering hint, so each order is one of the
 * counters it does return: newest activity first, most-replied first, newest
 * thread first. `activity` and `created` are "minutes ago", so ascending is
 * the recent end.
 */
const SORTING: Record<TopicSort, SortingState> = {
  latest: [{ id: "activity", desc: false }],
  top: [{ id: "replies", desc: true }],
  new: [{ id: "created", desc: false }],
}

const features = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  rowSortingFeature,
  filterFns,
  sortFns,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
})

const helper = createColumnHelper<typeof features, Topic>()

/*
 * Only the columns the board filters or sorts on need to exist here; the cells
 * themselves are still written by hand in `topic-list.tsx`, so no column needs
 * a renderer.
 */
const columns = helper.columns([
  helper.accessor((topic) => topic.category, {
    id: "category",
    filterFn: "equalsString",
  }),
  helper.accessor((topic) => topic.tags, {
    id: "tags",
    filterFn: "arrIncludes",
  }),
  helper.accessor((topic) => topic.replies, { id: "replies" }),
  helper.accessor((topic) => topic.activity, { id: "activity" }),
  helper.accessor((topic) => topic.created, { id: "created" }),
])

/** Records have no server-side text search, so the box matches title + tags. */
function matches(topic: Topic, needle: string): boolean {
  const q = needle.trim().toLowerCase()
  if (!q) return true
  return (
    topic.title.toLowerCase().includes(q) ||
    topic.tags.some((tag) => tag.toLowerCase().includes(q))
  )
}

export interface TopicRowsInput {
  topics: Topic[]
  category: string | null
  tag: string | null
  query: string
  sort: TopicSort
}

/** The board's rows, filtered and ordered by whatever the URL says. */
export function useTopicRows({
  topics,
  category,
  tag,
  query,
  sort,
}: TopicRowsInput): Topic[] {
  const columnFilters: ColumnFiltersState = []
  if (category) columnFilters.push({ id: "category", value: category })
  if (tag) columnFilters.push({ id: "tags", value: tag })

  const table = useTable({
    features,
    data: topics,
    columns,
    getRowId: (topic) => topic.id,
    state: {
      columnFilters,
      globalFilter: query,
      sorting: SORTING[sort],
    },
    globalFilterFn: (row, _columnId, filterValue) =>
      matches(row.original, String(filterValue ?? "")),
  })

  return table.getRowModel().rows.map((row) => row.original)
}
