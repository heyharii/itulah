import { useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { ConfirmButton } from "@/components/ui/dialog"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner } from "@/components/ui/states"
import { count, day, money } from "@/lib/format"
import {
  flushOutbox,
  removeOrder,
  type OutboxJob,
} from "@/lib/offline/po-outbox"
import { useOnline } from "@/lib/offline/reference"
import type { PurchaseOrderRow } from "@/lib/queries/procurement"
import { pcs } from "@/screens/procurement/shared"

/// Orders made with no connection, as the Purchase Orders list shows them.
///
/// They stand in the list like any other order, near the top, with the status
/// "Offline" — or "Not sent" when the server read one and refused it —
/// and no number yet: the server gives that when the order arrives. Opening one
/// says why it has not gone, and lets the buyer send it now, take it back to
/// the form to correct, or give it up.

/// What marks a list row as a held order rather than one the server knows.
export const HELD_PREFIX = "outbox:"

export function isHeld(row: { readonly purchase_order_id: string }): boolean {
  return row.purchase_order_id.startsWith(HELD_PREFIX)
}

/// A held order as a row of the list: everything the list draws, from what the
/// form worked out when the buyer pressed Submit.
export function heldRow(job: OutboxJob): PurchaseOrderRow {
  return {
    purchase_order_id: `${HELD_PREFIX}${job.id}`,
    po_number: "—",
    supplier_id: job.supplier_id,
    supplier_name: job.supplier_name,
    destination_site_id: job.body.destination_site_id ?? "",
    lifecycle: job.state === "refused" ? "NOT_SENT" : "WAITING_TO_SEND",
    order_status: "",
    currency: "IDR",
    issued_at: job.created_at,
    expected_arrival: job.arrival,
    line_count: job.line_count,
    gross_minor: job.value_minor,
    discount_minor: 0,
    net_minor: job.value_minor,
    expected_stock_units: job.pieces,
    ordered_label: null,
    received_stock_units: 0,
    outstanding_stock_units: job.pieces,
    invoiced_stock_units: 0,
    excess_stock_units: 0,
    excess_pending_stock_units: 0,
    fully_received: false,
    received_value_minor: 0,
    fulfilled_at: null,
    updated_at: job.created_at,
    overdue: false,
  }
}

/// What the buyer typed on each line, for reading the order back.
function linesOf(job: OutboxJob): readonly {
  readonly name: string
  readonly said: string
}[] {
  const form = job.form as {
    draft?: {
      lines?: readonly {
        name: string
        quantity: string
        unit: string
        said?: string
      }[]
    }
  }
  return (form.draft?.lines ?? []).map((line) => ({
    name: line.name,
    said: line.said ?? `${line.quantity} ${line.unit.toLowerCase()}`,
  }))
}

export function HeldOrderSheet({
  job,
  onClose,
  onEdit,
}: {
  job: OutboxJob | null
  onClose: () => void
  /// Take the order back to the New PO form.
  onEdit: (job: OutboxJob) => void
}) {
  const client = useQueryClient()
  const online = useOnline()
  if (job === null) return null
  const refused = job.state === "refused"
  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={job.supplier_name}
      caption={refused ? "Not sent" : "Offline"}
      footer={
        <div className="flex items-center justify-between gap-2">
          <ConfirmButton
            label="Delete Order"
            title="Delete This Order?"
            description="It has not been sent, so it exists only on this device. Nothing else holds it."
            cancelLabel="Keep Order"
            confirmLabel="Delete Order"
            tone="danger"
            variant="ghost"
            onConfirm={async () => {
              await removeOrder(job.id)
              onClose()
            }}
          />
          <div className="flex items-center gap-2">
            <Button
              variant={refused ? "primary" : "ghost"}
              onClick={() => {
                onEdit(job)
                onClose()
              }}
            >
              Edit
            </Button>
            {!refused && (
              <Button
                variant="primary"
                disabled={!online || job.state === "sending"}
                onClick={() => {
                  void flushOutbox(client)
                  onClose()
                }}
              >
                Send Now
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {refused ? (
          <Banner tone="bad">
            The order was not accepted: {job.refusal ?? "no reason was given"}.
            Edit it and submit again.
          </Banner>
        ) : (
          <Banner tone="warn">
            {online
              ? "This order has not been sent yet. It goes by itself in a moment."
              : "This order is on this device. It will be sent by itself when you are back online."}
          </Banner>
        )}
        <Facts>
          <Fact term="Delivery Date">{day(job.arrival)}</Fact>
          <Fact term="Items">{count(job.line_count)}</Fact>
          <Fact term="Quantity">{pcs(job.pieces)}</Fact>
          <Fact term="Value">{money(job.value_minor)}</Fact>
        </Facts>
        <ul className="flex flex-col divide-y divide-hairline text-body">
          {linesOf(job).map((line, index) => (
            <li
              key={index}
              className="flex items-baseline justify-between gap-4 py-2.5"
            >
              <span className="min-w-0 truncate text-ink">{line.name}</span>
              <span className="whitespace-nowrap text-mute tabular-nums">
                {line.said}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  )
}
