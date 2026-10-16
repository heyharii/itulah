import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { count, day, money } from "@/lib/format"
import { financeKeys, payablesAging } from "@/lib/queries/finance"
import {
  CardRow,
  Grid,
  Note,
  NumberCard,
  Td,
  Th,
  TotalRow,
} from "@/screens/finance-final/parts"
import { useAsOf } from "@/screens/finance/hooks"
import {
  AsOfControl,
  SupplierName,
  UnitName,
  UnitSelect,
} from "@/screens/finance/parts"
import type { AgingBuckets, PayablesAgingRow } from "@itulah/contract"

/// The bucket fields alone, so a column can be indexed with a key the compiler
/// has checked rather than with a string that happens to match today.
type BucketFigures = Omit<AgingBuckets, "total_minor">

/// The five buckets, in the order they are read, and where each one lives on
/// the wire.
///
/// Declared once because this page draws them five times — the header, the
/// payable rows, the payable total, the receivable placeholder and its total —
/// and five hand-written lists of the same five fields is five chances for one
/// of them to slip a column.
///
/// The labels are the ones the live Finance module's payables card already
/// uses. Same buckets, same words: an accountant who reads both screens in one
/// morning must not have to work out whether "90+" and "Above 90" are the same
/// question.
///
/// # These are the server's buckets, not a choice made here
///
/// ERPNext takes one free-text `range` string — `"30, 60, 90, 120"` by default
/// — appends `Above`, and emits one more column than it was given numbers:
/// `<0 · 0-30 · 31-60 · 61-90 · 91-120 · 121-Above`. Ours are fixed in the
/// endpoint's SQL. Three consequences, all of them deliberate:
///
/// 1. **The not-yet-due column survives.** `Not due` is `<0`, and it is the
///    column that keeps this report honest: outstanding and *late* are
///    different states, and a report that folds them together says a business
///    is two months behind when most of what it owes is not owed yet.
/// 2. **We are a day stricter than ERPNext at the boundary.** The server puts
///    `age_days <= 0` in `Not due`, so a bill falling due today is not yet
///    late; ERPNext's `<0` is strictly negative and drops today into `0-30`.
///    Hence `1–30` here and `0-30` there. The `+1` step above that — `31–60`,
///    never `30-60` — is the same convention in both.
/// 3. **`90+` is wider than ERPNext's top pair.** There is no 120-day boundary
///    on the wire, so a debt of 95 days and one of 400 share a column. Worth
///    knowing before reading that column as "very late"; splitting it is an
///    endpoint change, not a browser one.
///
/// What we do not copy is the trap: in ERPNext a system-wide
/// `default_ageing_range` silently overwrites the visible `range` filter when
/// the report loads, so the columns on screen need not be the ones anybody
/// asked for. Nothing here can override the bucketing, because nothing here
/// performs it.
const BUCKETS: readonly {
  readonly key: keyof BucketFigures
  readonly label: string
  readonly title: string
}[] = [
  {
    key: "not_due_minor",
    label: "Not due",
    title:
      "Outstanding, but not yet fallen due — a bill due today is here, not late",
  },
  { key: "days_1_30_minor", label: "1–30", title: "1–30 days late" },
  { key: "days_31_60_minor", label: "31–60", title: "31–60 days late" },
  { key: "days_61_90_minor", label: "61–90", title: "61–90 days late" },
  { key: "days_over_90_minor", label: "90+", title: "More than 90 days late" },
]

/// Party, count, age, five buckets, outstanding.
const COLUMNS = 3 + BUCKETS.length

/// Payable & receivable ageing — how long each debt has been outstanding.
///
/// # One table, two halves, one set of columns
///
/// The question this page answers on a Monday morning is comparative: are we
/// later paying than we are being paid? That comparison is made with the eye,
/// running down a column — so the two halves share one `<thead>` rather than
/// getting a table each. Two tables cannot be relied on to put `31–60` at the
/// same x position twice, and the moment they disagree the page stops being a
/// report and becomes two lists that happen to be stacked.
///
/// # Only one half has an endpoint
///
/// `GET /finance/payables-aging` answers the payable half completely. Nothing
/// answers the receivable half, because nothing on this system ever creates a
/// receivable *document*: a till sale settles in the same breath it is rung up
/// — the five tenders are cash, card, QRIS, voucher and other, and not one of
/// them is "on account". What the client is owed lives as balances instead —
/// unsettled card batches, inter-unit positions, advances — and a balance
/// carries no date it falls due, so it cannot be bucketed by age. See
/// `WhatIsActuallyReceivable` at the foot of this file.
///
/// So the receivable half is drawn as the shape it would take and filled with
/// `—`, which is the honest figure for something nobody has counted. It is not
/// filled with `Rp 0`, which would be a claim that we are owed nothing, and it
/// is not filled with anything invented at all.
///
/// # Why the server buckets and this file does not
///
/// The five figures on a row are the server's own, lifted straight out of the
/// response. Bucketing a bill list here would look identical and be wrong
/// twice: it would age the whole invoice rather than what is still outstanding
/// on it, and it could only ever report today — an ageing asked "as at the end
/// of last month" has to un-count every payment made since, which takes a
/// query over both sides. The only arithmetic below is a sum of document
/// counts, which is a tally and not a re-derivation of money.
export function Ageing() {
  const asOf = useAsOf()
  // A plain `useState` and not a slice of anything already loaded: `unit` goes
  // on the wire. The unit is a dimension on the ledger row here, not a piece
  // of the account code, so "which store is late" is a different request and
  // never a filter applied to an answer the browser is already holding.
  const [unit, setUnit] = useState("")

  const payable = useQuery({
    queryKey: financeKeys.payablesAging(asOf.value, unit || null),
    queryFn: ({ signal }) =>
      payablesAging({ as_of: asOf.value, unit: unit || undefined }, signal),
  })

  const rows = payable.data?.suppliers ?? []
  const total = payable.data?.total ?? null
  /// Everything that has already fallen due, which is the figure somebody
  /// actually acts on — the not-due bucket is a forecast, not a problem.
  const overdue =
    total === null ? null : total.total_minor - total.not_due_minor
  /// How many documents are behind the payable total. A sum of integers the
  /// server counted, not a second opinion about an amount.
  const openDocuments = rows.reduce(
    (sum, row) => sum + row.open_document_count,
    0
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Finance final · Reports"
        title="Payable &amp; Receivable Ageing"
        sub="Who we are late paying, and who is late paying us — both sides of the debt on one set of buckets."
      />

      <Toolbar>
        <AsOfControl asOf={asOf} />
        {/* The unit filter is the point of this report, not a convenience
            on it. "We are two months late" is a sentence nobody can act on;
            "C007 is two months late" sends somebody to a store. It is a
            select and not a box because the ids are ours, and nothing on
            this page ever says them out loud. */}
        <UnitSelect
          value={unit}
          onChange={setUnit}
          className="h-control w-44"
          aria-label="Unit"
        />
        <Toolbar.Spacer />
        {/* The effective answer, in words. A date box filled with today and a
            date box the server defaulted look identical to a reader, and an
            ageing is meaningless until you know the day it was struck. */}
        <span className="text-[0.9375rem] text-mute">
          {asOf.chip}
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

      {payable.isPending ? (
        <LoadingState>
          Working out how long each debt has been outstanding…
        </LoadingState>
      ) : payable.isError ? (
        <ErrorState error={payable.error} />
      ) : (
        <div className="flex flex-col gap-4">
          <CardRow>
            <NumberCard
              label="Owed to suppliers"
              value={total?.total_minor ?? null}
              note={`${count(rows.length)} suppliers · ${count(openDocuments)} open items`}
            />
            <NumberCard
              label="Already late"
              value={overdue}
              // Red only when there is something to be red about. A zero drawn
              // in alarm colours teaches a reader to stop seeing the colour.
              tone={overdue !== null && overdue > 0 ? "bad" : undefined}
              note="Past its due date as at the reporting day"
            />
            <NumberCard
              label="Owed to us"
              // Deliberately `null`, on every render, at every location. There
              // is no endpoint and no document behind this figure, and the
              // card's own rule — a missing figure is not zero — is what makes
              // that visible at the top of the page rather than only at the
              // bottom of it.
              value={null}
              note="Not counted anywhere — see below"
            />
          </CardRow>

          {rows.length === 0 ? (
            <EmptyState>
              {unit === ""
                ? `Nothing is outstanding to any supplier as at ${day(asOf.value)}. Every posted bill has been paid in full.`
                : `Nothing is outstanding to any supplier in this unit's books as at ${day(asOf.value)}. Another unit may still owe — the filter is a server filter, so this answer is about this unit alone.`}
            </EmptyState>
          ) : (
            <Grid>
              <thead>
                <tr>
                  <Th>Party</Th>
                  <Th align="right" width="4.5rem">
                    Open items
                  </Th>
                  {/* Not "Due date", and that is the one judgement on this
                      page worth reading the code for — see `HowTheAgeIsRead`
                      at the foot of the screen. */}
                  <Th align="right" width="6.5rem">
                    <span title="Age of the oldest instalment still outstanding">
                      Oldest
                    </span>
                  </Th>
                  {BUCKETS.map((bucket) => (
                    <Th key={bucket.key} align="right" width="8.5rem">
                      <span title={bucket.title}>{bucket.label}</span>
                    </Th>
                  ))}
                  <Th align="right" width="9.5rem">
                    Outstanding
                  </Th>
                </tr>
              </thead>

              {/* Two `<tbody>` elements rather than two tables: same columns,
                  same widths, one ruler down the page. */}
              <tbody>
                <HalfRow
                  label="Payable"
                  sub="What we owe suppliers"
                  detail="GET /finance/payables-aging"
                />
                {/* The server orders heaviest first and this does not re-sort.
                    An ageing is read to decide who to pay next, and the order
                    it arrives in is that decision already made. */}
                {rows.map((row) => (
                  <SupplierRow key={row.supplier_id} row={row} />
                ))}
                {total !== null && (
                  <TotalRow>
                    <Td>Total payable</Td>
                    <Td align="right">{count(openDocuments)}</Td>
                    <Td />
                    {BUCKETS.map((bucket) => (
                      <Td key={bucket.key} align="right">
                        {money(total[bucket.key])}
                      </Td>
                    ))}
                    <Td align="right">{money(total.total_minor)}</Td>
                  </TotalRow>
                )}
              </tbody>

              <tbody>
                <HalfRow
                  label="Receivable"
                  sub="What customers owe us"
                  detail="no endpoint"
                />
                {/* One row, and it is the total row. There are no detail rows
                    to put above it because there is no ledger of receivables
                    to draw them from, and a half-dozen plausible customer
                    names under a heading is exactly the lie this module is
                    written to avoid. */}
                <TotalRow>
                  <Td>
                    Total receivable
                    <span className="mt-0.5 block text-[0.9375rem] font-normal text-mute">
                      Nothing counts it, so nothing is claimed
                    </span>
                  </Td>
                  <Td align="right">
                    <Unknown />
                  </Td>
                  <Td />
                  {BUCKETS.map((bucket) => (
                    <Td key={bucket.key} align="right">
                      <Unknown />
                    </Td>
                  ))}
                  <Td align="right">
                    <Unknown />
                  </Td>
                </TotalRow>
              </tbody>
            </Grid>
          )}

          <WhatIsActuallyReceivable />
          <WhereTheBucketsComeFrom />
          <HowTheAgeIsRead />
        </div>
      )}
    </PageContent>
  )
}

/// Why the receivable half is empty, and what would have to fill it.
///
/// The temptation here is to mirror the payable half — a debtor book of
/// customers and invoices — because that is what ERPNext's Accounts Receivable
/// is and because it would make the page symmetrical. It would also be a
/// debtor book for a business with no debtors. ERPNext's whole AR surface is
/// shaped for B2B credit: ageing against an invoice, dunning letters, credit
/// limits, statements of account. This client sells clothes over a counter for
/// cash and cards. Building the wholesaler's screen here would produce a
/// permanently empty report and a permanently wrong mental model.
function WhatIsActuallyReceivable() {
  return (
    <Note>
      <b>
        The receivable half is empty, and copying ERPNext would not fill it.
      </b>{" "}
      There is no <code>GET /finance/receivables-aging</code>, and no
      customer-invoice document exists anywhere in the backend for one to age: a
      till sale settles as it is rung up — the tenders are cash, card, QRIS,
      voucher and other, and not one of them is &ldquo;on account&rdquo;. What
      this client is actually owed is not a debtor book. It is{" "}
      <b>money in flight</b>: card batches an acquirer has taken and not yet
      settled (<code>card_receivable_credit</code> and{" "}
      <code>card_receivable_debit</code> are already mapped, already in the
      client&rsquo;s chart, and already counted as balances by{" "}
      <code>GET /finance/money</code>), inter-unit balances between the fourteen
      units (<code>affiliate_receivable</code>), and advances to staff and
      suppliers (<code>advance</code>). Every one of those is a{" "}
      <b>ledger balance, not a document</b>, and none of them records a date it
      is expected to land — so none can be bucketed by age today, whatever
      endpoint is written. The first thing a receivables ageing needs is not a
      route: it is a settlement date on a card batch.
    </Note>
  )
}

/// What the columns are, in the reader's words rather than the compiler's.
function WhereTheBucketsComeFrom() {
  return (
    <Note>
      <b>Not due is a column, not a rounding.</b> The five buckets are the
      server&rsquo;s own and are fixed — this page never re-buckets, so what is
      on screen is exactly what the endpoint computed. Anything not yet fallen
      due sits in <b>Not due</b> and is kept out of the <b>Already late</b>{" "}
      figure above, because outstanding and late are different states and a
      report that adds them together tells a business it is months behind on
      money it does not owe yet. A bill falling due today counts as not due
      here; ERPNext, whose equivalent column is <code>&lt;0</code>, counts it in
      its first late bucket instead — which is why our bands read{" "}
      <code>1–30</code> and theirs read <code>0-30</code>. One thing to watch:
      there is no 120-day boundary on the wire, so <b>90+</b> holds a debt of
      ninety-five days and one of four hundred alike.
    </Note>
  )
}

/// The band that names a half of the report.
///
/// Spans every column, which is what keeps this one table rather than two: two
/// tables cannot be relied on to put `31–60` at the same x twice, and a reader
/// comparing what we owe against what we are owed is doing it with their eye
/// down a column.
function HalfRow({
  label,
  sub,
  detail,
}: {
  label: string
  sub: string
  detail: string
}) {
  return (
    <tr>
      <Td
        colSpan={COLUMNS}
        className="border-hairline-2 bg-soft py-1.5 align-middle"
      >
        <span className="text-[0.9375rem] font-semibold text-ink">{label}</span>
        <span className="ml-2 text-[0.9375rem] text-mute">{sub}</span>
        <span className="ml-2 font-mono text-[0.9375rem] text-faint">
          {detail}
        </span>
      </Td>
    </tr>
  )
}

/// One supplier, and the five ways their debt is old.
function SupplierRow({ row }: { row: PayablesAgingRow }) {
  return (
    <tr>
      <Td>
        {/* The id stays in `title`: `supplier_id` is a uuid, and a uuid in a
            column headed Party is a cell nobody can read — but it is also what
            every support conversation about this row will be about. The name
            the bill was invoiced under is preferred over today's master list,
            because that is the name on the paper. */}
        <SupplierName
          id={row.supplier_id}
          name={row.supplier_name}
          className="font-medium text-ink"
        />
      </Td>
      <Td align="right">{count(row.open_document_count)}</Td>
      <Td align="right">
        <OldestAge days={row.oldest_days} />
      </Td>
      {BUCKETS.map((bucket) => (
        <Td key={bucket.key} align="right">
          {/* Zero is `Rp 0` and not a dash: the server counted this bucket and
              found nothing in it, which is a different statement from the
              receivable half's `—`. */}
          {money(row.buckets[bucket.key])}
        </Td>
      ))}
      <Td align="right">
        <span className="font-medium text-ink">
          {money(row.buckets.total_minor)}
        </span>
      </Td>
    </tr>
  )
}

/// How late the oldest thing this party owes actually is.
///
/// The field goes negative until the date passes, so "in 11 days" and "29 days
/// late" are two readings of one number and neither is drawn as the other. A
/// bare `-11` in a column headed Oldest reads as a mistake.
function OldestAge({ days }: { days: number }) {
  // `whitespace-nowrap` because on a phone this column is narrow enough to
  // break "48d late" across two lines, and an age split over a line break
  // stops reading as one number.
  if (days > 0) {
    return (
      <span className="font-medium whitespace-nowrap text-bad-fg">
        {count(days)}d late
      </span>
    )
  }
  return (
    <span className="whitespace-nowrap text-mute">
      {days === 0 ? "due today" : `in ${count(-days)}d`}
    </span>
  )
}

/// A figure nobody has computed.
///
/// Not `money(0)`, which would be a claim. `text-faint` and not the body
/// colour, so a column of these reads as absent at a glance rather than as
/// data somebody has to squint at.
function Unknown() {
  return (
    <span className="text-faint" title="Not counted — no endpoint answers this">
      —
    </span>
  )
}

/// Why there is no due-date column, spelled out on the page.
///
/// This is not decoration. A reader who opens a bill, sees `due 30 Sep`, and
/// then sees that bill counted in `31–60` here will conclude one of the two
/// screens is broken. Both are right, and the reason is a sentence long.
function HowTheAgeIsRead() {
  return (
    <Note>
      <b>Age is measured from what falls due next, not from a due date.</b> A
      bill here can fall due more than once — an advance now, the balance on
      delivery — so the server ages each bill from the earliest instalment the
      payments made by the reporting date have not yet covered, dropping back to
      the bill&rsquo;s own due date, then its invoice date, when it carries no
      instalments. A bill whose advance has been settled therefore ages from its
      remaining balance rather than from the advance it no longer owes. There is
      no single due date on such a document to print, which is why this report
      has no due-date column and shows <b>Oldest</b> instead: the age of the
      oldest instalment still unpaid. An undated bill is aged from its invoice
      date, which is a guess — a deliberately visible one, since calling it
      &ldquo;not due&rdquo; forever would hide the oldest debts in the one
      bucket nobody chases. Each row sums a supplier across every unit the
      location filter admits, so the report carries no unit column: a per-store
      answer is the filter above, asked again.
    </Note>
  )
}
