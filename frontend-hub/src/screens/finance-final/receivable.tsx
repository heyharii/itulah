import { useQueries, useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { count, money } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  accountLedger,
  financeKeys,
  moneyOverview,
} from "@/lib/queries/finance"
import { Code, Grid, Td, Th } from "@/screens/finance-final/parts"
import { useAsOf } from "@/screens/finance/hooks"
import { CardFigure, PhoneList } from "@/components/ui/phone-cards"
import { AsOfControl, UnitName, UnitSelect } from "@/screens/finance/parts"
import { ReportFilters } from "@/screens/finance/report"

/// Accounts receivable — what we are actually owed — on ERPNext's Accounts
/// Receivable page (`accounts/report/accounts_receivable`): unit in
/// Company's place and Report Date as the filters, then one row per kind of
/// party, then the card settlement accounts unit by unit.
///
/// ERPNext's ageing chart and bucket columns are not drawn: nothing here
/// records when a receivable falls due — a card settlement has no due date, a
/// staff advance no repayment date — so there is nothing to age yet.
///
/// # Why this is not a debtor book
///
/// Because this client is a cash-and-card retailer and the classic receivable
/// of a wholesaler does not exist here. There is no customer invoice anywhere
/// in the backend to age, and no tender is "on account": `PaymentMethod` is
/// cash, card, QRIS, voucher or other, so a till sale settles in the same
/// breath it is rung up. A screen with a Customer column and an ageing grid
/// would be a plausible page drawn over nothing, which is the one thing a
/// finance prototype must never be.
///
/// What IS genuinely owed to this business, and unpaid for real days:
///
/// 1. **Card settlement.** A card sale is money the acquirer owes us until it
///    lands, typically T+1, less the MDR they keep.
/// 2. **Between units.** One shop's goods paid for by another, head office
///    funding a store — the client's chart carries a 14×14 grid of these.
/// 3. **People.** Staff loans, store-head advances, travel money paid out
///    before the cost lands.
///
/// So this page is built around those three, and it reads them where they
/// actually live: as balances on the client's own receivable accounts. Each
/// figure is one `GET /finance/accounts/{code}/ledger`, summed by the server
/// over the account's whole subtree, wound back to the reporting date and
/// narrowed by unit on the wire. Nothing here adds two families together and
/// calls the result a receivable.
///
/// # Why most of it reads zero, and why that is the finding
///
/// The accounts exist, and they are not orphans: the account map carries a
/// family literally called **Receivables** — `card_receivable_credit`,
/// `card_receivable_debit`, `card_fee` and `affiliate_receivable` — mapped at
/// all fourteen units. Nothing has ever posted to them, because nothing posts
/// a sale to the general ledger at all: every journal entry in the books today
/// is a supplier invoice, a depreciation run, a bank statement or somebody's
/// manual entry. The gap is the posting, not the chart, and saying that is
/// more useful than an empty page.
export function AccountsReceivable() {
  const asOf = useAsOf()
  // On the wire, never across an answer already in hand. Inter-unit balances
  // are the case that makes this matter: "who owes whom" is meaningless until
  // somebody says which unit is asking.
  const [unit, setUnit] = useState("")

  // One query per ACCOUNT, folded back into one row per family. A family that
  // spans three accounts asks three questions and adds them; the alternative —
  // one request per family against a group code — is what broke when the chart
  // collapse removed the group rung these families used to name.
  const asked = FAMILIES.flatMap((family, at) =>
    family.codes.map((code) => ({ code, at }))
  )

  const families = useQueries({
    queries: asked.map(({ code: familyCode }) => ({
      // The one-day window is how a ledger is asked for a balance:
      // `closing_minor` is a property of the window's end, so `from == to`
      // says "as at this date" and `limit: 1` keeps movements nobody is
      // reading off the wire. The key carries the unit, so two units are two
      // cache entries and never one answer wearing both names.
      queryKey: financeKeys.ledger(
        familyCode,
        unit || null,
        asOf.value,
        asOf.value
      ),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        accountLedger(
          familyCode,
          {
            unit: unit || undefined,
            from: asOf.value,
            to: asOf.value,
            limit: 1,
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
      rows: FAMILIES.map((family, at) => {
        const mine = asked
          .map((one, index) => ({ one, index }))
          .filter(({ one }) => one.at === at)
          .map(({ index }) => answers[index]?.data)
        /// The client's own names for the accounts, straight off the server.
        /// Never translated: an accountant looks for "Piutang Affiliasi
        /// Pembiayaan", and an English rendering is a different account as far
        /// as they are concerned. Several, when the family spans several.
        const name =
          mine
            .map((one) => one?.account_name)
            .filter((one): one is string => one !== undefined && one !== null)
            .join(" · ") || null
        /// Debits minus credits, in the accounts' own sign and deliberately
        /// unflipped. A report decides how to present a balance; a balance does
        /// not decide for itself. `null` while any of them is still in flight,
        /// and `—` on screen — "we have not asked" and "there is nothing there"
        /// are different sentences, and a partial sum would be a third thing
        /// that is neither.
        const balance = mine.some((one) => one === undefined)
          ? null
          : mine.reduce((sum, one) => sum + (one?.closing_minor ?? 0), 0)
        return { family, name, balance }
      }),
    }),
  })

  const phone = useLayout() === "phone"

  return (
    <PageContent>
      <PageHeader
        className="max-md:hidden"
        crumb="Finance · Receivables"
        title="Accounts Receivable"
      />

      <ReportFilters
        note={
          <>
            {asOf.chip}
            {unit === "" ? (
              " · all units"
            ) : (
              <>
                {" · "}
                <UnitName id={unit} />
              </>
            )}
          </>
        }
      >
        <UnitSelect
          value={unit}
          onChange={setUnit}
          className="h-control w-44"
          aria-label="Unit"
        />
        <AsOfControl asOf={asOf} />
      </ReportFilters>

      {families.isPending ? (
        <LoadingState>
          Reading what each receivable account holds at the report date…
        </LoadingState>
      ) : families.isError ? (
        <ErrorState error={families.error} />
      ) : (
        <>
          {/* No total row: an allowance subtracts, an advance is work owed
              rather than cash, and the last row is a liability read backwards.
              Adding them would make a figure with no name. */}
          {phone ? (
            <PhoneList
              rows={families.rows.map(({ family, name, balance }) => ({
                key: family.key,
                title: family.what,
                line: family.covers,
                lead: (
                  <CardFigure
                    value={balance === null ? "—" : money(balance)}
                    tone={balance !== null && balance < 0 ? "bad" : undefined}
                  />
                ),
                foot: (
                  <span className="flex flex-col">
                    <span>{name ?? "—"}</span>
                    <span className="font-mono">
                      {family.codes.join(" · ")}
                    </span>
                  </span>
                ),
              }))}
            />
          ) : (
            <Grid>
              <thead>
                <tr>
                  <Th>Party Type</Th>
                  <Th width="20rem">Account</Th>
                  <Th width="8rem">Account No</Th>
                  <Th align="right" width="11rem">
                    Outstanding Amount
                  </Th>
                </tr>
              </thead>
              <tbody>
                {families.rows.map(({ family, name, balance }) => (
                  <tr key={family.key}>
                    <Td>
                      <span
                        className="font-medium text-ink"
                        title={family.reading}
                      >
                        {family.what}
                      </span>
                      <span className="mt-0.5 block text-[0.875rem] text-mute">
                        {family.covers}
                      </span>
                    </Td>
                    <Td>
                      {name === null ? (
                        <span className="text-faint">—</span>
                      ) : (
                        name
                      )}
                    </Td>
                    <Td>
                      {family.codes.map((code) => (
                        <span key={code} className="block">
                          <Code>{code}</Code>
                        </span>
                      ))}
                    </Td>
                    <Td align="right">
                      <Balance minor={balance} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Grid>
          )}

          <Settlement asOf={asOf.value} unit={unit} />
        </>
      )}
    </PageContent>
  )
}

/// The receivable families the client's chart actually carries.
///
/// Each family is one or more codes, summed. They used to be single seven-digit
/// group codes, because the chart split every meaning into fourteen location
/// copies — `Piutang Kartu Kredit C001`, `… C002` — and one group code reached
/// all fourteen while the unit filter did the narrowing.
///
/// The chart collapse of 2026-09-14 removed that middle rung. A meaning is now
/// ONE account and the unit is only the dimension, so `1011101` — the group
/// that held the two card receivables — no longer exists and the server answers
/// `not found: account 1011101`. What survives is the meaning underneath it.
/// Where a family covered several meanings it now names several accounts and
/// adds them, which is the same question asked of a shorter chart.
///
/// Ordered the way somebody reads them: what a customer's card owes, what
/// people owe, what the write-down takes back, what we have paid out ahead,
/// then the two halves of between-unit.
const FAMILIES: readonly {
  /// Stable identity, independent of how many accounts the family spans.
  readonly key: string
  readonly codes: readonly string[]
  readonly what: string
  readonly covers: string
  readonly reading: string
}[] = [
  {
    key: "cards",
    codes: ["1011101001", "1011101002"],
    what: "Card settlement",
    covers: "Piutang Kartu Kredit · Piutang Debit Card",
    reading: "A debit is a sale the acquirer has taken and not yet paid over.",
  },
  {
    key: "people",
    codes: ["1011102001", "1011102002", "1011102003"],
    what: "Owed by people",
    covers: "Pegawai · Kepala Toko · Manajemen",
    reading:
      "A debit is money in somebody's hands: a staff loan, a store head's advance.",
  },
  {
    key: "allowance",
    codes: ["1011103001"],
    what: "Written down",
    covers: "Cadangan Penghapusan Piutang Tak Tertagih",
    reading:
      "A credit, and negative. It is the part of the above nobody expects to collect.",
  },
  {
    key: "advances",
    codes: ["1011303"],
    what: "Advances out",
    covers: "Travelling · Purchase · To Contractors · Others",
    reading:
      "Money paid before its cost arrived — owed to us as work, not as cash.",
  },
  {
    key: "interunit-receivable",
    codes: ["10214"],
    what: "Between units — the receivable side",
    covers: "Pembiayaan · Atas Barang · Lain-Lain",
    reading: "A debit is another unit owing this one.",
  },
  {
    key: "interunit-payable",
    codes: ["20123"],
    what: "Between units — read back off the payable side",
    covers: "Hutang Affiliasi Pembiayaan · Atas Barang · Lain-Lain",
    reading:
      "A liability account. A DEBIT here is a receivable in substance: the unit has overpaid.",
  },
]

/// A ledger balance, with a zero that is a finding rather than a gap.
///
/// `Rp 0` means the server looked at the account and found nothing posted; `—`
/// means nobody has asked yet. Those are different claims and a finance screen
/// that renders them the same has lied about an account nobody has touched. A
/// negative is marked, because on five of the six families above a credit
/// balance is the opposite of what the row is called.
function Balance({ minor }: { minor: number | null }) {
  if (minor === null) {
    return (
      <span className="text-faint" title="Not read yet">
        —
      </span>
    )
  }
  return (
    <span
      className={
        minor < 0 ? "font-medium text-warn-fg" : "font-medium text-ink"
      }
    >
      {money(minor)}
    </span>
  )
}

/// Where the card settlement accounts are, and what each one holds.
///
/// This is the account map's own view of the same thing the table above totals
/// — `GET /finance/money` returns one row per mapped money account per unit,
/// wound to the reporting date and narrowed by unit on the wire. It is here
/// because "the settlement total is zero" and "there are twenty-eight mapped
/// settlement accounts across fourteen units and every one of them is empty"
/// are the same number and very different news.
///
/// The pot is the server's decision and not a substring of the semantic key: a
/// screen that worked it out by looking for "card" in the name would get it
/// wrong the first time somebody added a key containing the word.
function Settlement({ asOf, unit }: { asOf: string; unit: string }) {
  const phone = useLayout() === "phone"
  const overview = useQuery({
    queryKey: financeKeys.money(asOf, unit || null),
    queryFn: ({ signal }) =>
      moneyOverview({ as_of: asOf, unit: unit || undefined }, signal),
  })

  const rows = useMemo(
    () =>
      (overview.data?.rows ?? []).filter(
        (row) => row.pot === "CARD_RECEIVABLE"
      ),
    [overview.data]
  )

  if (overview.isPending) {
    return <LoadingState>Finding the settlement accounts…</LoadingState>
  }
  if (overview.isError) {
    return <ErrorState error={overview.error} />
  }
  if (rows.length === 0) {
    return (
      <EmptyState>
        No card settlement account is linked in this unit. Link one on Account
        Links.
      </EmptyState>
    )
  }

  const holding = rows.filter((row) => row.per_books_minor !== 0).length

  return (
    <>
      <div className="mt-6 mb-2 flex items-baseline gap-3">
        <h2 className="text-[0.9375rem] font-semibold text-ink">
          Card settlement, by unit
        </h2>
        <span className="text-[0.875rem] text-mute">
          {count(rows.length)} accounts · {count(holding)} with a balance
        </span>
      </div>
      {phone ? (
        <PhoneList
          rows={rows.map((row) => ({
            key: `${row.account_code}@${row.unit_id}`,
            title: row.account_name,
            code: row.account_code,
            line: <UnitName id={row.unit_id} />,
            lead: (
              <CardFigure
                value={money(row.per_books_minor)}
                tone={row.per_books_minor < 0 ? "bad" : undefined}
              />
            ),
          }))}
        />
      ) : (
        <Grid>
          <thead>
            <tr>
              <Th>Account</Th>
              <Th width="9rem">Unit</Th>
              <Th width="8rem">Ledger</Th>
              <Th width="13rem">Meaning</Th>
              <Th align="right" width="11rem">
                Outstanding Amount
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.account_code}@${row.unit_id}`}>
                <Td>
                  {/* The client's name, untrimmed, ending in their own code for
                    the shop — `… C001`. That suffix is THEIR name for the
                    place; the unit column beside it is ours. */}
                  <span className="font-medium text-ink">
                    {row.account_name}
                  </span>
                </Td>
                <Td>
                  <UnitName id={row.unit_id} />
                </Td>
                <Td>
                  <Code>{row.account_code}</Code>
                </Td>
                <Td className="text-[0.875rem] text-mute">
                  {row.semantic_key}
                </Td>
                <Td align="right">
                  <Balance minor={row.per_books_minor} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Grid>
      )}
    </>
  )
}
