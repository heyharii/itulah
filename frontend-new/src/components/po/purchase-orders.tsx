import { useMemo, useState } from "react"
import { Link, getRouteApi } from "@tanstack/react-router"

import { Icon, paths } from "@/components/dashboard/parts"
import { Tag, Thumb, money } from "@/components/sourcing/product-views"
import type { Product, Supplier } from "@/components/sourcing/catalogue"
import { useSourcingCatalog } from "@/components/sourcing/api"
import { PoDraft } from "@/components/po/po-draft"
import {
  PO_STATUS_META,
  usePurchaseOrder,
  usePurchaseOrdersResource,
  type PurchaseOrderSummary,
} from "@/components/po/api"
import { useCancelPurchaseOrder, useClosePurchaseOrder } from "@/components/po/mutations"
import {
  orderDiscount,
  orderNet,
  orderUnits,
  type PurchaseOrder,
} from "@/components/commerce/store"
import { getErrorMessage } from "@/lib/api"
import { VirtualRows } from "@/shared/table"
import { cn } from "@/lib/utils"
import { SidebarTrigger } from "@/components/app-shell"

const productOf = (id: string | null, products: Product[]) =>
  id ? products.find((p) => p.id === id) : undefined

const ORDERS_COLUMNS = "150px minmax(0,1fr) 92px 92px 112px 124px 118px"
const ORDER_LINES_COLUMNS = "320px 100px 112px minmax(0,1fr)"

/* Neither table's row is itself a click target — only the elements inside it
 * are (the order number, the supplier link) — but the original `<tr>` still
 * washed the whole row on hover as a visual cue, so both ask VirtualRows for
 * `hoverable` without claiming the click. The wash belongs on the row element:
 * cells are `items-center` grid items and only as tall as their own content,
 * so tinting them paints ragged disconnected blocks rather than one row. */

/**
 * The list projection resolves the supplier name in SQL, so prefer it and fall
 * back to the sourcing catalogue only when the row is not on this page. The
 * catalogue has no division for a procurement supplier, so the second line
 * carries the delivery destination the API does return.
 */
function orderSupplier(
  order: PurchaseOrder,
  suppliers: Supplier[],
  summary?: PurchaseOrderSummary
) {
  const supplier = suppliers.find((item) => item.id === order.supplierId)
  return {
    name: summary?.supplierName || supplier?.name || order.supplierId || "Unknown supplier",
    detail: summary?.destinationName || supplier?.division || "\u2014",
  }
}

const route = getRouteApi("/buying")

/**
 * The orders half of Buying. It is a pane, not a screen: the app shell, the
 * nav tree and the toast stack belong to the supplier directory it shares a
 * route with, so this renders the card contents and nothing around them.
 *
 * The status filter lives in that shared nav; what stays here is the list,
 * the one order you opened, and the draft composer.
 */
export function OrdersPane({ onToast }: { onToast: (message: string) => void }) {
  /* `draftFor` arrives from Sourcing; the rest is this pane's own state, all
   * of it prefixed so it never collides with the directory's `open`/`sort`. */
  const { draftFor, order: openId, orderStatus: status, orderSupplier: supplierFilter } =
    route.useSearch()
  const navigate = route.useNavigate()

  /* The handover is consumed once: the draft is open, so the ids come back out
   * of the URL with `replace` and a reload no longer re-opens the draft. */
  const clearDraft = () =>
    void navigate({ search: (prev) => ({ ...prev, draftFor: undefined }), replace: true })

  const openOrder = (id: string) =>
    void navigate({ search: (prev) => ({ ...prev, order: id }) })

  const closeOrder = () =>
    void navigate({ search: (prev) => ({ ...prev, order: undefined }), replace: true })

  const clearFilters = () =>
    void navigate({
      search: (prev) => ({ ...prev, orderStatus: undefined, orderSupplier: undefined }),
      replace: true,
    })

  const startDraft = () => void navigate({ search: (prev) => ({ ...prev, draftFor: [] }) })

  const poResource = usePurchaseOrdersResource()
  const catalogResource = useSourcingCatalog()
  const orders = useMemo(() => poResource.data?.orders ?? [], [poResource.data?.orders])
  const summaries = useMemo(
    () => new Map((poResource.data?.summaries ?? []).map((summary) => [summary.id, summary])),
    [poResource.data?.summaries],
  )
  const products = useMemo(() => catalogResource.data?.products ?? [], [catalogResource.data?.products])
  const suppliers = useMemo(() => catalogResource.data?.suppliers ?? [], [catalogResource.data?.suppliers])

  /* The open order is fetched from its id, so a reload or a shared link lands
   * on the same detail view instead of an empty list. */
  const openResource = usePurchaseOrder(openId ?? null)
  const open = openId ? openResource.data ?? null : null

  /* Supplier is filtered here rather than at the API: the Go list endpoint
   * takes `status` and `limit` only, so narrowing to one supplier has to
   * happen on the page it was already loading. */
  const visibleOrders = useMemo(
    () =>
      orders.filter(
        (order) =>
          (!status || order.status === status) &&
          (!supplierFilter || order.supplierId === supplierFilter),
      ),
    [orders, status, supplierFilter],
  )

  const filterLabel = supplierFilter
    ? suppliers.find((item) => item.id === supplierFilter)?.name ?? "This supplier"
    : null

  /* An empty array still means "start a draft" — the presence of the param is
   * the handover, not its contents. */
  const drafting = draftFor !== undefined

  if (drafting) {
    return (
      <PoDraft
        productIds={draftFor}
        onClose={clearDraft}
        onCreated={(created) => {
          /* one navigation: the draft closes and its order opens */
          void navigate({
            search: (prev) => ({ ...prev, draftFor: undefined, order: created.id }),
            replace: true,
          })
          onToast(`${created.number} created`)
        }}
      />
    )
  }

  if (openId && openResource.errorMessage) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="text-xs text-ember">Unable to open this order: {openResource.errorMessage}</span>
        <button
          type="button"
          onClick={closeOrder}
          className="inline-flex h-[28px] items-center rounded-control bg-surface px-2.5 text-xs font-medium text-ink shadow-btn hover:bg-hover"
        >
          Back to orders
        </button>
      </div>
    )
  }

  if (openId && !open) {
    return <div className="flex h-full items-center justify-center text-xs text-ink-4">Loading order\u2026</div>
  }

  if (open) {
    return (
      <OrderView
        order={open}
        summary={summaries.get(open.id)}
        products={products}
        suppliers={suppliers}
        onBack={closeOrder}
        onChanged={(message) => {
          openResource.reload()
          poResource.reload()
          onToast(message)
        }}
      />
    )
  }

  return (
    <>
      {/* Band 1 \u2014 what this is, and what you can do to it. */}
      <div className="flex h-[52px] shrink-0 items-center justify-between gap-3 pr-2.5 pl-3.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <SidebarTrigger className="-ml-1 self-center" />
          <h1 className="text-sm font-semibold tracking-[-0.01em]">Purchase orders</h1>
          <span className="font-mono text-[11.5px] text-ink-4">
            {status || supplierFilter ? visibleOrders.length : poResource.data?.total ?? orders.length}
          </span>
        </div>

        <div className="flex items-center gap-[7px]">
          <Link
            to="/sourcing"
            className="inline-flex h-[30px] items-center gap-1.5 rounded-control bg-surface px-2.5 text-xs font-medium text-ink shadow-btn transition-colors duration-[120ms] hover:bg-hover"
          >
            <Icon path={paths.star} size={14} width={1.9} />
            From Sourcing
          </Link>
          <button
            type="button"
            onClick={startDraft}
            className="inline-flex h-[30px] items-center gap-1.5 rounded-control bg-accent px-2.5 text-xs font-medium text-white shadow-[0_1px_2px_rgb(0_134_252/.3)] transition-[filter] duration-[120ms] hover:brightness-105"
          >
            <Icon path={paths.plus} size={14} width={2.1} />
            New PO
          </button>
        </div>
      </div>

      {/* Band 2 \u2014 which slice of the data you are looking at. */}
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-t border-b border-t-line border-b-line-strong pr-2.5 pl-3">
        <span className="pr-1 pl-0.5 text-[11px] font-semibold tracking-[0.04em] text-ink-4 uppercase">
          Showing
        </span>
        {status || supplierFilter ? (
          <>
            {status && (
              <span className="inline-flex h-[26px] items-center gap-1.5 rounded-control bg-accent-tint px-2 text-xs font-medium text-accent-ink">
                <span
                  style={{ background: PO_STATUS_META[status].hue }}
                  className="size-2 shrink-0 rounded-full"
                />
                {PO_STATUS_META[status].label}
              </span>
            )}
            {filterLabel && (
              <span className="inline-flex h-[26px] max-w-[220px] items-center gap-1.5 rounded-control bg-accent-tint px-2 text-xs font-medium text-accent-ink">
                <span className="truncate">{filterLabel}</span>
              </span>
            )}
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex h-[26px] items-center gap-1.5 rounded-control px-2 text-xs font-medium text-ink-3 transition-colors hover:bg-hover hover:text-ink"
            >
              <Icon path={paths.close} size={11} width={2.4} />
              Every order
            </button>
          </>
        ) : (
          <span className="text-xs font-medium text-ink-3">Every order</span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {poResource.isLoading ? (
          <div className="flex h-[280px] items-center justify-center text-xs text-ink-4">Loading purchase orders\u2026</div>
        ) : poResource.errorMessage ? (
          <div className="flex h-[280px] flex-col items-center justify-center gap-3 px-6 text-center">
            <span className="text-xs text-ember">Unable to load purchase orders: {poResource.errorMessage}</span>
            <button
              type="button"
              onClick={() => poResource.reload()}
              className="inline-flex h-[28px] items-center rounded-control bg-surface px-2.5 text-xs font-medium text-ink shadow-btn hover:bg-hover"
            >
              Retry
            </button>
          </div>
        ) : !visibleOrders.length ? (
          <div className="flex h-[280px] items-center justify-center px-6 text-center text-xs text-ink-4">
            {status || supplierFilter
              ? "No purchase orders match this scope."
              : "No purchase orders have been created in Internal yet."}
          </div>
        ) : (
          <VirtualRows
            rows={visibleOrders}
            rowKey={(order) => order.id}
            columns={ORDERS_COLUMNS}
            rowHeight={56}
            className="min-w-[760px]"
            hoverable
            header={
              <>
                <span className="pl-3.5">Order</span>
                <span className="px-3">Supplier</span>
                <span className="px-3 text-right">Lines</span>
                <span className="px-3 text-right">Units</span>
                <span className="px-3 text-right">Delivery</span>
                <span className="px-3 text-right">Value</span>
                <span className="pr-3.5 pl-3">Status</span>
              </>
            }
            renderRow={(order) => {
              const summary = summaries.get(order.id)
              const supplier = orderSupplier(order, suppliers, summary)
              return (
                <>
                  <span role="gridcell" className="pl-3.5">
                    <button
                      type="button"
                      onClick={() => openOrder(order.id)}
                      className="block text-left font-mono text-[12.5px] font-medium text-ink hover:underline hover:underline-offset-[3px]"
                    >
                      {order.number}
                    </button>
                    {/* Receiving progress is the backend's own rollup \u2014
                        status never encodes it. */}
                    {summary && summary.receivedStatus !== "none" && (
                      <span className="block font-mono text-[10.5px] text-ink-4">
                        {summary.receivedUnits.toLocaleString()}/
                        {summary.totalUnits.toLocaleString()} received
                      </span>
                    )}
                  </span>
                  <span role="gridcell" className="px-3">
                    {/* the supplier is a record in the other half of this
                        app, so its name opens that record */}
                    {order.supplierId ? (
                      <Link
                        from="/buying"
                        to="/buying"
                        search={(prev) => ({
                          ...prev,
                          section: "suppliers" as const,
                          expanded: prev.expanded.includes("suppliers")
                            ? prev.expanded
                            : [...prev.expanded, "suppliers" as const],
                          open: order.supplierId ?? undefined,
                        })}
                        className="block truncate text-xs font-medium text-ink hover:underline hover:underline-offset-[3px]"
                      >
                        {supplier.name}
                      </Link>
                    ) : (
                      <span className="block truncate text-xs font-medium text-ink">
                        {supplier.name}
                      </span>
                    )}
                    <span className="block truncate text-[11px] text-ink-4">
                      {supplier.detail}
                    </span>
                  </span>
                  <span
                    role="gridcell"
                    className="px-3 text-right font-mono text-xs tabular-nums text-ink-2"
                  >
                    {summary?.lineCount ?? order.lines.length}
                  </span>
                  <span
                    role="gridcell"
                    className="px-3 text-right font-mono text-xs tabular-nums text-ink-2"
                  >
                    {summary?.totalUnits !== undefined
                      ? summary.totalUnits.toLocaleString()
                      : order.lines.length
                        ? orderUnits(order).toLocaleString()
                        : "\u2014"}
                  </span>
                  <span
                    role="gridcell"
                    className="px-3 text-right font-mono text-xs tabular-nums text-ink-3"
                  >
                    {order.deliveryDate || "\u2014"}
                  </span>
                  <span
                    role="gridcell"
                    className="px-3 text-right font-mono text-[13px] font-medium tabular-nums text-ink"
                  >
                    {money(summary?.total ?? orderNet(order), summary?.currency || undefined)}
                  </span>
                  <span role="gridcell" className="pr-3.5 pl-3">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-ink-2">
                      <span
                        style={{ background: PO_STATUS_META[order.status].hue }}
                        className="size-2 shrink-0 rounded-full"
                      />
                      {PO_STATUS_META[order.status].label}
                    </span>
                    {summary?.isOverdue && order.status === "active" && (
                      <span className="block truncate pt-0.5 text-[10.5px] text-ember">
                        overdue
                      </span>
                    )}
                  </span>
                </>
              )
            }}
          />
        )}
      </div>
    </>
  )
}

/**
 * The detail view and the only place an order changes state.
 *
 * Procurement offers exactly two transitions and both leave `active`, so the
 * actions disappear the moment an order is closed or cancelled — the backend
 * answers 409/400 for any further move and the screen should not offer one.
 */
function OrderView({
  order,
  summary,
  products,
  suppliers,
  onBack,
  onChanged,
}: {
  order: PurchaseOrder
  summary?: PurchaseOrderSummary
  products: Product[]
  suppliers: Supplier[]
  onBack: () => void
  onChanged: (message: string) => void
}) {
  const supplier = orderSupplier(order, suppliers, summary)

  const cancel = useCancelPurchaseOrder()
  const close = useClosePurchaseOrder()
  const [closing, setClosing] = useState(false)
  const [reason, setReason] = useState("")
  const [actionError, setActionError] = useState<string | null>(null)

  const busy = cancel.isLoading || close.isLoading
  const live = order.status === "active"

  const runCancel = async () => {
    setActionError(null)
    try {
      await cancel.execute(order.id)
      onChanged(`${order.number} cancelled`)
    } catch (error: unknown) {
      setActionError(getErrorMessage(error))
    }
  }

  const runClose = async () => {
    setActionError(null)
    try {
      await close.execute({ id: order.id, reason: reason.trim() })
      setClosing(false)
      setReason("")
      onChanged(`${order.number} closed`)
    } catch (error: unknown) {
      setActionError(getErrorMessage(error))
    }
  }

  const action =
    "inline-flex h-[28px] items-center rounded-control px-2.5 text-xs font-medium shadow-btn transition-colors disabled:opacity-50"

  return (
    <>
      <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-line pr-2.5 pl-3.5">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to orders"
          className="grid size-[30px] shrink-0 place-items-center rounded-control text-ink-3 transition-colors hover:bg-hover hover:text-ink"
        >
          <Icon path={paths.chevronRight} size={16} width={2} className="rotate-180" />
        </button>
        <div className="min-w-0">
          <div className="truncate font-mono text-sm font-semibold text-ink">{order.number}</div>
          <div className="truncate text-[11.5px] text-ink-4">
            {supplier.name} · {supplier.detail}
            {order.deliveryDate && ` · delivery ${order.deliveryDate}`}
          </div>
        </div>
        <span className="ml-auto flex items-center gap-4 font-mono text-[11px] text-ink-4">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-sans text-xs text-ink-2">
            <span
              style={{ background: PO_STATUS_META[order.status].hue }}
              className="size-2 shrink-0 rounded-full"
            />
            {PO_STATUS_META[order.status].label}
          </span>
          <span>
            <span className="text-ink-2">{orderUnits(order).toLocaleString()}</span> units
          </span>
          {orderDiscount(order) > 0 && (
            <span className="text-ember">−{money(orderDiscount(order))}</span>
          )}
          <span className="text-[13px] font-medium text-ink">
            {money(summary?.total ?? orderNet(order), summary?.currency || undefined)}
          </span>
          {live && (
            <span className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => setClosing((v) => !v)}
                className={cn(action, "bg-surface text-ink hover:bg-hover")}
              >
                Close
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runCancel()}
                className={cn(action, "bg-surface text-ember hover:bg-hover")}
              >
                {cancel.isLoading ? "Cancelling…" : "Cancel order"}
              </button>
            </span>
          )}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {actionError && (
          <div className="m-3.5 rounded-panel bg-surface px-3 py-2.5 text-[12.5px] text-ember shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ember)_28%,transparent)]">
            {actionError}
          </div>
        )}

        {closing && live && (
          <div className="m-3.5 rounded-panel bg-inset px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line)]">
            <div className="text-[12.5px] font-medium text-ink">Close this order</div>
            <p className="pt-0.5 text-[11.5px] text-ink-3">
              Closing settles the order at what has been received. The reason is kept on the
              procurement audit trail, not on the order itself.
            </p>
            <div className="flex items-center gap-1.5 pt-2">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this order closing?"
                className="h-[28px] min-w-0 flex-1 rounded-control bg-surface px-2 text-xs text-ink shadow-[inset_0_0_0_1px_var(--line)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--accent)]"
              />
              <button
                type="button"
                disabled={busy || !reason.trim()}
                onClick={() => void runClose()}
                className={cn(action, "bg-accent text-white hover:brightness-105")}
              >
                {close.isLoading ? "Closing…" : "Close order"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setClosing(false)}
                className={cn(action, "bg-surface text-ink hover:bg-hover")}
              >
                Keep open
              </button>
            </div>
          </div>
        )}

        {order.reviewNote && (
          <div className="m-3.5 flex items-start gap-2 rounded-panel bg-inset px-3 py-2.5 text-[12.5px] text-ink-2 shadow-[inset_0_0_0_1px_var(--line)]">
            <Icon path={paths.edit} size={14} width={2} className="mt-px shrink-0 text-ink-4" />
            <span>{order.reviewNote}</span>
          </div>
        )}

        <VirtualRows
          rows={order.lines}
          rowKey={(line) => line.id}
          columns={ORDER_LINES_COLUMNS}
          rowHeight={72}
          className="min-w-[720px]"
          hoverable
          header={
            <>
              <span className="pl-3.5">Style</span>
              <span className="px-3 text-right">Qty</span>
              <span className="px-3 text-right">Unit</span>
              <span className="pr-3.5 pl-3 text-right">Total</span>
            </>
          }
          renderRow={(line) => {
            const p = productOf(line.productId, products)
            return (
              <>
                <span role="gridcell" className="pr-3 pl-3.5">
                  <span className="flex items-center gap-2.5">
                    {p ? (
                      <Thumb product={p} className="h-[56px] w-[42px] rounded-chip" />
                    ) : (
                      <span className="grid h-[56px] w-[42px] shrink-0 place-items-center rounded-chip bg-inset text-ink-4 shadow-[inset_0_0_0_1px_var(--line)]">
                        <Icon path={paths.edit} size={15} width={1.8} />
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-ink">
                        {p?.name ?? line.name ?? "Untitled item"}
                      </span>
                      <span className="block truncate font-mono text-[10.5px] text-ink-4">
                        {p?.sku ?? (line.sourcingItemId ? "Internal sourcing item" : "direct line")}
                        {line.division && ` · ${line.division}`}
                      </span>
                      {line.tags.length > 0 && (
                        <span className="flex flex-wrap gap-1 pt-1">
                          {line.tags.slice(0, 4).map((t) => (
                            <Tag key={t} name={t} />
                          ))}
                        </span>
                      )}
                    </span>
                  </span>
                </span>
                <span
                  role="gridcell"
                  className="px-3 text-right font-mono text-xs tabular-nums text-ink-2"
                >
                  {line.quantity.toLocaleString()}
                </span>
                <span
                  role="gridcell"
                  className="px-3 text-right font-mono text-xs tabular-nums text-ink-2"
                >
                  {money(line.unitPrice)}
                </span>
                <span
                  role="gridcell"
                  className="pr-3.5 pl-3 text-right font-mono text-[13px] font-medium tabular-nums text-ink"
                >
                  {money(line.quantity * line.unitPrice)}
                </span>
              </>
            )
          }}
        />
      </div>
    </>
  )
}
