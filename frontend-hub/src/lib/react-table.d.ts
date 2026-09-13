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
    /// This cell hands itself over to `DataTable`'s `rowAction` while its row
    /// is under the pointer. Declared on the status column, which is the one
    /// whose answer the verb follows from.
    readonly swap?: boolean
    /// Renders the cell in the mono face at id size. Every SKU, PO number and
    /// account code in this language is set that way.
    readonly mono?: boolean
    /// How this column can be narrowed, if it can be. Declaring it here — on
    /// the column itself — is what puts the column in the filter bar's
    /// "+ Filter" menu and attaches the shared predicate to it. See
    /// `lib/filters.ts` for why the declaration does not live in a list beside
    /// the table.
    readonly filter?: FilterSpec
    /// Where this column goes when the viewport is too narrow to be a table at
    /// all, and `<DataTable>` relays the same rows as cards.
    ///
    /// Declared on the column, beside its header and its cell, so one column
    /// definition serves both shapes and they cannot drift: a phone that shows
    /// a different set of facts from the desk is two screens with one name.
    /// Omitted, a sensible role is inferred — see `roleOf` in `data-table.tsx`
    /// — so a list nobody has thought about on a phone is still readable on
    /// one.
    readonly card?: "id" | "title" | "status" | "metric" | "meta" | "hide"
    /// What to drop first when the table fits the screen but its columns do
    /// not. `1` (the default) never drops; `3` goes first.
    ///
    /// This is the tablet's problem, and only the tablet's: a phone gets cards
    /// and a desk gets everything. DESIGN.md's rule that every column is a
    /// decision metric is what makes the ordering possible to state — a column
    /// somebody has to have is a 1, a column that helps is a 2, a column that
    /// is context is a 3.
    readonly priority?: 1 | 2 | 3
  }
}
