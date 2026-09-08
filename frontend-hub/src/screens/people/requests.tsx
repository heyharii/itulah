import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { ButtonGroup } from "@/components/ui/segmented"
import { Banner, EmptyState } from "@/components/ui/states"
import { day } from "@/lib/format"
import {
  awaitingOvertime,
  boundedTo,
  decideLeave,
  leaveKeys,
  overtimeKeys,
  pendingLeave,
  readMinutesSpan,
  useReach,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import { AppLink } from "@/components/ui/app-link"
import type { LeaveRequestView, OvertimeOrderView } from "@itulah/contract"

/// One queue, not three.
///
/// A manager does not have a "leave task" and a "correction task" and an
/// "overtime task" — they have five minutes and a list of things waiting on
/// them. Three screens each holding two rows is how all three stop being
/// opened. Leave is what this queue holds today; overtime consent and
/// attendance corrections join it as they land, which is why the empty state
/// says *requests* rather than *leave requests*.
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
/// anybody — least of all the person who was refused.
///
/// # Overtime is here to be seen, not to be decided
///
/// It appears in the queue because a manager needs to know an order is sitting
/// unanswered — an order nobody answers authorizes nothing, so it is overtime
/// that will be worked unpaid or not worked at all. But the decision is not
/// theirs: PP 35/2021 art. 26(2) wants the worker's own agreement, and it
/// arrives from their phone under a key nobody here holds. So those rows link
/// to the Overtime screen rather than opening a sheet with buttons in it.

const columns: ColumnDef<TableSetup, LeaveRequestView>[] = [
  {
    id: "who",
    accessorFn: (row) => row.employee_id,
    header: "Employee",
    size: 200,
    cell: ({ row }) => (
      <span className="font-mono text-id text-body">
        {row.original.employee_id}
      </span>
    ),
  },
  {
    accessorKey: "leave_type_name",
    header: "Kind",
    size: 180,
  },
  {
    id: "when",
    accessorFn: (row) => row.from_date,
    header: "From",
    size: 130,
    cell: ({ row }) => day(row.original.from_date),
  },
  {
    id: "until",
    accessorFn: (row) => row.to_date,
    header: "To",
    size: 130,
    cell: ({ row }) => day(row.original.to_date),
  },
  {
    accessorKey: "chargeable_days",
    header: "Charged",
    size: 110,
    meta: { align: "right" },
    /// The days actually charged, which is not the length of the span: a *cuti
    /// bersama* inside it is already taken out of the twelve by the calendar,
    /// and charging it again would take the same day off the employee twice.
    /// Settled by the server on the day the request was filed.
    cell: ({ row }) => row.original.chargeable_days,
  },
  {
    accessorKey: "place_id",
    header: "Place",
    size: 130,
  },
]

export function Requests() {
  const request = useSheet("request")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "when", desc: false },
  ])
  const reach = useReach()
  const bounded = boundedTo(reach.data)

  const queue = useQuery({
    queryKey: leaveKeys.pending(),
    queryFn: ({ signal }) => pendingLeave(signal),
  })

  const rows = useMemo(() => queue.data ?? [], [queue.data])

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns,
        getRowId: (row: LeaveRequestView) => row.id,
        state: { sorting },
        onSortingChange: setSorting,
      }),
      [rows, sorting]
    )
  )

  const open = rows.find((row) => row.id === request.value) ?? null

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Requests"
        sub={
          bounded === null
            ? "Everything waiting on a decision, across every place."
            : `Everything waiting on a decision at ${bounded}.`
        }
      />

      {/* Honest about what this queue does not yet hold, so nobody reads an
          empty list as "nothing is waiting". Attendance corrections wait on a
          punch source, which is an open product question — see
          `PEOPLE-BRIEF.md`. */}
      <Banner tone="info" className="mb-4">
        Leave and overtime. Attendance corrections join this queue when there is
        a punch source to correct against.
      </Banner>

      <AwaitingConsent />

      <Card className="overflow-hidden">
        {queryState(queue, {
          loading: "Reading the queue…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {bounded === null
                  ? "Nothing anywhere is waiting on a decision."
                  : `Nothing at ${bounded} is waiting on a decision.`}
              </EmptyState>
            ) : (
              <DataTable<LeaveRequestView>
                table={table}
                onRowClick={(row) => request.open(row.id)}
                isSelected={(row) => row.id === request.value}
              />
            ),
        })}
      </Card>

      <RequestSheet request={open} onClose={request.close} />
    </PageContent>
  )
}

function RequestSheet({
  request,
  onClose,
}: {
  request: LeaveRequestView | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const decide = useMutation({
    mutationFn: (verb: "approve" | "reject") => {
      if (request === null) throw new Error("no request is open")
      return decideLeave(request.employee_id, request.id, verb, reason.trim())
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
  const ready = reason.trim() !== ""

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
          <span className="font-mono text-id">{request.employee_id}</span>
        </Fact>
        <Fact term="Place">{request.place_id}</Fact>
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

      {failed !== null && (
        <Banner tone="bad" className="mt-4">
          {failed}
        </Banner>
      )}

      <div className="mt-4 flex flex-col gap-3">
        <Field label="Why" hint="Recorded against the decision, and required.">
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="toko cukup orang"
          />
        </Field>
        <ButtonGroup>
          <Button
            variant="primary"
            disabled={!ready || decide.isPending}
            onClick={() => decide.mutate("approve")}
          >
            Approve
          </Button>
          <Button
            variant="danger"
            disabled={!ready || decide.isPending}
            onClick={() => decide.mutate("reject")}
          >
            Refuse
          </Button>
        </ButtonGroup>
      </div>
    </Sheet>
  )
}

/// Overtime orders nobody has answered yet.
///
/// A count and a link, not a table: the manager cannot act on these from here,
/// and a list of rows with no row action is a list people learn to scroll past.
/// What they can do is notice, and go and chase somebody.
function AwaitingConsent() {
  const orders = useQuery({
    queryKey: overtimeKeys.awaiting(),
    queryFn: ({ signal }) => awaitingOvertime(signal),
  })
  const rows: OvertimeOrderView[] = orders.data ?? []
  if (rows.length === 0) return null

  const minutes = rows.reduce((total, row) => total + row.planned_minutes, 0)

  return (
    <Banner tone="warn" className="mb-4">
      {rows.length === 1
        ? "One overtime order is"
        : `${rows.length} overtime orders are`}{" "}
      waiting on the people they were given to — {readMinutesSpan(minutes)} in
      all, authorizing nothing until they answer.{" "}
      <AppLink to="/people/overtime">See them</AppLink>.
    </Banner>
  )
}
