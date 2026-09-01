import "@tanstack/react-table"

import type { FilterSpec } from "@/lib/filters"

declare module "@tanstack/react-table" {
  /* eslint-disable @typescript-eslint/no-unused-vars -- the parameters are
     positional: declaration merging must restate the interface's full
     signature even where this augmentation does not reference them. */
  /// Per-column presentation the data model does not carry.
  ///
  /// Alignment lives here rather than in a wrapper because the header and the
  /// cell must agree and they are declared in different places. v9 also offers
  /// a per-table `columnMeta` slot on `tableFeatures()`; declaration merging is
  /// used instead so the shape is the same for every table in the app rather
  /// than a property of one feature set.
  interface ColumnMeta<
    in out TFeatures extends TableFeatures,
    in out TData extends RowData,
    TValue extends CellData = CellData,
  > {
    readonly align?: "left" | "right" | "center"
    /// Renders the cell in the mono face at id size. Every SKU, PO number and
    /// account code in this language is set that way.
    readonly mono?: boolean
    /// How this column can be narrowed, if it can be. Declaring it here — on
    /// the column itself — is what puts the column in the filter bar's
    /// "+ Filter" menu and attaches the shared predicate to it. See
    /// `lib/filters.ts` for why the declaration does not live in a list beside
    /// the table.
    readonly filter?: FilterSpec
  }
}
