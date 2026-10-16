import {
  useInfiniteQuery,
  useQuery,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { Suspense, useDeferredValue, useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { edge } from "@/lib/api"
import { useEdgeNodeIdentity } from "@/lib/edge-session"
import { money, moment } from "@/lib/format"
import { moneyOverviewQuery } from "@/lib/queries/finance"
import { useUnits } from "@/lib/queries/organisation"
import { tableSetup, type TableSetup } from "@/lib/table"
import { CardRow, Code, NumberCard } from "@/screens/finance-final/parts"
import { useSettledWindow } from "@/screens/finance/hooks"
import {
  PhoneFigures,
  SiteName,
  UnitName,
  UnitSelect,
  WindowControl,
} from "@/screens/finance/parts"
import { ScreenPending } from "@/screens/finance/pending"
import type {
  ExpenseWindow,
  MoneyAccountRow,
  PettyCashPosition,
} from "@itulah/contract"

/// What a shop spent out of its own hands, and what is left of the float.
///
/// # The policy this screen is drawn around
///
/// Spending is CENTRALISED (owner, 2026-09-07). A shop is not a place that
/// pays: it collects money and holds three floats, and each float has exactly
/// one job.
///
///   * **Cash on hand** — the day's takings. Banked daily, never spent from.
///   * **Petty cash** — an imprest float from head office. The only pot a
///     receipt may come out of, up to Rp 500.000 on a manager's signature.
///   * **Cashier float** — modal kasir. Fixed, for making change, and never an
///     expense route at all.
///
/// That is why the position table below leads with the two pots a manager may
/// NOT touch before it shows the one they may. A store manager reading "Rp 419
/// juta" against their name has to be told, in the same glance, that none of it
/// is theirs to spend — otherwise the honest answer to "how much can I still
/// spend" looks like a rounding error next to a number four orders of magnitude
/// larger.
///
/// # Why there is no approval queue on this screen
///
/// Because there is nothing waiting. The owner's correction of 2026-09-13 —
/// *"petty cash hak toko belanjakan bebas asalkan dibawah 500 ribu"* — makes a
/// small spend a RIGHT rather than a request, and the edge enforces the rest at
/// the counter: `store_expense.approved_by` is NOT NULL, `CHECK (approved_by <>
/// claimed_by)` refuses a self-signed receipt, and anything over the ceiling is
/// refused outright unless an ADMIN signs it. A receipt therefore cannot exist
/// unapproved, and a column headed "awaiting review" would be a column that is
/// empty forever.
///
/// Head office's real question is the harsher one, and the **Not in the book**
/// card answers it: not "which of these has nobody approved" but "which of
/// these has head office ever seen". Today that is all of them. See the note at
/// the foot of the screen.
export function Expenses() {
  return (
    <Suspense
      fallback={
        <ScreenPending crumb="Finance · Cash & Bank" title="Expenses">
          Reading the calendar…
        </ScreenPending>
      }
    >
      <ExpensesScreen />
    </Suspense>
  )
}

function ExpensesScreen() {
  const range = useSettledWindow()
  const [unit, setUnit] = useState("")

  // Which shop's node this hub is actually proxied to. Resolves to `null` for
  // an unreachable node rather than throwing, which is the honest reading: a
  // shop whose box is off is a fact about the shop, not a failure of the hub.
  const where = useEdgeNodeIdentity()
  const nodeSite = where.data?.site_id ?? null
  // The node answers for a SITE; the position table and the filter are
  // units' books. The unit owning the node's site is the row its tin is.
  const register = useUnits()
  const nodeUnit =
    register.data?.find((one) => one.sites.some((s) => s.id === nodeSite))
      ?.id ?? null
  // A DC edge serves no `/store/*` routes at all — `store_router_with_sync`
  // refuses to build on anything but a Store node — so asking one for a petty
  // cash book is a guaranteed 404 dressed up as an error state.
  const onAShop = where.data?.node_role === "STORE"

  // Where the money sits, per unit, as at today. The centre's own figure and
  // the centre's own `unit` filter: narrowing here is a narrower REQUEST, never
  // a slice of a wider answer held in the browser.
  const askedUnit = useDeferredValue(unit)
  const positions = useSuspenseQuery(
    moneyOverviewQuery(askedUnit === "" ? null : askedUnit)
  )

  const tin = useQuery({
    queryKey: pettyCashKey(nodeSite),
    queryFn: ({ signal }) =>
      edge.get<PettyCashPosition>("/api/v1/store/petty-cash", { signal }),
    enabled: onAShop,
  })

  // The book as ONE list — receipts and hand-overs merged, newest first — a
  // page at a time. `paged=true` is what asks the node for that; without it
  // the node answers the newest hundred of each half side by side, which
  // cannot be scrolled as one book.
  const book = useInfiniteQuery({
    queryKey: [...bookKey(nodeSite, range.from, range.to), "pages"],
    queryFn: ({ pageParam, signal }) =>
      edge.get<ExpenseWindow>(
        `/api/v1/store/expenses?from=${range.from}&to=${range.to}` +
          `&utc_offset_minutes=${-new Date().getTimezoneOffset()}` +
          `&limit=${BOOK_PAGE}&paged=true` +
          (pageParam === undefined
            ? ""
            : `&cursor=${encodeURIComponent(pageParam)}`),
        { signal }
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: (previous) => previous,
    enabled: onAShop,
  })
  const head = book.data?.pages[0]

  const units = useMemo(() => unitsOf(positions.data.rows), [positions.data])

  // The rows of one petty cash book, in and out, newest first. The edge answers
  // with both halves of the span on purpose — see `ExpenseWindow.top_ups` — so
  // that "what came in and what went out" is one page rather than two screens a
  // manager has to hold in their head.
  const entries = useMemo(
    () => bookEntries(book.data?.pages ?? []),
    [book.data]
  )

  // Whether the unit the reader picked is the unit whose receipts this hub can
  // actually read. Everything below the position table belongs to ONE node.
  const showingBook = onAShop && (unit === "" || unit === nodeUnit)

  /// The float position, per unit. Only the node this hub is proxied to can be
  /// asked what is really in its tin. Every other unit is `—` — not zero:
  /// "nobody has told us" and "there is nothing in it" are different claims
  /// and a float screen may not render them the same.
  const positionColumns = useMemo<ColumnDef<TableSetup, UnitFloat>[]>(() => {
    const counted = (row: UnitFloat): number | null =>
      row.unit_id === nodeUnit && tin.data !== undefined && tin.data !== null
        ? tin.data.balance_minor
        : null
    return [
      {
        id: "unit",
        accessorFn: (row) => row.unit_id,
        header: "Unit",
        size: 200,
        enableSorting: false,
        meta: { card: "title", grow: 180 },
        // The client's code and name, never our id.
        cell: ({ row }) => (
          <UnitName id={row.original.unit_id} className="text-ink" />
        ),
      },
      // The two pots a shop may not spend from, drawn quietly on purpose:
      // they are context for the third column, not an answer to "how much
      // can I spend".
      {
        id: "cash",
        accessorFn: (row) => row.cash,
        header: "Cash on hand",
        size: 160,
        enableSorting: false,
        meta: { align: "right", card: "metric", priority: 2 },
        cell: ({ row }) => (
          <span className="text-mute">{money(row.original.cash)}</span>
        ),
      },
      {
        id: "float",
        accessorFn: (row) => row.float,
        header: "Cashier float",
        size: 160,
        enableSorting: false,
        meta: { align: "right", card: "metric", priority: 2 },
        cell: ({ row }) => (
          <span className="text-mute">{money(row.original.float)}</span>
        ),
      },
      {
        id: "petty",
        accessorFn: (row) => row.petty,
        header: "Petty cash · per books",
        size: 205,
        enableSorting: false,
        meta: { align: "right", card: "metric" },
        cell: ({ row }) => money(row.original.petty),
      },
      {
        id: "shop",
        accessorFn: (row) => counted(row),
        header: "Petty cash · per the shop",
        size: 235,
        enableSorting: false,
        meta: { align: "right", card: "metric" },
        cell: ({ row }) => {
          const shop = counted(row.original)
          return shop === null ? (
            <span className="text-faint">—</span>
          ) : (
            money(shop)
          )
        },
      },
      {
        id: "difference",
        accessorFn: (row) => {
          const shop = counted(row)
          return shop === null ? null : shop - row.petty
        },
        header: "Difference",
        size: 150,
        enableSorting: false,
        meta: { align: "right", card: "metric" },
        cell: ({ row }) => {
          const shop = counted(row.original)
          const difference = shop === null ? null : shop - row.original.petty
          return difference === null ? (
            <span className="text-faint">—</span>
          ) : difference === 0 ? (
            <Pill tone="ok">agreed</Pill>
          ) : (
            <span className="text-bad-fg">
              {difference > 0 ? "+" : "−"}
              {money(Math.abs(difference))}
            </span>
          )
        },
      },
    ]
  }, [nodeUnit, tin.data])
  const positionTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: units,
        columns: positionColumns,
        getRowId: (row: UnitFloat) => row.unit_id,
      }),
      [units, positionColumns]
    )
  )
  const bookTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: entries,
        columns: BOOK_COLUMNS,
        getRowId: (row: BookEntry) => row.id,
      }),
      [entries]
    )
  )

  return (
    <PageContent>
      <PageHeader crumb="Finance · Cash & Bank" title="Expenses" />

      <Toolbar>
        <WindowControl range={range} />
        <UnitSelect
          value={unit}
          onChange={setUnit}
          className="h-8 w-44"
          aria-label="Unit"
        />
        <Toolbar.Spacer />
        {/* The effective answer in words, always. A date box filled with today
            and a date box the server defaulted look identical to a reader. */}
        <span className="text-[0.9375rem] text-mute">
          {range.chip}
          {unit === "" ? (
            " · all units"
          ) : (
            <>
              {" · "}
              <UnitName id={unit} />
            </>
          )}
        </span>
      </Toolbar>

      <div className="flex flex-col gap-5">
        {/* ── How much can I still spend ───────────────────────────────── */}
        <section className="flex flex-col gap-2.5">
          <h2 className="text-[0.9375rem] font-semibold text-ink">
            The tin{" "}
            {nodeSite !== null && (
              <span className="font-normal text-mute">
                at <SiteName id={nodeSite} />
              </span>
            )}
          </h2>
          {!onAShop ? (
            <EmptyState>
              No shop node is reachable from this hub, so nobody&rsquo;s float
              can be counted. The centre keeps no petty cash book of its own —
              the tin is a figure on the machine standing in the shop.
            </EmptyState>
          ) : tin.isPending ? (
            <LoadingState>Counting what is left in the tin…</LoadingState>
          ) : tin.error ? (
            <ErrorState error={tin.error} onRetry={() => void tin.refetch()} />
          ) : (
            <>
              <PhoneFigures
                items={[
                  {
                    label: "Float handed over",
                    value: tin.data.float_in_minor,
                  },
                  { label: "Spent", value: tin.data.spent_minor },
                  {
                    label: "Left to spend",
                    value: tin.data.balance_minor,
                    tone:
                      tin.data.balance_minor <= 0
                        ? "bad"
                        : tin.data.balance_minor < tin.data.code_above_minor
                          ? "warn"
                          : "ok",
                  },
                  {
                    label: "Never reached the book",
                    value: tin.data.spent_minor,
                    tone: "warn",
                  },
                ]}
              />
              <div className="max-md:hidden">
                <CardRow columns={4}>
                  <NumberCard
                    label="Float handed over"
                    value={tin.data.float_in_minor}
                    note={`${tin.data.top_up_count} top-up${tin.data.top_up_count === 1 ? "" : "s"} since the tin was opened`}
                  />
                  <NumberCard
                    label="Spent"
                    value={tin.data.spent_minor}
                    note={`${tin.data.expense_count} receipts`}
                  />
                  {/* The manager's question, and the only card that is allowed to
                  turn a colour. An imprest float is a lifetime figure, not a
                  period one: money handed over in July is still in the tin in
                  September, so this does not move when the span above does. */}
                  <NumberCard
                    label="Left to spend"
                    value={tin.data.balance_minor}
                    tone={
                      tin.data.balance_minor <= 0
                        ? "bad"
                        : tin.data.balance_minor < tin.data.code_above_minor
                          ? "warn"
                          : "ok"
                    }
                    note={`Code from Finance above ${money(tin.data.code_above_minor)}`}
                  />
                  {/* Head office's question, answered the way it really stands.
                  The node captures every receipt and uploads it, and the centre
                  has no arm that applies it — so this is not "unapproved", it is
                  "unseen", and it is the whole of what was spent. */}
                  <NumberCard
                    label="Never reached the book"
                    value={tin.data.spent_minor}
                    tone="warn"
                    note="not one receipt has been posted at the centre"
                  />
                </CardRow>
              </div>
            </>
          )}
        </section>

        {/* ── The float position, per unit ─────────────────────────────── */}
        <section
          className="list-swap flex flex-col gap-2.5"
          aria-busy={askedUnit !== unit || undefined}
        >
          <h2 className="text-[0.9375rem] font-semibold text-ink">
            Float position, per unit
          </h2>
          {units.length === 0 ? (
            <EmptyState>
              No cash account is mapped yet. A pot is a meaning bound to an
              account on the Account map, and until one is bound there is no
              float to be in a position about.
            </EmptyState>
          ) : (
            <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
              <DataTable<UnitFloat>
                table={positionTable}
                summary={{
                  unit: `${units.length} unit${units.length === 1 ? "" : "s"}`,
                  cash: money(units.reduce((sum, row) => sum + row.cash, 0)),
                  float: money(units.reduce((sum, row) => sum + row.float, 0)),
                  petty: money(units.reduce((sum, row) => sum + row.petty, 0)),
                  // Deliberately not totalled. One node out of fourteen has
                  // answered, so a figure here would read as what the estate
                  // holds in petty cash while being one shop's tin.
                  shop: <span className="text-faint">—</span>,
                  difference: <span className="text-faint">—</span>,
                }}
                pageScroll
                cardSort={false}
                cardsApart
              />
            </Card>
          )}
        </section>

        {/* ── The receipts ─────────────────────────────────────────────── */}
        <section className="flex flex-col gap-2.5">
          <h2 className="text-[0.9375rem] font-semibold text-ink">
            The petty cash book
            {nodeSite !== null && (
              <span className="font-normal text-mute">
                {" · "}
                <SiteName id={nodeSite} />
              </span>
            )}
          </h2>
          {!onAShop ? (
            <EmptyState>
              <Code>GET /api/v1/store/expenses</Code> is served by the machine
              standing in the shop — one node per unit, and this hub is proxied
              to exactly one node.{" "}
              {where.data === null || where.data === undefined
                ? "That node is not answering, so there is no book to read."
                : `That node is a ${where.data.node_role === "DC" ? "distribution centre" : "central"} node and keeps no shop's petty cash book.`}{" "}
              A receipt written at Store 04 is readable from Store 04 and
              nowhere else.
            </EmptyState>
          ) : !showingBook ? (
            <EmptyState>
              The unit filter is on <UnitName id={unit} />, and the only petty
              cash book this hub can read is <SiteName id={nodeSite} />
              &rsquo;s — one node per unit, and the hub is proxied to one node.
              Clear the filter to see it.
            </EmptyState>
          ) : book.isPending ? (
            <LoadingState>
              Reading what the shop spent over this span…
            </LoadingState>
          ) : book.error && book.data === undefined ? (
            // Only a first read that failed. A later page that fails keeps the
            // book on screen and says so at its foot (`<LoadMore>`).
            <ErrorState
              error={book.error}
              onRetry={() => void book.refetch()}
            />
          ) : entries.length === 0 ? (
            <EmptyState>
              Nothing went in or out of the tin between {range.chip}. The tin
              itself is unaffected by that — an imprest float spans months, and
              the cards above count its whole life.
            </EmptyState>
          ) : (
            <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
              <DataTable<BookEntry>
                refresh={[book]}
                table={bookTable}
                more={book}
                // The node's own figures for the whole span, not sums of the
                // rows above: the book pages, and a sum here would be a figure
                // about how far somebody had scrolled.
                summary={{
                  reason: <span className="text-mute">over this span</span>,
                  in: money(head?.top_up_minor),
                  out: money(head?.spent_minor),
                }}
                pageScroll
                cardSort={false}
                cardsApart
              />
            </Card>
          )}
        </section>
      </div>
    </PageContent>
  )
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/// Why these two keys are written here and not in `financeKeys`.
///
/// Because they are not the centre's. `lib/queries/finance.ts` is the cache the
/// live Finance module and this one share, and sharing it is the whole point —
/// one request, and the two can never disagree about a number. These two
/// answers come from a DIFFERENT SERVER, and the house already has a namespace
/// for that: `EDGE_KEY_PREFIX` in `lib/edge-session.tsx`, which every warehouse
/// key carries so that signing out of the node drops its answers and leaves the
/// centre's cache untouched. A key of mine under `financeKeys` would survive
/// that sweep and serve one shop's tin to whoever signed in next.
///
/// The node's site is in the key for the same reason. Two nodes' books under
/// one key is one shop's receipts shown over another shop's name.
const pettyCashKey = (siteId: string | null) =>
  ["edge", "petty-cash", siteId ?? "unknown"] as const

const bookKey = (siteId: string | null, from: string, to: string) =>
  ["edge", "petty-cash", siteId ?? "unknown", "book", from, to] as const

/// One page of the petty cash book. The book scrolls on — this is the size of
/// a step, not a ceiling. The node clamps anything above 500.
const BOOK_PAGE = 100

// ---------------------------------------------------------------------------
// Shaping
// ---------------------------------------------------------------------------

/// One unit's three pots, from the centre's own money rows.
interface UnitFloat {
  readonly unit_id: string
  /// The day's takings. Banked daily, never spent from.
  readonly cash: number
  /// The imprest float — the only pot a receipt may come out of.
  readonly petty: number
  /// Modal kasir. Fixed, and not an expense route at all.
  readonly float: number
}

/// Fold the money rows into one row per unit.
///
/// Grouped in arrival order rather than sorted: the server returns the chart's
/// own order — head office first, then the shops as the client numbers them —
/// and re-sorting here would be a second opinion about where head office goes.
/// `ho` happens to sort before `store-01` today, which is the right place by
/// accident; it was `dc`, which sorted between `store-03` and `store-04`, and
/// the next rename is under no obligation to be luckier.
function unitsOf(rows: readonly MoneyAccountRow[]): UnitFloat[] {
  // Mutable inside this function, `readonly` to everyone outside it. The map
  // used to be typed `{ site_id: string } & Record<string, number>`, which is a
  // contradiction — the index signature demands every property be a number
  // while `site_id` is a string — and it forced a cast on the way out that
  // stopped the compiler checking any of this. Naming the three pots instead
  // means a fourth one added to `MoneyPot` fails here rather than silently
  // landing nowhere.
  type Tally = { -readonly [K in keyof UnitFloat]: UnitFloat[K] }
  const table = new Map<string, Tally>()
  for (const row of rows) {
    if (
      row.pot !== "CASH" &&
      row.pot !== "PETTY_CASH" &&
      row.pot !== "CASHIER_FLOAT"
    ) {
      continue
    }
    let unit = table.get(row.unit_id)
    if (unit === undefined) {
      unit = { unit_id: row.unit_id, cash: 0, petty: 0, float: 0 }
      table.set(row.unit_id, unit)
    }
    // Summed rather than assigned: one meaning in one unit may legitimately be
    // mapped to more than one account, and the last one written would otherwise
    // silently win.
    if (row.pot === "CASH") unit.cash += row.per_books_minor
    else if (row.pot === "PETTY_CASH") unit.petty += row.per_books_minor
    else unit.float += row.per_books_minor
  }
  return [...table.values()]
}

/// One line of a petty cash book — a hand-over in, or a receipt out.
interface BookEntry {
  readonly id: string
  readonly at: string
  readonly kind: string
  readonly payee: string
  readonly reason: string
  readonly claimedBy: string
  readonly approvedBy: string
  /// `SUPERVISOR` or `ADMIN` on a receipt; absent on a hand-over, which has no
  /// ceiling to be over.
  readonly rung: string | null
  readonly in: number
  readonly out: number
}

/// The nine kinds of cost a shop may file against, as a person says them.
///
/// Written out here and nowhere else in this app, because there is nowhere else
/// to get them: they are a `CHECK` constraint in the edge's migration 0038 and
/// a `const` array in `edge/petty.rs`, not a list any endpoint serves. The
/// house `label()` would render `expense_household` as "Expense household",
/// which is the key with a capital letter rather than a name.
const CATEGORY: Readonly<Record<string, string>> = {
  expense_electricity: "Electricity",
  expense_water: "Water",
  expense_telephone: "Telephone",
  expense_household: "Household",
  expense_stationery: "Stationery",
  expense_repairs: "Repairs",
  expense_transport: "Transport",
  expense_cleaning: "Cleaning",
  expense_misc: "Miscellaneous",
}

/// Which rung said yes. Kept because the ceiling may move, and an audit six
/// months from now asks who was allowed to approve this, THEN.
const rungWord = (rung: string): string =>
  rung === "FINANCE" ? "code" : rung === "ADMIN" ? "head office" : "store"

/// The petty cash book. On a card the payee names it, what it was for and when
/// follow, who signed it after, the kind of entry at the right and the amount,
/// in or out, as its one figure.
const BOOK_COLUMNS: ColumnDef<TableSetup, BookEntry>[] = [
  {
    id: "at",
    accessorFn: (row) => row.at,
    header: "When",
    size: 150,
    enableSorting: false,
    meta: { card: "meta", priority: 2 },
    cell: ({ row }) => moment(row.original.at),
  },
  {
    id: "kind",
    accessorFn: (row) => row.kind,
    header: "Kind",
    size: 140,
    enableSorting: false,
    meta: { card: "status" },
    cell: ({ row }) => (
      <Pill tone={row.original.out === 0 ? "info" : "neutral"}>
        {row.original.kind}
      </Pill>
    ),
  },
  {
    id: "payee",
    accessorFn: (row) => row.payee,
    header: "Payee",
    size: 170,
    enableSorting: false,
    meta: { card: "title" },
    cell: ({ row }) => (
      <span className="block truncate">{row.original.payee}</span>
    ),
  },
  {
    id: "reason",
    accessorFn: (row) => row.reason,
    header: "What it was for",
    size: 220,
    enableSorting: false,
    meta: { card: "meta", grow: 180 },
    cell: ({ row }) => (
      <span className="block truncate text-body" title={row.original.reason}>
        {row.original.reason}
      </span>
    ),
  },
  {
    id: "claimed",
    accessorFn: (row) => row.claimedBy,
    header: "Claimed by",
    size: 120,
    enableSorting: false,
    meta: { card: "hide", priority: 3 },
    cell: ({ row }) => (
      <span className="block truncate">{row.original.claimedBy}</span>
    ),
  },
  {
    id: "signed",
    accessorFn: (row) => row.approvedBy,
    header: "Signed by",
    size: 170,
    enableSorting: false,
    meta: { card: "meta", priority: 2 },
    cell: ({ row }) => (
      <span className="block truncate">
        {row.original.approvedBy}
        {row.original.rung !== null && (
          <span className="ml-1.5 text-[0.9375rem] text-mute">
            {rungWord(row.original.rung)}
          </span>
        )}
      </span>
    ),
  },
  {
    id: "in",
    accessorFn: (row) => (row.in === 0 ? null : row.in),
    header: "In",
    size: 130,
    enableSorting: false,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) =>
      row.original.in === 0 ? (
        <span className="text-hairline-strong">·</span>
      ) : (
        money(row.original.in)
      ),
  },
  {
    id: "out",
    accessorFn: (row) => (row.out === 0 ? null : row.out),
    header: "Out",
    size: 130,
    enableSorting: false,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) =>
      row.original.out === 0 ? (
        <span className="text-hairline-strong">·</span>
      ) : (
        money(row.original.out)
      ),
  },
]

/// Both halves of the span as one book, newest first, across every page
/// loaded so far.
function bookEntries(pages: readonly ExpenseWindow[]): BookEntry[] {
  const entries: BookEntry[] = pages.flatMap((window) => [
    ...window.top_ups.map((topUp) => ({
      id: topUp.id,
      at: topUp.received_at,
      kind: "Float in",
      // The reference head office gave, when they gave one. A slip number, a
      // bank reference, or a date said over the phone — free text at the node,
      // and an em dash here when there was nothing to write down.
      payee: topUp.reference ?? "—",
      reason: topUp.note ?? "—",
      claimedBy: topUp.received_by,
      approvedBy: topUp.approved_by,
      rung: null,
      in: topUp.amount_minor,
      out: 0,
    })),
    ...window.expenses.map((expense) => ({
      id: expense.id,
      at: expense.spent_at,
      kind: CATEGORY[expense.category] ?? expense.category,
      payee: expense.payee,
      reason: expense.reason,
      claimedBy: expense.claimed_by,
      approvedBy: expense.approved_by ?? "—",
      rung: expense.approved_role,
      in: 0,
      out: expense.amount_minor,
    })),
  ])
  // RFC3339 in UTC at micro precision on both sides, so the strings sort the
  // way the instants do and no dates need parsing to merge two lists.
  return entries.sort((left, right) => right.at.localeCompare(left.at))
}
