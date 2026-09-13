import { useQueries, useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { PageHeader } from "@/components/ui/page-header"
import { Pill, type PillProps } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState } from "@/components/ui/states"
import { day, money, span } from "@/lib/format"
import {
  bankStatementLines,
  financeKeys,
  listBankStatements,
  listCashCounts,
  listDeposits,
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
import { LocationSelect, SiteName, WindowControl } from "@/screens/finance/parts"
import { useWindow } from "@/screens/finance/hooks"
import type {
  BankStatementLineRow,
  BankStatementRow,
  StoreDeposit,
} from "@itulah/contract"

/// Takings on their way from a drawer to a bank account.
///
/// # A deposit is now a document, and the middle of the journey is a balance
///
/// A deposit is three facts — notes left a drawer, a person carried them, a
/// bank credited an account — and this system used to keep the first and the
/// third and nothing in between. So this screen was built as the **two-sided
/// gap** it really was: our unconfirmed postings on one side, the bank's
/// unclaimed credits on the other, and a note at the foot saying a deposit slip
/// was not a document the system kept.
///
/// Migration 0241 made it one. `store_deposit` carries the unit, the drawer,
/// the destination bank account, the amount, the day it left, who carried it
/// and the slip reference — and it posts **twice**:
///
/// ```text
///   banking  (on banked_on)  Dr cash_in_transit   Cr the drawer
///   landing  (on landed_on)  Dr the bank          Cr cash_in_transit
/// ```
///
/// Two entries and not one, because the two facts happen on different days. A
/// single entry would have to pick one of the dates and be wrong about the
/// other, which is exactly the defect the document exists to remove: the
/// distance between the two dates IS the exposure.
///
/// Debiting the bank on the day the bag leaves would say the bank holds money
/// it has never heard of, and every reconciliation afterwards would have to
/// explain a credit that has not happened yet. Debiting
/// `1011005001 Setoran Dalam Perjalanan` instead says what is true: the notes
/// are out of the till and not yet at the bank, and the balance on that account
/// is one number, per unit, that somebody is answerable for.
///
/// # Why "in the air" is the server's figure and not this page's
///
/// `in_transit_minor` comes off the list envelope, computed over everything the
/// unit filter matches rather than over the rows drawn — so filtering the table
/// to what has landed leaves it unchanged, because it is a fact about the place
/// and not about which boxes are ticked. It agrees with the `cash_in_transit`
/// balance, because both move only when this document posts.
///
/// The page no longer fans out one ledger request per bank account to guess at
/// the same number. That was sixty-nine requests across fourteen units and it
/// could only ever find *postings no statement line agreed with*, which is not
/// the same finding as "the cash is in a bag somewhere".
///
/// # Debit and credit, on a statement, are the bank's way round
///
/// A debit on a bank statement is money LEAVING — the bank debits your account
/// when it pays somebody. So an arriving deposit is a `credit_minor`, and the
/// backend agrees: `banking.rs` derives `outgoing: line.debit_minor > 0`. The
/// column is headed `Deposit` after ERPNext's Bank Transaction, which names the
/// two sides rather than making a reader hold the convention in their head.
///
/// The bank's side is kept, and its job has changed. It is no longer half of a
/// subtraction; it is the evidence the second posting is matched against,
/// through the bank reconciliation that already exists and with no special case
/// for deposits anywhere in it.
export function Deposits() {
  const [site, setSite] = useState("")
  const range = useWindow()
  const scoped = site === "" ? null : site

  /// The document. Unpaged and narrowed on the server, like every list in this
  /// module.
  const deposits = useQuery({
    queryKey: financeKeys.deposits(null, scoped),
    queryFn: ({ signal }) =>
      listDeposits(scoped === null ? {} : { site }, signal),
  })

  const overview = useQuery({
    queryKey: financeKeys.money(null, scoped),
    queryFn: ({ signal }) =>
      moneyOverview(scoped === null ? {} : { site }, signal),
  })

  /// Every statement ever imported, unfiltered — and deliberately so.
  ///
  /// `financeKeys.bankStatements()` takes no arguments while
  /// `listBankStatements` accepts `site`, `account` and `state`. Asking the
  /// server for one unit under that key would overwrite the whole-company list
  /// that Finance's Cash & bank screen and the reconciliation tool read from
  /// the same cache, and they would then draw one shop's statements as if they
  /// were the company's. Until the key carries the filter, the filtering
  /// happens here — over a whole answer, never over a page of one.
  const statements = useQuery({
    queryKey: financeKeys.bankStatements(),
    queryFn: ({ signal }) => listBankStatements(signal),
  })

  const counts = useQuery({
    queryKey: financeKeys.cashCounts(null, scoped),
    queryFn: ({ signal }) =>
      listCashCounts(signal, scoped === null ? {} : { site }),
  })

  /// The statements that overlap the window, narrowed before their lines are
  /// asked for — which is what keeps this from being one request per statement
  /// ever imported.
  const inScope = useMemo(
    () =>
      (statements.data?.rows ?? []).filter(
        (statement) =>
          (scoped === null || statement.site_id === scoped) &&
          statement.period_start <= range.to &&
          statement.period_end >= range.from
      ),
    [statements.data, scoped, range.from, range.to]
  )

  const lines = useQueries({
    queries: inScope.map((statement) => ({
      queryKey: financeKeys.bankLines(statement.statement_id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        bankStatementLines(statement.statement_id, signal),
    })),
    // `combine` rather than a memo over the results: `useQueries` hands back a
    // new array every render, so a memo keyed on it never holds.
    combine: (answers) => ({
      isPending: answers.some((one) => one.isPending),
      isError: answers.some((one) => one.isError),
      error: answers.find((one) => one.isError)?.error,
      rows: answers.flatMap((one, at) =>
        (one.data ?? []).map((line) => ({ line, statement: inScope[at] }))
      ),
    }),
  })

  /// Loading and error across every read the page stands on.
  ///
  /// One state for the lot because the answers are one claim: a page that drew
  /// the bank's side while the document list was still failing would say
  /// "nothing is in transit" about a unit it had not read the deposits for.
  const view = {
    isPending:
      deposits.isPending ||
      overview.isPending ||
      statements.isPending ||
      counts.isPending ||
      lines.isPending,
    isError:
      deposits.isError ||
      overview.isError ||
      statements.isError ||
      counts.isError ||
      lines.isError,
    error:
      deposits.error ??
      overview.error ??
      statements.error ??
      counts.error ??
      lines.error,
    data: deposits.data,
    refetch: () => {
      void deposits.refetch()
      void overview.refetch()
      void statements.refetch()
      void counts.refetch()
    },
  }

  // Money that has not started the journey yet: notes still in the tills.
  const drawers = (overview.data?.rows ?? []).filter(
    (row) => row.pot === "CASH"
  )
  const inDrawers = drawers.reduce((sum, row) => sum + row.per_books_minor, 0)
  const neverCounted = drawers.filter(
    (row) =>
      !(counts.data ?? []).some(
        (count) =>
          count.account_code === row.account_code &&
          count.site_id === row.site_id
      )
  ).length

  const arrivals = lines.rows
    .filter(
      ({ line }) =>
        line.credit_minor > 0 &&
        line.value_date >= range.from &&
        line.value_date <= range.to
    )
    .sort((a, b) => a.line.value_date.localeCompare(b.line.value_date))
  const landed = arrivals.reduce((sum, { line }) => sum + line.credit_minor, 0)
  const unclaimed = arrivals.reduce(
    (sum, { line }) => sum + line.unallocated_minor,
    0
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Finance final · Store"
        title="Deposits"
        sub="Takings on their way from a drawer to a bank account."
      />

      <Toolbar>
        <LocationSelect value={site} onChange={setSite} className="w-52" />
        <WindowControl range={range} />
      </Toolbar>

      {queryState(view, {
        loading: "Reading the drawers, the slips and what the bank says arrived…",
        render: (page) => {
          // The window narrows the table, never the exposure: money banked in
          // August and still in the air is this unit's problem in September.
          const inWindow = page.rows.filter(
            (row) => row.banked_on >= range.from && row.banked_on <= range.to
          )
          const flying = page.rows.filter((row) => row.status === "IN_TRANSIT")
          const oldest = flying.reduce(
            (worst, row) => Math.max(worst, row.days_in_transit),
            0
          )
          return (
            <div className="flex flex-col gap-4">
              <CardRow>
                <NumberCard
                  label="Still in the drawers"
                  value={inDrawers}
                  note={
                    drawers.length === 0
                      ? "no cash account is mapped in scope"
                      : neverCounted === 0
                        ? `${drawers.length} ${drawers.length === 1 ? "drawer" : "drawers"}, every one counted at least once`
                        : `${neverCounted} of ${drawers.length} ${drawers.length === 1 ? "drawer has" : "drawers have"} never been counted`
                  }
                  tone={neverCounted === 0 ? undefined : "warn"}
                />
                <NumberCard
                  label="In a bag, somewhere"
                  value={page.in_transit_minor}
                  tone={page.in_transit_minor === 0 ? "ok" : "warn"}
                  note={
                    flying.length === 0
                      ? "every deposit has been confirmed by a bank"
                      : `${flying.length} ${flying.length === 1 ? "deposit" : "deposits"}, the oldest ${oldest} ${oldest === 1 ? "day" : "days"} out`
                  }
                />
                <NumberCard
                  label="Bank credits nothing claims"
                  value={inScope.length === 0 ? null : unclaimed}
                  tone={
                    inScope.length === 0
                      ? undefined
                      : unclaimed === 0
                        ? "ok"
                        : "bad"
                  }
                  note={
                    inScope.length === 0
                      ? "no statement covers this window"
                      : `of ${money(landed)} credited across ${inScope.length} ${inScope.length === 1 ? "statement" : "statements"}`
                  }
                />
              </CardRow>

              <section className="flex flex-col gap-2">
                <Heading
                  title="Deposits"
                  sub="A counted bag, a named person, and the two days it belongs to."
                />
                {inWindow.length === 0 ? (
                  <EmptyState>
                    {page.total === 0 ? (
                      <>
                        Nothing has been banked{" "}
                        {scoped === null ? (
                          "anywhere"
                        ) : (
                          <>
                            at <SiteName id={site} />
                          </>
                        )}{" "}
                        yet. The document exists —{" "}
                        <Code>POST /api/v1/finance/deposits</Code> — and no slip
                        has been written against it.
                      </>
                    ) : (
                      <>
                        No deposit left a drawer in this window. Widen it, or
                        clear the unit filter.
                      </>
                    )}
                  </EmptyState>
                ) : (
                  <Grid>
                    <thead>
                      <tr>
                        <Th width="8.5rem">Number</Th>
                        <Th width="7rem">Left the till</Th>
                        <Th width="8rem">Unit</Th>
                        <Th>Out of</Th>
                        <Th>Into</Th>
                        <Th width="8rem">Carried by</Th>
                        <Th align="right" width="9.5rem">
                          Amount
                        </Th>
                        <Th width="11rem">Where it is</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {inWindow.map((row) => (
                        <DepositRow key={row.deposit_id} row={row} />
                      ))}
                    </tbody>
                    <tfoot>
                      <TotalRow>
                        <Td>
                          {inWindow.length}{" "}
                          {inWindow.length === 1 ? "deposit" : "deposits"}
                        </Td>
                        <Td />
                        <Td />
                        <Td />
                        <Td />
                        <Td>In this window</Td>
                        <Td align="right">
                          {money(
                            inWindow.reduce(
                              (sum, row) => sum + row.amount_minor,
                              0
                            )
                          )}
                        </Td>
                        <Td />
                      </TotalRow>
                    </tfoot>
                  </Grid>
                )}
                {/* The window is a lens on the table and never on the
                    exposure, and a reader has to be told which is which. */}
                {inWindow.length < page.total && (
                  <p className="text-[0.6875rem] text-mute">
                    {page.total - inWindow.length} more{" "}
                    {page.total - inWindow.length === 1 ? "deposit" : "deposits"}{" "}
                    outside this window. The figure above counts every one that
                    is still in the air, whenever it was banked.
                  </p>
                )}
              </section>

              <section className="flex flex-col gap-2">
                <Heading
                  title="Landed at the bank"
                  sub="Every credit the bank reported in this window, and how much of each our books account for."
                />
                {arrivals.length === 0 ? (
                  <EmptyState>
                    {inScope.length === 0
                      ? "No bank statement covering this window has been imported for the unit in scope."
                      : "The statements covering this window carry no incoming line — the bank credited nothing in it."}
                  </EmptyState>
                ) : (
                  <Grid>
                    <thead>
                      <tr>
                        <Th width="7.5rem">Value date</Th>
                        <Th>Bank account</Th>
                        <Th width="9rem">Unit</Th>
                        <Th>Description</Th>
                        <Th width="8rem">Reference</Th>
                        <Th align="right" width="9.5rem">
                          Deposit
                        </Th>
                        <Th align="right" width="9.5rem">
                          Allocated
                        </Th>
                        <Th align="right" width="9.5rem">
                          Unallocated
                        </Th>
                        <Th width="8.5rem">Status</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {arrivals.map(({ line, statement }) => (
                        <ArrivalRow
                          key={line.line_id}
                          line={line}
                          statement={statement}
                        />
                      ))}
                    </tbody>
                    <tfoot>
                      <TotalRow>
                        <Td />
                        <Td />
                        <Td />
                        <Td />
                        <Td>
                          {arrivals.length}{" "}
                          {arrivals.length === 1 ? "credit" : "credits"}
                        </Td>
                        <Td align="right">{money(landed)}</Td>
                        <Td align="right">{money(landed - unclaimed)}</Td>
                        <Td align="right">{money(unclaimed)}</Td>
                        <Td />
                      </TotalRow>
                    </tfoot>
                  </Grid>
                )}
                {inScope.length > 0 && (
                  <p className="text-[0.6875rem] text-mute">
                    {inScope.length === 1 ? "Statement" : "Statements"}:{" "}
                    {inScope
                      .map(
                        (statement) =>
                          `${statement.account_name} ${span(statement.period_start, statement.period_end)}`
                      )
                      .join(" · ")}
                  </p>
                )}
              </section>

              <Note>
                <b>What the two tables are now.</b> The first is the document:
                every bag that left a till, who carried it, and which of the two
                postings have been made. The second is the bank&rsquo;s own
                account of what arrived, from the statements that have been
                imported. They are no longer two halves of a subtraction — the
                deposit joins them, and <Code>…/land</Code> writes the journal
                line on the bank account that a statement credit is matched
                against, through the reconciliation that already exists.
                <br />
                <br />
                <b>What is not built.</b> Nothing matches a statement credit to
                a deposit automatically: landing one is somebody&rsquo;s act,
                and the line it agreed with is recorded on the deposit when they
                name it. A suggestion — same unit, same account, same amount,
                within a day or two — is the obvious next thing and is
                deliberately not guessed at here.
              </Note>
            </div>
          )
        },
      })}
    </PageContent>
  )
}

function Heading({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <h2 className="text-[0.875rem] font-semibold text-ink">{title}</h2>
      <p className="text-[0.71875rem] text-mute">{sub}</p>
    </div>
  )
}

/// Where one deposit has got to, and which entry says so.
const STAGES: Readonly<
  Record<string, { readonly name: string; readonly tone: PillProps["tone"] }>
> = {
  DRAFT: { name: "slip written", tone: "neutral" },
  IN_TRANSIT: { name: "in a bag", tone: "warn" },
  LANDED: { name: "at the bank", tone: "ok" },
}

function DepositRow({ row }: { row: StoreDeposit }) {
  const stage = STAGES[row.status]
  return (
    <tr>
      <Td>
        <span className="font-medium text-ink">{row.deposit_number}</span>
        {row.slip_reference !== "" && (
          <span className="block">
            <Code>{row.slip_reference}</Code>
          </span>
        )}
      </Td>
      <Td className="whitespace-nowrap">{day(row.banked_on)}</Td>
      <Td>
        <SiteName id={row.site_id} />
      </Td>
      <Td>
        <span className="text-ink">{row.drawer_account_name}</span>
        <span className="block">
          <Code>{row.drawer_account_code}</Code>
        </span>
      </Td>
      <Td>
        <span className="text-ink">{row.bank_account_name}</span>
        <span className="block">
          <Code>{row.bank_account_code}</Code>
        </span>
      </Td>
      <Td className="text-body">{row.carried_by}</Td>
      <Td align="right">
        <span className="font-medium text-ink">{money(row.amount_minor)}</span>
      </Td>
      <Td>
        <Pill tone={stage?.tone ?? "neutral"}>{stage?.name ?? row.status}</Pill>
        {/* The two legs, each named by the entry that made it. A deposit that
            could not point at its own journal would be a status somebody set. */}
        {row.status === "IN_TRANSIT" && (
          <span className="mt-0.5 block text-[0.65625rem] text-mute">
            {row.days_in_transit === 0
              ? "banked today"
              : `${row.days_in_transit} ${row.days_in_transit === 1 ? "day" : "days"} out`}
          </span>
        )}
        {row.landed_entry_id !== null && row.landed_entry_number !== null && (
          <span className="mt-0.5 block text-[0.65625rem] text-mute">
            {day(row.landed_on)} ·{" "}
            <AppLink
              to="/finance/journal"
              sheet={{ key: "entry", value: row.landed_entry_id }}
              className="font-mono text-accent hover:underline"
            >
              {row.landed_entry_number}
            </AppLink>
          </span>
        )}
      </Td>
    </tr>
  )
}

function ArrivalRow({
  line,
  statement,
}: {
  line: BankStatementLineRow
  statement: BankStatementRow
}) {
  return (
    <tr>
      <Td>{day(line.value_date)}</Td>
      <Td>
        <span className="font-medium text-ink">{statement.account_name}</span>
        <span className="block">
          <Code>{statement.account_code}</Code>
        </span>
      </Td>
      <Td>
        <SiteName id={statement.site_id} />
      </Td>
      <Td className="text-body">
        {line.description}
        {line.counterparty_name !== "" && (
          <span className="block text-[0.65625rem] text-mute">
            {line.counterparty_name}
          </span>
        )}
      </Td>
      <Td>
        <Code>{line.reference ?? "—"}</Code>
      </Td>
      <Td align="right">
        <span className="font-medium text-ink">{money(line.credit_minor)}</span>
      </Td>
      <Td align="right">
        {line.allocated_minor === 0 ? (
          <span className="text-hairline-strong">·</span>
        ) : (
          money(line.allocated_minor)
        )}
      </Td>
      <Td align="right">
        {line.unallocated_minor === 0 ? (
          <span className="text-hairline-strong">·</span>
        ) : (
          <span className="text-bad-fg">{money(line.unallocated_minor)}</span>
        )}
      </Td>
      <Td>
        {line.unallocated_minor === 0 ? (
          <Pill tone="ok">agreed</Pill>
        ) : line.allocated_minor === 0 ? (
          <Pill tone="bad">unexplained</Pill>
        ) : (
          <Pill tone="warn">part agreed</Pill>
        )}
      </Td>
    </tr>
  )
}
