import { AppShell, ScreenHeader, ScreenState } from "@/components/app-shell"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/custom/table"
import { Nav } from "@/components/nav"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { AllotmentDetail as Allotment } from "@/lib/allotments"
import {
  allotmentDetail,
  cancelAllotment,
  detailStage,
  humanise,
  lineStage,
  STAGES,
} from "@/lib/allotments"
import { useIdentity } from "@/lib/identity"
import { units } from "@/lib/money"
import { cn } from "@/lib/utils"
import { ApiError } from "@itulah/contract/client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getRouteApi, useNavigate } from "@tanstack/react-router"
import { AlertTriangle, ArrowLeft } from "lucide-react"
import { useRef, useState } from "react"
import { AllotmentStatusDot } from "./columns"

const route = getRouteApi("/allotments/$allotmentId")

/// One Allotment: what was promised, how far it has got, and who is allowed to
/// move it.
///
/// The second question is the one this screen exists for. An Allotment is a
/// promise against stock that is still sitting in a warehouse, so "what has
/// happened to it" is not a status word — it is seven stage counts, an edge
/// node that may or may not have answered, and a cancellation that may have
/// been refused for goods already picked.
export function AllotmentDetailView() {
  const { allotmentId } = route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const identity = useIdentity()

  const allotment = useQuery({
    queryKey: ["allotments", allotmentId],
    queryFn: ({ signal }) => allotmentDetail(allotmentId, signal),
    refetchInterval: 60_000,
  })

  // One key per attempt, held across retries and rotated only once the server
  // has actually applied something: the route is idempotent on this key, so a
  // retried cancellation after a timeout releases the goods once.
  const cancelKey = useRef(crypto.randomUUID())

  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState("")
  const [tab, setTab] = useState<"lines" | "history" | "movements">("lines")

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["allotments"] })
  }

  const cancel = useMutation({
    mutationFn: (why: string) =>
      cancelAllotment(allotmentId, {
        reason: why,
        actor_id: identity.data?.username ?? "",
        idempotency_key: cancelKey.current,
      }),
    onSuccess: () => {
      cancelKey.current = crypto.randomUUID()
      setCancelling(false)
      setReason("")
      refresh()
    },
  })

  const back = (
    <Button variant="ghost" size="sm" onClick={() => void navigate({ to: "/allotments" })}>
      <ArrowLeft className="size-3.5" />
      Allotments
    </Button>
  )

  if (allotment.isPending) {
    return (
      <AppShell nav={<Nav />}>
        <ScreenHeader title="Allotment">{back}</ScreenHeader>
        <ScreenState>Loading the allotment…</ScreenState>
      </AppShell>
    )
  }

  if (allotment.isError) {
    return (
      <AppShell nav={<Nav />}>
        <ScreenHeader title="Allotment">{back}</ScreenHeader>
        <ScreenState
          tone="problem"
          action={
            <Button size="sm" variant="outline" onClick={() => void allotment.refetch()}>
              Try again
            </Button>
          }
        >
          {allotment.error instanceof ApiError
            ? allotment.error.message
            : "The allotment could not be loaded."}
        </ScreenState>
      </AppShell>
    )
  }

  const detail: Allotment = allotment.data
  // Nothing on this screen moves stock. Allotting reserves; the picking happens
  // in the warehouse that holds the goods, against the activation command this
  // Allotment sent there. Head office raises it, watches it, and can call it
  // off — that is the whole of what the centre does to an Allotment.
  const ownedByDc = detail.activation_target_origin_id !== null
  const open = detail.status === "ACTIVE" || detail.status === "IN_PROGRESS"
  const cancellationInFlight = detail.edge_cancellation_status === "PENDING"

  return (
    <AppShell nav={<Nav />}>
      <ScreenHeader
        title={<span className="font-mono">{detail.allotment_number}</span>}
        subtitle={`${humanise(detail.type)} · ${units(detail.total_quantity)} allotted`}
      >
        {open && !cancellationInFlight && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setCancelling(true)
              setReason("")
            }}
          >
            Cancel allotment
          </Button>
        )}
        {back}
      </ScreenHeader>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b px-3.5 py-2.5">
        <AllotmentStatusDot status={detail.status} />
        <Figure label="Allotted">{units(detail.total_quantity)}</Figure>
        {STAGES.map((stage) => (
          <Figure key={stage.key} label={stage.label}>
            {units(detailStage(detail, stage.key))}
          </Figure>
        ))}
        <Figure label="Cancelled">{units(detail.total_cancelled_quantity)}</Figure>
        <Figure label="Still reserved">{units(detail.remaining_quantity)}</Figure>
        <Figure label="Raised by">{detail.created_by}</Figure>
        <Figure label="Raised">{new Date(detail.created_at).toLocaleString("id-ID")}</Figure>
      </div>

      {/* Where the authority for these goods sits. Not a detail: it decides
          whether anything on this screen can move stock at all. */}
      <div className="flex flex-wrap items-center gap-2 border-b px-3.5 py-2 text-[11.5px]">
        {ownedByDc ? (
          <>
            <span className="text-muted-foreground">
              Picked at <span className="font-mono">{detail.activation_target_origin_id}</span>.
              The stages below are that warehouse reporting back.
            </span>
            <EdgeBadge status={detail.edge_application_status} />
          </>
        ) : (
          // Nobody is registered to pick it. Worth saying plainly rather than
          // leaving the stages at zero and letting somebody wait: this is a
          // topology problem, not a slow warehouse.
          <span className="text-amber-600">
            No DC is registered against this source site, so no warehouse has been asked to
            pick it.
          </span>
        )}
        {detail.notes !== null && detail.notes !== "" && (
          <span className="text-muted-foreground ml-auto italic">{detail.notes}</span>
        )}
      </div>

      {!detail.received_projection_consistent && (
        <Notice tone="warn">
          The received count and the tags matched to it disagree:{" "}
          {units(detail.total_received_quantity)} counted against{" "}
          {units(detail.total_received_breakdown_quantity)} matched. The projection and the
          evidence under it have come apart — both are shown per line below.
        </Notice>
      )}

      {detail.cancellation !== null && (
        <div className="border-b bg-muted/40 px-3.5 py-2">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11.5px]">
            <span className="font-medium">
              Cancellation {humanise(detail.cancellation.status ?? "requested").toLowerCase()}
            </span>
            <Figure label="Requested">{units(detail.cancellation.requested_quantity)}</Figure>
            <Figure label="Cancelled">
              {detail.cancellation.cancelled_quantity === null
                ? "—"
                : units(detail.cancellation.cancelled_quantity)}
            </Figure>
            {/* The number that makes a cancellation partial: goods already off
                the racks cannot be un-promised. */}
            <Figure label="Already picked">
              {detail.cancellation.blocked_picked_quantity === null
                ? "—"
                : units(detail.cancellation.blocked_picked_quantity)}
            </Figure>
            <Figure label="Asked by">{detail.cancellation.requested_by}</Figure>
            <Figure label="Asked">
              {new Date(detail.cancellation.requested_at).toLocaleString("id-ID")}
            </Figure>
          </div>
          <p className="text-muted-foreground pt-1 text-[11.5px] italic">
            {detail.cancellation.reason}
            {detail.cancellation.result_reason !== null &&
              ` — the DC answered: ${detail.cancellation.result_reason}`}
          </p>
        </div>
      )}

      {cancelling && (
        <div className="border-b bg-muted/40 px-3.5 py-2.5">
          <p className="text-[12px]">
            Release the {units(detail.remaining_quantity)} still reserved
            {ownedByDc
              ? ". The DC decides what it can still take back — anything already picked stays picked, and comes back as blocked."
              : "."}
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why is this allotment being cancelled?"
              aria-label="Reason for cancelling"
              className="h-8 min-w-64 flex-1 text-xs"
            />
            <Button
              size="sm"
              disabled={reason.trim() === "" || cancel.isPending}
              onClick={() => cancel.mutate(reason.trim())}
            >
              {cancel.isPending ? "Cancelling…" : "Cancel it"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCancelling(false)}>
              Leave it standing
            </Button>
          </div>
          {cancel.isError && (
            <p className="text-destructive pt-1 text-[11.5px]">
              {cancel.error instanceof ApiError
                ? cancel.error.message
                : "The allotment could not be cancelled."}
            </p>
          )}
        </div>
      )}

      <div className="flex shrink-0 gap-1 border-b px-3 py-1.5">
        {(["lines", "history", "movements"] as const).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            className={cn(
              "rounded-md px-2 py-1 text-[12px] capitalize transition-colors",
              tab === name
                ? "bg-muted text-foreground font-semibold"
                : "text-muted-foreground hover:bg-muted/60",
            )}
          >
            {name}
            <span className="ml-1.5 font-mono text-[10.5px] opacity-70">
              {name === "lines"
                ? detail.lines.length
                : name === "history"
                  ? detail.events.length
                  : detail.movements.length}
            </span>
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "lines" && (
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="hover:bg-transparent">
                <TableHead>SKU</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead className="text-right">Allotted</TableHead>
                {STAGES.map((stage) => (
                  <TableHead key={stage.key} className="text-right">
                    {stage.label}
                  </TableHead>
                ))}
                <TableHead className="text-right">Cancelled</TableHead>
                <TableHead className="text-right">Reserved</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium">
                          {line.article_name}
                        </div>
                        <div className="text-muted-foreground truncate font-mono text-[10.5px]">
                          {line.sku_code} · {line.article_code}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-[11px]">{line.source_pool_id}</TableCell>
                    <TableCell className="font-mono text-[11px]">
                      {line.destination_id}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {units(line.quantity)}
                    </TableCell>
                    {STAGES.map((stage) => (
                      <TableCell
                        key={stage.key}
                        className="text-muted-foreground text-right font-mono text-xs tabular-nums"
                      >
                        {units(lineStage(line, stage.key))}
                        {stage.key === "received" && !line.received_projection_consistent && (
                          <span className="block text-[10px] text-amber-600">
                            {units(line.received_breakdown_quantity)} tagged
                          </span>
                        )}
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {units(line.cancelled_quantity)}
                      {line.cancellation_blocked_picked_quantity !== null &&
                        line.cancellation_blocked_picked_quantity > 0 && (
                          <span className="block text-[10px] text-amber-600">
                            {units(line.cancellation_blocked_picked_quantity)} blocked
                          </span>
                        )}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-mono text-xs tabular-nums",
                        line.remaining_allotted > 0 && "text-amber-600",
                      )}
                    >
                      {units(line.remaining_allotted)}
                    </TableCell>
                  </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {tab === "history" && (
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="hover:bg-transparent">
                <TableHead>#</TableHead>
                <TableHead>Event</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                {/* Positive holds stock back, negative releases it. This column
                    is the reservation itself moving, which no other column
                    shows. */}
                <TableHead className="text-right">Reserved by it</TableHead>
                <TableHead>Where</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.events.map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="text-muted-foreground font-mono text-[11px]">
                    {event.sequence}
                  </TableCell>
                  <TableCell className="text-xs">{humanise(event.event_type)}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {units(event.quantity)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono text-xs tabular-nums",
                      event.remaining_delta < 0 && "text-emerald-600",
                      event.remaining_delta > 0 && "text-amber-600",
                    )}
                  >
                    {event.remaining_delta > 0 ? "+" : ""}
                    {units(event.remaining_delta)}
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-[10.5px]">
                    {event.source_pool_id ?? "—"}
                    {event.destination_id !== null && ` → ${event.destination_id}`}
                  </TableCell>
                  <TableCell className="text-xs">{event.actor_id}</TableCell>
                  <TableCell className="text-muted-foreground font-mono text-[10.5px]">
                    {new Date(event.occurred_at).toLocaleString("id-ID")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {tab === "movements" && (
          <>
            {detail.movements.length === 0 ? (
              <ScreenState>
                Nothing has moved yet. An Allotment reserves stock; it does not move it until
                somebody picks against it.
              </ScreenState>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow className="hover:bg-transparent">
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead>Cause</TableHead>
                    <TableHead>Who</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.movements.map((movement) => (
                    <TableRow key={movement.movement_id}>
                      <TableCell className="font-mono text-[10.5px]">{movement.from}</TableCell>
                      <TableCell className="font-mono text-[10.5px]">{movement.to}</TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {units(movement.quantity)}
                      </TableCell>
                      <TableCell className="text-xs">{humanise(movement.cause)}</TableCell>
                      <TableCell className="text-xs">{movement.actor_id}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-[10.5px]">
                        {new Date(movement.occurred_at).toLocaleString("id-ID")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </div>
    </AppShell>
  )
}

function EdgeBadge({ status }: { status: string | null }) {
  if (status === null) {
    return null
  }
  const tone =
    status === "ACCEPTED"
      ? "text-emerald-600"
      : status === "REJECTED"
        ? "text-destructive"
        : "text-amber-600"
  return (
    <span className={cn("font-mono text-[10.5px]", tone)}>
      {status === "PENDING" ? "not answered yet" : status.toLowerCase()}
    </span>
  )
}

function Notice({ tone, children }: { tone: "warn"; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 border-b px-3.5 py-2 text-[11.5px]",
        tone === "warn" && "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
      )}
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <p>{children}</p>
    </div>
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
