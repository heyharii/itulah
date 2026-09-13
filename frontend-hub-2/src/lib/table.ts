import {
  columnSizingFeature,
  columnVisibilityFeature,
  createExpandedRowModel,
  rowExpandingFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
} from "@tanstack/react-table"

/// The feature set every table in this app is built against.
///
/// v9 bundles nothing implicitly: each feature is registered here, once, so two
/// lists in two modules cannot behave differently. `stockFeatures` would pull
/// all seventeen plus every built-in filter and sort function into the bundle,
/// which is why the set is named out.
///
/// ## Why this set is SHORTER than `frontend-hub`'s
///
/// That app filters, sorts and facets in the browser, so it registers the row
/// models for all three. This one does not, and the difference is not a
/// preference — it is that **every list here is paged from the server.**
///
/// A client-side sorted row model over a paged list sorts the fifty rows that
/// happen to be loaded and leaves the rest where they were: a list that looks
/// sorted and is not. A client-side filter model narrows what has been
/// downloaded and reports its counts as if they described the whole set. Both
/// are worse than not having the feature, because both look like they worked.
///
/// So there is deliberately **no** `filteredRowModel`, **no** `sortedRowModel`,
/// and **no** faceting here. Sorting is registered as STATE only —
/// `rowSortingFeature` with `manualSorting: true` — so a header can say which
/// way it points and hand the answer to the query, and the ordering itself is
/// the server's.
///
/// And **no `rowPaginationFeature`**, for a sharper reason: registering it
/// routes `getRowModel()` through the paginated model whenever
/// `manualPagination` is falsy, which silently renders the first ten rows of a
/// list and calls it done. Long lists here are virtualised — every row is in
/// the model, only the visible ones are in the DOM.
export const tableSetup = tableFeatures({
  /// The one that earned adopting the library. A screen declares
  /// `meta.priority` per column and the table hides the least important ones
  /// as the container narrows — which is how a six-column list survives an
  /// iPad without shrinking its type to fit.
  columnVisibilityFeature,

  /// Widths, not the drag interaction — v8's single `ColumnSizing` is two
  /// features in v9. The virtualiser needs a width per column to lay out a
  /// window of rows.
  columnSizingFeature,

  /// State and the header helpers (`getIsSorted`, `toggleSorting`), with the
  /// ordering itself left to the server. See the note above.
  rowSortingFeature,

  /// For the bulk actions the write screens will need — pay these bills,
  /// reverse these entries. Registered now because adding a feature later
  /// means revisiting every table's generic parameter.
  rowSelectionFeature,

  /// Sub-rows, for the one shape that is a hierarchy rather than a list: a
  /// profit and loss or a balance sheet, folding by class.
  ///
  /// Safe to register for everybody, unlike pagination above. It only unfolds
  /// rows that have `subRows`, and a table that does not set `getSubRows` has
  /// none — so for every flat list the expanded model is a pass-through.
  rowExpandingFeature,
  expandedRowModel: createExpandedRowModel(),
})

export type TableSetup = typeof tableFeatures extends never
  ? never
  : typeof tableSetup

/// What a column may declare about itself beyond how to draw it.
///
/// Read by `kit/table.tsx`; a screen never reads its own meta back.
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TFeatures, TData, TValue> {
    /// Figures line up on the right so they can be compared down the column —
    /// and so a book balance, a statement balance and their difference read
    /// across as one sentence.
    readonly align?: "right"
    /// An icon in the heading. The column's own subject, not decoration: a
    /// wallet on Account, a pin on Location.
    readonly icon?: React.ReactNode
    /// What order the SERVER calls this. Absent means the column cannot be
    /// sorted, which is a real answer — a column of flags has no order anybody
    /// means.
    readonly sortKey?: string
    /// Which column goes first when the table runs out of width.
    ///
    /// 1 is dropped first. A column with no priority is never dropped: that is
    /// the identity column and the figure the screen exists for, and a table
    /// that hides those to fit has stopped being the list somebody asked for.
    readonly priority?: number
    /// The narrowest this column may be drawn, in px, before one is dropped
    /// instead.
    ///
    /// Per column, not one number for the table, because the columns are not
    /// alike: `Store 09` needs a hundred pixels and `Rp 4.549.546.000` needs
    /// half as much again. A single threshold either truncates the money or
    /// throws away columns that would have fitted — and a truncated figure
    /// cannot be compared down its column, which is the only reason it is a
    /// column.
    readonly min?: number
  }
}
