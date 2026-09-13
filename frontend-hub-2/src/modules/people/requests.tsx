import { useMemo } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { CalendarRange, MapPin, Users } from "lucide-react"
import type {
  EmployeeSummary,
  LeaveBalanceRow,
  LeaveRequestView,
} from "@itulah/contract"

import { ApiError } from "@/lib/api"
import { count, day } from "@/lib/format"
import { useReport } from "@/lib/list"
import { useQueryState } from "@/lib/query-state"
import { useReach, whoseList } from "@/lib/reach"
import { useWorkforceIndex } from "@/modules/people/workforce"
import type { TableSetup } from "@/lib/table"
import { PageHead, Toolbar } from "@/kit/page"
import { Sheet } from "@/kit/sheet"
import { Table } from "@/kit/table"
import { Empty, Failed, Loading, NoAccess } from "@/kit/state"
import {
  Fact,
  Facts,
  Line,
  Person,
  Quiet,
  SubHead,
} from "@/modules/people/parts"
import { days, leaveStateLabel } from "@/modules/people/labels"

/// One queue, not three.
///
/// A manager does not have a "leave task" and a "correction task" and an
/// "overtime task" — they have five minutes and a list of things waiting on
/// them. Three screens each holding two rows is how all three stop being
/// opened. Leave is what this queue holds today; the toolbar says plainly what
/// it does not, so an empty list is never read as "nothing is waiting".
///
/// ## Bounded by the server, said by the screen
///
/// `GET /leave-requests/pending` takes no parameters at all. The bound is the
/// caller's own posting, applied server-side: a manager posted to store-07 is
/// served store-07's requests and head office is served every place's. Nothing
/// here re-implements that — a screen that filtered by place itself would be a
/// second place the bound is decided, and the day the two disagreed the screen
/// would be the one that looked right.
///
/// ## This screen decides nothing
///
/// It reads. Approving or refusing leave writes a deduction into the balance
/// ledger in the same transaction, and the server refuses a decision without a
/// reason — so the decision belongs with the form that collects one. Until that
/// is written here, the old hub's queue is where a decision is taken, and a
/// button on this screen that only looked like it decided would be worse than
/// no button.
///
/// ## Centidays are divided once, at the last moment
///
/// `LeaveBalanceRow.centidays` is hundredths of a day because that is what the
/// ledger holds. It is divided in `labels.ts`, for display, and never before —
/// the same rule money follows for the same reason.

export function RequestsScreen() {
  const url = useQueryState()
  const openId = url.one("request")

  const reach = useReach()

  const queue = useReport<LeaveRequestView[]>({
    key: ["people", "leave", "pending"],
    path: "/api/v1/leave-requests/pending",
    // Genuinely none. The route's handler takes no `Query` at all, and this
    // list has no cap behind it either — what comes back is everything pending
    // at the places this caller reaches.
    params: {},
  })

  const rows = useMemo(() => queue.data ?? [], [queue.data])

  // ── who these people ARE ───────────────────────────────────────────────
  //
  // The queue carries `employee_id` and nothing else about the person, so the
  // names are joined in the browser. Why that is a stand-in rather than a
  // design, and what it costs, is written once in `workforce.ts`.
  const byId = useWorkforceIndex()

  const columns: ColumnDef<TableSetup, LeaveRequestView>[] = [
    {
      id: "who",
      header: "Employee",
      size: 22,
      meta: { icon: <Users className="size-[15px]" />, min: 170 },
      cell: ({ row }) => {
        const person = byId.get(row.original.employee_id)
        return (
          <Person
            id={row.original.employee_id}
            code={person?.employee_code}
            name={person?.full_name}
          />
        )
      },
    },
    {
      id: "kind",
      header: "Kind",
      size: 20,
      meta: { min: 150 },
      // The catalogue's own name, not its code. `AL` is what the ledger files
      // it under; "Cuti Tahunan" is what the person asked for.
      cell: ({ row }) => (
        <span className="truncate">{row.original.leave_type_name}</span>
      ),
    },
    {
      id: "from",
      header: "From",
      size: 14,
      meta: { icon: <CalendarRange className="size-[15px]" />, min: 120 },
      cell: ({ row }) => day(row.original.from_date),
    },
    {
      id: "to",
      header: "To",
      size: 14,
      meta: { min: 120 },
      cell: ({ row }) => day(row.original.to_date),
    },
    {
      id: "charged",
      header: "Days charged",
      size: 12,
      // Never dropped: it is the number the decision turns on.
      meta: { align: "right", min: 110 },
      // NOT the length of the span. A *cuti bersama* inside it has already come
      // out of the twelve by the calendar, and charging it again would take the
      // same day off somebody twice. Settled by the server on the day the
      // request was filed, which is why it is read rather than counted here.
      cell: ({ row }) => (
        <span className="tabular-nums">{row.original.chargeable_days}</span>
      ),
    },
    {
      id: "place",
      header: "Place",
      size: 18,
      meta: { icon: <MapPin className="size-[15px]" />, priority: 1, min: 120 },
      cell: ({ row }) => (
        <span className="text-label text-ink-2 truncate font-mono">
          {row.original.place_id}
        </span>
      ),
    },
  ]

  const open = rows.find((row) => row.id === openId)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="People"
        title="Requests"
        description={whoseList(reach.data, {
          everywhere:
            "Every leave request waiting on a decision, across every place you reach.",
          at: (place) =>
            `Every leave request waiting on a decision at ${place}.`,
        })}
      />

      <Toolbar
        trailing={
          queue.isPending
            ? "Loading…"
            : // A dash, not `0 waiting`, when the read failed: an empty queue and
              // an unanswered one are opposite findings.
              `${count(queue.data === undefined ? null : rows.length)} waiting`
        }
      >
        {/* Honest about what this queue does not hold yet. Without it, an empty
            list reads as "nothing is waiting on me", which for attendance is
            not true — it is unknowable, because there is nothing to correct
            against. */}
        <span className="text-ctl text-ink-3">
          Leave only. Attendance corrections join this queue when there is a
          punch source to correct against; overtime is read on its own screen,
          because the answer to it is not a manager&rsquo;s to give.
        </span>
      </Toolbar>

      {queue.isPending ? (
        <Loading rows={7} cols={columns.length} />
      ) : queue.isError ? (
        queue.error instanceof ApiError && queue.error.status === 403 ? (
          <NoAccess what="the requests queue" reach={queue.error.detail} />
        ) : (
          <Failed
            what="the requests queue"
            error={queue.error}
            onRetry={() => void queue.refetch()}
          />
        )
      ) : rows.length === 0 ? (
        // There is no narrowing on this screen, so an empty queue can only mean
        // one thing — which is why this is `Empty` and never `NoMatch`.
        <Empty
          what="requests"
          detail="Nothing is waiting on a decision at the places you reach."
        />
      ) : (
        <Table
          columns={columns}
          rows={rows}
          rowId={(row) => row.id}
          caption="Leave requests waiting on a decision"
          onRowClick={(row) => url.set({ request: row.id }, false)}
          isOpen={(row) => row.id === openId}
          foot={{
            who: (
              <>
                <b className="text-ink">{count(rows.length)}</b> waiting
              </>
            ),
            charged: (
              <span className="tabular-nums">
                {count(rows.reduce((sum, row) => sum + row.chargeable_days, 0))}{" "}
                days
              </span>
            ),
          }}
        />
      )}

      <RequestSheet
        request={open}
        person={open ? byId.get(open.employee_id) : undefined}
        onClose={() => url.set({ request: null }, false)}
      />
    </div>
  )
}

/// One request, and what it would cost the person asking.
///
/// The balance is the whole reason this panel exists. The row says four days
/// are charged; the question a manager actually has is whether those four days
/// are there — and that answer lives on a different route, keyed by the person
/// rather than by the request.
function RequestSheet({
  request,
  person,
  onClose,
}: {
  request: LeaveRequestView | undefined
  person: EmployeeSummary | undefined
  onClose: () => void
}) {
  const balances = useReport<LeaveBalanceRow[]>({
    // The employee is in the KEY as well as in the path. `useReport` appends
    // only `params` to the key it is given, and these params are empty — so a
    // key of `["people","leave","balances"]` would be one cache entry serving
    // every person, and opening a second request would show the first one's
    // balance against it.
    key: ["people", "leave", "balances", request?.employee_id ?? ""],
    path: `/api/v1/employees/${encodeURIComponent(request?.employee_id ?? "")}/leave-balances`,
    // `on` defaults to today on the server. Left off deliberately: the balance
    // that matters to a decision being taken now is the one as it stands now.
    params: {},
    enabled: request !== undefined,
  })

  return (
    <Sheet
      open={request !== undefined}
      onClose={onClose}
      width="record"
      title={person?.full_name ?? person?.employee_code ?? "Leave request"}
      subtitle={request ? leaveStateLabel(request.state) : undefined}
    >
      {request === undefined ? null : (
        <>
          <Facts>
            <Fact label="Kind">{request.leave_type_name}</Fact>
            <Fact label="Place">
              <span className="font-mono">{request.place_id}</span>
            </Fact>
            <Fact label="From">{day(request.from_date)}</Fact>
            <Fact label="To">{day(request.to_date)}</Fact>
            <Fact label="Days charged">
              <span className="tabular-nums">{request.chargeable_days}</span>
            </Fact>
            <Fact label="Filed by">
              <span className="font-mono">{request.requested_by}</span>
              <span className="text-label text-ink-4 block">
                {day(request.created_at)}
              </span>
            </Fact>
            <Fact label="Reason" wide>
              {request.reason === "" ? (
                <Quiet>None given</Quiet>
              ) : (
                request.reason
              )}
            </Fact>
            <Fact label="Evidence" wide>
              {request.evidence === null ? (
                <Quiet>None attached</Quiet>
              ) : (
                request.evidence
              )}
            </Fact>
          </Facts>

          {/* The days the server settled on, listed. A span of six calendar
              days that charges four is not an error, and the two dates it did
              not charge are the explanation. */}
          <SubHead>The days this charges</SubHead>
          <Line>
            {request.chargeable.length === 0 ? (
              <Quiet>None. This kind draws on no balance.</Quiet>
            ) : (
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {request.chargeable.map((date) => (
                  <span key={date}>{day(date)}</span>
                ))}
              </span>
            )}
          </Line>

          <SubHead>What they have left, today</SubHead>
          {balances.isPending ? (
            <Line>
              <Quiet>Reading the balances…</Quiet>
            </Line>
          ) : balances.isError ? (
            <Line note={(balances.error as Error).message}>
              <Quiet>The balances could not be read.</Quiet>
            </Line>
          ) : (balances.data ?? []).length === 0 ? (
            <Line>
              {/* Absent is not zero. Only balance-backed kinds appear at all:
                  sick leave draws on nothing (UU 13/2003 art. 93), and a screen
                  that printed it as `0` would be claiming somebody had run out
                  of something the law does not let us count. */}
              <Quiet>
                No kind this person can take draws on a balance, so there is
                nothing to count against.
              </Quiet>
            </Line>
          ) : (
            (balances.data ?? []).map((balance) => (
              <Line
                key={balance.leave_type}
                note={
                  balance.pending_centidays === 0
                    ? undefined
                    : `${days(balance.pending_centidays)} days already asked for and not yet decided`
                }
              >
                <span className="text-ink min-w-0 flex-1 truncate font-medium">
                  {balance.name}
                </span>
                <span className="text-ink-2 shrink-0 tabular-nums">
                  {days(balance.centidays)} days left
                </span>
              </Line>
            ))
          )}
        </>
      )}
    </Sheet>
  )
}
