import {
  columnFacetingFeature,
  columnFilteringFeature,
  columnSizingFeature,
  globalFilteringFeature,
  columnVisibilityFeature,
  createFacetedMinMaxValues,
  createFacetedRowModel,
  createFacetedUniqueValues,
  createFilteredRowModel,
  createSortedRowModel,
  filterFn_arrIncludes,
  filterFn_arrIncludesSome,
  filterFn_equals,
  filterFn_inDateRange,
  filterFn_inNumberRange,
  filterFn_includesString,
  filterFn_weakEquals,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
} from "@tanstack/react-table"

/// The feature set every table in this app is built against.
///
/// v9 no longer bundles features implicitly: each is registered here with the
/// row-model factory that powers it. Registering the set once — rather than per
/// table — is what stops two lists in two modules behaving differently.
///
/// Deliberately NOT `stockFeatures`: that pulls all seventeen plus every
/// built-in filter and sort function into the bundle.
///
/// **No `rowPaginationFeature`, on purpose.** Registering it routes
/// `getRowModel()` through the paginated model whenever `manualPagination` is
/// falsy, which silently renders the first ten rows of a list and calls it
/// done — the exact failure DESIGN.md forbids ("never slice a list to cap it,
/// that hides rows and calls it fast"). Long lists here are virtualised
/// instead, so every row is in the model and only the visible ones are in the
/// DOM.
export const tableSetup = tableFeatures({
  columnFilteringFeature,
  /// One search box per list, filtering every column at once. A per-column
  /// filter row is a spreadsheet affordance; these lists are read to compare
  /// rows, and the question is almost always "where is this supplier".
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),

  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),

  columnFacetingFeature,
  facetedRowModel: createFacetedRowModel(),
  facetedUniqueValues: createFacetedUniqueValues(),
  facetedMinMaxValues: createFacetedMinMaxValues(),

  columnVisibilityFeature,
  rowSelectionFeature,

  /// Sizes, not the drag interaction — v8's single `ColumnSizing` is split in
  /// two in v9. The virtualised path needs a width per column because its rows
  /// are flex, not table-layout, so `getSize()` has to answer.
  columnSizingFeature,

  /// `columnDef.filterFn` defaults to `'auto'`, which resolves by data type to
  /// one of the six below. In v9 an unregistered name does not filter at all —
  /// it warns in dev and returns `undefined` — so the whole auto set has to be
  /// present for columns that do not name a filter explicitly.
  filterFns: {
    includesString: filterFn_includesString,
    inNumberRange: filterFn_inNumberRange,
    equals: filterFn_equals,
    arrIncludes: filterFn_arrIncludes,
    arrIncludesSome: filterFn_arrIncludesSome,
    inDateRange: filterFn_inDateRange,
    weakEquals: filterFn_weakEquals,
  },

  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    text: sortFn_text,
    datetime: sortFn_datetime,
    basic: sortFn_basic,
  },
})

export type TableSetup = typeof tableSetup
