import "@tanstack/react-table"

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
  }
}
