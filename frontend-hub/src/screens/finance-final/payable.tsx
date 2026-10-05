import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Card } from "@/components/ui/card"
import { ExportButton } from "@/components/ui/export-button"
import { Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Status } from "@/components/ui/pill"
import { Banner, EmptyState, LoadMore } from "@/components/ui/states"
import type { ExportSheet } from "@/lib/export-xlsx"
import { count, day, money } from "@/lib/format"
import {
  financeKeys,
  listBills,
  payablesAging,
  unbilledPage,
} from "@/lib/queries/finance"
import { useSiteLabel, useUnits } from "@/lib/queries/organisation"
import { queryState } from "@/lib/query-state"
import { Code, Grid, Td, Th, TotalRow } from "@/screens/finance-final/parts"
import { todayIso } from "@/screens/finance/chart"
import { useAsOf, useSupplierName, useUnitName } from "@/screens/finance/hooks"
import {
  AsOfControl,
  SiteName,
  SupplierName,
  UnitName,
  UnitSelect,
} from "@/screens/finance/parts"
import { FilterCheck, ReportFilters } from "@/screens/finance/report"
import { AgeingBar } from "@/screens/finance/workspace"
import type {
  AgingBuckets,
  PayablesAgingRow,
  SupplierBill,
  UnbilledReceipt,
} from "@itulah/contract"

/// What the page's Export button writes. The table on screen owns its rows —
/// the bill register and the unbilled list page on their own — so it hands the
/// page a builder through this ref, and the header button (which stands
/// outside the table) calls whichever one is mounted. A ref and not state: it
/// is read on a click, never drawn.
type Exporter = React.RefObject<(() => ExportSheet | null) | null>

function useExporter(
  exporterRef: Exporter,
  build: () => ExportSheet | null
): void {
  useEffect(() => {
    exporterRef.current = build
    return () => {
      exporterRef.current = null
    }
  })
}

/// ERPNext's Accounts Payable report (`accounts/report/accounts_payable`).
///
/// Its page: the filters — unit in Company's place, Report Date, Group By
/// Supplier — then the ageing chart, one bar split by how late the money is,
/// then the table. Unticked, one row per bill in ERPNext's column order;
/// ticked, one row per supplier with the buckets across (ERPNext's Accounts
/// Payable Summary). Unbilled Deliveries is ours and comes last: goods that
/// arrived with no bill, the exposure that will become a payable.
///
/// The buckets are the server's (`GET /finance/payables-aging`), wound back to
/// the report date on both sides — a bill invoiced after it is not yet a
/// debt, a payment made after it has not yet reduced one. Re-bucketing the
/// bill list here would age the invoice rather than what is outstanding on it.
/// The bill rows are the register as it stands today: `GET /finance/bills`
/// takes no report date.
///
/// ERPNext keeps the ledger's figure beside the ageing (`gl_balance`, `diff`).
/// Here it is said only when the two disagree — the ageing counts a bill from
/// its invoice date and the ledger from its posting date, so a difference is a
/// bill posted into a month it was not invoiced in.
export function AccountsPayable() {
  const asOf = useAsOf()
  // `unit` goes on the wire, never across a list already in hand.
  const [unit, setUnit] = useState("")
  const [bySupplier, setBySupplier] = useState(false)
  const [unbilled, setUnbilled] = useState(false)
  const [needle, setNeedle] = useState("")
  const unitName = useUnitName()
  const exporter: Exporter = useRef(null)
  const subtitle = `${asOf.chip} · ${unit === "" ? "every unit" : unitName(unit)}`

  const aging = useQuery({
    queryKey: financeKeys.payablesAging(asOf.value, unit || null),
    queryFn: ({ signal }) =>
      payablesAging({ as_of: asOf.value, unit: unit || undefined }, signal),
  })

  const total = aging.data?.total ?? null
  const perBooks = aging.data?.books_minor ?? null
  const difference =
    total === null || perBooks === null ? null : total.total_minor - perBooks

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Payables"
        title="Accounts Payable"
        actions={
          <ExportButton
            build={() => exporter.current?.() ?? null}
            disabled={aging.data === undefined}
          />
        }
      />

      <ReportFilters
        note={
          <>
            {asOf.chip}
            {unit === "" ? (
              " · every unit"
            ) : (
              <>
                {" · "}
                <UnitName id={unit} />
              </>
            )}
          </>
        }
      >
        {/* The bill register is the only segment with bills to look for. */}
        {!bySupplier && !unbilled && (
          <Input
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            aria-label="Search"
            className="h-control w-64"
          />
        )}
        <UnitSelect
          value={unit}
          onChange={setUnit}
          className="h-control w-44"
          aria-label="Unit"
        />
        <AsOfControl asOf={asOf} />
        <FilterCheck
          label="Group By Supplier"
          checked={bySupplier}
          onChange={setBySupplier}
        />
        <FilterCheck
          label="Unbilled Deliveries"
          checked={unbilled}
          onChange={setUnbilled}
        />
      </ReportFilters>

      {difference !== null && difference !== 0 && (
        <Banner tone="warn">
          The ageing is {money(Math.abs(difference))}{" "}
          {difference > 0 ? "more" : "less"} than the payable accounts in the
          ledger ({money(perBooks)}) — a bill posted into a month it was not
          invoiced in.
        </Banner>
      )}

      {queryState(aging, {
        loading: "Working out what is owed and how long it has been owed…",
        render: (data) => (
          <>
            <Card className="mb-3 px-4 py-4">
              <AgeingBar buckets={data.total} />
            </Card>

            {unbilled ? (
              <UnbilledTable exporter={exporter} subtitle={subtitle} />
            ) : bySupplier ? (
              data.suppliers.length === 0 ? (
                <NothingOwed unit={unit} asOf={asOf.value} />
              ) : (
                <SupplierTable
                  rows={data.suppliers}
                  total={data.total}
                  exporter={exporter}
                  title="Accounts Payable by Supplier"
                  filename={`Accounts-Payable-by-Supplier-${asOf.value}`}
                  subtitle={subtitle}
                />
              )
            ) : (
              <BillTable
                unit={unit}
                needle={needle}
                exporter={exporter}
                subtitle={subtitle}
                asOf={asOf.value}
              />
            )}
          </>
        ),
      })}
    </PageContent>
  )
}

/// ERPNext's Accounts Payable Summary (`accounts_payable_summary`): the same
/// ageing, one row per supplier, under Financial Reports › Registers. The
/// table is the one Accounts Payable draws with Group By Supplier ticked.
export function AccountsPayableSummary() {
  const asOf = useAsOf()
  const [unit, setUnit] = useState("")
  const unitName = useUnitName()
  const exporter: Exporter = useRef(null)

  const aging = useQuery({
    queryKey: financeKeys.payablesAging(asOf.value, unit || null),
    queryFn: ({ signal }) =>
      payablesAging({ as_of: asOf.value, unit: unit || undefined }, signal),
  })

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Payables"
        title="Supplier Bills"
        actions={
          <ExportButton
            build={() => exporter.current?.() ?? null}
            disabled={aging.data === undefined}
          />
        }
      />

      <ReportFilters
        note={
          <>
            {asOf.chip}
            {unit === "" ? (
              " · every unit"
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

      {queryState(aging, {
        loading: "Adding up what each supplier is owed…",
        render: (data) => (
          <>
            <Card className="mb-3 px-4 py-4">
              <AgeingBar buckets={data.total} />
            </Card>
            {data.suppliers.length === 0 ? (
              <NothingOwed unit={unit} asOf={asOf.value} />
            ) : (
              <SupplierTable
                rows={data.suppliers}
                total={data.total}
                exporter={exporter}
                title="Supplier Bills"
                filename={`Supplier-Bills-${asOf.value}`}
                subtitle={`${asOf.chip} · ${unit === "" ? "every unit" : unitName(unit)}`}
              />
            )}
          </>
        ),
      })}
    </PageContent>
  )
}

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
/// Their summary also carries `Total Amount Due` — outstanding less the
/// not-due bucket. It is left out here: it is one subtraction of two columns
/// already on the row, and it cost the table its right edge at 1440.
function SupplierTable({
  rows,
  total,
  exporter,
  title,
  filename,
  subtitle,
}: {
  rows: readonly PayablesAgingRow[]
  total: AgingBuckets
  exporter: Exporter
  title: string
  filename: string
  subtitle: string
}) {
  const openDocuments = rows.reduce(
    (sum, row) => sum + row.open_document_count,
    0
  )
  const supplierName = useSupplierName()
  useExporter(exporter, () => ({
    filename,
    sheet: title,
    title,
    subtitle,
    columns: [
      { header: "Supplier", kind: "text", width: 40 },
      { header: "Open Bills", kind: "number", width: 12 },
      { header: "Oldest (days Late)", kind: "number", width: 18 },
      ...BUCKETS.map((bucket) => ({
        header: bucket.label,
        kind: "money" as const,
      })),
      { header: "Outstanding", kind: "money" },
    ],
    rows: rows.map((row) => [
      supplierName(row.supplier_id, row.supplier_name),
      row.open_document_count,
      row.oldest_days,
      ...BUCKETS.map((bucket) => row.buckets[bucket.key]),
      row.buckets.total_minor,
    ]),
    totalRow: [
      "Total payable",
      openDocuments,
      null,
      ...BUCKETS.map((bucket) => total[bucket.key]),
      total.total_minor,
    ],
  }))
  return (
    <>
      <Grid>
        <thead>
          <tr>
            <Th>Supplier</Th>
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
              {/* How many bills rides as the name's tooltip: the column cost
                  the ageing its right edge at 1440 and is one click away on
                  Accounts Payable. */}
              <Td className="max-w-0">
                <span
                  className="block truncate"
                  title={`${count(row.open_document_count)} open ${row.open_document_count === 1 ? "bill" : "bills"}`}
                >
                  {/* The name leads to the supplier's ledger: what is owed
                      here, and the movements it is made of. */}
                  <AppLink
                    to="/finance/payables/supplier-ledger"
                    sheet={{ key: "supplier", value: row.supplier_id }}
                    className="hover:underline"
                  >
                    <SupplierName
                      id={row.supplier_id}
                      name={row.supplier_name}
                      className="font-medium text-ink"
                    />
                  </AppLink>
                </span>
              </Td>
              <Td align="right">
                <OldestAge days={row.oldest_days} />
              </Td>
              {BUCKETS.map((bucket) => (
                <Td key={bucket.key} align="right">
                  {/* `Rp 0` and not a dash: the server counted this bucket and
                      found nothing in it, which is a finding — a quiet one. */}
                  <span
                    className={
                      row.buckets[bucket.key] === 0 ? "text-faint" : undefined
                    }
                  >
                    {money(row.buckets[bucket.key])}
                  </span>
                </Td>
              ))}
              <Td align="right">
                <span className="font-medium text-ink">
                  {money(row.buckets.total_minor)}
                </span>
              </Td>
            </tr>
          ))}
          <TotalRow>
            <Td>
              Total payable
              <span className="font-normal text-mute">
                {" "}
                · {count(openDocuments)} bills
              </span>
            </Td>
            <Td />
            {BUCKETS.map((bucket) => (
              <Td key={bucket.key} align="right">
                {money(total[bucket.key])}
              </Td>
            ))}
            <Td align="right">{money(total.total_minor)}</Td>
          </TotalRow>
        </tbody>
      </Grid>
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
/// It cannot be wound back to the reporting date. `GET /finance/bills` takes
/// no `as_of` at all: `outstanding_minor`, `days_overdue` and `next_due_date`
/// are derived on read, as at now. So this is the register as it stands today,
/// as the page's own comment says. The unit does reach it: a bill stays at the site
/// it was received at, so the unit's own sites go on the wire — one `site`,
/// comma-separated, which the server reads as a list — and the key carries
/// them. Nothing is asked until the register says which sites those are.
///
/// It pages — the list scrolls on — and the total row is the server's own
/// sum over every posted bill it matches, not a sum of the pages loaded.
function BillTable({
  unit,
  needle,
  exporter,
  subtitle,
  asOf,
}: {
  unit: string
  /// Narrows the bills already loaded; the server is not asked again, so a
  /// match further down the register shows once the list has scrolled to it.
  needle: string
  exporter: Exporter
  subtitle: string
  asOf: string
}) {
  const units = useUnits()
  const supplierName = useSupplierName()
  const sites =
    unit === ""
      ? ""
      : (units.data?.find((one) => one.id === unit)?.sites ?? [])
          .map((site) => site.id)
          .join(",")
  const bills = useInfiniteQuery({
    queryKey: [...financeKeys.bills("POSTED", sites || null), "pages"],
    queryFn: ({ pageParam, signal }) =>
      listBills(
        {
          status: "POSTED",
          site: sites || undefined,
          limit: PAGE,
          cursor: pageParam,
        },
        signal
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: (previous) => previous,
    // A unit whose sites are not known yet must not read as every site.
    enabled: unit === "" || sites !== "",
  })

  const text = needle.trim().toLowerCase()
  const searched = (bill: SupplierBill) =>
    text === "" ||
    [
      supplierName(bill.supplier_id, bill.supplier_name),
      bill.invoice_number,
      bill.entry_number,
    ].some((field) => (field ?? "").toLowerCase().includes(text))

  // What is on screen: the bills still owed, as far as the list has scrolled.
  useExporter(exporter, () => {
    const pages = bills.data?.pages
    if (pages === undefined) return null
    const owed = pages
      .flatMap((page) => page.rows)
      .filter((bill) => bill.outstanding_minor > 0 && searched(bill))
    return {
      filename: `Accounts-Payable-${asOf}`,
      sheet: "Accounts Payable",
      title: "Accounts Payable",
      subtitle,
      columns: [
        { header: "Posting Date", kind: "date" },
        { header: "Supplier", kind: "text", width: 36 },
        { header: "Bill No", kind: "text", width: 20 },
        { header: "Entry", kind: "text", width: 18 },
        { header: "Due Date", kind: "date" },
        { header: "Invoiced Amount", kind: "money" },
        { header: "Paid Amount", kind: "money" },
        { header: "Outstanding Amount", kind: "money" },
        { header: "Status", kind: "text", width: 12 },
        { header: "Age (days Late)", kind: "number", width: 16 },
      ],
      rows: owed.map((bill) => [
        bill.invoice_date,
        supplierName(bill.supplier_id, bill.supplier_name),
        bill.invoice_number,
        bill.entry_number,
        bill.next_due_date,
        bill.total_minor,
        bill.paid_minor,
        bill.outstanding_minor,
        bill.overdue ? "Overdue" : (PAYMENT_STATE[bill.payment_state] ?? null),
        bill.days_overdue,
      ]),
      totalRow: [
        "Total",
        `${count(owed.length)} bills`,
        null,
        null,
        null,
        owed.reduce((sum, bill) => sum + bill.total_minor, 0),
        owed.reduce((sum, bill) => sum + bill.paid_minor, 0),
        text === ""
          ? pages[0].outstanding_minor
          : owed.reduce((sum, bill) => sum + bill.outstanding_minor, 0),
        null,
        null,
      ],
    }
  })

  return queryState(bills, {
    loading: "Reading the bill register…",
    render: (data) => {
      // Accounts Payable lists what is still owed, as ERPNext's does: a bill
      // paid in full has left the report.
      const rows = data.pages
        .flatMap((page) => page.rows)
        .filter((bill) => bill.outstanding_minor > 0 && searched(bill))
      const head = data.pages[0]
      const invoiced = rows.reduce((sum, bill) => sum + bill.total_minor, 0)
      const paid = rows.reduce((sum, bill) => sum + bill.paid_minor, 0)
      // The server's sum covers every bill; a search totals what it shows.
      const outstanding =
        text === ""
          ? head.outstanding_minor
          : rows.reduce((sum, bill) => sum + bill.outstanding_minor, 0)
      return rows.length === 0 ? (
        <EmptyState>
          {text === ""
            ? "Nothing is owed to a supplier."
            : `No bill matches “${needle.trim()}”.`}
        </EmptyState>
      ) : (
        <>
          <Grid>
            <thead>
              <tr>
                <Th width="7.5rem">Posting Date</Th>
                <Th>Supplier</Th>
                <Th width="11rem">Bill No</Th>
                <Th width="7.5rem">
                  <span title="The earliest instalment this bill has not paid for">
                    Due Date
                  </span>
                </Th>
                <Th align="right" width="9rem">
                  Invoiced Amount
                </Th>
                <Th align="right" width="9rem">
                  Paid Amount
                </Th>
                <Th align="right" width="9.5rem">
                  Outstanding Amount
                </Th>
                <Th align="right" width="6rem">
                  Age (Days)
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((bill) => (
                <BillRow key={bill.invoice_id} bill={bill} />
              ))}
              <TotalRow>
                <Td>Total</Td>
                <Td>{count(rows.length)} bills</Td>
                <Td />
                <Td />
                <Td align="right">{money(invoiced)}</Td>
                <Td align="right">{money(paid)}</Td>
                <Td align="right">{money(outstanding)}</Td>
                <Td />
              </TotalRow>
            </tbody>
          </Grid>
          <LoadMore query={bills} />
        </>
      )
    },
  })
}

/// One page of the bill register. The list scrolls on — this is the size of
/// a step, not a ceiling.
const PAGE = 100

function BillRow({ bill }: { bill: SupplierBill }) {
  return (
    <tr>
      <Td className="whitespace-nowrap">{day(bill.invoice_date)}</Td>
      <Td className="whitespace-nowrap">
        <SupplierName
          id={bill.supplier_id}
          name={bill.supplier_name}
          className="font-medium text-ink"
        />
      </Td>
      <Td className="whitespace-nowrap">
        <Code>{bill.invoice_number}</Code>
        {bill.entry_number !== null && (
          <span className="mt-0.5 block text-[0.875rem] text-mute">
            {bill.entry_number}
          </span>
        )}
      </Td>
      <Td>
        {/* `next_due_date`, not `due_date`: which instalment is next, and
            `null` once nothing is owed. */}
        {bill.next_due_date === null ? (
          <span className="text-faint" title="Nothing left to fall due">
            —
          </span>
        ) : (
          day(bill.next_due_date)
        )}
      </Td>
      <Td align="right">{money(bill.total_minor)}</Td>
      <Td align="right">
        {money(bill.paid_minor)}
        {/* What a draft payment has reserved beyond what has left the bank:
            the database refuses a second allocation while a draft holds it. */}
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
          <Status tone={bill.overdue ? "bad" : paymentTone(bill.payment_state)}>
            {bill.overdue ? "Overdue" : PAYMENT_STATE[bill.payment_state]}
          </Status>
        </span>
      </Td>
      <Td align="right">
        <OldestAge days={bill.days_overdue} />
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
function UnbilledTable({
  exporter,
  subtitle,
}: {
  exporter: Exporter
  subtitle: string
}) {
  const siteLabel = useSiteLabel()
  // Paged, oldest first. The plain read of this route stops at 200 and says
  // nothing, so a total under it was the exposure of the oldest 200.
  const unbilled = useInfiniteQuery({
    queryKey: [...financeKeys.unbilled(), "pages"],
    queryFn: ({ pageParam, signal }) =>
      unbilledPage({ cursor: pageParam, limit: PAGE }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: (previous) => previous,
  })

  useExporter(exporter, () => {
    const pages = unbilled.data?.pages
    if (pages === undefined) return null
    const rows = pages.flatMap((page) => page.rows)
    return {
      filename: `Unbilled-Deliveries-${todayIso()}`,
      sheet: "Unbilled Deliveries",
      title: "Accounts Payable · Unbilled Deliveries",
      subtitle,
      columns: [
        { header: "Receipt", kind: "text", width: 20 },
        { header: "Their Invoice", kind: "text", width: 20 },
        { header: "Supplier", kind: "text", width: 14 },
        { header: "Unit", kind: "text", width: 22 },
        { header: "Arrived", kind: "date" },
        { header: "Waiting (days)", kind: "number", width: 16 },
        { header: "Lines", kind: "number", width: 10 },
        { header: "At Order Price", kind: "money" },
        { header: "Off the Paperwork", kind: "money" },
      ],
      rows: rows.map((receipt) => [
        receipt.receipt_number,
        receipt.invoice_number,
        receipt.supplier_id,
        siteLabel(receipt.site_id),
        receipt.arrived_at,
        receipt.days_waiting,
        receipt.line_count,
        receipt.value_at_order_price_minor,
        receipt.invoice_total_minor,
      ]),
      totalRow: [
        "Total exposure",
        `${count(pages[0].total)} receipts`,
        null,
        null,
        null,
        null,
        null,
        pages[0].total_minor,
        null,
      ],
    }
  })

  return queryState(unbilled, {
    loading: "Looking for deliveries nobody has billed for…",
    render: (data) => {
      const rows = data.pages.flatMap((page) => page.rows)
      const head = data.pages[0]
      return rows.length === 0 ? (
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
              {/* The server's count and value over every unbilled delivery,
                  not sums of the pages loaded. Lines are not counted there,
                  so that column is left empty rather than totalled short. */}
              <TotalRow>
                <Td>Total exposure</Td>
                <Td align="right">{count(head.total)} receipts</Td>
                <Td />
                <Td />
                <Td />
                <Td />
                <Td align="right">{money(head.total_minor)}</Td>
                <Td />
              </TotalRow>
            </tbody>
          </Grid>
          <LoadMore query={unbilled} />
        </>
      )
    },
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
/// In one unit the sentence has to say the filter is a server filter,
/// because "nothing is owed" and "nothing is owed HERE" are different findings
/// and a reader who has forgotten the select is set will take the first.
function NothingOwed({ unit, asOf }: { unit: string; asOf: string }) {
  return (
    <EmptyState>
      {unit === ""
        ? `Nothing is outstanding to any supplier as at ${day(asOf)}. Every posted bill has been paid in full.`
        : `Nothing is outstanding to any supplier in this unit's books as at ${day(asOf)}. Another unit may still owe — the filter is a server filter, so this answer is about this unit alone.`}
    </EmptyState>
  )
}
