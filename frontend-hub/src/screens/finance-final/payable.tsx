import {
  useInfiniteQuery,
  useSuspenseInfiniteQuery,
  useSuspenseQuery,
} from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import {
  Suspense,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { ExportButton } from "@/components/ui/export-button"
import { Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Status } from "@/components/ui/pill"
import { Banner, EmptyState, LoadingState } from "@/components/ui/states"
import type { ExportSheet } from "@/lib/export-xlsx"
import { count, day, money } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  financeKeys,
  openDeliveriesQuery,
  payablesAgingQuery,
  postedBillPagesQuery,
  unbilledPage,
} from "@/lib/queries/finance"
import { useSiteLabel, useUnits } from "@/lib/queries/organisation"
import { queryState } from "@/lib/query-state"
import { tableSetup, type TableSetup } from "@/lib/table"
import { Code } from "@/screens/finance-final/parts"
import { todayIso } from "@/screens/finance/chart"
import { useAsOf, useSupplierName, useUnitName } from "@/screens/finance/hooks"
import {
  AGEING_BUCKETS,
  openItemsText,
  useDeliveryNumber,
} from "@/screens/finance/measures"
import {
  AsOfControl,
  PhoneFigures,
  SiteName,
  SupplierName,
  UnitName,
  UnitSelect,
} from "@/screens/finance/parts"
import { FilterCheck, ReportFilters } from "@/screens/finance/report"
import { AgeingBar } from "@/screens/finance/workspace"
import { ScreenPending } from "@/screens/finance/pending"
import type {
  AgingBuckets,
  PaymentLedgerEntry,
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
  return (
    <Suspense
      fallback={
        <ScreenPending
          className="max-md:hidden"
          crumb="Finance · Payables"
          title="Accounts Payable"
        >
          Working out what is owed and how long it has been owed…
        </ScreenPending>
      }
    >
      <AccountsPayableScreen />
    </Suspense>
  )
}

function AccountsPayableScreen() {
  const asOf = useAsOf()
  // `unit` goes on the wire, never across a list already in hand.
  const [unit, setUnit] = useState("")
  const [bySupplier, setBySupplier] = useState(false)
  const [unbilled, setUnbilled] = useState(false)
  const [needle, setNeedle] = useState("")
  const unitName = useUnitName()
  const exporter: Exporter = useRef(null)
  const subtitle = `${asOf.chip} · ${unit === "" ? "all units" : unitName(unit)}`

  // The boxes answer at once; the ageing and the register trail them, and the
  // figures in hand stay on screen (dimmed) until the next are read.
  const askedUnit = useDeferredValue(unit)
  const askedAsOf = useDeferredValue(asOf.value)
  const stale = askedUnit !== unit || askedAsOf !== asOf.value
  const aging = useSuspenseQuery(
    payablesAgingQuery(askedAsOf, askedUnit || null)
  )

  const total = aging.data.total
  const perBooks = aging.data.books_minor ?? null
  const difference = perBooks === null ? null : total.total_minor - perBooks

  return (
    <PageContent>
      <PageHeader
        className="max-md:hidden"
        crumb="Finance · Payables"
        title="Accounts Payable"
        actions={<ExportButton build={() => exporter.current?.() ?? null} />}
      />

      <ReportFilters
        exportAction={
          <ExportButton
            variant="ghost"
            build={() => exporter.current?.() ?? null}
          />
        }
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
        {/* The bill register is the only segment with bills to look for. */}
        {!bySupplier && !unbilled && (
          <Input
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            aria-label="Search bills"
            placeholder="Search bills"
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

      <div className="list-swap" aria-busy={stale || undefined}>
        {queryState(aging, {
          render: (data) => (
            <>
              <Card className="mb-3 px-4 py-4">
                <AgeingBar buckets={data.total} />
              </Card>

              {data.on_hold_count > 0 && (
                <Banner tone="info">
                  {count(data.on_hold_count)}{" "}
                  {data.on_hold_count === 1 ? "bill is" : "bills are"} on hold (
                  {money(data.on_hold_minor)}) and not in these figures. Release{" "}
                  {data.on_hold_count === 1 ? "it" : "them"} on{" "}
                  <AppLink
                    to="/finance/payables/bills"
                    className="text-accent hover:underline"
                  >
                    Purchase Invoice
                  </AppLink>{" "}
                  to count {data.on_hold_count === 1 ? "it" : "them"}.
                </Banner>
              )}

              {unbilled ? (
                <UnbilledTable exporter={exporter} subtitle={subtitle} />
              ) : bySupplier ? (
                data.suppliers.length === 0 ? (
                  <NothingOwed unit={askedUnit} asOf={askedAsOf} />
                ) : (
                  <SupplierTable
                    rows={data.suppliers}
                    total={data.total}
                    exporter={exporter}
                    title="Accounts Payable by Supplier"
                    filename={`Accounts-Payable-by-Supplier-${askedAsOf}`}
                    subtitle={subtitle}
                  />
                )
              ) : (
                <Suspense
                  fallback={
                    <LoadingState>Reading the bill register…</LoadingState>
                  }
                >
                  <BillTable
                    unit={askedUnit}
                    needle={needle}
                    exporter={exporter}
                    subtitle={subtitle}
                    asOf={askedAsOf}
                  />
                </Suspense>
              )}
            </>
          ),
        })}
      </div>
    </PageContent>
  )
}

/// ERPNext's Accounts Payable Summary (`accounts_payable_summary`): the same
/// ageing, one row per supplier, under Financial Reports › Registers. The
/// table is the one Accounts Payable draws with Group By Supplier ticked.
export function AccountsPayableSummary() {
  return (
    <Suspense
      fallback={
        <ScreenPending
          className="max-md:hidden"
          crumb="Finance · Payables"
          title="Supplier Bills"
        >
          Adding up what each supplier is owed…
        </ScreenPending>
      }
    >
      <AccountsPayableSummaryScreen />
    </Suspense>
  )
}

function AccountsPayableSummaryScreen() {
  const asOf = useAsOf()
  const [unit, setUnit] = useState("")
  const unitName = useUnitName()
  const exporter: Exporter = useRef(null)

  // The boxes answer at once; the ageing trails them, and the figures in hand
  // stay on screen (dimmed) until the next are read.
  const askedUnit = useDeferredValue(unit)
  const askedAsOf = useDeferredValue(asOf.value)
  const stale = askedUnit !== unit || askedAsOf !== asOf.value
  const aging = useSuspenseQuery(
    payablesAgingQuery(askedAsOf, askedUnit || null)
  )

  return (
    <PageContent>
      <PageHeader
        className="max-md:hidden"
        crumb="Finance · Payables"
        title="Supplier Bills"
        actions={<ExportButton build={() => exporter.current?.() ?? null} />}
      />

      <ReportFilters
        exportAction={
          <ExportButton
            variant="ghost"
            build={() => exporter.current?.() ?? null}
          />
        }
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

      <div className="list-swap" aria-busy={stale || undefined}>
        {queryState(aging, {
          render: (data) => (
            <>
              <Card className="mb-3 px-4 py-4">
                <AgeingBar buckets={data.total} />
              </Card>
              {data.suppliers.length === 0 ? (
                <NothingOwed unit={askedUnit} asOf={askedAsOf} />
              ) : (
                <SupplierTable
                  rows={data.suppliers}
                  total={data.total}
                  exporter={exporter}
                  title="Supplier Bills"
                  filename={`Supplier-Bills-${askedAsOf}`}
                  subtitle={`${asOf.chip} · ${askedUnit === "" ? "all units" : unitName(askedUnit)}`}
                />
              )}
            </>
          ),
        })}
      </div>
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
const BUCKET_TITLES: readonly string[] = [
  "Not yet fallen due",
  "1–30 days late",
  "31–60 days late",
  "61–90 days late",
  "More than 90 days late",
]

/// The words are `measures.ts`' (the Overview names the same buckets); the
/// titles are this table's own.
const BUCKETS: readonly {
  readonly key: keyof BucketFigures
  readonly label: string
  readonly title: string
}[] = AGEING_BUCKETS.map((bucket, index) => ({
  key: bucket.key,
  label: bucket.short,
  title: BUCKET_TITLES[index],
}))

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
  const phone = useLayout() === "phone"
  useExporter(exporter, () => ({
    filename,
    sheet: title,
    title,
    subtitle,
    columns: [
      { header: "Supplier", kind: "text", width: 40 },
      { header: "Open Items", kind: "number", width: 12 },
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
      "Total payables",
      openDocuments,
      null,
      ...BUCKETS.map((bucket) => total[bucket.key]),
      total.total_minor,
    ],
  }))
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: SUPPLIER_COLUMNS,
        getRowId: (row: PayablesAgingRow) => row.supplier_id,
      }),
      [rows]
    )
  )
  return (
    <>
      {phone && (
        <PhoneFigures
          items={[
            { label: "Total payables", value: total.total_minor },
            { label: "Open items", value: openDocuments, unit: "count" },
          ]}
        />
      )}
      <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {/* The server orders heaviest first and this does not re-sort: an
            ageing is read to decide who to pay next, and the order it arrives
            in is that decision already made. */}
        <DataTable<PayablesAgingRow>
          table={table}
          summary={{
            supplier: (
              <>
                Total payables
                <span className="font-normal text-mute">
                  {" "}
                  · {openItemsText(openDocuments)}
                </span>
              </>
            ),
            ...Object.fromEntries(
              BUCKETS.map((bucket) => [bucket.key, money(total[bucket.key])])
            ),
            total: money(total.total_minor),
          }}
          pageScroll
          cardSort={false}
          cardsApart
        />
      </Card>
    </>
  )
}

/// The ageing by supplier. On a card the supplier names it, how old the oldest
/// instalment is stands under it, and the buckets that hold something follow
/// with what is outstanding.
const SUPPLIER_COLUMNS: ColumnDef<TableSetup, PayablesAgingRow>[] = [
  {
    id: "supplier",
    accessorFn: (row) => row.supplier_name,
    header: "Supplier",
    size: 160,
    enableSorting: false,
    meta: { card: "title", grow: 160 },
    // How many bills rides as the name's tooltip: the column cost the ageing
    // its right edge at 1440 and is one click away on Accounts Payable.
    cell: ({ row }) => (
      <span
        className="block whitespace-normal"
        title={openItemsText(row.original.open_document_count)}
      >
        {/* The name leads to the supplier's ledger: what is owed here, and the
            movements it is made of. */}
        <AppLink
          to="/finance/payables/supplier-ledger"
          sheet={{ key: "supplier", value: row.original.supplier_id }}
          className="hover:underline"
        >
          <SupplierName
            id={row.original.supplier_id}
            name={row.original.supplier_name}
            className="font-medium text-ink"
          />
        </AppLink>
      </span>
    ),
  },
  {
    id: "oldest",
    accessorFn: (row) => row.oldest_days,
    // Age of the oldest instalment still outstanding.
    header: "Oldest",
    size: 105,
    enableSorting: false,
    meta: { align: "right", card: "meta" },
    cell: ({ row }) => <OldestAge days={row.original.oldest_days} />,
  },
  ...BUCKETS.map((bucket, index): ColumnDef<TableSetup, PayablesAgingRow> => ({
    id: bucket.key,
    // A bucket with nothing in it is left off a card: a column of zeros is
    // not a finding there.
    accessorFn: (row) =>
      row.buckets[bucket.key] === 0 ? null : row.buckets[bucket.key],
    header: bucket.label,
    size: 130,
    enableSorting: false,
    meta: {
      align: "right",
      card: "metric",
      priority: index === 0 ? 3 : 1,
    },
    // `Rp 0` and not a dash: the server counted this bucket and found
    // nothing in it, which is a finding — a quiet one.
    cell: ({ row }) => (
      <span
        className={
          row.original.buckets[bucket.key] === 0 ? "text-faint" : undefined
        }
      >
        {money(row.original.buckets[bucket.key])}
      </span>
    ),
  })),
  {
    id: "total",
    accessorFn: (row) => row.buckets.total_minor,
    header: "Outstanding",
    size: 150,
    enableSorting: false,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => (
      <span className="font-medium text-ink">
        {money(row.original.buckets.total_minor)}
      </span>
    ),
  },
]

/// One row per open item — ERPNext's Accounts Payable detail.
///
/// # Two sources, one population
///
/// The ageing above this table counts two things (`measures.ts`): the posted
/// bills that are still unpaid, and the deliveries no bill covers yet. A table
/// that listed only the bills said "Nothing is owed to a supplier." under a
/// card that said Rp 52.946.430, so this draws both — the bills from the
/// register, then the deliveries from the payment ledger — and the Total row
/// is what the card is.
///
/// A bill put on hold is owed but not ageing: the figure leaves it out, so the
/// rows do too (the page says how many are held).
///
/// # Why the bills ask for POSTED and nothing else
///
/// Because that is the population the ageing counts: `payables_aging` filters
/// `i.status = 'POSTED'`, so a draft bill is in neither. Asking the server for
/// the same slice is what keeps the two segments of this page describing one
/// set of documents rather than two overlapping ones — and `status` is a
/// server filter, so the narrowing is the request and not a sieve over a wider
/// answer.
///
/// # What the bill half cannot do, and says so
///
/// It cannot be wound back to the reporting date. `GET /finance/bills` takes
/// no `as_of` at all: `outstanding_minor`, `days_overdue` and `next_due_date`
/// are derived on read, as at now. So this is the register as it stands today,
/// as the page's own comment says. The deliveries are wound back — the payment
/// ledger takes the date. The unit reaches both: a bill stays at the site
/// it was received at, so the unit's own sites go on the wire — one `site`,
/// comma-separated, which the server reads as a list — and the key carries
/// them. Nothing is asked until the register says which sites those are.
///
/// It pages — the list scrolls on — and the bills' part of the total is the
/// server's own sum over every posted bill it matches, not a sum of the pages
/// loaded.
/// The register of what is owed. A unit is read through its sites, so the
/// register waits for the unit list (a plain read: the site names beside it
/// use the same one) and a unit that owns no site owes nothing here.
function BillTable(props: {
  unit: string
  /// Narrows the bills already loaded; the server is not asked again, so a
  /// match further down the register shows once the list has scrolled to it.
  needle: string
  exporter: Exporter
  subtitle: string
  asOf: string
}) {
  const units = useUnits()
  const sites =
    props.unit === ""
      ? ""
      : (units.data?.find((one) => one.id === props.unit)?.sites ?? [])
          .map((site) => site.id)
          .join(",")
  // A unit whose sites are not known yet must not read as every site.
  if (props.unit !== "" && sites === "") {
    return units.isPending ? (
      <LoadingState>Reading the bill register…</LoadingState>
    ) : (
      <NothingOwed unit={props.unit} asOf={props.asOf} />
    )
  }
  return <BillRegister {...props} sites={sites} />
}

function BillRegister({
  unit,
  needle,
  exporter,
  subtitle,
  asOf,
  sites,
}: {
  unit: string
  needle: string
  exporter: Exporter
  subtitle: string
  asOf: string
  /// The unit's sites, comma-joined, or empty for every site.
  sites: string
}) {
  const supplierName = useSupplierName()
  const deliveryNumber = useDeliveryNumber()
  const phone = useLayout() === "phone"
  const bills = useSuspenseInfiniteQuery(postedBillPagesQuery(sites))
  const deliveries = useSuspenseQuery(openDeliveriesQuery(asOf, unit || null))

  const text = needle.trim().toLowerCase()
  const searched = (bill: SupplierBill) =>
    text === "" ||
    [
      supplierName(bill.supplier_id, bill.supplier_name),
      bill.invoice_number,
      bill.entry_number,
    ].some((field) => (field ?? "").toLowerCase().includes(text))
  const searchedDelivery = (item: PaymentLedgerEntry) =>
    text === "" ||
    [
      supplierName(item.party_id, item.party_name),
      deliveryNumber(item.voucher_id, item.entry_number),
      item.entry_number,
    ].some((field) => (field ?? "").toLowerCase().includes(text))

  /// What is owed and not held, as far as the register has scrolled; and every
  /// open delivery.
  const owedBills = (pages: readonly { rows: readonly SupplierBill[] }[]) =>
    pages
      .flatMap((page) => page.rows)
      .filter(
        (bill) => !bill.on_hold && bill.outstanding_minor > 0 && searched(bill)
      )
  const owedDeliveries = deliveries.data.items.filter(
    (item) => item.outstanding_minor > 0 && searchedDelivery(item)
  )
  /// The bills' share of the outstanding total: the server's sum over every
  /// posted bill, less the held ones this page has seen; a search totals what
  /// it shows.
  const billsOutstanding = (
    pages: readonly {
      rows: readonly SupplierBill[]
      outstanding_minor: number
    }[],
    shown: readonly SupplierBill[]
  ) =>
    text === ""
      ? pages[0].outstanding_minor -
        pages
          .flatMap((page) => page.rows)
          .filter((bill) => bill.on_hold && bill.outstanding_minor > 0)
          .reduce((sum, bill) => sum + bill.outstanding_minor, 0)
      : shown.reduce((sum, bill) => sum + bill.outstanding_minor, 0)

  // What is on screen: the open items, as far as the list has scrolled.
  useExporter(exporter, () => {
    const pages = bills.data.pages
    const owed = owedBills(pages)
    return {
      filename: `Accounts-Payable-${asOf}`,
      sheet: "Accounts Payable",
      title: "Accounts Payable",
      subtitle,
      columns: [
        { header: "Posting Date", kind: "date" },
        { header: "Supplier", kind: "text", width: 36 },
        { header: "Document No", kind: "text", width: 20 },
        { header: "Entry", kind: "text", width: 18 },
        { header: "Due Date", kind: "date" },
        { header: "Invoiced Amount", kind: "money" },
        { header: "Paid Amount", kind: "money" },
        { header: "Outstanding Amount", kind: "money" },
        { header: "Status", kind: "text", width: 12 },
        { header: "Age (days Late)", kind: "number", width: 16 },
      ],
      rows: [
        ...owed.map((bill) => [
          bill.invoice_date,
          supplierName(bill.supplier_id, bill.supplier_name),
          bill.invoice_number,
          bill.entry_number,
          bill.next_due_date,
          bill.total_minor,
          bill.paid_minor,
          bill.outstanding_minor,
          bill.overdue
            ? "Overdue"
            : (PAYMENT_STATE[bill.payment_state] ?? null),
          bill.days_overdue,
        ]),
        ...owedDeliveries.map((item) => [
          item.posting_date,
          supplierName(item.party_id, item.party_name),
          deliveryNumber(item.voucher_id, item.entry_number),
          item.entry_number,
          item.due_date,
          item.amount_minor,
          item.settled_minor,
          item.outstanding_minor,
          item.age_days > 0 ? "Overdue" : "Not billed",
          item.age_days,
        ]),
      ],
      totalRow: [
        "Total",
        openItemsText(owed.length + owedDeliveries.length),
        null,
        null,
        null,
        owed.reduce((sum, bill) => sum + bill.total_minor, 0) +
          owedDeliveries.reduce((sum, item) => sum + item.amount_minor, 0),
        owed.reduce((sum, bill) => sum + bill.paid_minor, 0) +
          owedDeliveries.reduce((sum, item) => sum + item.settled_minor, 0),
        billsOutstanding(pages, owed) +
          owedDeliveries.reduce((sum, item) => sum + item.outstanding_minor, 0),
        null,
        null,
      ],
    }
  })

  /// What is owed, bills first and then the deliveries no bill covers, as far
  /// as the register has scrolled.
  const items = useMemo<OpenItem[]>(
    () => [
      ...owedBills(bills.data.pages).map((bill): OpenItem => ({
        kind: "bill",
        id: bill.invoice_id,
        bill,
      })),
      ...owedDeliveries.map((item): OpenItem => ({
        kind: "delivery",
        id: item.entry_id,
        item,
        number: deliveryNumber(item.voucher_id, item.entry_number),
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bills.data, deliveries.data, text, supplierName, deliveryNumber]
  )
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: items,
        columns: OPEN_ITEM_COLUMNS,
        getRowId: (row: OpenItem) => row.id,
      }),
      [items]
    )
  )

  // The ageing's other half is read with the register: a table drawn before it
  // lands could say "nothing is owed" over a card that says otherwise.
  return (
    <div>
      {queryState(bills, {
        render: (data) => {
          // Accounts Payable lists what is still owed, as ERPNext's does: a bill
          // paid in full has left the report.
          const rows = owedBills(data.pages)
          const itemCount = rows.length + owedDeliveries.length
          const invoiced =
            rows.reduce((sum, bill) => sum + bill.total_minor, 0) +
            owedDeliveries.reduce((sum, item) => sum + item.amount_minor, 0)
          const paid =
            rows.reduce((sum, bill) => sum + bill.paid_minor, 0) +
            owedDeliveries.reduce((sum, item) => sum + item.settled_minor, 0)
          const outstanding =
            billsOutstanding(data.pages, rows) +
            owedDeliveries.reduce(
              (sum, item) => sum + item.outstanding_minor,
              0
            )
          return itemCount === 0 ? (
            <EmptyState>
              {text === ""
                ? "Nothing is owed to a supplier."
                : `Nothing matches “${needle.trim()}”.`}
            </EmptyState>
          ) : (
            <>
              {phone && (
                <PhoneFigures
                  items={[
                    { label: "Outstanding", value: outstanding },
                    { label: "Open items", value: itemCount, unit: "count" },
                  ]}
                />
              )}
              <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
                <DataTable<OpenItem>
                  table={table}
                  more={bills}
                  summary={{
                    date: "Total",
                    supplier: openItemsText(itemCount),
                    invoiced: money(invoiced),
                    paid: money(paid),
                    outstanding: money(outstanding),
                  }}
                  pageScroll
                  cardSort={false}
                  cardsApart
                />
              </Card>
            </>
          )
        },
      })}
    </div>
  )
}

/// An open item on the register: a posted bill, or a delivery the books
/// already owe for with no bill against it yet.
type OpenItem =
  | { readonly kind: "bill"; readonly id: string; readonly bill: SupplierBill }
  | {
      readonly kind: "delivery"
      readonly id: string
      readonly item: PaymentLedgerEntry
      readonly number: string
    }

/// ERPNext's Accounts Payable detail. On a card the supplier names it, the
/// document number sits over it and the figures follow, with how late it is
/// under the amounts.
const OPEN_ITEM_COLUMNS: ColumnDef<TableSetup, OpenItem>[] = [
  {
    id: "date",
    accessorFn: (row) =>
      row.kind === "bill" ? row.bill.invoice_date : row.item.posting_date,
    header: "Posting Date",
    size: 125,
    enableSorting: false,
    meta: { card: "meta" },
    cell: ({ row }) =>
      day(
        row.original.kind === "bill"
          ? row.original.bill.invoice_date
          : row.original.item.posting_date
      ),
  },
  {
    id: "supplier",
    accessorFn: (row) =>
      row.kind === "bill" ? row.bill.supplier_name : row.item.party_name,
    header: "Supplier",
    size: 170,
    enableSorting: false,
    meta: { card: "title", grow: 150 },
    cell: ({ row }) => (
      <span className="block whitespace-normal">
        {row.original.kind === "bill" ? (
          <SupplierName
            id={row.original.bill.supplier_id}
            name={row.original.bill.supplier_name}
            className="font-medium text-ink"
          />
        ) : (
          <SupplierName
            id={row.original.item.party_id}
            name={row.original.item.party_name}
            className="font-medium text-ink"
          />
        )}
      </span>
    ),
  },
  {
    id: "document",
    accessorFn: (row) =>
      row.kind === "bill" ? row.bill.invoice_number : row.number,
    header: "Document No",
    size: 200,
    enableSorting: false,
    meta: { card: "id" },
    cell: ({ row }) =>
      row.original.kind === "bill" ? (
        <span className="flex min-w-0 flex-col">
          <span
            className="block truncate"
            title={row.original.bill.invoice_number}
          >
            <Code>{row.original.bill.invoice_number}</Code>
          </span>
          {row.original.bill.entry_number !== null && (
            <span className="truncate text-[0.9375rem] text-mute">
              {row.original.bill.entry_number}
            </span>
          )}
        </span>
      ) : (
        <span className="flex min-w-0 flex-col">
          <span className="block truncate" title={row.original.number}>
            <Code>{row.original.number}</Code>
          </span>
          <span className="truncate text-[0.9375rem] text-mute">
            Delivery, no bill yet
          </span>
        </span>
      ),
  },
  {
    id: "due",
    accessorFn: (row) =>
      row.kind === "bill" ? row.bill.next_due_date : row.item.due_date,
    // The earliest instalment this bill has not paid for.
    header: "Due Date",
    size: 125,
    enableSorting: false,
    meta: { card: "metric", priority: 2 },
    // `next_due_date`, not `due_date`: which instalment is next, and `null`
    // once nothing is owed.
    cell: ({ row }) => {
      const due =
        row.original.kind === "bill"
          ? row.original.bill.next_due_date
          : row.original.item.due_date
      return due === null ? (
        <span className="text-faint" title="Nothing left to fall due">
          —
        </span>
      ) : (
        day(due)
      )
    },
  },
  {
    id: "invoiced",
    accessorFn: (row) =>
      row.kind === "bill" ? row.bill.total_minor : row.item.amount_minor,
    header: "Invoiced Amount",
    size: 150,
    enableSorting: false,
    meta: { align: "right", card: "metric", priority: 2 },
    cell: ({ row }) =>
      money(
        row.original.kind === "bill"
          ? row.original.bill.total_minor
          : row.original.item.amount_minor
      ),
  },
  {
    id: "paid",
    accessorFn: (row) =>
      row.kind === "bill" ? row.bill.paid_minor : row.item.settled_minor,
    header: "Paid Amount",
    size: 140,
    enableSorting: false,
    meta: { align: "right", card: "metric", priority: 2 },
    cell: ({ row }) =>
      row.original.kind === "bill" ? (
        <span className="flex flex-col items-end">
          {money(row.original.bill.paid_minor)}
          {/* What a draft payment has reserved beyond what has left the bank:
              the database refuses a second allocation while a draft holds it. */}
          {row.original.bill.allocated_minor > row.original.bill.paid_minor && (
            <span className="max-w-full text-right text-[0.9375rem] whitespace-normal text-mute">
              {money(
                row.original.bill.allocated_minor - row.original.bill.paid_minor
              )}{" "}
              spoken for
            </span>
          )}
        </span>
      ) : (
        money(row.original.item.settled_minor)
      ),
  },
  {
    id: "outstanding",
    accessorFn: (row) =>
      row.kind === "bill"
        ? row.bill.outstanding_minor
        : row.item.outstanding_minor,
    header: "Outstanding Amount",
    size: 180,
    enableSorting: false,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) =>
      row.original.kind === "bill" ? (
        <span className="flex flex-col items-end">
          <span className="font-medium text-ink">
            {money(row.original.bill.outstanding_minor)}
          </span>
          <Status
            tone={
              row.original.bill.overdue
                ? "bad"
                : paymentTone(row.original.bill.payment_state)
            }
          >
            {row.original.bill.overdue
              ? "Overdue"
              : PAYMENT_STATE[row.original.bill.payment_state]}
          </Status>
        </span>
      ) : (
        <span className="flex flex-col items-end">
          <span className="font-medium text-ink">
            {money(row.original.item.outstanding_minor)}
          </span>
          <Status tone={row.original.item.age_days > 0 ? "bad" : "neutral"}>
            {row.original.item.age_days > 0 ? "Overdue" : "Not billed"}
          </Status>
        </span>
      ),
  },
  {
    id: "age",
    accessorFn: (row) =>
      row.kind === "bill" ? row.bill.days_overdue : row.item.age_days,
    header: "Age (Days)",
    size: 105,
    enableSorting: false,
    meta: { align: "right", card: "meta", priority: 3 },
    cell: ({ row }) => (
      <OldestAge
        days={
          row.original.kind === "bill"
            ? row.original.bill.days_overdue
            : row.original.item.age_days
        }
      />
    ),
  },
]

/// One page of the bill register. The list scrolls on — this is the size of
/// a step, not a ceiling.
const PAGE = 100

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
/// These are in Total payables: the goods receipt posts the debt to the
/// supplier the day it is valued (`payables_aging`'s `open_receipt` leg), and
/// the register above lists them as open items. This view is the same
/// deliveries seen as paperwork — what the supplier's own invoice said, how
/// long each has waited — priced at the ORDER, which is why its total can sit
/// a few rupiah off the ledger's (the receipt is booked at the quantity
/// matched).
function UnbilledTable({
  exporter,
  subtitle,
}: {
  exporter: Exporter
  subtitle: string
}) {
  const siteLabel = useSiteLabel()
  const phone = useLayout() === "phone"
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

  const receipts = useMemo(
    () => unbilled.data?.pages.flatMap((page) => page.rows) ?? [],
    [unbilled.data]
  )
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: receipts,
        columns: RECEIPT_COLUMNS,
        getRowId: (row: UnbilledReceipt) => row.receipt_id,
      }),
      [receipts]
    )
  )

  // A new tab or filter: the rows in hand stay, dimmed, until the next land.
  return (
    <div
      aria-busy={unbilled.isPlaceholderData || undefined}
      className="list-swap"
    >
      {queryState(unbilled, {
        loading: "Looking for deliveries nobody has billed for…",
        render: (data) => {
          const head = data.pages[0]
          return receipts.length === 0 ? (
            <EmptyState>Every delivery has a bill against it.</EmptyState>
          ) : (
            <>
              {phone && (
                <PhoneFigures
                  items={[
                    { label: "Total exposure", value: head.total_minor },
                    { label: "Receipts", value: head.total, unit: "count" },
                  ]}
                />
              )}
              <Card className="overflow-clip max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
                <DataTable<UnbilledReceipt>
                  table={table}
                  more={unbilled}
                  // The server's count and value over every unbilled delivery, not
                  // sums of the pages loaded. Lines are not counted there, so that
                  // column is left empty rather than totalled short.
                  summary={{
                    receipt: "Total exposure",
                    supplier: `${count(head.total)} receipts`,
                    at_order: money(head.total_minor),
                  }}
                  pageScroll
                  cardSort={false}
                  cardsApart
                />
              </Card>
            </>
          )
        },
      })}
    </div>
  )
}

/// Deliveries with no bill against them, as paperwork. On a card the receipt
/// names it, the supplier's own invoice sits under it and the figures follow.
const RECEIPT_COLUMNS: ColumnDef<TableSetup, UnbilledReceipt>[] = [
  {
    id: "receipt",
    accessorFn: (row) => row.receipt_number,
    header: "Receipt",
    size: 200,
    enableSorting: false,
    meta: { card: "title", grow: 180 },
    cell: ({ row }) => (
      <span className="flex flex-col">
        <Code>{row.original.receipt_number}</Code>
        {row.original.invoice_number !== null && (
          <span className="text-[0.9375rem] text-mute">
            their {row.original.invoice_number}
          </span>
        )}
      </span>
    ),
  },
  {
    id: "supplier",
    accessorFn: (row) => row.supplier_id,
    header: "Supplier",
    size: 120,
    enableSorting: false,
    meta: { card: "meta" },
    // `supplier_id` on a receipt is the DC's own supplier code — `SUP02`, not a
    // uuid — so `<SupplierName>` would look it up in the finance master list
    // and find nothing. Printed as the code it is.
    cell: ({ row }) => <Code>{row.original.supplier_id}</Code>,
  },
  {
    id: "unit",
    accessorFn: (row) => row.site_id,
    header: "Unit",
    size: 130,
    enableSorting: false,
    meta: { card: "meta", priority: 3 },
    cell: ({ row }) => <SiteName id={row.original.site_id} />,
  },
  {
    id: "arrived",
    accessorFn: (row) => row.arrived_at,
    header: "Arrived",
    size: 125,
    enableSorting: false,
    meta: { card: "meta" },
    cell: ({ row }) => day(row.original.arrived_at),
  },
  {
    id: "waiting",
    accessorFn: (row) => row.days_waiting,
    header: "Waiting",
    size: 100,
    enableSorting: false,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => (
      <span
        className={
          row.original.days_waiting > 30 ? "font-medium text-bad-fg" : undefined
        }
      >
        {count(row.original.days_waiting)}d
      </span>
    ),
  },
  {
    id: "lines",
    accessorFn: (row) => row.line_count,
    header: "Lines",
    size: 85,
    enableSorting: false,
    meta: { align: "right", card: "metric", priority: 3 },
    cell: ({ row }) => count(row.original.line_count),
  },
  {
    id: "at_order",
    accessorFn: (row) => row.value_at_order_price_minor,
    // Accepted quantity at the price that was ordered.
    header: "At order price",
    size: 150,
    enableSorting: false,
    meta: { align: "right", card: "metric" },
    cell: ({ row }) => money(row.original.value_at_order_price_minor),
  },
  {
    id: "paperwork",
    accessorFn: (row) => row.invoice_total_minor,
    // What the supplier's own paperwork said, where it came with any.
    header: "Off the paperwork",
    size: 175,
    enableSorting: false,
    meta: { align: "right", card: "metric", priority: 2 },
    // `null` is an answer: the goods came with no paperwork. A zero would claim
    // the supplier invoiced nothing.
    cell: ({ row }) =>
      row.original.invoice_total_minor === null ? (
        <span className="text-faint" title="No paperwork came with the goods">
          —
        </span>
      ) : (
        money(row.original.invoice_total_minor)
      ),
  },
]

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
        ? `Nothing is outstanding to any supplier as at ${day(asOf)}.`
        : `Nothing is outstanding to any supplier in this unit's books as at ${day(asOf)}. Another unit may still owe — the filter is a server filter, so this answer is about this unit alone.`}
    </EmptyState>
  )
}
