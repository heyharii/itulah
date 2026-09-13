import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { day, money } from "@/lib/format"
import {
  financeKeys,
  listCashCounts,
  moneyOverview,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import {
  CardRow,
  Code,
  Grid,
  Note,
  NumberCard,
  Td,
  Th,
  TotalRow,
} from "@/screens/finance-final/parts"
import { LocationSelect, SiteName } from "@/screens/finance/parts"
import type { CashCountRow, MoneyAccountRow, MoneyPot } from "@itulah/contract"

/// Every place notes and coins sit, per unit, and what the books say each
/// holds.
///
/// # The column this screen exists for
///
/// Not the balance. A drawer whose last count says **never** is a drawer
/// nothing has ever contradicted: the figure beside it is an assertion the
/// books have been making, unchallenged, for as long as the shop has been
/// open. So the money sitting in never-counted drawers gets a card of its own,
/// in `{bad}`, and the row gets a pill rather than a polite dash. The point of
/// the screen is that somebody looks at that number and sends a person to a
/// till.
///
/// # Why the unit is a group and not a column
///
/// The client's chart carries the location inside the account name — `Cash on
/// Hand C003` — so a Location column repeated down every row restates what the
/// account already says and still leaves the reader adding up fourteen shops
/// in their head. Grouping by unit puts the name once and the unit's **total**
/// where a total belongs, in the balance column, so "how much cash is standing
/// at Store 03" is read rather than computed. `finance-lab-2` draws the same
/// endpoints as one flat list with a Location column and one grand total; this
/// is that screen with the unit dimension taken seriously.
///
/// # Why the picker narrows the request and not the list
///
/// `site` is a server filter on both endpoints. Slicing a fourteen-unit answer
/// in the browser would give the same fourteen rows to look at and a different
/// number in the cards, which is the way a finance screen quietly starts
/// disagreeing with itself.

/// The three pots that hold notes and coins.
///
/// Named rather than derived from the account code, because the server already
/// decided it — `MoneyPot` is computed from the meaning — and a screen
/// re-deriving it by substring gets `card_receivable` wrong the first time
/// somebody writes a key containing "cash". `BANK` and `CARD_RECEIVABLE` are
/// deliberately absent: a bank balance is somebody else's promise and a card
/// receivable is a scheme's timetable. Neither is a thing a person can count.
const CASH_POTS: readonly MoneyPot[] = ["CASH", "PETTY_CASH", "CASHIER_FLOAT"]

const POT_LABEL: Readonly<Record<string, string>> = {
  CASH: "Cash",
  PETTY_CASH: "Petty cash",
  CASHIER_FLOAT: "Cashier float",
}

/// One drawer, and the last time anybody opened it.
interface Drawer {
  readonly account: MoneyAccountRow
  /// The most recent count of THIS account at THIS unit, or nothing — which is
  /// the finding, not a gap in the data.
  readonly last: CashCountRow | null
}

interface Unit {
  readonly siteId: string
  readonly drawers: readonly Drawer[]
  readonly held: number
}

export function Cash() {
  const [site, setSite] = useState("")

  const overview = useQuery({
    queryKey: financeKeys.money(null, site === "" ? null : site),
    queryFn: ({ signal }) => moneyOverview(site === "" ? {} : { site }, signal),
  })
  // The same list the Cash Counts screen reads, under its own key: one request
  // for both screens, and no chance of the two disagreeing about when a drawer
  // was last counted.
  const counts = useQuery({
    queryKey: financeKeys.cashCounts(null, site === "" ? null : site),
    queryFn: ({ signal }) =>
      listCashCounts(signal, site === "" ? {} : { site }),
  })

  /// Loading and error for BOTH reads, in one place.
  ///
  /// The count history is not decoration here — it is the column the screen was
  /// built for — so drawing the balances while it silently fails would leave
  /// every drawer reading "never counted" and send somebody to a till that was
  /// counted this morning. A screen that can lie that way has to wait for both
  /// answers or show neither.
  const view = {
    isPending: overview.isPending || counts.isPending,
    isError: overview.isError || counts.isError,
    error: overview.error ?? counts.error,
    data:
      overview.data === undefined || counts.data === undefined
        ? undefined
        : ([overview.data.rows, counts.data] as const),
    refetch: () => {
      void overview.refetch()
      void counts.refetch()
    },
  }

  // Keyed on the two query results and not on `view.data`, which is rebuilt
  // every render and would make the memo never hold.
  const units = useMemo(
    () => group(overview.data?.rows ?? [], counts.data ?? []),
    [overview.data, counts.data]
  )

  const drawers = units.flatMap((unit) => unit.drawers)
  const held = drawers.reduce(
    (sum, drawer) => sum + drawer.account.per_books_minor,
    0
  )
  const uncounted = drawers.filter((drawer) => drawer.last === null)
  const disagreed = drawers.filter(
    (drawer) => drawer.last !== null && drawer.last.variance_minor !== 0
  )
  // Absent rather than zero when nobody has ever counted anything in scope:
  // "every drawer agrees" and "no drawer has been checked" are opposite
  // findings and must not render as the same Rp 0.
  const everCounted = drawers.some((drawer) => drawer.last !== null)
  const off = everCounted
    ? disagreed.reduce((sum, drawer) => sum + (drawer.last?.variance_minor ?? 0), 0)
    : null
  const unposted = disagreed.filter(
    (drawer) => drawer.last?.entry_id === null
  ).length

  return (
    <PageContent>
      <PageHeader
        crumb="Finance final · Store"
        title="Cash"
        sub="Tills, floats and petty cash — where the notes are, according to the books."
      />

      <Toolbar>
        <LocationSelect value={site} onChange={setSite} className="w-52" />
      </Toolbar>

      {queryState(view, {
        loading: "Reading where the money sits, and when it was last counted…",
        render: () =>
          drawers.length === 0 ? (
            <EmptyState>
              {site === ""
                ? "No cash account is mapped yet. A place money can sit is a meaning bound to an account on the Account map."
                : "This unit has no cash account mapped. A drawer becomes visible here once a meaning is bound to an account for it."}
            </EmptyState>
          ) : (
            <div className="flex flex-col gap-4">
              <CardRow>
                <NumberCard
                  label="Held per the books"
                  value={held}
                  note={`${drawers.length} ${drawers.length === 1 ? "drawer" : "drawers"} at ${units.length} ${units.length === 1 ? "unit" : "units"}`}
                />
                <NumberCard
                  label="In drawers nobody has counted"
                  value={uncounted.reduce(
                    (sum, drawer) => sum + drawer.account.per_books_minor,
                    0
                  )}
                  tone={uncounted.length === 0 ? "ok" : "bad"}
                  note={
                    uncounted.length === 0
                      ? "every drawer has been counted at least once"
                      : `${uncounted.length} of ${drawers.length} — nothing has ever contradicted them`
                  }
                />
                <NumberCard
                  label="Off at the last count"
                  value={off}
                  tone={
                    off === null ? undefined : off === 0 ? "ok" : "warn"
                  }
                  note={
                    off === null
                      ? "no drawer in scope has ever been counted"
                      : `${disagreed.length} of ${drawers.length} disagreed${unposted === 0 ? "" : `, ${unposted} still not in the books`}`
                  }
                />
              </CardRow>

              <Grid>
                <thead>
                  <tr>
                    <Th>Place</Th>
                    <Th width="9rem">Type</Th>
                    <Th width="10rem">Account</Th>
                    <Th align="right" width="11rem">
                      Balance per books
                    </Th>
                    <Th width="12rem">Last counted</Th>
                    <Th align="right" width="9rem">
                      Off by
                    </Th>
                  </tr>
                </thead>
                {units.map((unit) => (
                  <tbody key={unit.siteId}>
                    {/* The unit's name once, and its total in the column the
                        eye is already scanning — the thing a flat list with a
                        Location column cannot give you without arithmetic. */}
                    <tr>
                      <Td className="bg-soft font-medium text-ink">
                        <SiteName id={unit.siteId} />
                      </Td>
                      <Td className="bg-soft" />
                      <Td className="bg-soft" />
                      <Td align="right" className="bg-soft font-medium text-ink">
                        {money(unit.held)}
                      </Td>
                      <Td className="bg-soft" />
                      <Td className="bg-soft" />
                    </tr>
                    {unit.drawers.map((drawer) => (
                      <DrawerRow
                        key={drawer.account.account_code}
                        drawer={drawer}
                      />
                    ))}
                  </tbody>
                ))}
                <tfoot>
                  <TotalRow>
                    <Td>Every unit in scope</Td>
                    <Td />
                    <Td />
                    <Td align="right">{money(held)}</Td>
                    <Td />
                    <Td />
                  </TotalRow>
                </tfoot>
              </Grid>

              <Note>
                <b>Last counted</b> is the column this screen exists to make
                somebody look at: a drawer whose last count says{" "}
                <b>never</b> is a drawer nothing has ever contradicted, and the
                balance beside it is an assertion rather than a fact. A count is
                an <i>observation</i> — recording one changes no books. Putting
                its difference in the ledger is a second act, by somebody who
                has read the reason, and <b>Off by</b> says which counts have
                had that second act and which are still only a note.
              </Note>
            </div>
          ),
      })}
    </PageContent>
  )
}

function DrawerRow({ drawer }: { drawer: Drawer }) {
  const { account, last } = drawer
  return (
    <tr>
      <Td>
        <span className="font-medium text-ink">{account.account_name}</span>
        {account.qualifier !== "" && (
          <span className="block text-[0.65625rem] text-mute">
            {account.qualifier}
          </span>
        )}
      </Td>
      <Td>
        <Pill>{POT_LABEL[account.pot] ?? account.pot}</Pill>
      </Td>
      <Td>
        <Code>{account.account_code}</Code>
      </Td>
      <Td align="right">
        <span className="font-medium text-ink">
          {money(account.per_books_minor)}
        </span>
      </Td>
      <Td>
        {last === null ? (
          <Pill tone="bad">never counted</Pill>
        ) : (
          <>
            {day(last.counted_on)}
            <span className="block text-[0.65625rem] text-mute">
              {last.counted_by === "" ? "counted by nobody named" : last.counted_by}
              {last.witnessed_by === "" ? "" : `, witnessed by ${last.witnessed_by}`}
            </span>
          </>
        )}
      </Td>
      <Td align="right">
        {last === null ? (
          <span className="text-faint">—</span>
        ) : last.variance_minor === 0 ? (
          <Pill tone="ok">agreed</Pill>
        ) : (
          <>
            <span className="font-medium text-bad-fg">
              {last.variance_minor > 0 ? "+" : ""}
              {money(last.variance_minor)}
            </span>
            <span className="block text-[0.65625rem] text-mute">
              {last.entry_id === null ? "not in the books" : last.entry_number}
            </span>
          </>
        )}
      </Td>
    </tr>
  )
}

/// Drawers under the unit they stand in, with the latest count found for each.
///
/// The counts arrive newest first from the server, so the first one seen for a
/// drawer is its latest and nothing needs sorting here. Units come out in the
/// order the chart names them — `moneyOverview` is ordered by account code and
/// the code ends in the unit — which is the order the client's own reports
/// print and therefore the order somebody is looking for a shop in.
function group(
  rows: readonly MoneyAccountRow[],
  counts: readonly CashCountRow[]
): readonly Unit[] {
  const latest = new Map<string, CashCountRow>()
  for (const count of counts) {
    const key = `${count.account_code}@${count.site_id}`
    if (!latest.has(key)) latest.set(key, count)
  }

  const bySite = new Map<string, Drawer[]>()
  for (const account of rows) {
    if (!CASH_POTS.includes(account.pot)) continue
    const drawers = bySite.get(account.site_id) ?? []
    drawers.push({
      account,
      last: latest.get(`${account.account_code}@${account.site_id}`) ?? null,
    })
    bySite.set(account.site_id, drawers)
  }

  return [...bySite.entries()].map(([siteId, drawers]) => ({
    siteId,
    drawers,
    held: drawers.reduce(
      (sum, drawer) => sum + drawer.account.per_books_minor,
      0
    ),
  }))
}
