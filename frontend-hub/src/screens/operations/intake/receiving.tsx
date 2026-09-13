import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FileText, Upload } from "lucide-react"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Checkbox, Field, Input, Money } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState, Problem, Receipt } from "@/components/ui/states"
import { dc } from "@/lib/api"
import { useFilters } from "@/lib/filters"
import { clock, count, money, variance } from "@/lib/format"
import { keys } from "@/lib/operations/keys"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import { useEdgeActor, useEdgeNodeIdentity } from "@/lib/edge-session"
import { setBenchActor, useBenchActor } from "@/lib/operations/bench"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { idempotencyKey } from "@itulah/contract/client"
import type {
  InvoiceDocumentView,
  PurchaseCountAwaitingVerification,
  PurchaseWorkLine,
} from "@itulah/contract"

/// **Receiving** — the loading bay, as one list of orders.
///
/// The station used to be four screens: a delivery was opened, counted on a
/// second screen, verified on a third, and goods without an order arrived on a
/// fourth. What a person on the bay actually has in front of them is a lorry
/// against an order, so the list here is **the orders this DC is still owed**
/// and the work happens in a sheet beside the row.
///
/// The three-step ceremony survives, because it is the control that makes a
/// delivery evidence rather than paperwork:
///
///   1. **Count receive** — write down what physically arrived. The sheet
///      never shows the ordered quantity: a count taken while looking at the
///      number it is supposed to produce confirms the paperwork and proves
///      nothing. The delivery document is opened underneath, not by hand.
///   2. **Verify** — the button an order wears once something on it is
///      counted. This one *does* show what was ordered, because a verifier is
///      comparing rather than counting, and accepting is the moment the goods
///      first exist as stock.
///
/// The node refuses a verification by whoever took the count. That is a
/// database constraint, not a policy — two people, or nothing moves.
interface OrderRow {
  readonly po_number: string
  readonly supplier_id: string
  readonly supplier_name: string | null
  /// Lines still owed against this order.
  readonly lines: readonly PurchaseWorkLine[]
  /// Counts on this order waiting for a second pair of eyes.
  readonly awaiting: readonly PurchaseCountAwaitingVerification[]
  /// Pieces already accepted into stock against it.
  readonly received: number
}

export function Receiving() {
  const counting = useSheet("delivery")
  const verifying = useSheet("verify")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "po_number", desc: false },
  ])

  // `useSheet` hands back a fresh object every render, so the two openers can
  // not be memo dependencies: columns built from them would be rebuilt on
  // every render, and a table rebuilt on every render is one that loses what
  // the user was doing to it. The buttons read the current pair out of a ref
  // instead, and the columns are built once.
  const openers = useRef({ count: counting.open, verify: verifying.open })
  useEffect(() => {
    openers.current = { count: counting.open, verify: verifying.open }
  })

  const work = useQuery({
    queryKey: keys.purchaseWork(),
    queryFn: ({ signal }) => dc.purchaseWork(signal),
  })
  const queue = useQuery({
    queryKey: keys.verifyQueue(),
    queryFn: ({ signal }) => dc.countsAwaitingVerification(signal),
  })

  // One row per order, built from the two lists the node answers with. The
  // work list is the spine — an order leaves it when nothing is owed on it any
  // more — but a count awaiting a verifier is joined on rather than looked up,
  // so the button on the row can say which of the two jobs is waiting.
  const rows = useMemo<OrderRow[]>(() => {
    const byOrder = new Map<string, OrderRow>()
    for (const line of work.data ?? []) {
      const found = byOrder.get(line.po_number)
      if (found) {
        byOrder.set(line.po_number, {
          ...found,
          lines: [...found.lines, line],
          received: found.received + line.received_stock_units,
        })
      } else {
        byOrder.set(line.po_number, {
          po_number: line.po_number,
          supplier_id: line.supplier_id,
          supplier_name: line.supplier_name,
          lines: [line],
          awaiting: [],
          received: line.received_stock_units,
        })
      }
    }
    for (const waiting of queue.data ?? []) {
      const found = byOrder.get(waiting.po_number)
      byOrder.set(waiting.po_number, {
        po_number: waiting.po_number,
        supplier_id: found?.supplier_id ?? waiting.supplier_id,
        supplier_name: found?.supplier_name ?? null,
        lines: found?.lines ?? [],
        awaiting: [...(found?.awaiting ?? []), waiting],
        received: found?.received ?? 0,
      })
    }
    return [...byOrder.values()]
  }, [work.data, queue.data])

  const columns = useMemo<ColumnDef<TableSetup, OrderRow>[]>(
    () => [
      {
        accessorKey: "po_number",
        header: "Order",
        size: 150,
        // The bay has no search box, so this is how somebody with a docket in
        // their hand reaches the one order on it.
        meta: { filter: { kind: "text", label: "Order" } },
        cell: ({ row }) => (
          <span className="font-mono text-id text-ink">
            {row.original.po_number}
          </span>
        ),
      },
      {
        accessorKey: "supplier_id",
        header: "Supplier",
        size: 220,
        // Picked by code rather than by name, because the code is what this
        // column holds: one lorry brings several orders from one supplier, and
        // "everything Acme still owes us" is the morning's work in one clause.
        // The name is on the row and in the picker's second line.
        meta: { filter: { kind: "option", label: "Supplier" } },
        cell: ({ row }) => (
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink">
              {row.original.supplier_name ?? row.original.supplier_id}
            </span>
            <span className="block truncate font-mono text-[0.65625rem] text-mute">
              {row.original.supplier_id}
            </span>
          </span>
        ),
      },
      {
        id: "lines",
        accessorFn: (row: OrderRow) => row.lines.length,
        header: "Lines owed",
        size: 110,
        // No filter: how many lines an order has is how big it is, and size is
        // a question a header click answers. Nobody stands at a bay asking for
        // orders with between four and nine lines.
        meta: { align: "right" },
        cell: ({ row }) => count(row.original.lines.length),
      },
      {
        accessorKey: "received",
        header: "Already in",
        size: 110,
        // "is 0" is an order nobody has touched, which is not the same as one
        // with nothing waiting to be verified — a part-counted order shows a
        // figure here and an empty queue beside it.
        meta: {
          align: "right",
          filter: { kind: "number", label: "Already in", unit: "pcs" },
        },
        cell: ({ row }) =>
          row.original.received === 0 ? (
            <span className="text-mute">—</span>
          ) : (
            count(row.original.received)
          ),
      },
      {
        id: "state",
        accessorFn: (row: OrderRow) => row.awaiting.length,
        header: "Waiting on",
        size: 170,
        // Counted rather than worded, so the clause that matters is "more than
        // 0" — every order where goods are counted and not yet stock. That is
        // the queue for the second pair of eyes, and it is a different list
        // from the one this screen opens on.
        meta: {
          filter: { kind: "number", label: "Counts to verify", unit: "counts" },
        },
        cell: ({ row }) =>
          row.original.awaiting.length > 0 ? (
            <Pill tone="warn">
              {count(row.original.awaiting.length)} to verify
            </Pill>
          ) : (
            <span className="text-mute">a checker</span>
          ),
      },
      {
        // The button the whole screen is for, and deliberately the last thing
        // on the row: a person reads the order left to right and the verb is
        // where their eye stops.
        id: "action",
        header: "",
        size: 150,
        meta: { align: "right" },
        cell: ({ row }) => {
          const order = row.original
          const toVerify = order.awaiting.length > 0
          return (
            <Button
              variant="primary"
              size="sm"
              onClick={(event) => {
                event.stopPropagation()
                if (toVerify) openers.current.verify(order.po_number)
                else openers.current.count(order.po_number)
              }}
            >
              {toVerify ? "Verify" : "Count receive"}
            </Button>
          )
        },
      },
    ],
    []
  )

  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: OrderRow) => row.po_number,
        state: { columnFilters: filters.columnFilters, sorting },
        onSortingChange: setSorting,
      }),
      [rows, filters.columns, filters.columnFilters, sorting]
    )
  )

  const toVerify = rows.filter((row) => row.awaiting.length > 0).length
  const owedLines = rows.reduce((total, row) => total + row.lines.length, 0)

  return (
    <PageContent>
      <PageHeader
        crumb="Operations"
        title="Receiving"
        sub="Orders this DC is still owed. Count what arrived, then somebody else accepts it."
      />

      <KpiStrip className="grid-cols-2 xl:grid-cols-3">
        <Kpi label="Orders open" value={count(rows.length)} />
        <Kpi label="Lines owed" value={count(owedLines)} />
        <Kpi
          label="Waiting for a verifier"
          value={count(toVerify)}
          delta={toVerify > 0 ? "goods are not stock yet" : "nothing pending"}
          tone={toVerify > 0 ? "down" : "flat"}
        />
      </KpiStrip>

      {/* The strip above counts the whole bay and goes on doing so; a clause
          here only changes which orders are listed below it. */}
      <Toolbar>
        <FilterPanel model={filters} table={table} />
      </Toolbar>

      <Card className="overflow-hidden">
        {queryState(work, {
          loading: "Reading the orders…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                This DC is owed nothing. An order appears here the moment head
                office raises one against this node.
              </EmptyState>
            ) : (
              <DataTable<OrderRow>
                table={table}
                touch
                onRowClick={(row) =>
                  row.awaiting.length > 0
                    ? verifying.open(row.po_number)
                    : counting.open(row.po_number)
                }
                isSelected={(row) =>
                  row.po_number === counting.value ||
                  row.po_number === verifying.value
                }
                className="max-h-[calc(100vh-20rem)]"
              />
            ),
        })}
      </Card>

      <CountSheet
        order={rows.find((row) => row.po_number === counting.value) ?? null}
        open={counting.value !== undefined}
        onClose={counting.close}
      />
      <VerifySheet
        order={rows.find((row) => row.po_number === verifying.value) ?? null}
        open={verifying.value !== undefined}
        onClose={verifying.close}
      />
    </PageContent>
  )
}

/// Counting an order, blind.
///
/// No ordered quantity, no earlier count, no progress against a target — the
/// wire does not carry them here either (`expected_stock_units` is null on this
/// view and populated only for the verifier).
///
/// The delivery document is opened underneath rather than by hand. It is still
/// a real document with a number minted at this DC, and it is still what the
/// counts hang off; it just is not a thing anybody has to remember to create
/// before the goods can be written down. An open document for the same
/// supplier is reused, because a lorry is one arrival with one invoice.
function CountSheet({
  order,
  open,
  onClose,
}: {
  order: OrderRow | null
  open: boolean
  onClose: () => void
}) {
  const actor = useEdgeActor()
  const client = useQueryClient()
  const [quantities, setQuantities] = useState<Record<string, string>>({})

  const receipts = useQuery({
    queryKey: keys.receipts(),
    queryFn: ({ signal }) => dc.goodsReceipts(signal),
  })

  // Minted once per thing being written, and kept across a retry. A bay with
  // bad wifi is exactly where a retried POST becomes a second document, or a
  // second count against goods that arrived once — so the key that makes the
  // retry harmless has to survive the failure that caused it.
  const minted = useRef(new Map<string, string>())
  const keyFor = (subject: string) => {
    const existing = minted.current.get(subject)
    if (existing !== undefined) return existing
    const fresh = idempotencyKey()
    minted.current.set(subject, fresh)
    return fresh
  }

  const record = useMutation({
    mutationFn: async (entries: { line: string; quantity: number }[]) => {
      const supplier = order!.supplier_id
      const existing = (receipts.data ?? (await dc.goodsReceipts())).find(
        (row) => row.supplier_id === supplier
      )
      const receiptId =
        existing?.receipt_id ??
        (
          await dc.openGoodsReceipt({
            supplier_id: supplier,
            // Null means now. Nobody on a bay types the time the lorry came in
            // while it is still being unloaded.
            arrived_at: null,
            actor_id: actor,
            idempotency_key: keyFor(`receipt:${order!.po_number}`),
          })
        ).receipt_id
      // Sequential, not parallel: the first line is what creates the movement
      // group the rest join, and four counts racing into one document is four
      // chances to be told the document is not there yet.
      for (const entry of entries) {
        await dc.countPurchase({
          receipt_id: receiptId,
          po_line_id: entry.line,
          counted_quantity: entry.quantity,
          actor_id: actor,
          idempotency_key: keyFor(`count:${entry.line}`),
        })
      }
      return entries.length
    },
    onSuccess: () => {
      setQuantities({})
      minted.current.clear()
      void client.invalidateQueries({ queryKey: keys.verifyQueue() })
      void client.invalidateQueries({ queryKey: keys.receipts() })
      void client.invalidateQueries({ queryKey: keys.purchaseWork() })
    },
  })

  const entries = (order?.lines ?? []).flatMap((line) => {
    const typed = (quantities[line.po_line_id] ?? "").trim()
    if (typed === "") return []
    const quantity = Number(typed)
    if (!Number.isInteger(quantity) || quantity < 0) return []
    return [{ line: line.po_line_id, quantity }]
  })

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      id={order?.po_number}
      title={order?.supplier_name ?? order?.supplier_id ?? "Order"}
      footer={
        order !== null && (
          <div className="flex items-center gap-3">
            <span className="text-[0.75rem] text-mute">
              {entries.length === 0
                ? "Nothing written down yet"
                : `${count(entries.length)} of ${count(order.lines.length)} lines`}
            </span>
            <div className="flex-1" />
            <Button
              variant="primary"
              disabled={entries.length === 0 || record.isPending}
              onClick={() => record.mutate(entries)}
            >
              {record.isPending ? "Recording…" : "Record the count"}
            </Button>
          </div>
        )
      }
    >
      {order === null ? (
        <EmptyState>
          Nothing is owed on that order any more. It has been received.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-5">
          <Banner tone="info">
            Write down what is physically on the pallet. You are not shown what
            was ordered — somebody else compares the two, and cannot be you.
          </Banner>

          <div className="flex flex-col gap-2.5">
            {order.lines.map((line) => (
              <div
                key={line.po_line_id}
                className="flex flex-wrap items-center gap-3 rounded-inner border border-hairline px-3.5 py-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink">
                    {line.article_name}
                  </span>
                  <span className="block truncate font-mono text-[0.65625rem] text-mute">
                    {line.article_code} · line {line.line_number}
                  </span>
                </span>
                {line.received_stock_units > 0 && (
                  <Pill tone="ok">{count(line.received_stock_units)} in</Pill>
                )}
                <Input
                  className="w-24 text-center text-[1.0625rem] font-semibold"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="0"
                  aria-label={`Counted pieces of ${line.article_code}`}
                  value={quantities[line.po_line_id] ?? ""}
                  onChange={(event) =>
                    setQuantities((current) => ({
                      ...current,
                      [line.po_line_id]: event.target.value,
                    }))
                  }
                />
              </div>
            ))}
          </div>

          {record.isSuccess && (
            <Receipt>
              {count(record.data)} lines recorded. They are waiting for somebody
              else to verify — you cannot verify your own count.
            </Receipt>
          )}
          <Problem error={record.error} />
        </div>
      )}
    </Sheet>
  )
}

/// The supplier's paper, and the arithmetic that says whether it agrees.
///
/// **The verifier's, not the checker's.** The checker is counting garments off
/// a pallet with the ordered quantity deliberately hidden from them; the
/// invoice is a price list for the same delivery, and handing it to them is
/// handing them the answer. It belongs one station along, with the person who
/// is already comparing.
///
/// Three things happen here, in the order a person does them: the page is
/// **uploaded**, the numbers on it are **typed**, and the total is
/// **compared** against what the same goods are worth at the agreed price.
/// The comparison is the point of the other two — a difference does not hold
/// the delivery, it goes to whoever raised the order.
function InvoiceBlock({
  receiptId,
  counts,
}: {
  receiptId: string
  /// The counts on this delivery that are still waiting, which is what the
  /// invoice gets compared against.
  counts: readonly PurchaseCountAwaitingVerification[]
}) {
  const actor = useEdgeActor()
  const client = useQueryClient()

  const receipts = useQuery({
    queryKey: keys.receipts(),
    queryFn: ({ signal }) => dc.goodsReceipts(signal),
  })
  const receipt = (receipts.data ?? []).find(
    (row) => row.receipt_id === receiptId
  )

  const upload = useMutation({
    mutationFn: (file: File) =>
      dc.uploadInvoiceDocument(receiptId, file, actor),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.receipts() })
      void client.invalidateQueries({
        queryKey: keys.invoiceDocument(receiptId),
      })
    },
  })

  const record = useMutation({
    mutationFn: (value: { number: string; date: string; totalMinor: string }) =>
      dc.recordInvoice(receiptId, {
        receipt_id: receiptId,
        invoice_number: value.number.trim(),
        invoice_date:
          value.date.trim() === "" ? null : new Date(value.date).toISOString(),
        invoice_total_minor: Number(value.totalMinor),
        // The uploaded page IS the reference now. It was a string somebody
        // typed — a folder name, a shelf — and a reference nobody can follow
        // is a field that only looks filled in.
        invoice_document_ref: null,
        actor_id: actor,
        // The invoice is money. Recorded twice against one delivery it is a
        // second liability the supplier never issued.
        idempotency_key: idempotencyKey(),
      }),
    onSuccess: () => {
      form.reset()
      void client.invalidateQueries({ queryKey: keys.receipts() })
    },
  })

  const form = useForm({
    defaultValues: { number: "", date: "", totalMinor: "" },
    onSubmit: ({ value }) => {
      if (value.number.trim() === "") return
      record.mutate(value)
    },
  })

  // What the goods on this delivery are worth at the price that was agreed
  // when the order was raised. Lines whose price the order never carried are
  // counted as unpriced rather than as zero: a missing price is not free
  // goods, and silently treating it as nothing understates the total the
  // verifier is comparing against.
  const priced = counts.filter((row) => row.unit_price_minor !== null)
  const agreedMinor = priced.reduce(
    (total, row) => total + row.counted_quantity * (row.unit_price_minor ?? 0),
    0
  )
  const invoicedMinor = receipt?.invoice_total_minor ?? null
  const difference = invoicedMinor === null ? null : invoicedMinor - agreedMinor

  return (
    <div className="rounded-inner border border-hairline p-3.5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-[0.84375rem] font-semibold text-ink">
          Supplier invoice
        </h3>
        <span className="font-mono text-[0.65625rem] text-mute">
          {receipt?.receipt_number}
        </span>
      </div>

      {/* The page on the left, what is typed off it on the right. Stacked,
          these three fields were single lines the width of the whole sheet —
          a 60rem box for an invoice number is a line the eye loses its place
          on, and it is the shape the wide sheet had to be tidied out of. */}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <InvoicePage
            receiptId={receiptId}
            onFile={(file) => upload.mutate(file)}
            uploading={upload.isPending}
            uploaded={upload.data ?? null}
          />
          <Problem error={upload.error} className="mt-2.5" />
        </div>

        {receipt?.invoice_number ? (
          <div>
            <Facts>
              <Fact term="Invoice">{receipt.invoice_number}</Fact>
              <Fact term="Billed">{money(invoicedMinor)}</Fact>
              <Fact term="Price for what was counted">
                {money(agreedMinor)}
              </Fact>
            </Facts>

            {difference !== null && (
              <div className="mt-3">
                <Pill tone={difference === 0 ? "ok" : "bad"}>
                  {difference === 0
                    ? "The invoice agrees"
                    : `${money(Math.abs(difference))} ${difference > 0 ? "over" : "under"} the agreed price`}
                </Pill>
              </div>
            )}
          </div>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              form.handleSubmit()
            }}
          >
            <p className="text-[0.71875rem] text-mute">
              At the agreed price, what has been counted on this delivery is
              worth {money(agreedMinor)}. Type what the paper asks for and the
              two are compared.
            </p>
            <form.Field name="number">
              {(field) => (
                <Field label="Invoice number">
                  <Input
                    className="font-mono"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="totalMinor">
              {(field) => (
                <Field label="Invoice total" hint="In rupiah, as printed">
                  <Money
                    value={field.state.value}
                    onChange={field.handleChange}
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="date">
              {(field) => (
                <Field label="Invoice date">
                  <Input
                    type="date"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </Field>
              )}
            </form.Field>
            <div className="flex items-center gap-3">
              <div className="flex-1" />
              <Button
                variant="primary"
                type="submit"
                disabled={record.isPending}
              >
                {record.isPending ? "Recording…" : "Record the invoice"}
              </Button>
            </div>
            <Problem error={record.error} />
          </form>
        )}
      </div>
    </div>
  )
}

/// The page itself: what is on file, or the control that puts one there.
///
/// The bytes are fetched rather than linked. This node authenticates with a
/// bearer token the client holds, so an `<img src>` or an anchor arrives
/// without it and is refused.
///
/// The object URL is made where it is used and revoked the moment it has been
/// — on the image's own `load`, and a tick after the tab opens. Not held in
/// state: an object URL in `useState` is revoked by an effect's cleanup, and
/// under StrictMode that cleanup runs once before the component is really
/// mounted, leaving a picture pointing at a URL the browser has already
/// forgotten.
function InvoicePage({
  receiptId,
  onFile,
  uploading,
  uploaded,
}: {
  receiptId: string
  onFile: (file: File) => void
  uploading: boolean
  uploaded: InvoiceDocumentView | null
}) {
  const page = useQuery({
    queryKey: keys.invoiceDocument(receiptId),
    queryFn: ({ signal }) => dc.invoiceDocument(receiptId, signal),
    // A delivery with no page on file answers 404, which is an answer and not
    // a failure. Retrying it four times is four requests saying the same
    // thing.
    retry: false,
  })

  const bytes = page.data ?? null
  const pdf = bytes?.type === "application/pdf"

  const draw = useCallback(
    (element: HTMLImageElement | null) => {
      if (element === null || bytes === null) return
      const url = URL.createObjectURL(bytes)
      const done = () => URL.revokeObjectURL(url)
      element.onload = done
      element.onerror = done
      element.src = url
    },
    [bytes]
  )

  const openPdf = () => {
    if (bytes === null) return
    const url = URL.createObjectURL(bytes)
    window.open(url, "_blank", "noreferrer")
    // The tab has the bytes by now; the URL is only the handle it was passed.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  return (
    <div className="flex flex-col gap-2.5">
      {bytes !== null &&
        (pdf ? (
          <Button variant="soft" className="justify-start" onClick={openPdf}>
            <FileText />
            The invoice, as a PDF — opens in a tab
          </Button>
        ) : (
          <img
            ref={draw}
            alt="The supplier's invoice"
            className="max-h-[16rem] w-full rounded-inner border border-hairline bg-soft-2 object-contain"
          />
        ))}

      <label className="flex min-h-tap cursor-pointer items-center justify-center gap-2 rounded-full border border-dashed border-hairline-2 px-3.5 text-[0.78125rem] text-body transition-colors hover:border-hairline-strong hover:bg-soft">
        <Upload className="size-4 text-line-ico" />
        {uploading
          ? "Uploading…"
          : bytes !== null || uploaded !== null
            ? "Replace the page"
            : "Upload the invoice"}
        <input
          type="file"
          accept="image/*,application/pdf"
          className="sr-only"
          disabled={uploading}
          onChange={(event) => {
            const file = event.target.files?.[0]
            // Cleared so choosing the same file twice — after a failed upload
            // — still fires a change.
            event.target.value = ""
            if (file !== undefined) onFile(file)
          }}
        />
      </label>
    </div>
  )
}

/// Who is standing at the bay, asked where they are blocked.
///
/// The same name `Node → Account` collects, in the one place a person actually
/// discovers they need it: a verifier who has never opened the node's own
/// settings has no reason to know that a warehouse with sign-in switched off
/// needs to be told a name before it will let a count be accepted.
function NameTheVerifier() {
  const [name, setName] = useState("")
  return (
    <form
      className="flex flex-wrap items-center gap-2.5 rounded-inner border border-hairline bg-soft px-3.5 py-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (name.trim() !== "") setBenchActor(name)
      }}
    >
      <span className="min-w-[16rem] flex-1 text-[0.78125rem] text-body">
        Sign-in is off on this node, so it writes the name this browser gives
        it. A count cannot be accepted under the name that took it — say who is
        verifying and the decisions below work.
      </span>
      <Input
        className="w-[11rem]"
        placeholder="Your name"
        aria-label="Who is verifying"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Button variant="primary" type="submit" disabled={name.trim() === ""}>
        That is me
      </Button>
    </form>
  )
}

/// The verifier's grid, in three classes.
///
/// Read-only cells, unlike the order composer's: nothing in this table is
/// typed, so a cell carries its own padding rather than surrendering it to a
/// control, and there is no focus ring to draw — the one thing you can put a
/// caret in is the tick box, which draws its own.
const HEAD =
  "border-b border-hairline bg-soft-2 px-3 py-2 text-left font-mono text-eyebrow tracking-[0.04em] text-body uppercase"

const CELL = "px-3 py-2.5 align-middle"

/// Figures line up on the right in tabular digits, because the reason they are
/// beside each other is to be compared.
const NUM = "text-right text-[0.8125rem] text-body tabular-nums"

/// The verifier's grid — everything the checker was not shown, on one screen.
///
/// This used to be one card per count: a pill, five facts, a price box, a
/// note box and two buttons, repeated down a 27.5rem rail. Five garments off
/// one lorry was five screens of scrolling, and a verifier's whole job is
/// comparing lines to each other — which is the one thing a stack of cards a
/// screen tall each makes impossible. It is a table now, in a sheet wide
/// enough to hold it.
///
/// **What is being verified is the count and the price.** Both are columns.
/// Who counted it and when are not: they are the same person and the same
/// half-hour on every line of a delivery, so they were five columns of the
/// same two answers — they sit above the table, once.
///
/// **The verifier types no price.** There was a "price on the invoice" box on
/// every line, asking somebody holding one piece of paper to key a figure per
/// garment. The paper's total is recorded once, underneath, and compared
/// against what the counted goods come to at the agreed price — which is the
/// same check, done once, by arithmetic rather than by typing.
///
/// **Accepting is the moment the goods first exist as stock.** There is still
/// no field for a quantity of the verifier's own, and the decision is still
/// per line: the tick in the first column is the per-line consent, and the
/// footer only commits the ones that were ticked.
function VerifySheet({
  order,
  open,
  onClose,
}: {
  order: OrderRow | null
  open: boolean
  onClose: () => void
}) {
  const actor = useEdgeActor()
  const client = useQueryClient()
  const waiting = order?.awaiting ?? []
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [note, setNote] = useState("")

  // A DC running with sign-in switched off writes whatever `actor_id` it is
  // given, and what an unnamed browser gives it is `"api"` — the same word the
  // count was taken under. `CHECK (verified_by <> counted_by)` then refuses
  // every decision on the sheet, which is the whole of why nothing here could
  // be accepted or sent back. Naming the person is the fix, and it belongs
  // where they are stuck rather than three screens away under Node → Account.
  const where = useEdgeNodeIdentity()
  const bench = useBenchActor()
  const unnamed = where.data?.auth === "DISABLED" && bench === null

  // A different order is a different set of counts, and a tick carried over
  // from the last one is a verifier accepting goods they never looked at. Reset
  // during render rather than in an effect: an effect would paint the new
  // order's rows once wearing the last one's ticks, and the frame where a
  // verifier's ticks are on somebody else's goods is the one frame this screen
  // cannot afford.
  const [showing, setShowing] = useState(order?.po_number)
  if (showing !== order?.po_number) {
    setShowing(order?.po_number)
    setPicked(new Set())
    setNote("")
  }

  // Minted once per count and per verb, and kept across a retry. The batch
  // below is a loop: if the third line fails, the first two are already stock
  // and already gone from the queue, so the retry that follows resends them —
  // and only a key that survived the failure makes that second POST harmless.
  // Keyed by verb as well, because Recount after a failed Accept is a
  // different decision about the same count, not a repeat of it.
  const minted = useRef(new Map<string, string>())
  const keyFor = (subject: string) => {
    const existing = minted.current.get(subject)
    if (existing !== undefined) return existing
    const fresh = idempotencyKey()
    minted.current.set(subject, fresh)
    return fresh
  }

  const decide = useMutation({
    mutationFn: async (input: {
      decision: "Accept" | "Recount"
      rows: readonly PurchaseCountAwaitingVerification[]
      note: string
    }) => {
      // Sequential, for the same reason the counts are: these writes land in
      // the same delivery's movement group, and a handful of them racing is a
      // handful of chances to be told it is not there yet.
      for (const row of input.rows) {
        await dc.verifyPurchase({
          count_id: row.count_id,
          verifier_actor_id: actor,
          decision: input.decision,
          note: input.note.trim() === "" ? null : input.note.trim(),
          // Never typed here. The invoice's own total is recorded once, on the
          // delivery, and the comparison is done for the verifier.
          invoiced_price_minor: null,
          idempotency_key: keyFor(`${input.decision}:${row.count_id}`),
        })
      }
      return input.rows.length
    },
    onSuccess: () => {
      setPicked(new Set())
      setNote("")
      minted.current.clear()
      // Accepted goods become stock, leave the queue, change the delivery's
      // accepted tally, and appear in the pools and the ledger.
      void client.invalidateQueries({ queryKey: keys.verifyQueue() })
      void client.invalidateQueries({ queryKey: keys.receipts() })
      void client.invalidateQueries({ queryKey: keys.purchaseWork() })
      void client.invalidateQueries({ queryKey: keys.pools() })
      void client.invalidateQueries({ queryKey: ["inventory", "movements"] })
      void client.invalidateQueries({ queryKey: keys.taggingJobs() })
    },
  })

  // A lorry is one arrival with one invoice, and the counts on it all hang
  // off the one delivery document. They agree in every case the bay produces,
  // so the first one names the document the paper belongs to.
  const receiptId = waiting[0]?.receipt_id ?? null

  // The two answers that repeat down every line, said once above the table.
  const counters = [...new Set(waiting.map((row) => row.counted_by))]
  const latest = waiting.reduce(
    (newest, row) => (row.counted_at > newest ? row.counted_at : newest),
    waiting[0]?.counted_at ?? ""
  )

  // A row is only somebody else's when we know whose the hand on this screen
  // is. Unnamed, the actor is the placeholder `"api"` — which is also what an
  // unnamed node writes into `counted_by`, so every row matched and the whole
  // sheet locked itself with no way out. Not knowing is not the same as being
  // the counter.
  const mineToo = (row: PurchaseCountAwaitingVerification) =>
    !unnamed && row.counted_by === actor
  const decidable = waiting.filter((row) => !mineToo(row))
  const chosen = waiting.filter((row) => picked.has(row.count_id))

  const toggle = (countId: string) =>
    setPicked((was) => {
      const next = new Set(was)
      if (next.has(countId)) next.delete(countId)
      else next.add(countId)
      return next
    })

  const totalOrdered = waiting.reduce(
    (sum, row) => sum + row.expected_stock_units,
    0
  )
  const totalCounted = waiting.reduce(
    (sum, row) => sum + row.counted_quantity,
    0
  )
  const unpriced = waiting.filter((row) => row.unit_price_minor === null).length
  const totalValue = waiting.reduce(
    (sum, row) => sum + row.counted_quantity * (row.unit_price_minor ?? 0),
    0
  )

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      width="table"
      id={order?.po_number}
      title={order?.supplier_name ?? order?.supplier_id ?? "Order"}
      footer={
        waiting.length > 0 && (
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[0.75rem] text-mute">
              {unnamed
                ? "Say who is verifying, above"
                : chosen.length === 0
                  ? "Tick the lines you have compared"
                  : `${count(chosen.length)} of ${count(waiting.length)} lines ticked`}
            </span>
            <Input
              className="min-w-[12rem] flex-1"
              placeholder="Reason, if you are sending it back"
              aria-label="Reason for a recount"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <Button
              variant="soft"
              disabled={
                unnamed ||
                decide.isPending ||
                chosen.length === 0 ||
                note.trim() === ""
              }
              onClick={() =>
                decide.mutate({ decision: "Recount", rows: chosen, note })
              }
            >
              Send back to count
            </Button>
            <Button
              variant="primary"
              disabled={unnamed || decide.isPending || chosen.length === 0}
              onClick={() =>
                decide.mutate({ decision: "Accept", rows: chosen, note })
              }
            >
              {decide.isPending
                ? "Deciding…"
                : chosen.length === 0
                  ? "Accept into stock"
                  : `Accept ${count(chosen.length)} into stock`}
            </Button>
          </div>
        )
      }
    >
      {order === null || waiting.length === 0 ? (
        <EmptyState>
          Nothing on this order is waiting for a verifier. Every count has been
          decided.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-5">
          {/* No banner counting the differences, and none naming your own
              counts. The Diff column says which lines disagree, on the lines
              that disagree, and the totals row says what that comes to — a
              paragraph at the top saying "4 of 4" is the same fact a fourth
              time, and it pushed the grid it describes off the screen. */}
          {unnamed && <NameTheVerifier />}

          {/* Who counted, and when. Above the table because they are one
              answer for the whole delivery: down a column they were the same
              two facts written five times, in the two widest cells on the
              row. */}
          <Facts className="grid-cols-2 sm:grid-cols-4">
            <Fact term="Counted by">
              {counters.length === 1
                ? counters[0]
                : `${count(counters.length)} people`}
            </Fact>
            <Fact term="Counted at">{clock(latest)}</Fact>
            <Fact term="Lines waiting">{count(waiting.length)}</Fact>
            <Fact term="Pieces counted">{count(totalCounted)}</Fact>
          </Facts>

          {/* The comparison, as a grid. Ordered and Counted are adjacent
              because the difference between them is the whole question, and
              Diff is beside them rather than derived in somebody's head. */}
          <div className="overflow-hidden rounded-inner border border-hairline">
            {/* Scrolls sideways inside its own box rather than squeezing: six
                columns of figures have a floor under their width, and the
                only column that can give is the one holding the garment's
                name — the one column a person actually reads. */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[43rem] table-fixed border-collapse">
                <colgroup>
                  <col className="w-[2.5rem]" />
                  <col />
                  <col className="w-[5rem]" />
                  <col className="w-[5rem]" />
                  <col className="w-[5.5rem]" />
                  <col className="w-[7.5rem]" />
                  <col className="w-[8.5rem]" />
                </colgroup>
                <thead>
                  <tr>
                    <th className={cn(HEAD, "text-center")}>
                      <Checkbox
                        label={<span className="sr-only">Tick every line</span>}
                        checked={
                          decidable.length > 0 &&
                          decidable.every((row) => picked.has(row.count_id))
                        }
                        disabled={decidable.length === 0}
                        onChange={(next) =>
                          setPicked(
                            next
                              ? new Set(decidable.map((row) => row.count_id))
                              : new Set()
                          )
                        }
                      />
                    </th>
                    <th className={HEAD}>Item</th>
                    <th className={cn(HEAD, "text-right")}>Ordered</th>
                    <th className={cn(HEAD, "text-right")}>Counted</th>
                    <th className={cn(HEAD, "text-right")}>Diff</th>
                    <th className={cn(HEAD, "text-right")}>Price</th>
                    <th className={cn(HEAD, "text-right")}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {waiting.map((row) => {
                    const own = mineToo(row)
                    return (
                      // The whole row is the tick's hit area. A 14px box in
                      // the first column is the smallest target on the sheet,
                      // and it is the one thing a verifier presses five times
                      // in a row — the box still shows the state, it is just
                      // not the only place you can aim.
                      <tr
                        key={row.count_id}
                        onClick={() => !own && toggle(row.count_id)}
                        className={cn(
                          "border-t border-hairline transition-colors",
                          own ? "opacity-70" : "cursor-pointer hover:bg-soft"
                        )}
                      >
                        <td
                          className={cn(CELL, "text-center")}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Checkbox
                            label={
                              <span className="sr-only">
                                {`Decide ${row.article_code}`}
                              </span>
                            }
                            checked={picked.has(row.count_id)}
                            disabled={own}
                            onChange={() => toggle(row.count_id)}
                          />
                        </td>
                        <td className={CELL}>
                          <span className="block truncate font-medium text-ink">
                            {row.article_name}
                          </span>
                          <span className="block truncate font-mono text-[0.65625rem] text-mute">
                            {row.article_code}
                            {own && " · your count"}
                          </span>
                        </td>
                        <td className={cn(CELL, NUM)}>
                          {count(row.expected_stock_units)}
                        </td>
                        <td className={cn(CELL, NUM, "font-semibold")}>
                          {count(row.counted_quantity)}
                        </td>
                        <td className={cn(CELL, "text-right")}>
                          {row.variance === 0 ? (
                            <span className="text-mute tabular-nums">0</span>
                          ) : (
                            <Pill tone="bad">{variance(row.variance)}</Pill>
                          )}
                        </td>
                        <td className={cn(CELL, NUM)}>
                          {money(row.unit_price_minor)}
                        </td>
                        <td className={cn(CELL, NUM, "text-ink")}>
                          {row.unit_price_minor === null
                            ? "—"
                            : money(
                                row.counted_quantity * row.unit_price_minor
                              )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                {/* The totals the invoice underneath is checked against, on
                    the same right edge as the figures they add up. */}
                <tfoot>
                  <tr className="border-t border-hairline bg-soft-2">
                    <td className={CELL} />
                    <td
                      className={cn(
                        CELL,
                        "font-mono text-eyebrow tracking-[0.04em] text-body uppercase"
                      )}
                    >
                      This delivery
                    </td>
                    <td className={cn(CELL, NUM)}>{count(totalOrdered)}</td>
                    <td className={cn(CELL, NUM, "font-semibold")}>
                      {count(totalCounted)}
                    </td>
                    <td className={cn(CELL, NUM)}>
                      {variance(totalCounted - totalOrdered)}
                    </td>
                    <td className={CELL} />
                    <td className={cn(CELL, NUM, "font-semibold text-ink")}>
                      {money(totalValue)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {unpriced > 0 && (
            <p className="-mt-2.5 text-[0.71875rem] text-mute">
              {count(unpriced)} of {count(waiting.length)} lines carry no agreed
              price, so they add nothing to the value above — it is a floor, not
              the whole delivery.
            </p>
          )}

          {/* Directly under the value the goods come to, because "billed" and
              "worth at the agreed price" are two halves of one sum and a
              verifier should not have to hold one of them in their head. */}
          {receiptId !== null && (
            <InvoiceBlock receiptId={receiptId} counts={waiting} />
          )}

          {decide.isSuccess && (
            <Receipt>
              {count(decide.data)} lines decided. Accepted goods are stock from
              this moment and are waiting to be tagged.
            </Receipt>
          )}
          <Problem error={decide.error} />
        </div>
      )}
    </Sheet>
  )
}
