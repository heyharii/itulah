import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Textarea } from "@/components/ui/field"
import { TotalsLadder } from "@/components/ui/rows"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"

import { SubTabs } from "@/components/ui/sub-tabs"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { count, day, label, money, toneFor } from "@/lib/format"
import {
  financeKeys,
  listBills,
  postBill,
  recordBill,
  unbilledReceipts,
} from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { parseMinor, todayIso } from "@/screens/finance/chart"
import type { SupplierBill, UnbilledReceipt } from "@itulah/contract"

/// What is late, and what has arrived that nobody has been billed for.
///
/// # Why recording and posting are two acts
///
/// A bill arrives, gets queried, gets held. Only when somebody decides it may
/// be paid does it go into the books. Collapsing the two would mean the act of
/// writing an invoice down were also the act of accepting it.
///
/// # Why the second list is on this screen
///
/// The client keeps no goods-received-not-invoiced account, so a delivery with
/// no bill against it is sitting in the warehouse and nowhere in the books at
/// all. At month end inventory *and* payables both understate by it. It is not
/// a balance and it is not posted anywhere — this list is the only place that
/// exposure is ever seen, which is why it lives beside the bills rather than
/// on a screen of its own that nobody would open.

/// `days_overdue` is negative until the due date passes, and is derived on
/// every read — a stored age would be wrong by morning.
function isLate(bill: SupplierBill): boolean {
  return bill.status.toUpperCase() !== "POSTED" && bill.days_overdue > 0
}

const billColumns: ColumnDef<TableSetup, SupplierBill>[] = [
  {
    accessorKey: "invoice_number",
    header: "Invoice",
    size: 150,
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.invoice_number}
      </span>
    ),
  },
  {
    id: "supplier",
    accessorFn: (row) => row.supplier_name ?? row.supplier_id,
    header: "Supplier",
    size: 260,
    cell: ({ row }) => (
      <span className="font-medium text-ink">
        {row.original.supplier_name ?? row.original.supplier_id}
      </span>
    ),
  },
  {
    accessorKey: "site_id",
    header: "Site",
    size: 100,
  },
  {
    accessorKey: "status",
    header: "Status",
    size: 130,
    cell: ({ row }) => (
      <Pill tone={toneFor(row.original.status)}>
        {label(row.original.status)}
      </Pill>
    ),
  },
  {
    accessorKey: "due_date",
    header: "Due",
    size: 120,
    cell: ({ row }) => day(row.original.due_date),
  },
  {
    accessorKey: "total_minor",
    header: "Total",
    size: 150,
    meta: { align: "right" },
    cell: ({ row }) => (
      <span className="font-medium text-ink tabular-nums">
        {money(row.original.total_minor)}
      </span>
    ),
  },
  {
    accessorKey: "days_overdue",
    header: "Overdue",
    size: 120,
    meta: { align: "right" },
    // The decision metric, and the reason this list overrides the server's
    // order: the invoice date is when the bill was recorded, not the order it
    // has to be paid in.
    cell: ({ row }) => {
      const bill = row.original
      if (!isLate(bill)) {
        return (
          <span className="text-mute tabular-nums">
            {bill.days_overdue < 0 ? `in ${-bill.days_overdue}d` : "—"}
          </span>
        )
      }
      return (
        <span className="font-medium text-bad-fg tabular-nums">
          {count(bill.days_overdue)}d
        </span>
      )
    },
  },
]

const unbilledColumns: ColumnDef<TableSetup, UnbilledReceipt>[] = [
  {
    accessorKey: "receipt_number",
    header: "Receipt",
    size: 160,
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.receipt_number}
      </span>
    ),
  },
  {
    accessorKey: "supplier_id",
    header: "Supplier",
    size: 200,
    cell: ({ row }) => (
      <span className="font-medium text-ink">{row.original.supplier_id}</span>
    ),
  },
  {
    accessorKey: "site_id",
    header: "Site",
    size: 100,
  },
  {
    accessorKey: "arrived_at",
    header: "Arrived",
    size: 120,
    cell: ({ row }) => day(row.original.arrived_at),
  },
  {
    accessorKey: "line_count",
    header: "Lines",
    size: 90,
    meta: { align: "right" },
    cell: ({ row }) => count(row.original.line_count),
  },
  {
    accessorKey: "value_at_order_price_minor",
    header: "At order price",
    size: 170,
    meta: { align: "right" },
    // Accepted quantity times the agreed price. What the delivery is worth if
    // the supplier bills what was agreed — deliberately not a bookable figure.
    cell: ({ row }) => (
      <span className="font-medium text-ink tabular-nums">
        {money(row.original.value_at_order_price_minor)}
      </span>
    ),
  },
  {
    accessorKey: "days_waiting",
    header: "Waiting",
    size: 110,
    meta: { align: "right" },
    cell: ({ row }) => (
      <span
        className={
          row.original.days_waiting > 30
            ? "font-medium text-warn-fg tabular-nums"
            : "text-body tabular-nums"
        }
      >
        {count(row.original.days_waiting)}d
      </span>
    ),
  },
]

export function SupplierBills() {
  const [tab, setTab] = useState<"bills" | "unbilled">("bills")
  const [query, setQuery] = useState("")
  const [recording, setRecording] = useState(false)
  const bill = useSheet("bill")
  const [billSort, setBillSort] = useState<SortingState>([
    { id: "days_overdue", desc: true },
  ])
  const [waitSort, setWaitSort] = useState<SortingState>([
    { id: "days_waiting", desc: true },
  ])

  const bills = useQuery({
    queryKey: financeKeys.bills(null),
    queryFn: ({ signal }) => listBills({}, signal),
  })
  const unbilled = useQuery({
    queryKey: financeKeys.unbilled(),
    queryFn: ({ signal }) => unbilledReceipts(signal),
  })

  const billRows = useMemo(() => bills.data ?? [], [bills.data])
  const waitRows = useMemo(() => unbilled.data ?? [], [unbilled.data])

  const billTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: billRows,
        columns: billColumns,
        getRowId: (row: SupplierBill) => row.invoice_id,
        state: { globalFilter: query, sorting: billSort },
        onSortingChange: setBillSort,
        onGlobalFilterChange: setQuery,
      }),
      [billRows, query, billSort]
    )
  )

  const waitTable = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: waitRows,
        columns: unbilledColumns,
        getRowId: (row: UnbilledReceipt) => row.receipt_id,
        state: { globalFilter: query, sorting: waitSort },
        onSortingChange: setWaitSort,
        onGlobalFilterChange: setQuery,
      }),
      [waitRows, query, waitSort]
    )
  )

  const exposure = waitRows.reduce(
    (sum, row) => sum + row.value_at_order_price_minor,
    0
  )

  return (
    <PageContent>
      <PageHeader
        crumb="Finance"
        title="Supplier bills"
        sub="What has been invoiced, what has been posted, and what arrived with no invoice at all."
        actions={
          <>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="h-8 w-48"
            />
            <Button variant="dark" onClick={() => setRecording(true)}>
              Record bill
            </Button>
          </>
        }
      />

      {/* Two datasets, not two slices of one: a bill is a document the supplier
          sent, an unbilled receipt is a document they have not. */}
      <SubTabs
        value={tab}
        onChange={(next) => setTab(next as "bills" | "unbilled")}
        tabs={[
          { value: "bills", label: "Bills" },
          {
            value: "unbilled",
            label: `Unbilled deliveries${waitRows.length > 0 ? ` · ${waitRows.length}` : ""}`,
          },
        ]}
      />

      {tab === "bills" ? (
        <Card className="overflow-hidden">
          {queryState(bills, {
            loading: "Loading the bills…",
            render: () =>
              billRows.length === 0 ? (
                <EmptyState>
                  No supplier invoice has been recorded yet.
                </EmptyState>
              ) : (
                <DataTable<SupplierBill>
                  table={billTable}
                  onRowClick={(row) => bill.open(row.invoice_id)}
                  isSelected={(row) => row.invoice_id === bill.value}
                  empty="No bill matches that search."
                  className="max-h-[calc(100vh-18rem)]"
                />
              ),
          })}
        </Card>
      ) : (
        <>
          <Banner tone="warn" className="mb-3">
            Not a balance. The client keeps no goods-received-not-invoiced
            account, so none of this is in the books: at month end inventory and
            payables both understate by{" "}
            <span className="font-semibold tabular-nums">
              {money(exposure)}
            </span>
            . The figure is accepted quantity at the agreed price — what the
            supplier will charge if they charge what was agreed.
          </Banner>
          <Card className="overflow-hidden">
            {queryState(unbilled, {
              loading: "Looking for unbilled deliveries…",
              render: () =>
                waitRows.length === 0 ? (
                  <EmptyState>
                    Every delivery has a bill against it. Nothing is sitting in
                    the warehouse that the books do not know about.
                  </EmptyState>
                ) : (
                  <DataTable<UnbilledReceipt>
                    table={waitTable}
                    empty="No delivery matches that search."
                    className="max-h-[calc(100vh-22rem)]"
                  />
                ),
            })}
          </Card>
        </>
      )}

      <BillSheet id={bill.value ?? null} onClose={bill.close} />
      <RecordSheet open={recording} onClose={() => setRecording(false)} />
    </PageContent>
  )
}

/// One bill, and the one decision it is waiting on.
///
/// There is no per-bill read on the node, so this selects out of the list the
/// table already holds — same query key, so it costs nothing and cannot
/// disagree with the row that was clicked.
function BillSheet({
  id,
  onClose,
}: {
  id: string | null
  onClose: () => void
}) {
  const client = useQueryClient()

  const bills = useQuery({
    queryKey: financeKeys.bills(null),
    queryFn: ({ signal }) => listBills({}, signal),
    enabled: id !== null,
  })

  const bill = bills.data?.find((row) => row.invoice_id === id)

  const post = useMutation({
    mutationFn: () => postBill(id!),
    onSuccess: () => {
      // Posting a bill writes a journal entry, so the register, the balances,
      // both statements and the trial balance all moved with it.
      client.invalidateQueries({ queryKey: financeKeys.all })
    },
  })

  const posted = bill?.status?.toUpperCase() === "POSTED"

  return (
    <Sheet
      open={id !== null}
      subject={id === null ? undefined : { kind: "bill", id }}
      onOpenChange={(next) => !next && onClose()}
      id={bill?.invoice_number}
      title={bill?.supplier_name ?? bill?.supplier_id ?? "Bill"}
      footer={
        bill && !posted ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-[0.71875rem] text-mute">
              Posts on the invoice date unless the month is closed.
            </span>
            <Button
              variant="dark"
              disabled={post.isPending}
              onClick={() => post.mutate()}
            >
              {post.isPending ? "Posting…" : "Post to the books"}
            </Button>
          </div>
        ) : undefined
      }
    >
      {queryState(bills, {
        loading: "Loading the bill…",
        render: () =>
          bill === undefined ? (
            <EmptyState>
              No bill is recorded under that id on this list.
            </EmptyState>
          ) : (
            <div className="flex flex-col gap-5">
              {post.isError && (
                <Banner tone="bad">
                  {post.error instanceof Error
                    ? post.error.message
                    : "The bill could not be posted."}
                </Banner>
              )}

              <div className="flex flex-wrap gap-1.5">
                <Pill tone={toneFor(bill.status)}>{label(bill.status)}</Pill>
                {isLate(bill) && (
                  <Pill tone="bad">
                    {count(bill.days_overdue)} days overdue
                  </Pill>
                )}
              </div>

              <Facts>
                <Fact term="Supplier">{bill.supplier_id}</Fact>
                <Fact term="Site">{bill.site_id}</Fact>
                <Fact term="Invoice date">{day(bill.invoice_date)}</Fact>
                <Fact term="Due">{day(bill.due_date)}</Fact>
                <Fact term="Currency">{bill.currency}</Fact>
                <Fact term="Recorded by">{bill.recorded_by}</Fact>
                {bill.posted_by && (
                  <Fact term="Posted by">{bill.posted_by}</Fact>
                )}
                {bill.entry_number && bill.journal_entry_id && (
                  <Fact term="Journal">
                    <AppLink
                      to="/finance/journal"
                      sheet={{ key: "entry", value: bill.journal_entry_id }}
                      className="font-mono text-id text-accent hover:underline"
                    >
                      {bill.entry_number}
                    </AppLink>
                  </Fact>
                )}
              </Facts>

              {bill.note && (
                <p className="text-[0.78125rem] text-body">{bill.note}</p>
              )}

              <TotalsLadder
                rows={[
                  { label: "Subtotal", value: money(bill.subtotal_minor) },
                  { label: "Tax", value: money(bill.tax_minor) },
                  { label: "Discount", value: money(-bill.discount_minor) },
                ]}
                total={{ label: "Total", value: money(bill.total_minor) }}
              />
            </div>
          ),
      })}
    </Sheet>
  )
}

/// The bill as it is typed — every amount is text until it is submitted,
/// because a half-typed number is not a number.
interface BillDraft {
  invoiceNumber: string
  supplierId: string
  supplierName: string
  siteId: string
  invoiceDate: string
  dueDate: string
  subtotal: string
  tax: string
  discount: string
  note: string
}

/// What the three amounts add up to, from whatever is typed so far.
///
/// A blank tax or discount is zero rather than a refusal — most invoices carry
/// neither — but a *misread* one stays `null`, which is what stops the form.
function billTotals(draft: BillDraft) {
  const subtotalMinor = parseMinor(draft.subtotal)
  const taxMinor = draft.tax.trim() === "" ? 0 : parseMinor(draft.tax)
  const discountMinor =
    draft.discount.trim() === "" ? 0 : parseMinor(draft.discount)
  // Integer minor units throughout — a float rupiah is a rounding error waiting
  // for a total to disagree with the ledger.
  const total = (subtotalMinor ?? 0) + (taxMinor ?? 0) - (discountMinor ?? 0)

  const ready =
    draft.invoiceNumber.trim() !== "" &&
    draft.supplierId.trim() !== "" &&
    draft.siteId.trim() !== "" &&
    draft.invoiceDate !== "" &&
    subtotalMinor !== null &&
    taxMinor !== null &&
    discountMinor !== null

  return { subtotalMinor, taxMinor, discountMinor, total, ready }
}

/// Writing a supplier's invoice down. It does not post: recording and posting
/// are two acts, and this is only the first.
function RecordSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  // What the request answered, not what was typed into it.
  const [receipt, setReceipt] = useState<string | null>(null)

  const record = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: BillDraft) => {
      const totals = billTotals(draft)
      return recordBill({
        invoice_number: draft.invoiceNumber.trim(),
        supplier_id: draft.supplierId.trim(),
        supplier_name:
          draft.supplierName.trim() === "" ? null : draft.supplierName.trim(),
        site_id: draft.siteId.trim(),
        invoice_date: draft.invoiceDate,
        due_date: draft.dueDate === "" ? null : draft.dueDate,
        subtotal_minor: totals.subtotalMinor ?? 0,
        tax_minor: totals.taxMinor ?? 0,
        discount_minor: totals.discountMinor ?? 0,
        note: draft.note.trim() === "" ? null : draft.note.trim(),
      })
    },
    onSuccess: (saved) => {
      setReceipt(saved.invoice_number)
      // Only the fields that differ from invoice to invoice are cleared: the
      // supplier, the site and the dates are almost always the next bill's too.
      form.setFieldValue("invoiceNumber", "")
      form.setFieldValue("subtotal", "")
      form.setFieldValue("tax", "")
      form.setFieldValue("discount", "")
      form.setFieldValue("note", "")
      // Recording writes no journal entry, so only the bill list moved.
      client.invalidateQueries({ queryKey: financeKeys.bills(null) })
    },
  })

  const form = useForm({
    defaultValues: {
      invoiceNumber: "",
      supplierId: "",
      supplierName: "",
      siteId: "",
      invoiceDate: todayIso(),
      dueDate: "",
      subtotal: "",
      tax: "",
      discount: "",
      note: "",
    } as BillDraft,
    onSubmit: ({ value }) => record.mutate(value),
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Record a supplier bill"
      footer={
        /* The screen's black CTA opens this sheet and is behind the veil while
           it is up, so the two are never on screen together. */
        <form.Subscribe selector={(state) => billTotals(state.values)}>
          {(totals) => (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[0.71875rem] text-mute tabular-nums">
                {totals.ready
                  ? money(totals.total)
                  : "Fill in the invoice and the amount"}
              </span>
              <Button
                variant="dark"
                disabled={!totals.ready || record.isPending}
                onClick={() => form.handleSubmit()}
              >
                {record.isPending ? "Recording…" : "Record"}
              </Button>
            </div>
          )}
        </form.Subscribe>
      }
    >
      <form
        // The button is in the sheet's footer, outside this element, so its
        // disabled state cannot block an Enter keypress. The gate is repeated
        // here rather than trusted to the layout.
        onSubmit={(event) => {
          event.preventDefault()
          if (billTotals(form.state.values).ready && !record.isPending) {
            form.handleSubmit()
          }
        }}
        className="flex flex-col gap-3.5"
      >
        {receipt && (
          <Banner tone="ok" onDismiss={() => setReceipt(null)}>
            {receipt} recorded. It is not in the books until somebody posts it.
          </Banner>
        )}
        {record.isError && (
          <Banner tone="bad">
            {record.error instanceof Error
              ? record.error.message
              : "The bill was refused."}
          </Banner>
        )}

        <div className="grid grid-cols-2 gap-3">
          <form.Field name="invoiceNumber">
            {(field) => (
              <Field label="Invoice number">
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="siteId">
            {(field) => (
              <Field label="Site">
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="e.g. DC01"
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="supplierId">
            {(field) => (
              <Field label="Supplier id">
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="supplierName">
            {(field) => (
              <Field
                label="Supplier name"
                hint="Optional; for reading the list."
              >
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="invoiceDate">
            {(field) => (
              <Field label="Invoice date">
                <Input
                  type="date"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="dueDate">
            {(field) => (
              <Field label="Due date" hint="Optional.">
                <Input
                  type="date"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="subtotal">
            {(field) => (
              <Field
                label="Subtotal"
                problem={
                  field.state.value.trim() !== "" &&
                  parseMinor(field.state.value) === null
                    ? "Not a number."
                    : undefined
                }
              >
                <Input
                  inputMode="numeric"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="0"
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="tax">
            {(field) => (
              <Field label="Tax">
                <Input
                  inputMode="numeric"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="0"
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="discount">
            {(field) => (
              <Field label="Discount">
                <Input
                  inputMode="numeric"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="0"
                />
              </Field>
            )}
          </form.Field>
        </div>

        <form.Field name="note">
          {(field) => (
            <Field label="Note" hint="Why it is being held, if it is.">
              <Textarea
                rows={2}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>

        <form.Subscribe selector={(state) => billTotals(state.values)}>
          {(totals) => (
            <TotalsLadder
              rows={[
                { label: "Subtotal", value: money(totals.subtotalMinor ?? 0) },
                { label: "Tax", value: money(totals.taxMinor ?? 0) },
                {
                  label: "Discount",
                  value: money(-(totals.discountMinor ?? 0)),
                },
              ]}
              total={{ label: "Total", value: money(totals.total) }}
            />
          )}
        </form.Subscribe>
      </form>
    </Sheet>
  )
}
