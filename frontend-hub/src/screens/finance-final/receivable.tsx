import { useQueries, useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { count, day, money } from "@/lib/format"
import { accountLedger, financeKeys, moneyOverview } from "@/lib/queries/finance"
import {
  CardRow,
  Code,
  Grid,
  Note,
  NumberCard,
  Td,
  Th,
} from "@/screens/finance-final/parts"
import { useAsOf } from "@/screens/finance/hooks"
import { AsOfControl, LocationSelect, SiteName } from "@/screens/finance/parts"

/// Accounts receivable — what we are actually owed.
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
  const [site, setSite] = useState("")

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
      // reading off the wire. The key carries the unit, so two locations are
      // two cache entries and never one answer wearing both names.
      queryKey: financeKeys.ledger(
        familyCode,
        site || null,
        asOf.value,
        asOf.value
      ),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        accountLedger(
          familyCode,
          {
            site: site || undefined,
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

  const byKey = useMemo(() => {
    const table = new Map<string, number | null>()
    for (const row of families.rows) table.set(row.family.key, row.balance)
    return table
  }, [families.rows])

  return (
    <PageContent>
      <PageHeader
        crumb="Finance final · Accounting"
        title="Accounts receivable"
        sub="What is owed to us — settlement an acquirer has not paid over, money one unit owes another, and money in people's hands."
      />

      <Toolbar>
        <AsOfControl asOf={asOf} />
        <LocationSelect
          value={site}
          onChange={setSite}
          className="h-8 w-44"
          aria-label="Location"
        />
        <Toolbar.Spacer />
        <span className="text-[0.71875rem] text-mute">
          {asOf.chip}
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

      {families.isPending ? (
        <LoadingState>
          Reading what each receivable account holds at the reporting date…
        </LoadingState>
      ) : families.isError ? (
        <ErrorState error={families.error} />
      ) : (
        <div className="flex flex-col gap-4">
          <CardRow>
            {/* Three cards, three single server figures. Not one of them adds
                two accounts together: a card that sums families is a card that
                has an opinion, and the accounts below have different natures —
                an allowance is a contra-asset and an inter-unit payable read
                backwards is not the same kind of thing as a card settlement. */}
            <NumberCard
              label="Owed by acquirers"
              value={byKey.get("cards") ?? null}
              note="Card sales the scheme has not paid over"
            />
            <NumberCard
              label="Owed by people"
              value={byKey.get("people") ?? null}
              note="Staff, store heads and management"
            />
            <NumberCard
              label="Owed by another unit"
              value={byKey.get("interunit-receivable") ?? null}
              note="Before the payable side is read back — see below"
            />
          </CardRow>

          <Grid>
            <thead>
              <tr>
                <Th>What it is</Th>
                <Th width="18rem">The client&rsquo;s account</Th>
                <Th width="7.5rem">Code</Th>
                <Th width="17rem">How to read it</Th>
                <Th align="right" width="10rem">
                  At {day(asOf.value)}
                </Th>
              </tr>
            </thead>
            <tbody>
              {families.rows.map(({ family, name, balance }) => (
                <tr key={family.key}>
                  <Td>
                    <span className="font-medium text-ink">{family.what}</span>
                    <span className="mt-0.5 block text-[0.65625rem] text-mute">
                      {family.covers}
                    </span>
                  </Td>
                  <Td>
                    {/* The server's own answer, not a label written here. If
                        the client renames an account the page follows. */}
                    {name === null ? (
                      <span className="text-faint">—</span>
                    ) : (
                      name
                    )}
                  </Td>
                  <Td>
                    {/* Every account the family adds, not one group code. The
                        collapse turned a group into its meanings, so a family
                        that used to print `1011101` now prints the two card
                        receivables it is the sum of. */}
                    {family.codes.map((code) => (
                      <span key={code} className="block">
                        <Code>{code}</Code>
                      </span>
                    ))}
                  </Td>
                  <Td className="text-[0.71875rem] text-body">
                    {family.reading}
                  </Td>
                  <Td align="right">
                    <Balance minor={balance} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Grid>

          <Note>
            <b>There is no total row, and that is deliberate.</b> These six
            families do not add up to one number: an allowance is a
            contra-asset that subtracts, an advance is money we have paid out
            rather than money owed to us, and the last row is a{" "}
            <i>liability</i> account read backwards — a debit on{" "}
            <code>HUTANG AFFILIASI</code> means the unit overpaid and is owed,
            which is the same fact as an inter-unit receivable booked on the
            other side of the books. Adding them would produce a figure with no
            name. Each row is the server&rsquo;s own sum over that
            account&rsquo;s whole subtree, so the fourteen location leaves the
            client&rsquo;s chart splits each of these into are already added up
            before they reach this page.
          </Note>

          <Settlement asOf={asOf.value} site={site} />

          <Note>
            <b>Why the settlement rows read nothing.</b> The accounts are there
            and they are mapped — the account map carries a family called{" "}
            <i>Receivables</i>, and <code>card_receivable_credit</code>,{" "}
            <code>card_receivable_debit</code> and <code>card_fee</code> each
            point at one of the client&rsquo;s accounts at all fourteen units.
            Nothing posts to them, because nothing posts a sale to the general
            ledger at all: every entry in the books today is a supplier
            invoice, a depreciation run, a bank statement line or a manual
            journal. Until a day&rsquo;s takings are posted — cash to the
            drawer, card to a receivable, MDR to the fee account, and the
            receivable cleared when the acquirer pays — the T+1 money we are
            owed exists on the merchant statement and nowhere in the books.
            There is no QRIS receivable account in the chart at all, and no
            voucher receivable: a voucher is a liability we owe the shopper,
            settled when it is spent, and it is tracked in the voucher ledger
            rather than here.
          </Note>

          <Note>
            <b>What an ageing of this side would need.</b> Nothing can be
            bucketed by age today, because nothing records when any of these
            falls due — a ledger balance has a posting date and no due date, so
            drawing empty <i>1–30 / 31–60 / 61–90</i> columns here would say the
            figures are missing when in fact the question cannot yet be asked. A{" "}
            <code>GET /finance/receivables-aging</code> would have to mirror the
            payable one exactly: <code>as_of</code> and <code>site</code> as
            query parameters, both sides wound back to the reporting date, and
            an answer of <code>as_of</code>, <code>site_id</code>, a{" "}
            <code>parties</code> array of{" "}
            <code>
              {
                "{ party_kind, party_id, party_name, item_count, oldest_days, buckets }"
              }
            </code>{" "}
            and a grand <code>total</code>, with <code>buckets</code> the same
            five <code>AgingBuckets</code> fields in minor units and the
            bucketing done in SQL. <code>party_kind</code> is the field the
            payable version does not need: this side has three kinds of debtor
            — an acquirer, a unit, a person — and one supplier column cannot
            hold them. Before any of that, something has to give each row a due
            date: a settlement terms table per acquirer (scheme, T+n), a
            repayment date on a staff advance, and a settlement date on an
            inter-unit charge. Without those three the endpoint could only age
            from the posting date, which for a card sale is right by accident
            and for a staff loan is meaningless.
          </Note>
        </div>
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
  /// Stable identity for the summary cards, independent of how many accounts
  /// the family turns out to span.
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
function Settlement({ asOf, site }: { asOf: string; site: string }) {
  const overview = useQuery({
    queryKey: financeKeys.money(asOf, site || null),
    queryFn: ({ signal }) =>
      moneyOverview({ as_of: asOf, site: site || undefined }, signal),
  })

  const rows = useMemo(
    () =>
      (overview.data?.rows ?? []).filter((row) => row.pot === "CARD_RECEIVABLE"),
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
        No settlement account is mapped at this location. A place money can be
        owed is a meaning bound to an account on the Account map, and until one
        is bound there is nowhere for a card sale to sit.
      </EmptyState>
    )
  }

  const holding = rows.filter((row) => row.per_books_minor !== 0).length

  return (
    <>
      <h2 className="mt-2 text-[0.875rem] font-semibold text-ink">
        Settlement accounts, unit by unit
      </h2>
      <p className="-mt-2 text-[0.71875rem] text-mute">
        {count(rows.length)} mapped across the units this filter admits ·{" "}
        {holding === 0
          ? "not one of them carries a balance"
          : `${count(holding)} carrying a balance`}
      </p>
      <Grid>
        <thead>
          <tr>
            <Th>Account</Th>
            <Th width="9rem">Unit</Th>
            <Th width="8rem">Ledger</Th>
            <Th width="13rem">Meaning</Th>
            <Th align="right" width="10rem">
              Per books
            </Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.account_code}@${row.site_id}`}>
              <Td>
                {/* The client's name, untrimmed, ending in their own code for
                    the shop — `… C001`. That suffix is THEIR name for the
                    place; the unit column beside it is ours. */}
                <span className="font-medium text-ink">{row.account_name}</span>
              </Td>
              <Td>
                <SiteName id={row.site_id} />
              </Td>
              <Td>
                <Code>{row.account_code}</Code>
              </Td>
              <Td className="text-[0.71875rem] text-mute">
                {row.semantic_key}
              </Td>
              <Td align="right">
                <Balance minor={row.per_books_minor} />
              </Td>
            </tr>
          ))}
        </tbody>
      </Grid>
    </>
  )
}
