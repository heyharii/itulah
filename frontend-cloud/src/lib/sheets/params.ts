/// Every sheet in the app, named once.
///
/// A sheet is a thing you look at without leaving the list that produced it,
/// and that is exactly why which one is open belongs in the URL rather than in
/// a `useState` beside the table. A sheet held in component state cannot be
/// sent to a colleague, does not survive the reload a shop's browser gets
/// every morning, and cannot be opened by anything that is not a descendant of
/// the component holding the state — which rules out the rail, the command
/// palette, and a notification saying "somebody amended a price on PO-1183".
///
/// This is the file nuqs would be doing in another codebase. It is a registry
/// rather than a call site per sheet because the root route has to validate
/// all of them in one go: TanStack Router merges the search of every matched
/// route, so declaring the sheet keys once on the root is what makes them
/// legal on all sixty-seven routes below it.
///
/// Adding a sheet is one line here, one domain hook, and one entry in
/// `components/sheets/global-sheets.tsx`.

/// An identifier out of a query string, or nothing.
///
/// Shape-checked rather than passed through, for the reason the sales and
/// discussion filters are: the value is handed to a query key and then to the
/// server, and an empty string is not an id — it is a sheet that opens onto a
/// request nobody can answer.
function id(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

/// A `YYYY-MM-DD` out of a query string, or nothing.
///
/// Shape-checked like the rest: these reach the server as a date span, and a
/// hand-edited URL should not be able to open a panel onto a request that can
/// only answer 400.
function isoDay(value: unknown): string | undefined {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : undefined
}

/// A sheet with nothing to identify: it is either open or it is not.
///
/// `"true"` as well as `true` because a pasted URL arrives as text, and a flag
/// that only understood the boolean would silently ignore the link somebody
/// sent.
function flag(value: unknown): true | undefined {
  return value === true || value === "true" ? true : undefined
}

/// The whole set. The key is the query parameter, so it is also what somebody
/// reads in the address bar — `?item=` and not `?supplierItemId=`.
export const SHEET_PARAMS = {
  /// One supplier item, opened from the catalogue.
  item: id,
  /// One purchase order and what has arrived against it.
  order: id,
  /// One person's record.
  employee: id,
  /// One allotment: what was promised and how far it has got.
  allotment: id,
  /// One journal entry, down to its lines.
  entry: id,
  /// One price book, and the prices in it.
  book: id,
  /// One shop over one span, down to the receipts. Three keys rather than one:
  /// a cell in the sales table is a shop *and* a period, and squashing them
  /// into a single value would make the address unreadable and the parser a
  /// second place dates are defined.
  sale: id,
  saleFrom: isoDay,
  saleTo: isoDay,
  /// What this buyer has picked out so far.
  basket: flag,
  /// Work that came looking for you.
  notifications: flag,
} as const

export type SheetKey = keyof typeof SHEET_PARAMS

/// What a sheet parameter carries. `string` for the ones that name a record,
/// `true` for the ones that are only open or shut.
export type SheetValue<K extends SheetKey> = Exclude<
  ReturnType<(typeof SHEET_PARAMS)[K]>,
  undefined
>

export type SheetSearch = {
  [K in SheetKey]?: SheetValue<K>
}

/// The root route's `validateSearch`.
///
/// Keys are omitted rather than set to `undefined` when they do not parse: a
/// key TanStack Router does not receive back is a key it drops from the URL,
/// which is how a closed sheet leaves no trace in the address bar.
///
/// It governs only the keys above. Every other search parameter in the app —
/// the sales span, the discussion filters, the ledger's account — is validated
/// by the route that owns it and merged over this.
export function validateSheetSearch(
  search: Record<string, unknown>
): SheetSearch {
  const open: Record<string, unknown> = {}
  for (const [key, parse] of Object.entries(SHEET_PARAMS)) {
    const value = parse(search[key])
    if (value !== undefined) open[key] = value
  }
  return open as SheetSearch
}
