import { ScreenState } from "@/components/app-shell"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/custom/table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type {
  AllotmentDetail as Allotment,
  AllotmentEvent,
  AllotmentLine,
  AllotmentMovement,
} from "@/lib/allotments"
import {
  cancelAllotment,
  detailStage,
  humanise,
  lineStage,
  STAGES,
} from "@/lib/allotments"
import { useIdentity } from "@/lib/identity"
import { units } from "@/lib/money"
import { dataTableFeatures } from "@/lib/table/features"
import { cn } from "@/lib/utils"
import { ApiError } from "@itulah/contract/client"
import { useForm } from "@tanstack/react-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { DataTableFeatures } from "@/lib/table/features"
import type {
  ColumnDef,
  ReactTable,
  RowData,
  SortingState,
} from "@tanstack/react-table"
import { flexRender, useTable } from "@tanstack/react-table"
import { AlertTriangle } from "lucide-react"
import { useMemo, useRef, useState } from "react"
import { AllotmentStatusDot } from "./columns"

/// Every row, always: the tables below are the whole of one Allotment, and a
/// second page of them would be a story told in halves.
const WHOLE_TABLE = { pageIndex: 0, pageSize: Number.MAX_SAFE_INTEGER }

/// One Allotment: what was promised, how far it has got, and who is allowed to
/// move it.
///
/// The second question is the one this screen exists for. An Allotment is a
/// promise against stock that is still sitting in a warehouse, so "what has
/// happened to it" is not a status word — it is seven stage counts, an edge
/// node that may or may not have answered, and a cancellation that may have
/// been refused for goods already picked.
/// Given the allotment rather than fetching it: the sheet around this already
/// asked for it to put the number in its header.
export function AllotmentPanel({ detail }: { detail: Allotment }) {
  const queryClient = useQueryClient()
  const identity = useIdentity()
  const allotmentId = detail.id

  // One key per attempt, held across retries and rotated only once the server
  // has actually applied something: the route is idempotent on this key, so a
  // retried cancellation after a timeout releases the goods once.
  const cancelKey = useRef(crypto.randomUUID())

  // Whether the cancellation box is open, and which table is on show, are
  // states of the screen rather than things anybody types and sends.
  const [cancelling, setCancelling] = useState(false)
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
      form.reset()
      refresh()
    },
  })

  /// The one thing typed on this screen. A cancellation without a reason is a
  /// warehouse being told to give stock back and nobody able to say why, so the
  /// button stays dead until there are words.
  const form = useForm({
    defaultValues: { reason: "" },
    onSubmit: ({ value }) => {
      cancel.mutate(value.reason.trim())
    },
  })

  const lines = useMemo<AllotmentLine[]>(
    () => [...detail.lines],
    [detail.lines]
  )
  const events = useMemo<AllotmentEvent[]>(
    () => [...detail.events],
    [detail.events]
  )
  const movements = useMemo<AllotmentMovement[]>(
    () => [...detail.movements],
    [detail.movements]
  )

  const [lineSorting, setLineSorting] = useState<SortingState>([])
  const [eventSorting, setEventSorting] = useState<SortingState>([])
  const [movementSorting, setMovementSorting] = useState<SortingState>([])

  /// A line is eleven figures wide once the stages are counted, and the
  /// question asked of it — which SKU is furthest behind, which store is owed
  /// most — is a sort. The stage columns are generated from `STAGES` so the
  /// table cannot drift from the totals in the strip above it.
  const lineColumns = useMemo<
    ColumnDef<typeof dataTableFeatures, AllotmentLine>[]
  >(
    () => [
      {
        accessorKey: "sku_code",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="SKU" />
        ),
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium">
              {row.original.article_name}
            </div>
            <div className="truncate font-mono text-[10.5px] text-muted-foreground">
              {row.original.sku_code} · {row.original.article_code}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "source_pool_id",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="From" />
        ),
        cell: ({ row }) => (
          <span className="font-mono text-[11px]">
            {row.original.source_pool_id}
          </span>
        ),
      },
      {
        accessorKey: "destination_id",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="To" />
        ),
        cell: ({ row }) => (
          <span className="font-mono text-[11px]">
            {row.original.destination_id}
          </span>
        ),
      },
      {
        accessorKey: "quantity",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Allotted" align="end" />
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs tabular-nums">
            {units(row.original.quantity)}
          </div>
        ),
      },
      ...STAGES.map(
        (stage): ColumnDef<typeof dataTableFeatures, AllotmentLine> => ({
          id: stage.key,
          accessorFn: (line: AllotmentLine) => lineStage(line, stage.key),
          header: ({ column }) => (
            <DataTableColumnHeader
              column={column}
              title={stage.label}
              align="end"
            />
          ),
          cell: ({ row }) => (
            <div className="text-right font-mono text-xs text-muted-foreground tabular-nums">
              {units(lineStage(row.original, stage.key))}
              {stage.key === "received" &&
                !row.original.received_projection_consistent && (
                  <span className="block text-[10px] text-amber-600">
                    {units(row.original.received_breakdown_quantity)} tagged
                  </span>
                )}
            </div>
          ),
        })
      ),
      {
        accessorKey: "cancelled_quantity",
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title="Cancelled"
            align="end"
          />
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs tabular-nums">
            {units(row.original.cancelled_quantity)}
            {row.original.cancellation_blocked_picked_quantity !== null &&
              row.original.cancellation_blocked_picked_quantity > 0 && (
                <span className="block text-[10px] text-amber-600">
                  {units(row.original.cancellation_blocked_picked_quantity)}{" "}
                  blocked
                </span>
              )}
          </div>
        ),
      },
      {
        accessorKey: "remaining_allotted",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Reserved" align="end" />
        ),
        cell: ({ row }) => (
          <div
            className={cn(
              "text-right font-mono text-xs tabular-nums",
              row.original.remaining_allotted > 0 && "text-amber-600"
            )}
          >
            {units(row.original.remaining_allotted)}
          </div>
        ),
      },
    ],
    []
  )

  const eventColumns = useMemo<
    ColumnDef<typeof dataTableFeatures, AllotmentEvent>[]
  >(
    () => [
      {
        accessorKey: "sequence",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="#" />
        ),
        cell: ({ row }) => (
          <span className="font-mono text-[11px] text-muted-foreground">
            {row.original.sequence}
          </span>
        ),
      },
      {
        accessorKey: "event_type",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Event" />
        ),
        cell: ({ row }) => (
          <span className="text-xs">{humanise(row.original.event_type)}</span>
        ),
      },
      {
        accessorKey: "quantity",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Quantity" align="end" />
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs tabular-nums">
            {units(row.original.quantity)}
          </div>
        ),
      },
      {
        accessorKey: "remaining_delta",
        header: ({ column }) => (
          // Positive holds stock back, negative releases it. This column is the
          // reservation itself moving, which no other column shows.
          <DataTableColumnHeader
            column={column}
            title="Reserved by it"
            align="end"
          />
        ),
        cell: ({ row }) => (
          <div
            className={cn(
              "text-right font-mono text-xs tabular-nums",
              row.original.remaining_delta < 0 && "text-emerald-600",
              row.original.remaining_delta > 0 && "text-amber-600"
            )}
          >
            {row.original.remaining_delta > 0 ? "+" : ""}
            {units(row.original.remaining_delta)}
          </div>
        ),
      },
      {
        id: "where",
        header: "Where",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="font-mono text-[10.5px] text-muted-foreground">
            {row.original.source_pool_id ?? "—"}
            {row.original.destination_id !== null &&
              ` → ${row.original.destination_id}`}
          </span>
        ),
      },
      {
        accessorKey: "actor_id",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Who" />
        ),
        cell: ({ row }) => (
          <span className="text-xs">{row.original.actor_id}</span>
        ),
      },
      {
        accessorKey: "occurred_at",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="When" />
        ),
        cell: ({ row }) => (
          <span className="font-mono text-[10.5px] text-muted-foreground">
            {new Date(row.original.occurred_at).toLocaleString("id-ID")}
          </span>
        ),
      },
    ],
    []
  )

  const movementColumns = useMemo<
    ColumnDef<typeof dataTableFeatures, AllotmentMovement>[]
  >(
    () => [
      {
        accessorKey: "from",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="From" />
        ),
        cell: ({ row }) => (
          <span className="font-mono text-[10.5px]">{row.original.from}</span>
        ),
      },
      {
        accessorKey: "to",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="To" />
        ),
        cell: ({ row }) => (
          <span className="font-mono text-[10.5px]">{row.original.to}</span>
        ),
      },
      {
        accessorKey: "quantity",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Quantity" align="end" />
        ),
        cell: ({ row }) => (
          <div className="text-right font-mono text-xs tabular-nums">
            {units(row.original.quantity)}
          </div>
        ),
      },
      {
        accessorKey: "cause",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Cause" />
        ),
        cell: ({ row }) => (
          <span className="text-xs">{humanise(row.original.cause)}</span>
        ),
      },
      {
        accessorKey: "actor_id",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Who" />
        ),
        cell: ({ row }) => (
          <span className="text-xs">{row.original.actor_id}</span>
        ),
      },
      {
        accessorKey: "occurred_at",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="When" />
        ),
        cell: ({ row }) => (
          <span className="font-mono text-[10.5px] text-muted-foreground">
            {new Date(row.original.occurred_at).toLocaleString("id-ID")}
          </span>
        ),
      },
    ],
    []
  )

  const lineTable = useTable(
    useMemo(
      () => ({
        features: dataTableFeatures,
        data: lines,
        columns: lineColumns,
        getRowId: (row: AllotmentLine) => row.id,
        state: { sorting: lineSorting, pagination: WHOLE_TABLE },
        onSortingChange: setLineSorting,
      }),
      [lines, lineColumns, lineSorting]
    )
  )

  const eventTable = useTable(
    useMemo(
      () => ({
        features: dataTableFeatures,
        data: events,
        columns: eventColumns,
        getRowId: (row: AllotmentEvent) => row.id,
        state: { sorting: eventSorting, pagination: WHOLE_TABLE },
        onSortingChange: setEventSorting,
      }),
      [events, eventColumns, eventSorting]
    )
  )

  const movementTable = useTable(
    useMemo(
      () => ({
        features: dataTableFeatures,
        data: movements,
        columns: movementColumns,
        getRowId: (row: AllotmentMovement) => row.movement_id,
        state: { sorting: movementSorting, pagination: WHOLE_TABLE },
        onSortingChange: setMovementSorting,
      }),
      [movements, movementColumns, movementSorting]
    )
  )

  // Nothing on this screen moves stock. Allotting reserves; the picking happens
  // in the warehouse that holds the goods, against the activation command this
  // Allotment sent there. Head office raises it, watches it, and can call it
  // off — that is the whole of what the centre does to an Allotment.
  const ownedByDc = detail.activation_target_origin_id !== null
  const open = detail.status === "ACTIVE" || detail.status === "IN_PROGRESS"
  const cancellationInFlight = detail.edge_cancellation_status === "PENDING"

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b px-3.5 py-2.5">
        <AllotmentStatusDot status={detail.status} />
        <Figure label="Allotted">{units(detail.total_quantity)}</Figure>
        {STAGES.map((stage) => (
          <Figure key={stage.key} label={stage.label}>
            {units(detailStage(detail, stage.key))}
          </Figure>
        ))}
        <Figure label="Cancelled">
          {units(detail.total_cancelled_quantity)}
        </Figure>
        <Figure label="Still reserved">
          {units(detail.remaining_quantity)}
        </Figure>
        <Figure label="Raised by">{detail.created_by}</Figure>
        <Figure label="Raised">
          {new Date(detail.created_at).toLocaleString("id-ID")}
        </Figure>
      </div>

      {/* Where the authority for these goods sits. Not a detail: it decides
          whether anything on this screen can move stock at all. */}
      <div className="flex flex-wrap items-center gap-2 border-b px-3.5 py-2 text-[11.5px]">
        {ownedByDc ? (
          <>
            <span className="text-muted-foreground">
              Picked at{" "}
              <span className="font-mono">
                {detail.activation_target_origin_id}
              </span>
              . The stages below are that warehouse reporting back.
            </span>
            <EdgeBadge status={detail.edge_application_status} />
          </>
        ) : (
          // Nobody is registered to pick it. Worth saying plainly rather than
          // leaving the stages at zero and letting somebody wait: this is a
          // topology problem, not a slow warehouse.
          <span className="text-amber-600">
            No DC is registered against this source site, so no warehouse has
            been asked to pick it.
          </span>
        )}
        {detail.notes !== null && detail.notes !== "" && (
          <span className="text-muted-foreground italic">{detail.notes}</span>
        )}
        {/* Beside the sentence about who may move these goods rather than up
            in the sheet's header, because calling an allotment off is the same
            subject: it is the one thing the centre can do to stock a warehouse
            is holding. */}
        {open && !cancellationInFlight && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => {
              setCancelling(true)
              form.reset()
            }}
          >
            Cancel allotment
          </Button>
        )}
      </div>

      {!detail.received_projection_consistent && (
        <Notice tone="warn">
          The received count and the tags matched to it disagree:{" "}
          {units(detail.total_received_quantity)} counted against{" "}
          {units(detail.total_received_breakdown_quantity)} matched. The
          projection and the evidence under it have come apart — both are shown
          per line below.
        </Notice>
      )}

      {detail.cancellation !== null && (
        <div className="border-b bg-muted/40 px-3.5 py-2">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11.5px]">
            <span className="font-medium">
              Cancellation{" "}
              {humanise(
                detail.cancellation.status ?? "requested"
              ).toLowerCase()}
            </span>
            <Figure label="Requested">
              {units(detail.cancellation.requested_quantity)}
            </Figure>
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
              {new Date(detail.cancellation.requested_at).toLocaleString(
                "id-ID"
              )}
            </Figure>
          </div>
          <p className="pt-1 text-[11.5px] text-muted-foreground italic">
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
            <form.Field name="reason">
              {(field) => (
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="Why is this allotment being cancelled?"
                  aria-label="Reason for cancelling"
                  className="h-8 min-w-64 flex-1 text-xs"
                />
              )}
            </form.Field>
            <form.Subscribe selector={(state) => state.values.reason.trim()}>
              {(reason) => (
                <Button
                  size="sm"
                  disabled={reason === "" || cancel.isPending}
                  onClick={() => void form.handleSubmit()}
                >
                  {cancel.isPending ? "Cancelling…" : "Cancel it"}
                </Button>
              )}
            </form.Subscribe>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCancelling(false)}
            >
              Leave it standing
            </Button>
          </div>
          {cancel.isError && (
            <p className="pt-1 text-[11.5px] text-destructive">
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
                ? "bg-muted font-semibold text-foreground"
                : "text-muted-foreground hover:bg-muted/60"
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
        {tab === "lines" && <Grid table={lineTable} />}

        {tab === "history" && <Grid table={eventTable} />}

        {tab === "movements" &&
          (detail.movements.length === 0 ? (
            <ScreenState>
              Nothing has moved yet. An Allotment reserves stock; it does not
              move it until somebody picks against it.
            </ScreenState>
          ) : (
            <Grid table={movementTable} />
          ))}
      </div>
    </>
  )
}

/// One table, drawn from its column definitions.
///
/// The three tabs are three different shapes of row, but the drawing of them is
/// the same drawing — headers that sort, cells that flex-render — so it is
/// written once here rather than three times inline.
function Grid<TData extends RowData>({
  table,
}: {
  // `ReactTable`, not the core `Table`, and pinned to the block's own feature
  // set: v9 declares `TFeatures` invariant, so a component generic over it
  // cannot resolve a single feature's API.
  table: ReactTable<DataTableFeatures, TData>
}) {
  return (
    <Table>
      <TableHeader className="bg-muted/50">
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id} className="hover:bg-transparent">
            {headerGroup.headers.map((header) => (
              <TableHead key={header.id}>
                {header.isPlaceholder
                  ? null
                  : flexRender(
                      header.column.columnDef.header,
                      header.getContext()
                    )}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.id}>
            {row.getVisibleCells().map((cell) => (
              <TableCell key={cell.id}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
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

function Notice({
  tone,
  children,
}: {
  tone: "warn"
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 border-b px-3.5 py-2 text-[11.5px]",
        tone === "warn" &&
          "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
      )}
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <p>{children}</p>
    </div>
  )
}

function Figure({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <span className="flex flex-col">
      <span className="text-[10.5px] tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <span className="font-mono text-xs tabular-nums">{children}</span>
    </span>
  )
}
