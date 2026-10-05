import { AppShell, ScreenBody, ScreenHeader, ScreenState } from "@/components/app-shell"
import { Nav } from "@/components/nav"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useIdentity } from "@/lib/identity"
import { money } from "@/lib/money"
import {
  decidePriceAmendment,
  pendingPriceAmendments,
  type PriceAmendment,
  type PriceAmendmentOutcome,
} from "@/lib/purchase-orders"
import { cn } from "@/lib/utils"
import { ApiError } from "@itulah/contract/client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

/// Deliveries waiting on head office to answer a price.
///
/// A warehouse took a delivery, the invoice said a different number than the
/// order, and it asked. Until somebody answers, the question sits here and the
/// DC has an open count it cannot finish. That is why this is a screen and not
/// a report: the queue is a queue of blocked work, not a list of curiosities.
export function PriceAmendmentsView() {
  const queryClient = useQueryClient()
  const identity = useIdentity()
  const amendments = useQuery({
    queryKey: ["purchase-price-amendments"],
    queryFn: ({ signal }) => pendingPriceAmendments(signal),
  })

  const [notes, setNotes] = useState<Record<string, string>>({})

  const decide = useMutation({
    mutationFn: ({
      requestId,
      outcome,
    }: {
      requestId: string
      outcome: PriceAmendmentOutcome
    }) =>
      decidePriceAmendment(
        requestId,
        outcome,
        identity.data?.username ?? "",
        notes[requestId]?.trim() || null,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["purchase-price-amendments"] })
      void queryClient.invalidateQueries({ queryKey: ["purchase-orders"] })
    },
  })

  const rows = amendments.data ?? []

  return (
    <AppShell data-cloudhub nav={<Nav />}>
      <ScreenHeader
        eyebrow="Buying"
        title="Price amendments"
        subtitle={
          amendments.isPending
            ? "loading…"
            : `${rows.length} waiting${rows.length === 0 ? "" : " on an answer"}`
        }
      />

      {decide.isError && (
        <div className="text-destructive border-b px-3.5 py-2 text-[11.5px]">
          {decide.error instanceof ApiError
            ? decide.error.message
            : "The decision could not be recorded."}
        </div>
      )}

      <ScreenBody>
        {amendments.isPending ? (
          <ScreenState>Loading the queue…</ScreenState>
        ) : amendments.isError ? (
          <ScreenState
            tone="problem"
            action={
              <Button size="sm" variant="outline" onClick={() => void amendments.refetch()}>
                Try again
              </Button>
            }
          >
            {amendments.error instanceof ApiError
              ? amendments.error.message
              : "The queue could not be loaded."}
          </ScreenState>
        ) : rows.length === 0 ? (
          <ScreenState>
            Nothing is waiting. The Gudang raises one of these when a supplier's invoice
            disagrees with what the order says.
          </ScreenState>
        ) : (
          <ul className="divide-y">
            {rows.map((row) => (
              <AmendmentRow
                key={row.request_id}
                row={row}
                note={notes[row.request_id] ?? ""}
                onNote={(value) =>
                  setNotes((current) => ({ ...current, [row.request_id]: value }))
                }
                busy={decide.isPending}
                canDecide={identity.data !== undefined}
                onDecide={(outcome) => decide.mutate({ requestId: row.request_id, outcome })}
              />
            ))}
          </ul>
        )}
      </ScreenBody>
    </AppShell>
  )
}

function AmendmentRow({
  row,
  note,
  onNote,
  busy,
  canDecide,
  onDecide,
}: {
  row: PriceAmendment
  note: string
  onNote: (value: string) => void
  busy: boolean
  canDecide: boolean
  onDecide: (outcome: PriceAmendmentOutcome) => void
}) {
  // Above the agreed price is the case that costs money; below it is still a
  // disagreement and still needs answering, so both are shown with a sign
  // rather than only the expensive one.
  const dearer = row.difference_minor > 0
  return (
    <li className="flex flex-col gap-3 p-3.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-xs font-semibold">{row.po_number}</span>
        <span className="text-[13px] font-medium">{row.article_name}</span>
        <span className="text-muted-foreground font-mono text-[10.5px]">{row.article_code}</span>
        <span className="text-muted-foreground ml-auto text-[11px]">
          {row.requested_by} at {row.origin_id} ·{" "}
          {new Date(row.requested_at).toLocaleString("id-ID")}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Figure label="Ordered">{money(row.ordered_price_minor)}</Figure>
        <Figure label="Invoiced">{money(row.invoiced_price_minor)}</Figure>
        <Figure label="Difference">
          <span className={cn(dearer ? "text-destructive" : "text-[var(--os-ok,#059669)]")}>
            {dearer ? "+" : "−"}
            {money(Math.abs(row.difference_minor))}
          </span>
        </Figure>
      </div>

      {row.note.trim() !== "" && (
        <p className="bg-muted/50 rounded-md px-2.5 py-2 text-[12px]">{row.note}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={note}
          onChange={(event) => onNote(event.target.value)}
          placeholder="Why (kept on the record either way)…"
          aria-label={`Note for ${row.po_number}`}
          className="h-8 min-w-56 flex-1 text-xs"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !canDecide}
          onClick={() => onDecide("Rejected")}
        >
          Reject
        </Button>
        <Button size="sm" disabled={busy || !canDecide} onClick={() => onDecide("Approved")}>
          Approve
        </Button>
      </div>

      <p className="text-muted-foreground text-[10.5px]">
        Approving changes the order's price to the invoice and tells {row.origin_id} in the same
        step. Rejecting leaves the order as it stands — the Gudang may still accept the
        delivery, and the disagreement is on record against the supplier.
      </p>
    </li>
  )
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex flex-col">
      <span className="text-muted-foreground text-[10.5px] tracking-wide uppercase">{label}</span>
      <span className="font-mono text-xs tabular-nums">{children}</span>
    </span>
  )
}
