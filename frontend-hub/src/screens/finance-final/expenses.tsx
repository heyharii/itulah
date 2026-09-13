import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Truncated,
} from "@/components/ui/states"
import { edge } from "@/lib/api"
import { useEdgeNodeIdentity } from "@/lib/edge-session"
import { money, moment } from "@/lib/format"
import { financeKeys, moneyOverview } from "@/lib/queries/finance"
import {
  CardRow,
  Code,
  DebitCredit,
  Grid,
  Note,
  NumberCard,
  Td,
  Th,
  TotalRow,
} from "@/screens/finance-final/parts"
import { useWindow } from "@/screens/finance/hooks"
import {
  LocationSelect,
  SiteName,
  WindowControl,
} from "@/screens/finance/parts"
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
  const range = useWindow()
  const [site, setSite] = useState("")

  // Which shop's node this hub is actually proxied to. Resolves to `null` for
  // an unreachable node rather than throwing, which is the honest reading: a
  // shop whose box is off is a fact about the shop, not a failure of the hub.
  const where = useEdgeNodeIdentity()
  const nodeSite = where.data?.site_id ?? null
  // A DC edge serves no `/store/*` routes at all — `store_router_with_sync`
  // refuses to build on anything but a Store node — so asking one for a petty
  // cash book is a guaranteed 404 dressed up as an error state.
  const onAShop = where.data?.node_role === "STORE"

  // Where the money sits, per unit, as at today. The centre's own figure and
  // the centre's own `site` filter: narrowing here is a narrower REQUEST, never
  // a slice of a wider answer held in the browser.
  const positions = useQuery({
    queryKey: financeKeys.money(null, site === "" ? null : site),
    queryFn: ({ signal }) =>
      moneyOverview(site === "" ? {} : { site }, signal),
  })

  const tin = useQuery({
    queryKey: pettyCashKey(nodeSite),
    queryFn: ({ signal }) =>
      edge.get<PettyCashPosition>("/api/v1/store/petty-cash", { signal }),
    enabled: onAShop,
  })

  const book = useQuery({
    queryKey: bookKey(nodeSite, range.from, range.to),
    queryFn: ({ signal }) =>
      edge.get<ExpenseWindow>(
        `/api/v1/store/expenses?from=${range.from}&to=${range.to}` +
          `&utc_offset_minutes=${-new Date().getTimezoneOffset()}&limit=100`,
        { signal }
      ),
    enabled: onAShop,
  })

  const units = useMemo(
    () => unitsOf(positions.data?.rows ?? []),
    [positions.data]
  )

  // The rows of one petty cash book, in and out, newest first. The edge answers
  // with both halves of the span on purpose — see `ExpenseWindow.top_ups` — so
  // that "what came in and what went out" is one page rather than two screens a
  // manager has to hold in their head.
  const entries = useMemo(() => bookEntries(book.data), [book.data])

  // Whether the unit the reader picked is the unit whose receipts this hub can
  // actually read. Everything below the position table belongs to ONE node.
  const showingBook = onAShop && (site === "" || site === nodeSite)

  return (
    <PageContent>
      <PageHeader
        crumb="Finance final · Store"
        title="Expenses"
        sub="What a shop spent out of its own hands, what it was for, and how much of the float is left."
      />

      <Toolbar>
        <WindowControl range={range} />
        <LocationSelect
          value={site}
          onChange={setSite}
          className="h-8 w-44"
          aria-label="Location"
        />
        <Toolbar.Spacer />
        {/* The effective answer in words, always. A date box filled with today
            and a date box the server defaulted look identical to a reader. */}
        <span className="text-[0.71875rem] text-mute">
          {range.chip}
          {site === "" ? (
            " · every location"
          ) : (
            <>
              {" · "}
              <SiteName id={site} />
            </>
          )}
        </span>
      </Toolbar>

      <div className="flex flex-col gap-5">
        {/* ── How much can I still spend ───────────────────────────────── */}
        <section className="flex flex-col gap-2.5">
          <h2 className="text-[0.8125rem] font-semibold text-ink">
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
                    : tin.data.balance_minor < tin.data.manager_limit_minor
                      ? "warn"
                      : "ok"
                }
                note={`${money(tin.data.manager_limit_minor)} a receipt on a manager's signature; above that head office signs`}
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
          )}
        </section>

        {/* ── The float position, per unit ─────────────────────────────── */}
        <section className="flex flex-col gap-2.5">
          <h2 className="text-[0.8125rem] font-semibold text-ink">
            Float position, per unit
          </h2>
          {positions.isPending ? (
            <LoadingState>
              Reading where each unit&rsquo;s money sits…
            </LoadingState>
          ) : positions.error ? (
            <ErrorState
              error={positions.error}
              onRetry={() => void positions.refetch()}
            />
          ) : units.length === 0 ? (
            <EmptyState>
              No cash account is mapped yet. A pot is a meaning bound to an
              account on the Account map, and until one is bound there is no
              float to be in a position about.
            </EmptyState>
          ) : (
            <Grid>
              <thead>
                <tr>
                  <Th width="11rem">Unit</Th>
                  <Th align="right" width="10rem">
                    Cash on hand
                  </Th>
                  <Th align="right" width="10rem">
                    Cashier float
                  </Th>
                  <Th align="right" width="10rem">
                    Petty cash · per books
                  </Th>
                  <Th align="right" width="10rem">
                    Petty cash · per the shop
                  </Th>
                  <Th align="right" width="9rem">
                    Difference
                  </Th>
                </tr>
              </thead>
              <tbody>
                {units.map((unit) => {
                  // Only the node this hub is proxied to can be asked what is
                  // really in its tin. Every other unit is `—` — not zero:
                  // "nobody has told us" and "there is nothing in it" are
                  // different claims and a float screen may not render them the
                  // same.
                  const counted =
                    unit.site_id === nodeSite &&
                    tin.data !== undefined &&
                    tin.data !== null
                      ? tin.data.balance_minor
                      : null
                  const difference =
                    counted === null ? null : counted - unit.petty
                  return (
                    <tr key={unit.site_id}>
                      <Td>
                        <SiteName id={unit.site_id} className="text-ink" />
                        {/* Under the name, not beside it. Head office's row is
                            the reason the id is drawn at all: the client's
                            chart calls it `HO` and this system files it under
                            `dc`, because head office and the distribution
                            centre share a building. */}
                        <span className="block">
                          <Code>{unit.site_id}</Code>
                        </span>
                      </Td>
                      {/* The two pots a shop may not spend from, drawn quietly
                          on purpose: they are context for the third column, not
                          an answer to "how much can I spend". */}
                      <Td align="right" className="text-mute">
                        {money(unit.cash)}
                      </Td>
                      <Td align="right" className="text-mute">
                        {money(unit.float)}
                      </Td>
                      <Td align="right">{money(unit.petty)}</Td>
                      <Td align="right">
                        {counted === null ? (
                          <span className="text-faint">—</span>
                        ) : (
                          money(counted)
                        )}
                      </Td>
                      <Td align="right">
                        {difference === null ? (
                          <span className="text-faint">—</span>
                        ) : difference === 0 ? (
                          <Pill tone="ok">agreed</Pill>
                        ) : (
                          <span className="text-bad-fg">
                            {difference > 0 ? "+" : "−"}
                            {money(Math.abs(difference))}
                          </span>
                        )}
                      </Td>
                    </tr>
                  )
                })}
                <TotalRow>
                  <Td>
                    {units.length} unit{units.length === 1 ? "" : "s"}
                  </Td>
                  <Td align="right">
                    {money(units.reduce((sum, row) => sum + row.cash, 0))}
                  </Td>
                  <Td align="right">
                    {money(units.reduce((sum, row) => sum + row.float, 0))}
                  </Td>
                  <Td align="right">
                    {money(units.reduce((sum, row) => sum + row.petty, 0))}
                  </Td>
                  {/* Deliberately not totalled. One node out of fourteen has
                      answered, so a figure here would read as what the estate
                      holds in petty cash while being one shop's tin. */}
                  <Td align="right">
                    <span className="text-faint">—</span>
                  </Td>
                  <Td align="right">
                    <span className="text-faint">—</span>
                  </Td>
                </TotalRow>
              </tbody>
            </Grid>
          )}
        </section>

        {/* ── The receipts ─────────────────────────────────────────────── */}
        <section className="flex flex-col gap-2.5">
          <h2 className="text-[0.8125rem] font-semibold text-ink">
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
              The location filter is on <SiteName id={site} />, and the only
              petty cash book this hub can read is{" "}
              <SiteName id={nodeSite} />
              &rsquo;s — one node per unit, and the hub is proxied to one node.
              Clear the filter to see it.
            </EmptyState>
          ) : book.isPending ? (
            <LoadingState>
              Reading what the shop spent over this span…
            </LoadingState>
          ) : book.error ? (
            <ErrorState error={book.error} onRetry={() => void book.refetch()} />
          ) : entries.length === 0 ? (
            <EmptyState>
              Nothing went in or out of the tin between {range.chip}. The tin
              itself is unaffected by that — an imprest float spans months, and
              the cards above count its whole life.
            </EmptyState>
          ) : (
            <div className="flex flex-col gap-2.5">
              {book.data.truncated && (
                <Truncated
                  limit={book.data.limit}
                  noun="receipts"
                  total={book.data.count}
                />
              )}
              <Grid>
                <thead>
                  <tr>
                    <Th width="10rem">When</Th>
                    <Th width="9rem">Kind</Th>
                    <Th width="11rem">Payee</Th>
                    <Th>What it was for</Th>
                    <Th width="8rem">Claimed by</Th>
                    <Th width="10rem">Signed by</Th>
                    <Th align="right" width="8.5rem">
                      In
                    </Th>
                    <Th align="right" width="8.5rem">
                      Out
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <Td className="whitespace-nowrap">
                        {moment(entry.at)}
                      </Td>
                      <Td>
                        <Pill tone={entry.out === 0 ? "info" : "neutral"}>
                          {entry.kind}
                        </Pill>
                      </Td>
                      <Td>{entry.payee}</Td>
                      <Td className="text-body">{entry.reason}</Td>
                      <Td>{entry.claimedBy}</Td>
                      <Td>
                        {entry.approvedBy}
                        {/* Which rung said yes. Kept because the ceiling may
                            move, and an audit six months from now asks who was
                            allowed to approve this, THEN. */}
                        {entry.rung !== null && (
                          <span className="ml-1.5 text-[0.65625rem] text-mute">
                            {entry.rung === "ADMIN" ? "head office" : "store"}
                          </span>
                        )}
                      </Td>
                      <DebitCredit debit={entry.in} credit={entry.out} />
                    </tr>
                  ))}
                  <TotalRow>
                    <Td />
                    <Td />
                    <Td />
                    <Td />
                    <Td />
                    <Td className="text-mute">over this span</Td>
                    <Td align="right">
                      {money(entries.reduce((sum, row) => sum + row.in, 0))}
                    </Td>
                    {/* The server's own figure for the whole span, not a sum of
                        the rows above: the list stops at `limit` and the total
                        does not, so summing here would under-report a busy
                        month by exactly the rows that did not fit. */}
                    <Td align="right">{money(book.data.spent_minor)}</Td>
                  </TotalRow>
                </tbody>
              </Grid>
            </div>
          )}
        </section>

        <Note>
          <b>What is real here and what is not.</b> The position table is the
          centre&rsquo;s ledger, filtered by <Code>site</Code> on the server.
          The tin and the book are one shop&rsquo;s own SQLite, read over{" "}
          <Code>GET /api/v1/store/petty-cash</Code> and{" "}
          <Code>GET /api/v1/store/expenses</Code> — edge routes, one node per
          unit, with no <Code>site</Code> parameter because a node only ever
          holds its own. <b>There is no cross-unit read of either.</b> Head
          office cannot see thirteen shops&rsquo; receipts from here, and no
          endpoint exists that would let it.
          <br />
          <br />
          <b>Why petty cash reads Rp 0 per books everywhere.</b> The node
          captures every receipt as <Code>store.expense.recorded</Code> and
          every hand-over as <Code>store.petty_cash.topped_up</Code> and uploads
          them, and <Code>cloud/postgres/sync.rs</Code> has no arm that applies
          either — an unrecognised fact is kept in the receipt log for a future
          applier rather than posted. There is no <Code>store_expense</Code>{" "}
          table in Postgres (it exists only on the unmerged{" "}
          <Code>feat/finance-control</Code> branch), and the nine categories a
          shop files against — <Code>expense_electricity</Code> through{" "}
          <Code>expense_misc</Code> — are in none of the centre&rsquo;s 34
          required meanings, so even with an applier there would be no account
          to debit. Three things are missing, in this order: the meanings on the
          account map, the table, the applier.
        </Note>
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

// ---------------------------------------------------------------------------
// Shaping
// ---------------------------------------------------------------------------

/// One unit's three pots, from the centre's own money rows.
interface UnitFloat {
  readonly site_id: string
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
/// and re-sorting by `site_id` would put `dc` between `store-03` and
/// `store-04`, which is nobody's idea of where head office goes.
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
    let unit = table.get(row.site_id)
    if (unit === undefined) {
      unit = { site_id: row.site_id, cash: 0, petty: 0, float: 0 }
      table.set(row.site_id, unit)
    }
    // Summed rather than assigned: one meaning at one site may legitimately be
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

/// Both halves of the span as one book, newest first.
function bookEntries(window: ExpenseWindow | undefined): BookEntry[] {
  if (window === undefined) return []
  const entries: BookEntry[] = [
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
      approvedBy: expense.approved_by,
      rung: expense.approved_role,
      in: 0,
      out: expense.amount_minor,
    })),
  ]
  // RFC3339 in UTC at micro precision on both sides, so the strings sort the
  // way the instants do and no dates need parsing to merge two lists.
  return entries.sort((left, right) => right.at.localeCompare(left.at))
}
