import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Segmented, Toolbar } from "@/components/ui/segmented"
import { EmptyState, Truncated } from "@/components/ui/states"
import { count, day, money } from "@/lib/format"
import {
  financeKeys,
  listBills,
  payablesAging,
  unbilledReceipts,
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
import { useAsOf } from "@/screens/finance/hooks"
import {
  AsOfControl,
  LocationSelect,
  SiteName,
  SupplierName,
} from "@/screens/finance/parts"
import type {
  AgingBuckets,
  PayablesAgingRow,
  SupplierBill,
  UnbilledReceipt,
} from "@itulah/contract"

/// Accounts payable — what is owed, to whom, and how late.
///
/// # Three questions, not one
///
/// ERPNext ships this as four reports off one engine: Accounts Payable,
/// Accounts Payable Summary, and the receivable twins. The split is real and
/// worth keeping — *which supplier do I pay this week* and *what is this
/// invoice still short* are asked by the same person on the same morning and
/// answered by different tables — so they are segments here rather than two
/// entries in the sidebar. A third segment holds the goods that arrived and
/// have not been billed, which is not a payable at all and is on this page
/// because it is the exposure that will become one.
///
/// # What is the server's and what is this file's
///
/// The buckets are the server's, lifted whole. Re-bucketing the bill list here
/// would look identical and be wrong twice: it ages the invoice rather than
/// what is still outstanding on it, and it cannot wind a payment back — "as at
/// the end of last month" has to un-count money that left the bank since, and
/// only a query over both sides can do that. `as_of` and the unit both go on
/// the wire for the same reason: a bill invoiced after the reporting date is
/// not yet a debt, and one shop's payables are not another's.
///
/// The only arithmetic below is `total − not_due`, a subtraction of two
/// figures the server sent in the same response, and tallies of document
/// counts. Neither re-derives an amount.
export function AccountsPayable() {
  const asOf = useAsOf()
  // `site` goes on the wire, never across a list already in hand. The unit is
  // a dimension on the ledger row here rather than a slice of the account
  // code, so "what does Store 07 owe" is a different request.
  const [site, setSite] = useState("")
  const [view, setView] = useState<View>("supplier")

  const aging = useQuery({
    queryKey: financeKeys.payablesAging(asOf.value, site || null),
    queryFn: ({ signal }) =>
      payablesAging({ as_of: asOf.value, site: site || undefined }, signal),
  })

  // The books' own answer to the same question, for the reconciliation card,
  // comes back IN the ageing (`books_minor`): the server resolves the payable
  // accounts through the account map. This screen used to ask the ledger for
  // a client account code (`2012001`) the chart in use does not have, got a
  // ledger of nothing, and printed "Ageing less −Rp 0" beside the whole
  // ageing as its "difference".
  //
  // ERPNext calls this `gl_balance` and puts `diff` beside it. Ours differ for
  // a narrow reason — the ageing counts a bill from its INVOICE date and the
  // ledger from its POSTING date — so a non-zero difference here is a real
  // statement about bills posted into a month they were not invoiced in, not
  // a rounding artefact.

  const total = aging.data?.total ?? null
  const suppliers = aging.data?.suppliers ?? []
  /// What has already fallen due — the figure somebody acts on today. The
  /// not-due bucket is a forecast, not a problem.
  const due = total === null ? null : total.total_minor - total.not_due_minor
  const openDocuments = suppliers.reduce((sum, row) => sum + row.open_document_count, 0)
  /// Already a positive debt: the server turns the credit balance the right
  /// way up, so nothing on this page flips a sign.
  const perBooks = aging.data?.books_minor ?? null
  const difference =
    total === null || perBooks === null ? null : total.total_minor - perBooks

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Payables"
        title="Accounts payable"
        sub="What is owed to suppliers, how late it is, and what arrived before its invoice did."
      />

      <Toolbar>
        <AsOfControl asOf={asOf} />
        <LocationSelect
          value={site}
          onChange={setSite}
          className="h-8 w-44"
          aria-label="Location"
        />
        <Segmented options={VIEWS} value={view} onChange={setView} />
        <Toolbar.Spacer />
        {/* The effective answer, in words. A date box filled with today and a
            date box the server defaulted look identical to a reader, and an
            ageing means nothing until you know the day it was struck. */}
        <span className="text-[0.875rem] text-mute">
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

      <div className="flex flex-col gap-4">
        {queryState(aging, {
          loading: "Working out what is owed and how long it has been owed…",
          render: () => (
            <CardRow columns={4}>
              <NumberCard
                label="Outstanding"
                value={total?.total_minor ?? null}
                note={`${count(suppliers.length)} suppliers · ${count(openDocuments)} open items`}
              />
              <NumberCard
                label="Already due"
                value={due}
                // Red only when there is something to be red about. A zero in
                // alarm colours teaches a reader to stop seeing the colour.
                tone={due !== null && due > 0 ? "bad" : undefined}
                note="Past its due date at the reporting day"
              />
              <NumberCard
                label="Not yet due"
                value={total?.not_due_minor ?? null}
                note="Falls due after the reporting day"
              />
              <NumberCard
                label="Against the books"
                // `null` while the ledger is still in flight, and `—` on
                // screen: "we have not asked yet" and "the two agree" are
                // different sentences and a zero would say the second one
                // early.
                value={difference}
                tone={
                  difference === null || difference === 0 ? "ok" : "warn"
                }
                note={
                  difference === null
                    ? "Reading the payable account…"
                    : difference === 0
                      ? "The ageing and the ledger agree"
                      : `Ageing less ${money(perBooks)} on the payable account`
                }
              />
            </CardRow>
          ),
        })}

        {view === "supplier" &&
          queryState(aging, {
            loading: "Adding up what each supplier is owed…",
            render: (data) =>
              data.suppliers.length === 0 ? (
                <NothingOwed site={site} asOf={asOf.value} />
              ) : (
                <SupplierTable rows={data.suppliers} total={data.total} />
              ),
          })}

        {view === "bill" && <BillTable asOf={asOf.value} site={site} />}

        {view === "unbilled" && <UnbilledTable />}
      </div>
    </PageContent>
  )
}

type View = "supplier" | "bill" | "unbilled"

const VIEWS: readonly { readonly value: View; readonly label: string }[] = [
  { value: "supplier", label: "By supplier" },
  { value: "bill", label: "By bill" },
  { value: "unbilled", label: "Not yet billed" },
]

/// The bucket fields alone, so a column is indexed with a key the compiler has
/// checked rather than with a string that happens to match today.
type BucketFigures = Omit<AgingBuckets, "total_minor">

/// The five buckets, in the order they are read.
///
/// ERPNext's default range is `30, 60, 90, 120` and gives six columns — `<0`,
/// `0-30`, `31-60`, `61-90`, `91-120`, `121-Above`. Ours stops at 90 because
/// the server's SQL stops at 90, and a column the server cannot fill is a
/// column that lies. The shape is otherwise theirs, including the separate
/// not-due column they call `<0`: a debt that has not fallen due is not an old
/// debt, and folding it into the first bucket — which is what ERPNext's own
/// `get_ageing_data` does before `set_ageing` corrects it — makes a supplier
/// paid perfectly on time look thirty days late.
///
/// Declared once because the page draws them in a header, in every row and in
/// a total, and three hand-written lists of five fields is three chances to
/// slip a column.
const BUCKETS: readonly {
  readonly key: keyof BucketFigures
  readonly label: string
  readonly title: string
}[] = [
  { key: "not_due_minor", label: "Not due", title: "Not yet fallen due" },
  { key: "days_1_30_minor", label: "1–30", title: "1–30 days late" },
  { key: "days_31_60_minor", label: "31–60", title: "31–60 days late" },
  { key: "days_61_90_minor", label: "61–90", title: "61–90 days late" },
  { key: "days_over_90_minor", label: "90+", title: "More than 90 days late" },
]

/// One row per supplier — ERPNext's Accounts Payable Summary.
///
/// Their summary carries a `Total Amount Due` column beside the outstanding
/// one and it reads as a duplicate until you notice it excludes the not-due
/// bucket. That is the column an AP clerk actually works from: outstanding is
/// the relationship, due is this week's decision. It is kept here under the
/// plainer heading **Due now**.
function SupplierTable({
  rows,
  total,
}: {
  rows: readonly PayablesAgingRow[]
  total: AgingBuckets
}) {
  const openDocuments = rows.reduce((sum, row) => sum + row.open_document_count, 0)
  return (
    <>
      <Grid>
        <thead>
          <tr>
            <Th>Supplier</Th>
            <Th align="right" width="4.5rem">
              Open items
            </Th>
            <Th align="right" width="6.5rem">
              <span title="Age of the oldest instalment still outstanding">
                Oldest
              </span>
            </Th>
            {BUCKETS.map((bucket) => (
              <Th key={bucket.key} align="right" width="8rem">
                <span title={bucket.title}>{bucket.label}</span>
              </Th>
            ))}
            <Th align="right" width="8.5rem">
              <span title="Everything that has already fallen due — the buckets after Not due">
                Due now
              </span>
            </Th>
            <Th align="right" width="9.5rem">
              Outstanding
            </Th>
          </tr>
        </thead>
        <tbody>
          {/* The server orders heaviest first and this does not re-sort: an
              ageing is read to decide who to pay next, and the order it
              arrives in is that decision already made. */}
          {rows.map((row) => (
            <tr key={row.supplier_id}>
              <Td>
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
                  {/* `Rp 0` and not a dash: the server counted this bucket and
                      found nothing in it, which is a finding. */}
                  {money(row.buckets[bucket.key])}
                </Td>
              ))}
              <Td align="right">{money(dueNow(row.buckets))}</Td>
              <Td align="right">
                <span className="font-medium text-ink">
                  {money(row.buckets.total_minor)}
                </span>
              </Td>
            </tr>
          ))}
          <TotalRow>
            <Td>Total payable</Td>
            <Td align="right">{count(openDocuments)}</Td>
            <Td />
            {BUCKETS.map((bucket) => (
              <Td key={bucket.key} align="right">
                {money(total[bucket.key])}
              </Td>
            ))}
            <Td align="right">{money(dueNow(total))}</Td>
            <Td align="right">{money(total.total_minor)}</Td>
          </TotalRow>
        </tbody>
      </Grid>

      <Note>
        <b>Age is measured from what falls due next.</b> A bill here can fall
        due more than once — an advance now, the balance on delivery — so the
        server ages each one from the earliest instalment the payments made by
        the reporting date have not covered, dropping back to the bill&rsquo;s
        own due date and then to its invoice date when it carries no
        instalments. There is no single due date on such a document to print,
        which is why this table shows <b>Oldest</b> rather than a due-date
        column. Each row sums a supplier across every unit the location filter
        admits, so there is no unit column: a per-store answer is the filter
        above, asked again.
      </Note>
    </>
  )
}

/// One row per bill — ERPNext's Accounts Payable detail.
///
/// # Why this asks for POSTED and nothing else
///
/// Because that is the population the ageing counts: `payables_aging` filters
/// `i.status = 'POSTED'`, so a draft bill is in neither. Asking the server for
/// the same slice is what keeps the two segments of this page describing one
/// set of documents rather than two overlapping ones — and `status` is a
/// server filter, so the narrowing is the request and not a sieve over a wider
/// answer.
///
/// # What this table cannot do, and says so
///
/// It cannot be wound back to the reporting date and it cannot be narrowed by
/// unit. `GET /finance/bills` takes `site`, but the browser's `listBills()`
/// wrapper does not forward it and `financeKeys.bills()` keys on `status`
/// alone — so passing one here would read another unit's cached answer. It
/// takes no `as_of` at all: `outstanding_minor`, `days_overdue` and
/// `next_due_date` are derived on read, as at now. So this is the register as
/// it stands today, and the `<Note>` beneath it says that in words rather than
/// letting the date box above imply otherwise.
function BillTable({ asOf, site }: { asOf: string; site: string }) {
  const bills = useQuery({
    queryKey: financeKeys.bills("POSTED"),
    queryFn: ({ signal }) =>
      listBills({ status: "POSTED", limit: CAP }, signal).then(
        (page) => page.rows
      ),
  })

  return queryState(bills, {
    loading: "Reading the bill register…",
    render: (rows) =>
      rows.length === 0 ? (
        <EmptyState>
          No bill has been posted yet. A bill is recorded first and posted
          second, so a register this empty means either nothing has arrived or
          nothing has been let into the books.
        </EmptyState>
      ) : (
        <>
          {rows.length === CAP && (
            <Truncated limit={CAP} noun="bills" total={null} />
          )}
          <Grid>
            <thead>
              <tr>
                <Th>Supplier</Th>
                <Th width="11rem">Bill</Th>
                <Th width="8rem">Unit</Th>
                <Th width="7rem">Invoiced</Th>
                <Th width="7rem">
                  <span title="The earliest instalment this bill has not paid for">
                    Falls due
                  </span>
                </Th>
                <Th align="right" width="6rem">
                  Age
                </Th>
                <Th align="right" width="9rem">
                  Invoiced amount
                </Th>
                <Th align="right" width="9rem">
                  Paid
                </Th>
                <Th align="right" width="9.5rem">
                  Outstanding
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((bill) => (
                <BillRow key={bill.invoice_id} bill={bill} />
              ))}
              <TotalRow>
                <Td>Listed here</Td>
                <Td align="right">{count(rows.length)} bills</Td>
                <Td />
                <Td />
                <Td />
                <Td />
                <Td align="right">{money(sumBy(rows, "total_minor"))}</Td>
                <Td align="right">{money(sumBy(rows, "paid_minor"))}</Td>
                <Td align="right">
                  {money(sumBy(rows, "outstanding_minor"))}
                </Td>
              </TotalRow>
            </tbody>
          </Grid>

          <Note>
            <b>This table is today, not {day(asOf)}.</b> Every figure on a bill
            row — what is still outstanding, how late it is, which instalment
            falls due next — is derived when the row is read, so the register
            answers as at now and the date box above does not reach it. The
            aged tables and the cards do:{" "}
            <code>GET /finance/payables-aging</code> winds both sides back.{" "}
            {site === "" ? (
              <>
                The unit filter does not reach it either — the endpoint takes{" "}
                <code>site</code>, but this app&rsquo;s wrapper does not send it
                and its cache key does not carry it, so a filtered read here
                would be another unit&rsquo;s answer under the wrong name.
              </>
            ) : (
              <>
                The unit filter does not reach it either, so these rows are
                every location&rsquo;s and not <SiteName id={site} />
                &rsquo;s — the <b>Unit</b> column is the honest way to read them
                until <code>listBills()</code> forwards <code>site</code>.
              </>
            )}{" "}
            The total row says <b>listed here</b> for the same reason: it adds
            the rows that arrived, and the authoritative outstanding is the
            card above, which the server counted over everything.
          </Note>
        </>
      ),
  })
}

/// The ceiling this screen asks for, and the reason there is one.
///
/// `listBills()` defaults to 200 and pages above it. A table that silently
/// shows the first page of a register and puts a total under it is the quiet
/// version of a wrong number, so the ask is explicit and `<Truncated>` says so
/// when the answer comes back exactly full.
const CAP = 300

function BillRow({ bill }: { bill: SupplierBill }) {
  return (
    <tr>
      <Td>
        <SupplierName
          id={bill.supplier_id}
          name={bill.supplier_name}
          className="font-medium text-ink"
        />
      </Td>
      <Td>
        <Code>{bill.invoice_number}</Code>
        {bill.entry_number !== null && (
          <span className="mt-0.5 block text-[0.875rem] text-mute">
            {bill.entry_number}
          </span>
        )}
      </Td>
      <Td>
        <SiteName id={bill.site_id} />
      </Td>
      <Td>{day(bill.invoice_date)}</Td>
      <Td>
        {/* `next_due_date`, not `due_date`. The date on the paper stays what it
            always was; what an AP office asks every morning is which
            instalment is next, and it is `null` once nothing is owed. */}
        {bill.next_due_date === null ? (
          <span className="text-faint" title="Nothing left to fall due">
            —
          </span>
        ) : (
          day(bill.next_due_date)
        )}
      </Td>
      <Td align="right">
        <OldestAge days={bill.days_overdue} />
      </Td>
      <Td align="right">{money(bill.total_minor)}</Td>
      <Td align="right">
        {money(bill.paid_minor)}
        {/* What a DRAFT payment has reserved beyond what has actually left the
            bank. Without it a bill showing money outstanding that will not take
            another allocation looks broken; the database refuses the second
            allocation because a draft already holds it. ERPNext has no
            equivalent column — its drafts reserve nothing. */}
        {bill.allocated_minor > bill.paid_minor && (
          <span className="mt-0.5 block text-[0.875rem] text-mute">
            {money(bill.allocated_minor - bill.paid_minor)} spoken for
          </span>
        )}
      </Td>
      <Td align="right">
        <span className="font-medium text-ink">
          {money(bill.outstanding_minor)}
        </span>
        <span className="mt-0.5 block">
          <Pill tone={bill.overdue ? "bad" : paymentTone(bill.payment_state)}>
            {bill.overdue ? "Overdue" : PAYMENT_STATE[bill.payment_state]}
          </Pill>
        </span>
      </Td>
    </tr>
  )
}

/// `payment_state` is its own field rather than a fourth `status`, because a
/// bill can be partly paid AND late at once — which ERPNext's single Select
/// cannot express and this pair can. `overdue` wins the colour when both are
/// true: late is the thing somebody has to do something about.
const PAYMENT_STATE: Readonly<Record<string, string>> = {
  UNPAID: "Unpaid",
  PARTIALLY_PAID: "Part paid",
  PAID: "Paid",
}

function paymentTone(state: string): "ok" | "warn" | "neutral" {
  if (state === "PAID") return "ok"
  if (state === "PARTIALLY_PAID") return "warn"
  return "neutral"
}

/// Deliveries with no bill against them.
///
/// Not a payable and not on this page by accident. The client keeps no
/// goods-received-not-invoiced account, so this exposure sits in the warehouse
/// and nowhere in the books: at month end both inventory and payables
/// understate by exactly this, and this list is the only place the gap is ever
/// visible. ERPNext would have posted it to Stock Received But Not Billed on
/// the purchase receipt; we have no such account to post to, which is why the
/// figure is labelled an exposure rather than a balance.
function UnbilledTable() {
  const unbilled = useQuery({
    queryKey: financeKeys.unbilled(),
    queryFn: ({ signal }) => unbilledReceipts(signal),
  })

  return queryState(unbilled, {
    loading: "Looking for deliveries nobody has billed for…",
    render: (rows) =>
      rows.length === 0 ? (
        <EmptyState>
          Every delivery has a bill against it. Nothing is sitting in a
          warehouse that the books do not know about.
        </EmptyState>
      ) : (
        <>
          <Grid>
            <thead>
              <tr>
                <Th>Receipt</Th>
                <Th width="9rem">Supplier</Th>
                <Th width="8rem">Unit</Th>
                <Th width="8rem">Arrived</Th>
                <Th align="right" width="5.5rem">
                  Waiting
                </Th>
                <Th align="right" width="5rem">
                  Lines
                </Th>
                <Th align="right" width="10rem">
                  <span title="Accepted quantity at the price that was ordered">
                    At order price
                  </span>
                </Th>
                <Th align="right" width="10rem">
                  <span title="What the supplier's own paperwork said, where it came with any">
                    Off the paperwork
                  </span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((receipt) => (
                <ReceiptRow key={receipt.receipt_id} receipt={receipt} />
              ))}
              <TotalRow>
                <Td>Total exposure</Td>
                <Td />
                <Td />
                <Td />
                <Td />
                <Td align="right">
                  {count(rows.reduce((sum, row) => sum + row.line_count, 0))}
                </Td>
                <Td align="right">
                  {money(sumBy(rows, "value_at_order_price_minor"))}
                </Td>
                <Td />
              </TotalRow>
            </tbody>
          </Grid>

          <Note>
            <b>This is not in the books anywhere.</b> The client&rsquo;s chart
            carries no goods-received-not-invoiced account, so a delivery that
            has arrived and not been billed leaves inventory and payables both
            understated by the same amount until the invoice lands. The figure
            under <b>At order price</b> is what the goods are worth if the
            supplier bills what was agreed; the column beside it is what their
            own paperwork claimed, which is evidence and not a bookable figure —
            where they disagree, neither has been posted and somebody has to
            decide which is right. No <code>as_of</code> here either:{" "}
            <code>GET /finance/unbilled</code> answers as at now, which is the
            only question an exposure like this is ever asked. The unit column
            prints a raw id rather than a name on these rows, and that is not a
            rendering fault: a receipt carries the DISTRIBUTION CENTRE&rsquo;s
            own spelling of itself — <code>dc-01</code>, the edge node&rsquo;s
            id — where every other finance endpoint says <code>dc</code>, the
            cloud&rsquo;s. The two are the same building. Inventing a name for
            an id the account map does not carry would be worse than showing the
            id, so the id is what shows.
          </Note>
        </>
      ),
  })
}

function ReceiptRow({ receipt }: { receipt: UnbilledReceipt }) {
  return (
    <tr>
      <Td>
        <Code>{receipt.receipt_number}</Code>
        {receipt.invoice_number !== null && (
          <span className="mt-0.5 block text-[0.875rem] text-mute">
            their {receipt.invoice_number}
          </span>
        )}
      </Td>
      <Td>
        {/* `supplier_id` on a receipt is the DC's own supplier code — `SUP02`,
            not a uuid — so `<SupplierName>` would look it up in the finance
            master list and find nothing. Printed as the code it is. */}
        <Code>{receipt.supplier_id}</Code>
      </Td>
      <Td>
        <SiteName id={receipt.site_id} />
      </Td>
      <Td>{day(receipt.arrived_at)}</Td>
      <Td align="right">
        <span
          className={
            receipt.days_waiting > 30 ? "font-medium text-bad-fg" : undefined
          }
        >
          {count(receipt.days_waiting)}d
        </span>
      </Td>
      <Td align="right">{count(receipt.line_count)}</Td>
      <Td align="right">{money(receipt.value_at_order_price_minor)}</Td>
      <Td align="right">
        {/* `null` is an answer: the goods came with no paperwork. A zero would
            claim the supplier invoiced nothing. */}
        {receipt.invoice_total_minor === null ? (
          <span className="text-faint" title="No paperwork came with the goods">
            —
          </span>
        ) : (
          money(receipt.invoice_total_minor)
        )}
      </Td>
    </tr>
  )
}

/// Everything past its due date: the buckets after `not_due`.
///
/// Written as a subtraction of the server's own two figures rather than a sum
/// of four, because `total_minor` is the server's total and re-adding the
/// buckets to get it back would be this file having a second opinion about an
/// amount.
function dueNow(buckets: AgingBuckets): number {
  return buckets.total_minor - buckets.not_due_minor
}

/// Add one field down a list of rows.
///
/// Only ever used on a list that arrived whole, and only on fields the server
/// computed — the tables that use it say "listed here" over the result rather
/// than claiming it is the population's total.
function sumBy<K extends string>(
  rows: readonly Record<K, number>[],
  field: K
): number {
  return rows.reduce((sum, row) => sum + row[field], 0)
}

/// How late a thing is, when the number goes negative before it is due.
///
/// `oldest_days` and `days_overdue` are both counted forward from the date
/// something falls due, so they are negative until that day passes. A bare
/// `-11` in a column headed Age reads as a mistake; "in 11d" reads as a
/// forecast, which is what it is.
function OldestAge({ days }: { days: number }) {
  if (days > 0) {
    return <span className="font-medium text-bad-fg">{count(days)}d late</span>
  }
  return (
    <span className="text-mute">
      {days === 0 ? "due today" : `in ${count(-days)}d`}
    </span>
  )
}

/// Nothing outstanding — and which kind of nothing.
///
/// At one location the sentence has to say the filter is a server filter,
/// because "nothing is owed" and "nothing is owed HERE" are different findings
/// and a reader who has forgotten the select is set will take the first.
function NothingOwed({ site, asOf }: { site: string; asOf: string }) {
  return (
    <EmptyState>
      {site === ""
        ? `Nothing is outstanding to any supplier as at ${day(asOf)}. Every posted bill has been paid in full.`
        : `Nothing is outstanding to any supplier at this location as at ${day(asOf)}. Another location may still owe — the filter is a server filter, so this answer is about this unit alone.`}
    </EmptyState>
  )
}
