import { getRouteApi, useNavigate, useSearch } from "@tanstack/react-router"

/// Every sheet in the app, named once, and held in the URL.
///
/// A sheet is a thing you look at without leaving the list that produced it,
/// and that is exactly why *which one is open* belongs in the address bar
/// rather than in a `useState` beside the table. A sheet in component state
/// cannot be sent to a colleague, does not survive the reload a shop's browser
/// gets every morning, and cannot be opened by anything that is not a
/// descendant of the component holding it — which rules out the rail, the
/// command palette, and a notification saying "somebody amended a price on
/// PO-1183".
///
/// This is the file `nuqs` would be doing in another codebase; TanStack Router
/// validates search itself, so no second library is needed. It is a central
/// registry rather than a declaration per screen because the **root route has
/// to validate all of them at once**: Router merges the validated search of
/// every matched route, so declaring the keys once on the root is what makes
/// them legal on every route below it.
///
/// Adding a sheet is one line here plus a `useSheet("key")` at the call site.

/// An identifier out of a query string, or nothing.
///
/// Shape-checked rather than passed through: the value is handed to a query key
/// and then to the server, and an empty string is not an id — it is a sheet that
/// opens onto a request nobody can answer.
function id(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

/// A sheet with nothing to identify: it is either open or it is not.
///
/// `"true"` as well as `true`, because a pasted URL arrives as text and a flag
/// that only understood the boolean would silently ignore the link somebody
/// sent.
function flag(value: unknown): true | undefined {
  return value === true || value === "true" ? true : undefined
}

/// A `YYYY-MM-DD` out of a query string, or nothing.
///
/// Shape-checked like the rest: these reach the server as a date, and a
/// hand-edited URL should not be able to open a screen onto a request that can
/// only answer 400. A day-close report for a malformed date is not a stale
/// answer — it is a different question, badly asked.
function isoDay(value: unknown): string | undefined {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : undefined
}

/// A whole positive number carried as text — a count of buckets, a page size.
function counted(value: unknown): string | undefined {
  return typeof value === "string" && /^[1-9]\d{0,3}$/.test(value)
    ? value
    : undefined
}

/// One of a fixed set. Anything else is dropped rather than passed on: the
/// value reaches the server as a grouping, and `?bucket=fortnight` is a 400
/// dressed up as a link.
function oneOf<const T extends readonly string[]>(allowed: T) {
  return (value: unknown): T[number] | undefined =>
    typeof value === "string" && (allowed as readonly string[]).includes(value)
      ? (value as T[number])
      : undefined
}

/// The filter bar's clauses, as one string.
///
/// Shape-checked and length-capped here; the clauses themselves are parsed by
/// `decodeFilters`, which drops anything it does not understand and anything
/// naming a column the screen does not have. Two stages rather than one because
/// this file cannot know which columns a screen draws, and a validator that
/// guessed would either reject legal links or wave through nonsense.
function clauses(value: unknown): string | undefined {
  return typeof value === "string" &&
    value !== "" &&
    value.length <= 2048 &&
    // A control character in a query parameter is not a filter, it is somebody
    // probing the parser.
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f]/.test(value)
    ? value
    : undefined
}

/// The key is the query parameter, so it is also what somebody reads in the
/// address bar — `?order=` and not `?purchaseOrderId=`.
///
/// Not everything here opens a sheet. `bucket`, `span` and `date` are a
/// screen's own controls, and they live in the URL for the same reason a sheet
/// does: a report is something you send somebody, and the window it was read
/// over is half of what you are sending.
export const SHEET_PARAMS = {
  /// How a browsable list is ordered. In the URL because an order is half of
  /// what somebody is looking at — "the newest ones" is a link worth sending.
  sort: oneOf(["newest", "price_low", "price_high"] as const),
  /// What was typed into a search box, when that box filters a whole screen
  /// rather than a card. In the URL so a filtered catalogue can be sent to a
  /// colleague and survives the back button — the two things a `useState`
  /// search box cannot do.
  q: id,
  /// What the filter bar is narrowing by, as `column:operator:value~…`. In the
  /// URL for the same reasons `q` is, and one more: a filtered list is the
  /// unit of work people hand each other — "the items with no barcode" is a
  /// job, and it should be a link.
  f: clauses,
  /// The second bar, for the two screens that draw two filterable tables at
  /// once. Never used alone.
  f2: clauses,
  // procurement
  order: id,
  supplier: id,
  item: id,
  amendment: id,
  /// The basket itself, open over whatever the buyer was doing. A flag rather
  /// than an id: there is one basket, and it is not a record you navigate to —
  /// which is why it is no longer a screen in the menu.
  cart: flag,
  /// One article-setup session: the receipt that arrived without an article,
  /// and the variants being declared against it.
  setup: id,
  /// A delivery line waiting to be told what it is. Distinct from `setup`
  /// because they are two moments: this one has no session yet, and opening
  /// one is the whole point of the sheet it names.
  receipt: id,
  basket: flag,
  // articles
  /// One master article, keyed by its eight-digit code rather than a uuid.
  /// The code is the identifier every other system already speaks — it is on
  /// the label, in the SKU and in the supplier's own paperwork — so a link to
  /// an article is a thing somebody can type from a garment in their hand.
  article: id,
  // inventory
  pool: id,
  allotment: id,
  count: id,
  movement: id,
  // finance
  entry: id,
  account: id,
  bill: id,
  asset: id,
  /// "2026-09" — the fiscal month whose close panel is open. A period is a
  /// record people send each other ("seal 412 entries in 2026-08"), not
  /// transient UI.
  period: id,
  /// One imported bank statement, and the reconcile session over it.
  statement: id,
  /// One semantic posting key in the account map.
  mapping: id,
  // commercial
  book: id,
  price: id,
  campaign: id,
  rule: id,
  // people
  employee: id,
  // storeops
  sale: id,
  /// A site id. Analytics reuses this rather than adding `shop`: two names for
  /// one site id is exactly the drift this registry exists to prevent.
  store: id,
  /// The sale-return record. Named `refund` because `return` is a reserved word
  /// and `?return=` reads like a redirect parameter.
  refund: id,
  /// Whose history is being read. There is no customer search endpoint, so the
  /// member id is typed in — without a key that screen cannot be linked to or
  /// reloaded at all.
  member: id,
  // workplace
  thread: id,
  /// One filed document, with its evidence.
  document: id,
  conversation: id,
  file: id,
  // analytics — a report's window, which is half of what a shared report says
  bucket: oneOf(["day", "week", "month"] as const),
  span: counted,
  date: isoDay,
  // system
  user: id,
  origin: id,
  notifications: flag,
} as const

export type SheetKey = keyof typeof SHEET_PARAMS

/// Which record kind the audit log files each sheet's subject under.
///
/// The kinds are the server's, not ours: `audit_actions` derives them from the
/// path shape, so `/api/v1/purchase-orders/{id}` files under `purchase_order`
/// and nothing here gets to disagree. Every value below was read back from a
/// running node rather than inferred from the Rust — the singularisation has
/// edge cases ("addresses" → "address") and guessing wrong would show one
/// record's history on another record's sheet.
///
/// A key with no entry is a sheet whose subject the server does not name: the
/// window sheets, the basket, the notification drawer. They get no trail, which
/// is correct — there is no record for one to belong to.
const SHEET_SUBJECT: Partial<Record<SheetKey, string>> = {
  order: "purchase_order",
  supplier: "supplier",
  item: "supplier_item",
  amendment: "purchase_price_amendment",
  setup: "article_setup",
  pool: "pool",
  allotment: "allotment",
  count: "count",
  entry: "journal",
  account: "account",
  bill: "bill",
  asset: "asset",
  statement: "bank_statement",
  book: "publication",
  campaign: "campaign",
  rule: "commercial_rule",
  employee: "employee",
  sale: "sale",
  refund: "return",
  member: "customer",
  thread: "discussion",
  conversation: "conversation",
  document: "document",
  user: "user",
}

export type SheetSearch = {
  [K in SheetKey]?: ReturnType<(typeof SHEET_PARAMS)[K]>
}

/// The root route's `validateSearch`.
///
/// Unknown keys are dropped rather than preserved: a URL is a public surface,
/// and letting arbitrary parameters ride along means a stale link keeps
/// resurrecting state nothing reads any more.
export function validateSheetSearch(raw: Record<string, unknown>): SheetSearch {
  const out: Record<string, unknown> = {}
  for (const [key, check] of Object.entries(SHEET_PARAMS)) {
    const value = check(raw[key])
    if (value !== undefined) out[key] = value
  }
  return out as SheetSearch
}

const rootApi = getRouteApi("__root__")

/// Open, read and close one sheet.
///
/// `replace: true` on close so dismissing a sheet does not leave an entry in
/// the history: pressing back after closing should go to the previous *screen*,
/// not reopen what was just dismissed. Opening does push, because arriving at a
/// record is a place you can go back from.
export function useSheet<K extends SheetKey>(key: K) {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as SheetSearch
  const value = search[key]

  const kind = SHEET_SUBJECT[key]

  return {
    /// The id in the URL, or `undefined`. Feed it straight to `enabled:`.
    value,
    isOpen: value !== undefined,
    /// Hand straight to `<Sheet subject={…}>` — the record's history, without
    /// each screen restating which kind of record it is showing.
    subject:
      kind !== undefined && typeof value === "string"
        ? { kind, id: value }
        : undefined,
    open: (next: SheetSearch[K] extends true | undefined ? true : string) =>
      navigate({
        // The screen does not change; only which record is being looked at.
        to: ".",
        search: (prev: SheetSearch) => ({ ...prev, [key]: next }),
        // Said here as well as in `routes.tsx`, and not redundantly: the
        // router's `pathChanged` predicate is only consulted by a browser that
        // supports view-transition *types*, and one with view transitions but
        // without them would take the default and fade the screen behind every
        // sheet that opened. A sheet already animates; the page under it is
        // meant to hold still.
        viewTransition: false,
      }),
    close: () =>
      navigate({
        to: ".",
        replace: true,
        search: (prev: SheetSearch) => ({ ...prev, [key]: undefined }),
        viewTransition: false,
      }),
  }
}

export { rootApi }
