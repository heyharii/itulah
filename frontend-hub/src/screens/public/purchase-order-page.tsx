import { useQuery } from "@tanstack/react-query"
import { useEffect } from "react"

import { count, day } from "@/lib/format"
import {
  getPublicPurchaseOrder,
  type PublicPurchaseOrder,
} from "@/lib/queries/procurement"
import { COMPANY } from "@/screens/finance-lab/print"

/// The public page of a printed purchase order: `/p/{token}`, opened from the
/// QR on the paper (owner, 2026-10-16: "di scan langsung keluar isinya").
///
/// Read-only and without a login, as the surat jalan's page (`/n/{token}`).
/// Unlike that one it reads the order as it is NOW: what it is for is to say
/// whether the order is still active. The server sends only what the paper
/// already shows — no prices, no people.
export function PurchaseOrderPage({ token }: { token: string }) {
  const order = useQuery({
    queryKey: ["public-purchase-order", token],
    queryFn: ({ signal }) => getPublicPurchaseOrder(token, signal),
    retry: false,
  })

  // Not for search engines while the page is shown.
  useEffect(() => {
    const meta = document.createElement("meta")
    meta.name = "robots"
    meta.content = "noindex"
    document.head.appendChild(meta)
    const was = document.title
    document.title = "Purchase Order"
    return () => {
      meta.remove()
      document.title = was
    }
  }, [])

  return (
    <div className="fixed inset-0 overflow-y-auto bg-soft">
      <main className="mx-auto flex w-full max-w-[46rem] flex-col gap-4 px-4 py-6 pb-[max(2rem,env(safe-area-inset-bottom))] sm:py-10">
        {order.isPending && (
          <p className="py-16 text-center text-[0.9375rem] text-body">
            Loading the purchase order…
          </p>
        )}
        {order.isError && (
          <Notice
            title="This purchase order could not be read"
            body="Check the connection and scan the code again."
          />
        )}
        {order.isSuccess && order.data === null && (
          <Notice
            title="This purchase order was not found"
            body="The code may be damaged, or the link may be wrong."
          />
        )}
        {order.data && <Paper order={order.data} />}
      </main>
    </div>
  )
}

/// Whether the order still stands, said first and large: the reason the code
/// was scanned.
function standing(order: PublicPurchaseOrder): {
  readonly active: boolean
  readonly word: string
} {
  switch (order.lifecycle) {
    case "CANCELLED":
      return { active: false, word: "Cancelled" }
    case "FULLY_RECEIVED":
      return { active: false, word: "Fully Received" }
    case "SHORT_RECEIVED":
      return { active: false, word: "Closed Short" }
    case "PARTIALLY_RECEIVED":
      return { active: true, word: "Active · Partially Received" }
    default:
      return { active: true, word: "Active" }
  }
}

function Paper({ order }: { order: PublicPurchaseOrder }) {
  const state = standing(order)
  const ordered = order.lines.reduce(
    (sum, line) => sum + line.ordered_quantity,
    0
  )
  const received = order.lines.reduce(
    (sum, line) => sum + line.received_quantity,
    0
  )
  return (
    <article
      aria-label={`Purchase order ${order.po_number}`}
      className="rounded-card border border-hairline bg-canvas px-5 py-6 text-[0.9375rem] text-ink shadow-soft sm:px-9 sm:py-9"
    >
      <div
        className={
          state.active
            ? "mb-5 rounded-inner bg-accent-bg px-4 py-3 text-accent"
            : "mb-5 rounded-inner bg-bad-bg px-4 py-3 text-bad-fg"
        }
      >
        <p className="text-[1.125rem] font-semibold">{state.word}</p>
        <p>
          {state.active
            ? "This purchase order is still active."
            : "This purchase order is no longer active."}
        </p>
      </div>

      <header className="flex flex-col gap-4 border-b-2 border-ink pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-semibold tracking-[0.04em] uppercase">
            {COMPANY.name}
          </p>
          <p className="text-body">{COMPANY.address}</p>
        </div>
        <div className="sm:text-right">
          <h1 className="mb-1 text-[1.25rem] font-semibold tracking-[0.04em]">
            PURCHASE ORDER
          </h1>
          <p className="font-semibold">{order.po_number}</p>
          <p className="text-body">
            Date {day(order.issued_at ?? order.created_at)}
          </p>
        </div>
      </header>

      <dl className="my-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-body">To</dt>
        <dd className="font-semibold">{order.supplier_name ?? "—"}</dd>
        <dt className="text-body">Delivery date</dt>
        <dd>{order.expected_arrival ? day(order.expected_arrival) : "—"}</dd>
      </dl>

      <table className="w-full border-collapse border border-ink">
        <thead>
          <tr className="text-left text-body">
            <th className="border border-ink px-3 py-2 font-medium">Item</th>
            <th className="w-24 border border-ink px-3 py-2 text-right font-medium">
              Ordered
            </th>
            <th className="w-24 border border-ink px-3 py-2 text-right font-medium">
              Received
            </th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((line) => (
            <tr key={line.line_number}>
              <td className="border border-ink px-3 py-2.5 align-top">
                <p>{line.article_name ?? "—"}</p>
                {line.tags && line.tags.length > 0 && (
                  <p className="text-body">{line.tags.join(" · ")}</p>
                )}
              </td>
              <td className="border border-ink px-3 py-2.5 text-right align-top tabular-nums">
                {count(line.ordered_quantity)} pcs
              </td>
              <td className="border border-ink px-3 py-2.5 text-right align-top tabular-nums">
                {count(line.received_quantity)} pcs
              </td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="border border-ink px-3 py-2.5 text-right">Total</td>
            <td className="border border-ink px-3 py-2.5 text-right tabular-nums">
              {count(ordered)} pcs
            </td>
            <td className="border border-ink px-3 py-2.5 text-right tabular-nums">
              {count(received)} pcs
            </td>
          </tr>
        </tbody>
      </table>
    </article>
  )
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-card border border-hairline bg-canvas px-5 py-10 text-center shadow-soft">
      <h1 className="text-[1.125rem] font-semibold text-ink">{title}</h1>
      <p className="text-[0.9375rem] text-body">{body}</p>
    </div>
  )
}
