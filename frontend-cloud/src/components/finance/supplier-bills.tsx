import { AppShell, ScreenBody, ScreenHeader, ScreenState } from "@/components/app-shell"
import { billColumns } from "@/components/finance/columns"
import { DataGrid, useDataGrid } from "@/components/finance/data-grid"
import { FinanceNav } from "@/components/finance/finance-nav"
import { Nav } from "@/components/nav"
import { financeKeys, listBills, postBill, unbilledReceipts } from "@/lib/finance"
import { money } from "@/lib/money"
import { cn } from "@/lib/utils"
import type { SupplierBill } from "@itulah/contract"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { TriangleAlert } from "lucide-react"
import { useMemo, useState } from "react"

/// What suppliers have billed, and what has arrived that nobody has billed for.
///
/// # Why the second list is on the same screen
///
/// Because the client has no goods-received-not-invoiced account, so a delivery
/// that has not been billed is in the warehouse and nowhere in the books. At a
/// month end that means inventory and payables both understate by its value,
/// and there is no line on the balance sheet where anyone would notice.
///
/// Putting the exposure beside the bills is the only place it is ever going to
/// be seen. It is deliberately not styled as a total to be relied on: it is
/// valued at the ordered price, which is what the supplier has agreed to charge
/// and not what they have charged.
export function SupplierBillsScreen() {
  const client = useQueryClient()
  const bills = useQuery({
    queryKey: financeKeys.bills(),
    queryFn: ({ signal }) => listBills({}, signal),
  })
  const unbilled = useQuery({
    queryKey: financeKeys.unbilled(),
    queryFn: ({ signal }) => unbilledReceipts(signal),
  })
  const post = useMutation({
    mutationFn: (invoiceId: string) => postBill(invoiceId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["finance"] })
    },
  })

  const rows = useMemo(() => [...(bills.data ?? [])], [bills.data])
  // Rebuilt when the mutation's busy flag flips, because the Post button in the
  // last column is disabled from it. Cheap: seven of these are constants and
  // the eighth closes over two values.
  const posting = post.isPending
  const send = post.mutate
  const columns = useMemo(() => billColumns(send, posting), [send, posting])
  // Overdue first, which is the only reason anybody opens this screen. Not the
  // server's order — it sends them by invoice date, which is the order they
  // were recorded in and not the order they need paying in.
  const table = useDataGrid({
    data: rows,
    columns,
    getRowId: rowId,
    sorting: [{ id: "days_overdue", desc: true }],
  })

  const waiting = unbilled.data ?? []
  const exposure = waiting.reduce((sum, r) => sum + r.value_at_order_price_minor, 0)

  return (
    <AppShell nav={<Nav />} section={<FinanceNav />}>
      <ScreenHeader
        title="Supplier Bills"
        subtitle={rows.length === 0 ? undefined : `${rows.length} bills`}
      />

      {post.error !== null && (
        <p className="text-destructive shrink-0 border-b px-3.5 py-2 text-[12px]">
          {post.error instanceof Error ? post.error.message : "could not post the bill"}
        </p>
      )}

      {bills.isPending ? (
        <ScreenState>Loading bills…</ScreenState>
      ) : bills.error !== null ? (
        <ScreenState tone="problem">
          {bills.error instanceof Error ? bills.error.message : "could not load bills"}
        </ScreenState>
      ) : rows.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ScreenState>
            No supplier bill has been recorded yet. Recording one and posting it are two
            acts: a bill can arrive, be queried and be held before anybody decides it may
            be paid.
          </ScreenState>
          <UnbilledPanel rows={waiting} exposure={exposure} loading={unbilled.isPending} open />
        </div>
      ) : (
        <>
          <ScreenBody>
            <DataGrid table={table} />
          </ScreenBody>
          <div className="shrink-0 overflow-y-auto">
            <UnbilledPanel
              rows={waiting}
              exposure={exposure}
              loading={unbilled.isPending}
              open={false}
            />
          </div>
        </>
      )}
    </AppShell>
  )
}

function rowId(row: SupplierBill): string {
  return row.invoice_id
}

/// Received, not billed — the exposure the books cannot carry.
///
/// Left as plain markup on purpose. It is a footnote to the table above it, not
/// a second table: it is behind a disclosure, it is read as a whole rather than
/// scanned, and its length is bounded by how many deliveries are waiting on
/// paperwork — a number that is a problem long before it is a scrolling
/// problem. Sorting and filtering it would be answering a question nobody is
/// asking here.
function UnbilledPanel({
  rows,
  exposure,
  loading,
  open: expandedByDefault,
}: {
  rows: readonly {
    receipt_id: string
    receipt_number: string
    supplier_id: string
    site_id: string
    invoice_number: string | null
    value_at_order_price_minor: number
    line_count: number
    days_waiting: number
  }[]
  exposure: number
  loading: boolean
  open: boolean
}) {
  const [open, setOpen] = useState(expandedByDefault)
  if (loading) return null

  return (
    <section className="border-t">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        className="hover:bg-muted/40 flex w-full items-center gap-2 px-3.5 py-2 text-left text-[12px]"
      >
        <TriangleAlert
          className={cn(
            "size-3.5 shrink-0",
            rows.length > 0 ? "text-amber-600" : "text-muted-foreground/40",
          )}
        />
        <span className="font-medium">Received, not billed</span>
        <span className="text-muted-foreground">
          {rows.length === 0
            ? "nothing waiting"
            : `${rows.length} ${rows.length === 1 ? "delivery" : "deliveries"} · about ${money(exposure)} at ordered prices`}
        </span>
        <span className="text-muted-foreground ml-auto text-[11px]">
          {open ? "hide" : "show"}
        </span>
      </button>

      {open && (
        <div className="px-3.5 pb-3">
          <p className="text-muted-foreground max-w-2xl pb-2 text-[11.5px]">
            None of this is in the books. The client's chart has no
            goods-received-not-invoiced account, so stock that has arrived and not been
            billed sits in the Gudang and not on the balance sheet — at a month end,
            inventory and payables both understate by roughly this much. The figure is an
            estimate at the ordered price, not a balance.
          </p>
          {rows.length === 0 ? (
            <p className="text-muted-foreground text-[12px]">
              Every delivery has a bill against it.
            </p>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-muted-foreground border-b text-[10.5px]">
                  <th className="py-1 text-left font-medium">Receipt</th>
                  <th className="py-1 text-left font-medium">Supplier</th>
                  <th className="py-1 text-left font-medium">Site</th>
                  <th className="py-1 text-left font-medium">Paper invoice</th>
                  <th className="py-1 text-right font-medium">Lines</th>
                  <th className="py-1 text-right font-medium">Waiting</th>
                  <th className="py-1 text-right font-medium">At ordered price</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.receipt_id} className="border-b">
                    <td className="py-1 font-mono text-[11px]">{row.receipt_number}</td>
                    <td className="py-1">{row.supplier_id}</td>
                    <td className="text-muted-foreground py-1 font-mono text-[11px]">
                      {row.site_id}
                    </td>
                    {/* What the DC read off the paper that came with the goods.
                        Evidence that a bill exists somewhere — not a bookable
                        figure, and not this system's record of one. */}
                    <td className="text-muted-foreground py-1 font-mono text-[11px]">
                      {row.invoice_number ?? "none came with it"}
                    </td>
                    <td className="py-1 text-right tabular-nums">{row.line_count}</td>
                    <td
                      className={cn(
                        "py-1 text-right tabular-nums",
                        row.days_waiting > 30 && "text-amber-700",
                      )}
                    >
                      {row.days_waiting}d
                    </td>
                    <td className="py-1 text-right font-mono tabular-nums">
                      {money(row.value_at_order_price_minor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  )
}
