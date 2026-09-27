import { useQueries, useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { day, label, money } from "@/lib/format"
import {
  accountLedger,
  financeKeys,
  journalEntry,
  moneyOverview,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
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
import {
  UnitName,
  UnitSelect,
  WindowControl,
} from "@/screens/finance/parts"
import { useWindow } from "@/screens/finance/hooks"
import type {
  GeneralLedgerRow,
  JournalEntryDetail,
  MoneyAccountRow,
  MoneyPot,
} from "@itulah/contract"

/// Every movement of money at one place, in the order it happened.
///
/// The store manager's answer to "what happened to our money this week": one
/// list, every drawer and every bank account at that unit, oldest first, with a
/// balance walking down it.
///
/// # Why it insists on a unit
///
/// Because the question is about a place. "What happened to our money" asked of
/// fourteen units at once is a trial balance, and there is one of those in
/// Reports. The mechanical reason agrees with the editorial one: this is one
/// ledger request per money account, which is ten at a shop and a hundred and
/// thirty-nine across the company.
///
/// # Why the running balance is computed here and the totals are not
///
/// `GeneralLedgerRow.running_minor` is the balance of ONE account. This list
/// merges ten of them, so the figure a reader wants — what this unit was
/// holding after that movement — is not any row's own running figure and has to
/// be walked over the merged list. The four cards above are the opposite case:
/// `opening_minor`, `window_debit_minor`, `window_credit_minor` and
/// `closing_minor` are the server's totals **over the whole window**, unmoved
/// by paging, so they stay right even on a window too big for one page. When
/// the walked balance and the server's closing disagree, rows are missing, and
/// the screen says so rather than drawing a balance that does not land.
///
/// # Why `Against` costs a request
///
/// A ledger row names its entry and not the other side of it: `GeneralLedgerRow`
/// carries `entry_id` and no counter-account, so the account money came from or
/// went to is only in `GET /journal/{id}`. A posted entry never changes — a
/// wrong one is answered by its mirror, never edited — so those reads are held
/// for the life of the tab and shared with the Journal screen's own sheet under
/// the same key. They are still one request each, which is why they stop at
/// `AGAINST_CAP`.

/// Places money actually sits at a unit. `CARD_RECEIVABLE` is deliberately out:
/// a card receivable is not money at the shop, it is a scheme's promise on a
/// timetable, and putting it in a running cash balance would tell a manager
/// they are holding notes they cannot touch.
const MONEY_POTS: readonly MoneyPot[] = [
  "CASH",
  "PETTY_CASH",
  "CASHIER_FLOAT",
  "BANK",
]

/// How many distinct entries the `Against` column will look up.
///
/// A week at a shop is tens of movements and this never binds. It exists so a
/// year-wide window cannot turn one screen into thousands of requests; past it
/// the column says so in words rather than going quietly blank.
const AGAINST_CAP = 250

/// One movement, and the account it moved on — which the row itself cannot say.
interface Movement {
  readonly row: GeneralLedgerRow
  readonly account: MoneyAccountRow
  /// What the unit was holding after this movement, across every account on
  /// this list. Walked here; see the note on the screen above.
  readonly balance: number
}

export function Transactions() {
  const [unit, setUnit] = useState("")
  const range = useWindow()
  const scoped = unit === "" ? null : unit

  const overview = useQuery({
    queryKey: financeKeys.money(null, scoped),
    queryFn: ({ signal }) =>
      moneyOverview(scoped === null ? {} : { unit }, signal),
    enabled: scoped !== null,
  })

  const accounts = useMemo(
    () =>
      (overview.data?.rows ?? []).filter((row) => MONEY_POTS.includes(row.pot)),
    [overview.data]
  )

  const ledgers = useQueries({
    queries: accounts.map((account) => ({
      queryKey: financeKeys.ledger(
        account.account_code,
        account.unit_id,
        range.from,
        range.to
      ),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        accountLedger(
          account.account_code,
          {
            unit: account.unit_id,
            from: range.from,
            to: range.to,
            limit: 500,
          },
          signal
        ),
    })),
    // `combine` rather than a memo over the results: `useQueries` hands back a
    // new array every render, so a memo keyed on it never holds.
    combine: (answers) => ({
      isPending: answers.some((one) => one.isPending),
      isError: answers.some((one) => one.isError),
      error: answers.find((one) => one.isError)?.error,
      opening: answers.reduce(
        (sum, one) => sum + (one.data?.opening_minor ?? 0),
        0
      ),
      closing: answers.reduce(
        (sum, one) => sum + (one.data?.closing_minor ?? 0),
        0
      ),
      moved: answers.reduce(
        (sum, one) => sum + (one.data?.window_debit_minor ?? 0),
        0
      ),
      spent: answers.reduce(
        (sum, one) => sum + (one.data?.window_credit_minor ?? 0),
        0
      ),
      /// How many movements the window holds, before any paging. Compared with
      /// what actually arrived, this is what tells a reader the list is short.
      held: answers.reduce((sum, one) => sum + (one.data?.window_rows ?? 0), 0),
      pairs: answers.flatMap((one, at) =>
        (one.data?.rows ?? []).map((row) => ({ row, account: accounts[at] }))
      ),
    }),
  })

  /// The unit's money, in the order it moved.
  ///
  /// Sorted on the posting date first and the entry number second, because two
  /// movements on the same day were still made in a known order and the entry
  /// number is the only record of it. The line id breaks the last tie so the
  /// list does not reshuffle between renders.
  const movements = useMemo(() => {
    const sorted = [...ledgers.pairs].sort(
      (a, b) =>
        a.row.posting_date.localeCompare(b.row.posting_date) ||
        a.row.entry_number.localeCompare(b.row.entry_number) ||
        a.row.line_id.localeCompare(b.row.line_id)
    )
    // A fold rather than a counter a closure keeps adding to: the running
    // figure is derived from the rows above it, and writing it as state the map
    // mutates is how a list silently gets two different balances on two renders.
    return sorted.reduce<Movement[]>((walked, { row, account }) => {
      const previous = walked[walked.length - 1]?.balance ?? ledgers.opening
      walked.push({
        row,
        account,
        balance: previous + row.debit_minor - row.credit_minor,
      })
      return walked
    }, [])
  }, [ledgers.pairs, ledgers.opening])

  /// The other side of each entry on the list.
  ///
  /// Distinct entry ids, so an entry touching two of this unit's accounts is
  /// read once and not twice.
  const entryIds = useMemo(
    () => [...new Set(movements.map((one) => one.row.entry_id))],
    [movements]
  )
  const against = useQueries({
    queries: entryIds.slice(0, AGAINST_CAP).map((id) => ({
      queryKey: financeKeys.entry(id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        journalEntry(id, signal),
      // A posted entry is immutable — a wrong one is answered by a reversal,
      // which is a new entry — so this never needs re-reading.
      staleTime: Infinity,
    })),
    combine: (answers) => ({
      failed: answers.some((one) => one.isError),
      byEntry: new Map(
        answers.flatMap((one) =>
          one.data === undefined
            ? []
            : ([[one.data.entry.entry_id, one.data]] as const)
        )
      ),
    }),
  })

  const view = {
    isPending: overview.isPending || ledgers.isPending,
    isError: overview.isError || ledgers.isError,
    error: overview.error ?? ledgers.error,
    data: overview.data === undefined ? undefined : true,
    refetch: () => {
      void overview.refetch()
    },
  }

  // The server's closing is a total over the whole window; the walked balance
  // is a total over the rows that arrived. They part company exactly when rows
  // are missing, which is the one thing a running balance must not hide.
  const walked =
    movements.length === 0
      ? ledgers.opening
      : movements[movements.length - 1].balance
  const short = walked !== ledgers.closing || movements.length < ledgers.held

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Cash & Bank"
        title="Transactions"
        sub="Every movement of money at one place, in the order it happened."
      />

      <Toolbar>
        <UnitSelect
          value={unit}
          onChange={setUnit}
          emptyLabel="Choose a unit"
          className="w-52"
        />
        <WindowControl range={range} />
      </Toolbar>

      {scoped === null ? (
        <EmptyState>
          Choose a unit. This list is one place&rsquo;s money — every drawer,
          float and bank account it holds — and reading it means one ledger
          request per account.
        </EmptyState>
      ) : (
        queryState(view, {
          loading: "Reading this unit's drawers and bank accounts…",
          render: () => (
            <div className="flex flex-col gap-4">
              <CardRow columns={4}>
                <NumberCard
                  label={`Held on ${day(range.from)}`}
                  value={ledgers.opening}
                  note="opening balance, every money account at this unit"
                />
                <NumberCard label="In" value={ledgers.moved} tone="ok" />
                <NumberCard label="Out" value={ledgers.spent} tone="warn" />
                <NumberCard
                  label={`Held on ${day(range.to)}`}
                  value={ledgers.closing}
                  note={`${ledgers.held} ${ledgers.held === 1 ? "movement" : "movements"} across ${accounts.length} ${accounts.length === 1 ? "account" : "accounts"}`}
                />
              </CardRow>

              {short && (
                <Note>
                  This window holds {ledgers.held} movements and{" "}
                  {movements.length} of them arrived, so the balance column does
                  not land on the closing figure above. The four totals are the
                  server&rsquo;s own and are still right; narrow the window to
                  make the list agree with them.
                </Note>
              )}

              {movements.length === 0 ? (
                <EmptyState>
                  Nothing moved through this unit&rsquo;s drawers or bank
                  accounts between {day(range.from)} and {day(range.to)}.
                </EmptyState>
              ) : (
                <Grid>
                  <thead>
                    <tr>
                      <Th width="7.5rem">Date</Th>
                      <Th>Account</Th>
                      <Th width="9rem">Unit</Th>
                      <Th width="9rem">Entry</Th>
                      <Th>Description</Th>
                      <Th>Against</Th>
                      <Th align="right" width="9.5rem">
                        Debit
                      </Th>
                      <Th align="right" width="9.5rem">
                        Credit
                      </Th>
                      <Th align="right" width="10rem">
                        Balance
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((movement) => (
                      <MovementRow
                        key={movement.row.line_id}
                        movement={movement}
                        entry={against.byEntry.get(movement.row.entry_id)}
                      />
                    ))}
                  </tbody>
                  <tfoot>
                    <TotalRow>
                      <Td />
                      <Td />
                      <Td />
                      <Td />
                      <Td />
                      <Td>Movement in the window</Td>
                      <DebitCredit
                        debit={ledgers.moved}
                        credit={ledgers.spent}
                      />
                      <Td align="right">{money(ledgers.closing)}</Td>
                    </TotalRow>
                  </tfoot>
                </Grid>
              )}

              {(against.failed || entryIds.length > AGAINST_CAP) && (
                <Note>
                  {against.failed
                    ? "At least one journal entry could not be read, so the Against column is blank on the rows it belongs to. Every other column comes from the ledger itself and is unaffected."
                    : `This window touches ${entryIds.length} journal entries and Against is read one entry at a time, so it stops after ${AGAINST_CAP}. Narrow the window to fill the column.`}
                </Note>
              )}
            </div>
          ),
        })
      )}
    </PageContent>
  )
}

function MovementRow({
  movement,
  entry,
}: {
  movement: Movement
  /// The whole entry, once it has been read. Absent while in flight, past the
  /// cap, or when the read failed — all three of which are "we do not know
  /// yet", and none of which may be drawn as "there is no other side".
  entry: JournalEntryDetail | undefined
}) {
  const { row, account, balance } = movement
  return (
    <tr>
      <Td>{day(row.posting_date)}</Td>
      <Td>
        <span className="font-medium text-ink">
          {account.account_name}
          {/* The category, where the account declares a family. Without it a
              store's day of movements reads as the same three account names
              repeated, which is exactly what the forty-account chart trades
              away and this is the half it trades it for. */}
          {row.category_name !== null && (
            <span
              className="font-normal text-mute"
              title={row.category_code ?? undefined}
            >
              {" · "}
              {row.category_name}
            </span>
          )}
        </span>
        <span className="block">
          <Code>{account.account_code}</Code>
          {account.qualifier !== "" && (
            <span className="ml-1.5 text-[0.875rem] text-mute">
              {account.qualifier}
            </span>
          )}
        </span>
      </Td>
      <Td>
        <UnitName id={row.unit_id} />
      </Td>
      <Td>
        <AppLink
          to="/finance/accounting/journal-entries"
          sheet={{ key: "entry", value: row.entry_id }}
          className="font-mono text-[0.875rem] text-accent hover:underline"
        >
          {row.entry_number}
        </AppLink>
        <span className="block text-[0.875rem] text-mute">
          {label(row.source_kind)}
        </span>
      </Td>
      <Td className="text-body">{row.memo ?? "—"}</Td>
      <Td>
        <Against entry={entry} movement={movement} />
      </Td>
      <DebitCredit debit={row.debit_minor} credit={row.credit_minor} />
      <Td align="right">
        <span className="font-medium text-ink">{money(balance)}</span>
      </Td>
    </tr>
  )
}

/// Where the money came from, or went to.
///
/// The other side of an entry is every line on the OPPOSITE side of this one —
/// not simply "the line that is not this one", which gets a four-line entry
/// wrong. One account is named; several are counted, with the names in the
/// title, because a column wide enough for four account names is a column that
/// pushes the figures off the page.
function Against({
  entry,
  movement,
}: {
  entry: JournalEntryDetail | undefined
  movement: Movement
}) {
  if (entry === undefined) return <span className="text-faint">—</span>

  const wasDebit = movement.row.debit_minor > 0
  const others = entry.lines.filter((line) =>
    wasDebit ? line.credit_minor > 0 : line.debit_minor > 0
  )
  const names = [...new Set(others.map((line) => line.account_name))]
  if (names.length === 0) return <span className="text-faint">—</span>
  if (names.length === 1)
    return (
      <span className="text-body" title={others[0].account_code}>
        {names[0]}
      </span>
    )
  return (
    <span className="text-body" title={names.join(" · ")}>
      {names.length} accounts
    </span>
  )
}
