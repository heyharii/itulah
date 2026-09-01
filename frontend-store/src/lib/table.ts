import { tableFeatures } from "@tanstack/react-table"

/// The feature set the till's two tables are built against.
///
/// TanStack Table v9 registers nothing implicitly — every feature, and the row
/// model that powers it, has to be named here. Nothing is named: neither table
/// sorts, filters, paginates or hides a column, because both are already the
/// shape the node sent them in. A shop's sales matrix is three measures against
/// the buckets that were asked for, and a receipt list is the newest of a
/// window in the order they were rung up; letting somebody re-sort either would
/// be offering to break the only reading that means anything.
///
/// What the tables are for, then, is the header/row/cell model — one place per
/// column that says what its heading is and how its cell is drawn, instead of
/// the same column repeated across a `<thead>` and two `<tbody>` branches.
export const storeTableFeatures = tableFeatures({})

/// The feature set as a type, for the `TFeatures` parameter v9 threads through
/// `Table`, `Row`, `Column` and `ColumnDef`. It is invariant, so column
/// definitions pin this rather than staying generic.
export type StoreTableFeatures = typeof storeTableFeatures
