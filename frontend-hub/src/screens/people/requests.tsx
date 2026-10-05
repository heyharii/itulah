import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { ButtonGroup, Toolbar } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { useFilters } from "@/lib/filters"
import { day, moment } from "@/lib/format"
import {
  boundedTo,
  decideCorrection,
  decideSwap,
  listCorrections,
  listEmployees,
  nextKeys,
  peopleKeys,
  pendingSwaps,
  punchKeys,
  decideLeave,
  leaveKeys,
  pendingLeave,
  rosterKeys,
  useReach,
  type RosterSwapView,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { AppLink } from "@/components/ui/app-link"
import type { CorrectionRow, LeaveRequestView } from "@itulah/contract"

/// One queue, not three — drawn on the People overview.
///
/// A manager does not have a "leave task" and a "correction task" and an
/// "overtime task" — they have five minutes and a list of things waiting on
/// them. Three screens each holding two rows is how all three stop being
/// opened. So everything a manager decides is decided here: leave, attendance
/// corrections and roster swaps, each its own table because each is judged on
/// different facts, all opening into the same sheet with the same two verbs.
///
/// This was its own screen, Requests, beside an Overview that listed the same
/// leave again. The owner asked for a shorter menu on 2026-09-27, and two
/// front doors onto one queue were one too many: the tables are drawn under
/// the Overview's attention list now, and the overtime orders and expense
/// claims that were banners here are rows in that list.
///
/// Corrections were a banner too, pointing at the attendance screen. That
/// stopped being enough the day head office's own staff came into the
/// module: somebody posted at `ho` has no till, so the hub is the only place
/// their correction or their swap can be answered — and a queue that could
/// only count them left those with nowhere to be decided at all.
///
/// The list is bounded by the caller's own posting, on the server. A manager
/// posted to store-07 is served store-07's requests and nothing else, and head
/// office is served every place's — the same reach the Directory is bounded by,
/// asked of a different row. Nothing here re-implements that rule: a screen
/// that filtered by place itself would be a second place the bound is decided,
/// and the day the two disagreed the screen would be the one that looked right.
///
/// Every decision carries a reason. The server refuses one without it, because
/// "refused" with no reason is the half of an audit trail that never helps
/// anybody — least of all the person who was refused. It also refuses a
/// decision by the person who filed the request, and says so in its own words;
/// the sheet shows that sentence rather than hiding the buttons, because a
/// screen guessing who filed what would be a second copy of the rule.
///
/// # Overtime is here to be seen, not to be decided
///
/// It appears in the queue because a manager needs to know an order is sitting
/// unanswered — an order nobody answers authorizes nothing, so it is overtime
/// that will be worked unpaid or not worked at all. But the decision is not
/// theirs: PP 35/2021 art. 26(2) wants the worker's own agreement, and it
/// arrives from their phone under a key nobody here holds. So the Overview's
/// rows for them link to the Overtime screen rather than opening a sheet with
/// buttons in it.

/// A leave request, with the name of the person it is for.
type LeaveRow = LeaveRequestView & { readonly name: string }

/// A swap, with the names of both people whose day it moves.
type SwapRow = RosterSwapView & {
  readonly name: string
  readonly withName: string
}

const columns: ColumnDef<TableSetup, LeaveRow>[] = [
  {
    id: "who",
    accessorFn: (row) => row.name,
    header: "Employee",
    size: 200,
    // No filter: narrowing a queue by one person would mean already knowing
    // whose request you were looking for, which is the opposite of what a
    // queue is read for.
    cell: ({ row }) => (
      <Who id={row.original.employee_id} name={row.original.name} />
    ),
  },
  {
    accessorKey: "leave_type_name",
    header: "Kind",
    size: 180,
    /// The leave types actually waiting, faceted off the queue: five minutes
    /// and a list of things is exactly the situation where "just the sick
    /// leave" is worth one click.
    meta: { filter: { kind: "option" } },
  },
  {
    id: "when",
    accessorFn: (row) => row.from_date,
    header: "From",
    size: 130,
    /// Two date columns filtered separately, and that is the point: "starts
    /// before Friday" and "ends after Friday" together are the request that
    /// spans the day the shop is short-handed.
    meta: { filter: { kind: "date" } },
    cell: ({ row }) => day(row.original.from_date),
  },
  {
    id: "until",
    accessorFn: (row) => row.to_date,
    header: "To",
    size: 130,
    meta: { filter: { kind: "date" } },
    cell: ({ row }) => day(row.original.to_date),
  },
  {
    accessorKey: "chargeable_days",
    header: "Charged",
    size: 110,
    meta: { align: "right", filter: { kind: "number", unit: "days" } },
    /// The days actually charged, which is not the length of the span: a *cuti
    /// bersama* inside it is already taken out of the twelve by the calendar,
    /// and charging it again would take the same day off the employee twice.
    /// Settled by the server on the day the request was filed.
    cell: ({ row }) => row.original.chargeable_days,
  },
  {
    accessorKey: "unit_id",
    header: "Unit",
    size: 130,
    /// Faceted from the queue itself, never from a places list: the server has
    /// already bounded these rows to the caller's own reach, so the places
    /// present here are exactly the places they may narrow by — and the ids on
    /// these rows are the only spelling that matches them.
    meta: { filter: { kind: "option" } },
  },
]

const correctionColumns: ColumnDef<TableSetup, CorrectionRow>[] = [
  {
    id: "who",
    accessorFn: (row) => row.display_name,
    header: "Employee",
    size: 200,
  },
  {
    id: "when",
    accessorFn: (row) => row.business_date,
    header: "Day",
    size: 130,
    cell: ({ row }) => day(row.original.business_date),
  },
  {
    id: "effect",
    accessorFn: (row) => effectLabel(row.effect),
    header: "Claims",
    size: 170,
  },
  {
    id: "arrival",
    accessorFn: (row) => row.corrected_arrival,
    header: "Arrived",
    size: 110,
    cell: ({ row }) => correctedTime(row.original.corrected_arrival),
  },
  {
    id: "departure",
    accessorFn: (row) => row.corrected_departure,
    header: "Left",
    size: 130,
    cell: ({ row }) => correctedTime(row.original.corrected_departure),
  },
  { accessorKey: "reason", header: "Reason", size: 240 },
  { accessorKey: "unit_id", header: "Unit", size: 130 },
]

const swapColumns: ColumnDef<TableSetup, SwapRow>[] = [
  {
    id: "who",
    accessorFn: (row) => row.name,
    header: "Employee",
    size: 200,
    cell: ({ row }) => (
      <Who id={row.original.employee_id} name={row.original.name} />
    ),
  },
  {
    id: "with",
    accessorFn: (row) => row.withName,
    header: "Swaps with",
    size: 200,
    cell: ({ row }) => (
      <Who id={row.original.with_employee_id} name={row.original.withName} />
    ),
  },
  {
    id: "when",
    accessorFn: (row) => row.on_date,
    header: "Day",
    size: 130,
    cell: ({ row }) => day(row.original.on_date),
  },
  { accessorKey: "reason", header: "Reason", size: 240 },
  { accessorKey: "unit_id", header: "Unit", size: 130 },
]

export function RequestQueues() {
  const request = useSheet("request")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "when", desc: false },
  ])
  const reach = useReach()
  const bounded = boundedTo(reach.data)
  const nameOf = useNames()

  const queue = useQuery({
    queryKey: leaveKeys.pending(),
    queryFn: ({ signal }) => pendingLeave(signal),
  })
  /// No place asked for: the server bounds the queue by the caller's own
  /// posting, and `boundedTo` is a place's *name* for the header, which the
  /// route would read as a place it does not know.
  const corrections = useQuery({
    queryKey: punchKeys.corrections(null, true),
    queryFn: ({ signal }) => listCorrections({ pending: true }, signal),
  })
  const swaps = useQuery({
    queryKey: nextKeys.pendingSwaps(),
    queryFn: ({ signal }) => pendingSwaps(signal),
  })

  const rows = useMemo(
    () =>
      (queue.data ?? []).map((row) => ({
        ...row,
        name: nameOf(row.employee_id),
      })),
    [queue.data, nameOf]
  )
  const swapRows = useMemo(
    () =>
      (swaps.data ?? []).map((row) => ({
        ...row,
        name: nameOf(row.employee_id),
        withName: nameOf(row.with_employee_id),
      })),
    [swaps.data, nameOf]
  )

  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: LeaveRow) => row.id,
        state: { columnFilters: filters.columnFilters, sorting },
        onSortingChange: setSorting,
      }),
      [rows, filters.columns, filters.columnFilters, sorting]
    )
  )

  // One sheet key for all three kinds: the value is a request id, and ids are
  // minted per kind, so it can only ever be found in one of the three lists.
  const open = rows.find((row) => row.id === request.value) ?? null
  const openCorrection =
    corrections.data?.find((row) => row.id === request.value) ?? null
  const openSwap = swapRows.find((row) => row.id === request.value) ?? null

  return (
    <>
      <Toolbar>
        <FilterPanel model={filters} table={table} />
      </Toolbar>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Leave</CardTitle>
        </CardHeader>
        {queryState(queue, {
          loading: "Reading the queue…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {bounded === null
                  ? "No leave anywhere is waiting on a decision."
                  : `No leave at ${bounded} is waiting on a decision.`}
              </EmptyState>
            ) : (
              <DataTable<LeaveRow>
                table={table}
                onRowClick={(row) => request.open(row.id)}
                isSelected={(row) => row.id === request.value}
                // A queue narrowed to nothing is not an empty queue, and on
                // this screen the difference is somebody's leave waiting
                // unanswered behind a clause they forgot was there.
                empty={
                  <>
                    {rows.length.toLocaleString("id-ID")} requests are waiting,
                    and none of them match the filters in force.
                  </>
                }
              />
            ),
        })}
      </Card>

      <CorrectionQueue
        query={corrections}
        selected={request.value}
        onOpen={request.open}
      />
      <SwapQueue
        query={swaps}
        rows={swapRows}
        selected={request.value}
        onOpen={request.open}
      />

      <RequestSheet key={open?.id} request={open} onClose={request.close} />
      <CorrectionSheet
        key={openCorrection?.id}
        correction={openCorrection}
        onClose={request.close}
      />
      <SwapSheet key={openSwap?.id} swap={openSwap} onClose={request.close} />
    </>
  )
}

/// Employee id → name, out of the workforce list the Leave screen already
/// holds under the same key, so on most visits this is a cache hit rather than
/// a request. Somebody the list does not carry — past the thousandth, or no
/// longer active — is shown by id rather than not shown.
function useNames(): (id: string) => string {
  const team = useQuery({
    queryKey: peopleKeys.employees({ status: "ACTIVE", limit: 1000 }),
    queryFn: ({ signal }) =>
      listEmployees({ status: "ACTIVE", limit: 1000 }, signal),
  })
  return useMemo(() => {
    const names = new Map(
      (team.data ?? []).map((person) => [
        person.employee_id,
        person.full_name ?? person.employee_code,
      ])
    )
    return (id: string) => names.get(id) ?? id
  }, [team.data])
}

/// A name, or the id set as one when no name was found — so a uuid never
/// passes for somebody's name.
function Who({ id, name }: { id: string; name: string }) {
  return name === id ? (
    <span className="font-mono text-id text-body">{id}</span>
  ) : (
    <span className="text-body">{name}</span>
  )
}

/// What a correction claims, in words. A code this screen has not been taught
/// is shown as the server spelled it rather than given a guessed name.
function effectLabel(code: string): string {
  switch (code) {
    case "ARRIVAL":
      return "Arrival"
    case "DEPARTURE":
      return "Departure"
    case "ARRIVAL_AND_DEPARTURE":
      return "Arrival and departure"
    case "APPROVED_LEAVE":
      return "Approved leave"
    default:
      return code
  }
}

/// A corrected time as the server writes it — `2026-09-20 08:15`, or
/// `… 02:00+1` for a departure past midnight. The date is the row's own
/// business date, so only the time is drawn; the `+1` is kept in words,
/// because it is the difference between a two-hour shift and a twenty-six.
function correctedTime(value: string | null): string {
  if (value === null) return "—"
  const time = value.slice(value.indexOf(" ") + 1)
  return time.endsWith("+1") ? `${time.slice(0, -2)} next day` : time
}

/// Attendance corrections waiting on a decision.
///
/// Fingerprint is the only way in, by the owner's decision — no PIN, no card.
/// So a correction is the *only* route by which a real day of work the reader
/// failed to see becomes a real day of work again. An unanswered one is
/// somebody's day quietly missing from the month their pay is built on.
///
/// Drawn only when something is waiting, like the banners: an empty card for
/// a kind of request that rarely comes is a card people learn to scroll past.
function CorrectionQueue({
  query,
  selected,
  onOpen,
}: {
  query: UseQueryResult<CorrectionRow[]>
  selected: string | undefined
  onOpen: (id: string) => void
}) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "when", desc: false },
  ])
  const rows = useMemo(() => query.data ?? [], [query.data])
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: correctionColumns,
        getRowId: (row: CorrectionRow) => row.id,
        state: { sorting },
        onSortingChange: setSorting,
      }),
      [rows, sorting]
    )
  )
  if (query.isPending || (query.isSuccess && rows.length === 0)) return null

  return (
    <Card className="mt-4 overflow-hidden">
      <CardHeader>
        <CardTitle>Attendance corrections</CardTitle>
      </CardHeader>
      {queryState(query, {
        render: () => (
          <DataTable<CorrectionRow>
            table={table}
            onRowClick={(row) => onOpen(row.id)}
            isSelected={(row) => row.id === selected}
          />
        ),
      })}
    </Card>
  )
}

/// Roster swaps waiting on a decision. Drawn only when one is, for the same
/// reason as the corrections above.
function SwapQueue({
  query,
  rows,
  selected,
  onOpen,
}: {
  query: UseQueryResult<RosterSwapView[]>
  rows: SwapRow[]
  selected: string | undefined
  onOpen: (id: string) => void
}) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "when", desc: false },
  ])
  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: swapColumns,
        getRowId: (row: SwapRow) => row.id,
        state: { sorting },
        onSortingChange: setSorting,
      }),
      [rows, sorting]
    )
  )
  if (query.isPending || (query.isSuccess && rows.length === 0)) return null

  return (
    <Card className="mt-4 overflow-hidden">
      <CardHeader>
        <CardTitle>Roster swaps</CardTitle>
      </CardHeader>
      {queryState(query, {
        render: () => (
          <DataTable<SwapRow>
            table={table}
            onRowClick={(row) => onOpen(row.id)}
            isSelected={(row) => row.id === selected}
          />
        ),
      })}
    </Card>
  )
}

/// The half of every sheet here that decides: a reason, then one of two verbs.
///
/// One component for three kinds of request because the rule is one rule. The
/// server's refusal is shown as it was written — "the requester may not decide
/// their own swap" is already the sentence the reader needs.
function Verdict({
  reason,
  onReason,
  busy,
  failed,
  onDecide,
}: {
  reason: string
  onReason: (reason: string) => void
  busy: boolean
  failed: string | null
  onDecide: (approve: boolean) => void
}) {
  const ready = reason.trim() !== ""
  return (
    <>
      {failed !== null && (
        <Banner tone="bad" className="mt-4">
          {failed}
        </Banner>
      )}

      <div className="mt-4 flex flex-col gap-3">
        <Field
          label="Why"
          hint="Recorded against the decision, and required."
          required
        >
          <Input
            value={reason}
            onChange={(event) => onReason(event.target.value)}
          />
        </Field>
        <ButtonGroup>
          <Button
            variant="primary"
            disabled={!ready || busy}
            onClick={() => onDecide(true)}
          >
            Approve
          </Button>
          <Button
            variant="danger"
            disabled={!ready || busy}
            onClick={() => onDecide(false)}
          >
            Refuse
          </Button>
        </ButtonGroup>
      </div>
    </>
  )
}

function RequestSheet({
  request,
  onClose,
}: {
  request: LeaveRow | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const decide = useMutation({
    mutationFn: (approve: boolean) => {
      if (request === null) throw new Error("no request is open")
      return decideLeave(
        request.employee_id,
        request.id,
        approve ? "approve" : "reject",
        reason.trim()
      )
    },
    onSuccess: () => {
      setReason("")
      setFailed(null)
      // The queue loses a row, and the person's own balance and request list
      // both change — an approval mints the deduction in the same transaction,
      // so a stale balance beside a decided request would be visibly wrong.
      void client.invalidateQueries({ queryKey: leaveKeys.pending() })
      if (request !== null) {
        void client.invalidateQueries({
          queryKey: leaveKeys.balances(request.employee_id),
        })
        void client.invalidateQueries({
          queryKey: leaveKeys.requests(request.employee_id),
        })
      }
      onClose()
    },
    onError: (error: Error) => setFailed(error.message),
  })

  if (request === null) return null

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={request.id}
      title={request.leave_type_name}
    >
      <Pill tone="warn">Waiting on a decision</Pill>

      <Facts>
        <Fact term="Employee">
          <Who id={request.employee_id} name={request.name} />
        </Fact>
        <Fact term="Unit">{request.unit_id}</Fact>
        <Fact term="From">{day(request.from_date)}</Fact>
        <Fact term="To">{day(request.to_date)}</Fact>
        {/* Not the length of the span. The server settled which days this
            charges against the calendar on the day it was filed, and a holiday
            inside the span is not one of them. */}
        <Fact term="Days charged">{request.chargeable_days}</Fact>
        <Fact term="Asked by">{request.requested_by}</Fact>
        <Fact term="Reason">{request.reason}</Fact>
        {request.evidence !== null && (
          <Fact term="Evidence">{request.evidence}</Fact>
        )}
      </Facts>

      <Verdict
        reason={reason}
        onReason={setReason}
        busy={decide.isPending}
        failed={failed}
        onDecide={(approve) => decide.mutate(approve)}
      />
    </Sheet>
  )
}

/// One correction, and the day it is about.
///
/// A correction is judged against the day — the plan, the punches the reader
/// did see — and that lives on the attendance screen, so the sheet links to
/// the person's days rather than restating them. What it carries itself is
/// what the correction claims and why.
function CorrectionSheet({
  correction,
  onClose,
}: {
  correction: CorrectionRow | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const decide = useMutation({
    mutationFn: (approve: boolean) => {
      if (correction === null) throw new Error("no correction is open")
      return decideCorrection(correction.id, approve, reason.trim())
    },
    onSuccess: () => {
      setReason("")
      setFailed(null)
      // The whole attendance prefix, not just the queue: an approval changes
      // what the day amounted to, and the month's readiness counts the
      // corrections still open.
      void client.invalidateQueries({ queryKey: punchKeys.all })
      onClose()
    },
    onError: (error: Error) => setFailed(error.message),
  })

  if (correction === null) return null

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={correction.id}
      title="Attendance correction"
    >
      <Pill tone="warn">Waiting on a decision</Pill>

      <Facts>
        <Fact term="Employee">{correction.display_name}</Fact>
        <Fact term="Unit">{correction.unit_id}</Fact>
        <Fact term="Day">{day(correction.business_date)}</Fact>
        <Fact term="Claims">{effectLabel(correction.effect)}</Fact>
        {correction.corrected_arrival !== null && (
          <Fact term="Arrived">
            {correctedTime(correction.corrected_arrival)}
          </Fact>
        )}
        {correction.corrected_departure !== null && (
          <Fact term="Left">
            {correctedTime(correction.corrected_departure)}
          </Fact>
        )}
        <Fact term="Asked by">{correction.requested_by}</Fact>
        <Fact term="Asked at">{moment(correction.requested_at)}</Fact>
        <Fact term="Reason">{correction.reason}</Fact>
      </Facts>

      <p className="mt-4 text-body">
        <AppLink
          to="/people/attendance-days"
          sheet={{ key: "attendanceOf", value: correction.employee_id }}
        >
          See their attendance
        </AppLink>
        .
      </p>

      <Verdict
        reason={reason}
        onReason={setReason}
        busy={decide.isPending}
        failed={failed}
        onDecide={(approve) => decide.mutate(approve)}
      />
    </Sheet>
  )
}

/// One swap: two people exchanging one day's plan.
///
/// Approving moves both roster days at once, as roster revisions — so the
/// roster answers are dropped with the queue, or the week on the Roster
/// screen would still show each person on the other's shift.
function SwapSheet({
  swap,
  onClose,
}: {
  swap: SwapRow | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const decide = useMutation({
    mutationFn: (approved: boolean) => {
      if (swap === null) throw new Error("no swap is open")
      return decideSwap(swap.id, { approved, reason: reason.trim() })
    },
    onSuccess: () => {
      setReason("")
      setFailed(null)
      void client.invalidateQueries({ queryKey: nextKeys.swaps() })
      void client.invalidateQueries({ queryKey: rosterKeys.all() })
      onClose()
    },
    onError: (error: Error) => setFailed(error.message),
  })

  if (swap === null) return null

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={swap.id}
      title="Roster swap"
    >
      <Pill tone="warn">Waiting on a decision</Pill>

      <Facts>
        <Fact term="Employee">
          <Who id={swap.employee_id} name={swap.name} />
        </Fact>
        <Fact term="Swaps with">
          <Who id={swap.with_employee_id} name={swap.withName} />
        </Fact>
        <Fact term="Unit">{swap.unit_id}</Fact>
        <Fact term="Day">{day(swap.on_date)}</Fact>
        <Fact term="Asked by">{swap.requested_by}</Fact>
        <Fact term="Reason">{swap.reason}</Fact>
      </Facts>

      <Verdict
        reason={reason}
        onReason={setReason}
        busy={decide.isPending}
        failed={failed}
        onDecide={(approve) => decide.mutate(approve)}
      />
    </Sheet>
  )
}
