import { useQueries, useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { money } from "@/lib/format"
import { accountLedger, financeKeys, moneyOverview } from "@/lib/queries/finance"
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
import { MONEY_FAMILIES } from "@/screens/finance/chart"
import { useMeaningLabel, useWindow } from "@/screens/finance/hooks"
import { UnitName, UnitSelect, WindowControl } from "@/screens/finance/parts"
import type { GeneralLedger, MoneyAccountRow } from "@itulah/contract"

/// Where cash came from and where it went, over a window.
///
/// The third of the Reports group, built to the family rules Profit & Loss
/// settled — same toolbar order, same cards above the table, same indent, one
/// `TotalRow` per table. Read that file's opening comment for the four. What
/// follows is only what a cash flow does differently, and why it has to.
///
/// # This is a direct-method reading. ERPNext's is indirect.
///
/// `GET /finance/statement` serves two kinds, `BALANCE_SHEET` and
/// `PROFIT_LOSS`, and refuses anything else — there is no cash-flow kind, and
/// inventing one in the browser is not available to a screen that may not
/// invent numbers. So this page asks the only question the server can actually
/// answer about cash over a window: **what moved through the cash and bank
/// accounts themselves**, account family by account family, straight out of
/// the ledger.
///
/// That is a direct-method statement. ERPNext derives an *indirect* one: it
/// starts from the period's profit, adds back the non-cash charges and the
/// movement on working capital, and files each into Operating, Investing or
/// Financing — one query per `account_type` per period, netting credit less
/// debit. The `<Note>` at the foot of the page says the same thing to the
/// reader, because the difference changes what the page may be used for.
///
/// # Why the rows are derived from the account map rather than listed here
///
/// The client's chart carries the location inside the account code, so there
/// are fourteen `Cash on Hand` accounts and a hundred and thirty-nine money
/// accounts in all. Asking the ledger a hundred and thirty-nine times would be
/// absurd, and hard-coding `10110` would be this screen holding a private
/// opinion about a chart the account map already describes.
///
/// So the families come from `GET /finance/money` — which accounts hold money,
/// what each one means, and at which bank — and each (meaning, bank) group is
/// asked for once, at the narrowest code on the client's own `{1,3,5,7,10,12}`
/// ladder that covers its accounts at every unit. That code is a fact about
/// the rows the server just sent, not a guess about the chart: change the map
/// and this page follows it.
export function CashFlow() {
  const range = useWindow()
  const [unit, setUnit] = useState("")
  const meaning = useMeaningLabel()

  /// The account map, read through the ledger. Asked without an as-at date on
  /// purpose: the balances it carries are not used here — only which accounts
  /// hold money, what each means, and at which bank — and a date in the key
  /// would fork the cache away from every other screen asking the same
  /// question.
  const map = useQuery({
    queryKey: financeKeys.money(null, unit || null),
    queryFn: ({ signal }) =>
      moneyOverview({ unit: unit || undefined }, signal),
  })

  const families = useMemo(
    () => familiesOf(map.data?.rows ?? []),
    [map.data]
  )
  // `flatMap` rather than `filter`, so the narrowing survives into the type: a
  // family with no covering code is not asked for, and the queries below never
  // have to defend against a null they cannot receive.
  const askable = useMemo(
    () =>
      families.flatMap((family) =>
        family.code === null ? [] : [{ ...family, code: family.code }]
      ),
    [families]
  )

  // `combine` rather than a `useMemo` over the results: `useQueries` hands back
  // a fresh array every render, so a memo over it would either recompute
  // constantly or need a hand-rolled fingerprint as its dependency. Keyed
  // positionally and zipped with `askable` at render time.
  //
  // No `limit` is sent, deliberately. The four figures this page reads are
  // properties of the WINDOW and arrive whatever the page size, but the key
  // `financeKeys.ledger` does not carry a limit — so asking for one row here
  // would hand a one-row answer to the General Ledger screen out of the same
  // cache entry. Same question, same key, same answer.
  const walks = useQueries({
    queries: askable.map((family) => ({
      queryKey: financeKeys.ledger(
        family.code,
        unit || null,
        range.from,
        range.to
      ),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        accountLedger(
          family.code,
          { unit: unit || undefined, from: range.from, to: range.to },
          signal
        ),
    })),
    combine: (results) => ({
      ledgers: results.map((result) => result.data),
      pending: results.some((result) => result.isPending),
      error: results.find((result) => result.isError)?.error,
    }),
  })

  const byKey = new Map<string, GeneralLedger | undefined>()
  askable.forEach((family, index) => {
    byKey.set(family.key, walks.ledgers[index])
  })

  const rowsOf = (ids: readonly string[]): readonly StatementRow[] =>
    MONEY_FAMILIES.filter((group) => ids.includes(group.id)).map((group) => ({
      group,
      members: families
        .filter((family) => group.keys.includes(family.semanticKey))
        .map((family) => ({ family, walk: byKey.get(family.key) })),
    }))

  const cash = rowsOf(CASH_AND_EQUIVALENTS)
  const near = rowsOf(NEAR_CASH)
  const held = cash.flatMap((section) => section.members)

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Reports"
        title="Cash Flow"
        sub="Where cash came from and where it went, over a window."
      />

      <Toolbar>
        <WindowControl range={range} />
        <UnitSelect
          value={unit}
          onChange={setUnit}
          className="h-8 w-44"
          aria-label="Unit"
        />
        <Toolbar.Spacer />
        {/* The effective answer, in words, always. A date box left blank and a
            date box filled with today look identical to a reader; this
            sentence is what tells them which report they are looking at. */}
        <span className="text-[0.875rem] text-mute">
          {range.chip}
          {unit === "" ? (
            " · every unit"
          ) : (
            <>
              {" · "}
              <UnitName id={unit} />
            </>
          )}
        </span>
      </Toolbar>

      {map.isPending || walks.pending ? (
        <LoadingState>
          Reading what moved through the cash and bank accounts…
        </LoadingState>
      ) : map.isError ? (
        <ErrorState error={map.error} onRetry={() => map.refetch()} />
      ) : walks.error !== undefined ? (
        <ErrorState error={walks.error} />
      ) : held.length === 0 ? (
        <EmptyState>
          No account is mapped as cash or bank
          {unit === "" ? "" : " in this unit"}, so there is nothing whose
          movement a cash flow could be read from. A place money can sit is a
          meaning bound to an account on the Account map.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <CardRow columns={4}>
            <NumberCard
              label="Opening cash"
              value={sumOf(held, (walk) => walk.opening_minor)}
              note="The day before the window opened"
            />
            <NumberCard
              label="Received"
              value={sumOf(held, (walk) => walk.window_debit_minor)}
              note="Into the pots, inside the window"
            />
            <NumberCard
              label="Paid out"
              value={sumOf(held, (walk) => walk.window_credit_minor)}
              note="Out of the pots, inside the window"
            />
            <NumberCard
              label="Closing cash"
              value={sumOf(held, (walk) => walk.closing_minor)}
              note="Opening, plus received, less paid out"
            />
          </CardRow>

          <Grid>
            <thead>
              <tr>
                <Th width="20rem">Where the money sits</Th>
                <Th width="9rem">Ledger</Th>
                <Th align="right" width="10rem">
                  Opening
                </Th>
                <Th align="right" width="10rem">
                  Received
                </Th>
                <Th align="right" width="10rem">
                  Paid out
                </Th>
                <Th align="right" width="10rem">
                  Closing
                </Th>
              </tr>
            </thead>
            <tbody>
              {cash.map((section) => (
                <SectionRows
                  key={section.group.id}
                  section={section}
                  meaning={meaning}
                />
              ))}
              <TotalRow>
                <Td>Cash and cash equivalents</Td>
                <Td />
                <Td align="right">
                  {money(sumOf(held, (walk) => walk.opening_minor))}
                </Td>
                <Td align="right">
                  {money(sumOf(held, (walk) => walk.window_debit_minor))}
                </Td>
                <Td align="right">
                  {money(sumOf(held, (walk) => walk.window_credit_minor))}
                </Td>
                <Td align="right">
                  {money(sumOf(held, (walk) => walk.closing_minor))}
                </Td>
              </TotalRow>
            </tbody>
          </Grid>

          {near.some((section) => section.members.length > 0) && (
            <div className="flex flex-col gap-2">
              <div className="text-[0.875rem] text-mute">
                <b className="text-ink">Near cash, and deliberately not in the
                total above.</b>{" "}
                A giro written and not cleared is money the bank has not taken
                yet; a card the till took is money the scheme still owes. The
                two are not added together here, because a liability and a
                receivable are not the same kind of thing — and the giro reads
                negative, unflipped, because that is what a liability is.
              </div>
              <Grid>
                <thead>
                  <tr>
                    <Th width="20rem">Where the money sits</Th>
                    <Th width="9rem">Ledger</Th>
                    <Th align="right" width="10rem">
                      Opening
                    </Th>
                    <Th align="right" width="10rem">
                      Received
                    </Th>
                    <Th align="right" width="10rem">
                      Paid out
                    </Th>
                    <Th align="right" width="10rem">
                      Closing
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {near.map((section) => (
                    <SectionRows
                      key={section.group.id}
                      section={section}
                      meaning={meaning}
                    />
                  ))}
                </tbody>
              </Grid>
            </div>
          )}

          <Note>
            <b>This is a direct-method reading of the cash accounts, not the
            indirect statement ERPNext derives.</b> Every figure above came out
            of the cash and bank accounts themselves: what they held the day
            before the window, what moved each way inside it, and what they held
            at the end. It answers <i>how much cash moved</i> truthfully. It
            does <i>not</i> answer ERPNext's question — how much of the movement
            was operating, how much investing, how much financing — because
            nothing here says which activity a payment belonged to.
          </Note>

          <Note>
            <b>What the indirect statement would need.</b> ERPNext starts from
            the period's profit, adds back the non-cash charges and the movement
            on working capital, and sorts each account into Operating (
            depreciation, receivables, payables, stock), Investing (fixed
            assets) or Financing (equity) by the{" "}
            <code className="font-mono text-[0.875rem]">account_type</code> on
            the Account itself, with a <i>Cash Flow Mapping</i> for anything
            that does not fit. Two things would have to exist here first.{" "}
            <b>One:</b> a classification of every account into operating,
            investing or financing —{" "}
            <code className="font-mono text-[0.875rem]">ledger_account</code>{" "}
            carries a root class and an is-group flag, and neither says which
            activity an account belongs to. <b>Two:</b> an endpoint that reports{" "}
            <i>movement over a window</i> for classes 1, 2 and 3.{" "}
            <code className="font-mono text-[0.875rem]">
              GET /finance/statement
            </code>{" "}
            windows the profit-and-loss classes only — a balance sheet is
            answered inception to date — and{" "}
            <code className="font-mono text-[0.875rem]">
              GET /finance/balances
            </code>{" "}
            takes an as-at date and no{" "}
            <code className="font-mono text-[0.875rem]">from</code>.
            Subtracting two balances in the browser would put a figure on the
            page the server never computed and could not be asked to confirm,
            which is the one thing no number in this module is allowed to be.
          </Note>

          <Note>
            <b>Every row is one server request, and none of them subtracts two
            balances.</b> The account map says which accounts hold money and
            where; each (meaning, bank) group is then asked for once, at the
            narrowest code on the client's own {"{1,3,5,7,10,12}"} ladder that
            covers its accounts at all fourteen units.{" "}
            <code className="font-mono text-[0.875rem]">
              GET /finance/accounts/{"{code}"}/ledger
            </code>{" "}
            answers with the opening balance, what moved each way inside the
            window and the closing balance — all four computed by the server
            over the whole window, never over the rows it happened to return.
            The unit is a filter on that request, so a shop's cash flow is a
            narrower question and never a slice of a wider answer cut up here.
          </Note>
        </div>
      )}
    </PageContent>
  )
}

/// The two `MONEY_FAMILIES` a cash flow is actually about, and the two it must
/// keep out of the total.
///
/// Cash equivalents are notes and bank balances. A card receivable is money the
/// scheme has not settled and an outstanding giro is a cheque the bank has not
/// taken — both are *near* cash, which is precisely why they are shown and
/// precisely why adding them in would overstate what is actually in hand.
const CASH_AND_EQUIVALENTS: readonly string[] = ["cash", "bank"]
const NEAR_CASH: readonly string[] = ["cards", "giro"]

/// The client's ladder, longest rung first, for trimming a common prefix down
/// to a code that is actually an account.
///
/// `chart.ts` holds the same six numbers for indenting. They are not shared
/// through one constant because they are doing two different jobs here — that
/// one turns a length into an indent, this one turns a length into the nearest
/// real account — and a single export serving both would have to be read twice
/// to be understood once.
const LADDER = [12, 10, 7, 5, 3, 1]

/// One family of money accounts: a meaning, a bank, and the one account code
/// that covers it at every unit.
interface MoneyFamily {
  /// `semantic_key|qualifier`. The qualifier is part of the identity and not a
  /// note — `bank_giro` at one shop legitimately has one mapping per bank, and
  /// two banks are two pots.
  readonly key: string
  readonly semanticKey: string
  readonly qualifier: string
  /// `null` when no single account on the ladder covers the family — see
  /// `coveringCode`. The row is still drawn; its figures are not invented.
  readonly code: string | null
}

interface SectionMember {
  readonly family: MoneyFamily
  readonly walk: GeneralLedger | undefined
}

interface StatementRow {
  readonly group: (typeof MONEY_FAMILIES)[number]
  readonly members: readonly SectionMember[]
}

/// One family heading and the meanings under it, in the tree shape every report
/// in this group uses.
function SectionRows({
  section,
  meaning,
}: {
  section: StatementRow
  meaning: (key: string) => string
}) {
  if (section.members.length === 0) return null
  return (
    <>
      <tr>
        <Td className="font-medium text-ink">{section.group.label}</Td>
        <Td className="text-[0.875rem] text-mute">{section.group.note}</Td>
        <Td />
        <Td />
        <Td />
        <Td />
      </tr>
      {section.members.map(({ family, walk }) => (
        <tr key={family.key}>
          <Td>
            {/* The indent rides a span inside the cell, not the cell itself:
                `<Td>` owns its padding, and a second opinion about that in
                every table of this module is how two reports stop lining up.
                One rung down from the family heading, which is level zero. */}
            <span
              className="flex items-baseline gap-1.5"
              style={{ paddingLeft: "1.125rem" }}
            >
              <span className="min-w-0">{meaning(family.semanticKey)}</span>
              {family.qualifier !== "" && (
                <span className="text-[0.875rem] text-mute">
                  {family.qualifier}
                </span>
              )}
            </span>
          </Td>
          <Td>
            {family.code === null ? (
              <span className="text-[0.875rem] text-mute">
                no single account covers it
              </span>
            ) : (
              <Code>{family.code}</Code>
            )}
          </Td>
          <Td align="right">{money(walk?.opening_minor ?? null)}</Td>
          <Td align="right">{money(walk?.window_debit_minor ?? null)}</Td>
          <Td align="right">{money(walk?.window_credit_minor ?? null)}</Td>
          <Td align="right">{money(walk?.closing_minor ?? null)}</Td>
        </tr>
      ))}
    </>
  )
}

/// The money families the account map describes, one per (meaning, bank).
function familiesOf(
  rows: readonly MoneyAccountRow[]
): readonly MoneyFamily[] {
  const grouped = new Map<string, { row: MoneyAccountRow; codes: string[] }>()
  for (const row of rows) {
    const key = `${row.semantic_key}|${row.qualifier}`
    const held = grouped.get(key) ?? { row, codes: [] }
    held.codes.push(row.account_code)
    grouped.set(key, held)
  }
  return [...grouped.entries()]
    .map(([key, held]) => ({
      key,
      semanticKey: held.row.semantic_key,
      qualifier: held.row.qualifier,
      code: coveringCode(held.codes),
    }))
    .sort((left, right) => left.key.localeCompare(right.key))
}

/// The narrowest account on the client's ladder that covers every code given.
///
/// The client's chart puts the unit inside the code, so one meaning at one bank
/// is fourteen twelve-digit accounts differing only in their last two digits:
/// `101100100100` through `101100100113` are Cash on Hand at the fourteen
/// units, and `1011001001` is the family all fourteen hang off. The longest
/// common prefix finds it.
///
/// Trimmed to a rung of the ladder afterwards, because only lengths 1, 3, 5, 7,
/// 10 and 12 are accounts — a nine-character prefix is a string, and the ledger
/// endpoint answers 404 for it. Trimming can only widen, never narrow.
///
/// Refused below five characters. A prefix that short means the group's
/// accounts do not share a family at all, and widening to `1` would quietly
/// report the movement of every asset in the chart as though it were cash.
/// Better to draw the row with no figures and say why than to draw a figure
/// that means something else.
function coveringCode(codes: readonly string[]): string | null {
  if (codes.length === 0) return null
  let prefix = codes[0]
  for (const code of codes) {
    let shared = 0
    while (
      shared < prefix.length &&
      shared < code.length &&
      prefix[shared] === code[shared]
    ) {
      shared += 1
    }
    prefix = prefix.slice(0, shared)
  }
  const rung = LADDER.find((length) => length <= prefix.length)
  if (rung === undefined || rung < 5) return null
  return prefix.slice(0, rung)
}

/// One column added across the rows on screen — or `null` if any of them has
/// not arrived.
///
/// `null` and not a partial sum, because a total that grows as its rows land is
/// a total that was wrong when it was first read. Every figure being added is
/// itself the server's, computed over the whole window; this adds them, which
/// is the one arithmetic a table of complete rows is allowed.
function sumOf(
  members: readonly SectionMember[],
  pick: (walk: GeneralLedger) => number
): number | null {
  let total = 0
  for (const member of members) {
    if (member.walk === undefined) return null
    total += pick(member.walk)
  }
  return total
}
