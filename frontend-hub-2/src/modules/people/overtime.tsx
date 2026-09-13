import { useMemo } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { CalendarDays, MapPin, Users } from "lucide-react"
import type { EmployeeSummary, OvertimeOrderView } from "@itulah/contract"

import { ApiError } from "@/lib/api"
import { count, day } from "@/lib/format"
import { useReport } from "@/lib/list"
import { useQueryState } from "@/lib/query-state"
import { useReach, whoseList } from "@/lib/reach"
import type { TableSetup } from "@/lib/table"
import { PageHead, Toolbar } from "@/kit/page"
import { Sheet } from "@/kit/sheet"
import { Table } from "@/kit/table"
import { Tag } from "@/kit/tag"
import { Empty, Failed, Loading, NoAccess } from "@/kit/state"
import { useWorkforceIndex } from "@/modules/people/workforce"
import { Fact, Facts, Person, Quiet } from "@/modules/people/parts"
import {
  dayKindLabel,
  minutes,
  overtimeStateLabel,
} from "@/modules/people/labels"

/// Overtime: ordered here, agreed somewhere else.
///
/// ## There is no consent button on this screen, and there must not be
///
/// PP 35/2021 art. 26(2) wants two written acts from two people: the employer's
/// instruction and the worker's own agreement. `POST
/// /employees/{id}/overtime-orders/{order_id}/consent` is the SECOND of those,
/// and it is the employee's act. A manager pressing it would be the employer
/// agreeing twice — the single-consent model the whole design exists to refuse
/// — and the server would refuse it anyway. Employee self-service lives in
/// `frontend-employee`, under a key nobody here holds.
///
/// So the state on this screen is a fact to read, not a control. What is
/// waiting is waiting on somebody else, and the honest thing a manager can do
/// about it is chase the person, not the button.
///
/// ## Read `authorized_minutes`, never `planned_minutes`
///
/// They are different numbers and only one of them may be acted on. What was
/// ORDERED is the employer's instruction; what is AUTHORIZED is null in every
/// state but `AGREED`. Every row on this queue is awaiting an answer, so the
/// authorized column is empty down its whole length — and that is precisely
/// what the column is here to show. Filling it with the ordered figure, or with
/// a zero, would turn an unanswered instruction into a number somebody pays.
///
/// ## What the endpoint cannot do
///
/// `GET /overtime-orders/awaiting` takes no parameters: no date range, no
/// place, no cap and no ordering. It answers exactly one question — what is
/// unanswered right now, where this caller reaches — and this screen asks no
/// other. Ordering overtime, and looking at a month's orders in any other
/// state, both need routes this surface does not have.

export function OvertimeScreen() {
  const url = useQueryState()
  const openId = url.one("order")

  const reach = useReach()

  const queue = useReport<OvertimeOrderView[]>({
    key: ["people", "overtime", "awaiting"],
    path: "/api/v1/overtime-orders/awaiting",
    params: {},
  })

  const rows = useMemo(() => queue.data ?? [], [queue.data])

  // The same client-side join as the Requests queue, for the same reason and
  // with the same limits: `OvertimeOrderView` carries `employee_id` and nothing
  // else about the person. See `workforce.ts`.
  const byId = useWorkforceIndex()

  const columns: ColumnDef<TableSetup, OvertimeOrderView>[] = [
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
      id: "on_date",
      header: "Evening",
      size: 15,
      meta: { icon: <CalendarDays className="size-[15px]" />, min: 130 },
      cell: ({ row }) => day(row.original.on_date),
    },
    {
      id: "day_kind",
      header: "Kind of day",
      size: 15,
      meta: { priority: 2, min: 130 },
      // Which statutory table applies — Kepmenaker 102/2004 has one schedule
      // for ordinary days and another for rest days and holidays. Never a rate:
      // nothing on this surface computes one.
      cell: ({ row }) => (
        <span className="truncate">{dayKindLabel(row.original.day_kind)}</span>
      ),
    },
    {
      id: "ordered",
      header: "Ordered",
      size: 16,
      meta: { align: "right", min: 120 },
      cell: ({ row }) => (
        <span className="tabular-nums">
          {minutes(row.original.planned_minutes)}
        </span>
      ),
    },
    {
      id: "authorized",
      header: "Authorized",
      size: 16,
      // No `priority`, so it never drops out to fit a narrow frame. A screen
      // that showed what was ordered and hid what was authorized would be
      // showing the number nobody may act on and hiding the one they may.
      meta: { align: "right", min: 130 },
      cell: ({ row }) =>
        row.original.authorized_minutes === null ? (
          <Quiet>
            <span title="An order nobody has answered authorizes nothing">
              nothing yet
            </span>
          </Quiet>
        ) : (
          <span className="text-ink font-medium tabular-nums">
            {minutes(row.original.authorized_minutes)}
          </span>
        ),
    },
    {
      id: "place",
      header: "Place",
      size: 16,
      meta: { icon: <MapPin className="size-[15px]" />, priority: 1, min: 120 },
      cell: ({ row }) => (
        <span className="text-label text-ink-2 truncate font-mono">
          {row.original.place_id}
        </span>
      ),
    },
  ]

  // Deliberately NO state column. This route returns one state and only one, so
  // a column repeating "Waiting on their answer" on every row would be a column
  // spent saying what the page has already said — the same argument the money
  // screen makes for dropping Kind on a single-kind tab. The state is in the
  // description, once.
  const ordered = rows.reduce((sum, row) => sum + row.planned_minutes, 0)
  const open = rows.find((row) => row.id === openId)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHead
        module="People"
        title="Overtime"
        description={whoseList(reach.data, {
          everywhere:
            "Orders issued and not yet answered, across every place you reach.",
          at: (place) => `Orders issued at ${place} and not yet answered.`,
        })}
      />

      <Toolbar
        trailing={
          queue.isPending
            ? "Loading…"
            : // A dash, not `0 unanswered`, when the read failed.
              `${count(queue.data === undefined ? null : rows.length)} unanswered`
        }
      >
        <span className="text-ctl text-ink-3">
          The answer is the worker&rsquo;s own — PP 35/2021 art. 26(2) — and it
          arrives from their phone. Nothing on this screen can give it for them.
        </span>
      </Toolbar>

      {queue.isPending ? (
        <Loading rows={6} cols={columns.length} />
      ) : queue.isError ? (
        queue.error instanceof ApiError && queue.error.status === 403 ? (
          <NoAccess what="overtime orders" reach={queue.error.detail} />
        ) : (
          <Failed
            what="the overtime queue"
            error={queue.error}
            onRetry={() => void queue.refetch()}
          />
        )
      ) : rows.length === 0 ? (
        <Empty
          what="unanswered orders"
          detail="Every order issued at the places you reach has been answered, one way or the other."
        />
      ) : (
        <Table
          columns={columns}
          rows={rows}
          rowId={(row) => row.id}
          caption="Overtime orders awaiting the worker's answer"
          onRowClick={(row) => url.set({ order: row.id }, false)}
          isOpen={(row) => row.id === openId}
          foot={{
            who: (
              <>
                <b className="text-ink">{count(rows.length)}</b> unanswered
              </>
            ),
            ordered: (
              <span className="tabular-nums">{minutes(ordered)} ordered</span>
            ),
            // The one figure on this page that is a statement rather than a
            // sum: nothing here authorizes anything, and adding up nulls to
            // get a zero would say the opposite.
            authorized: (
              <span className="text-warn-ink font-medium">none authorized</span>
            ),
          }}
        />
      )}

      <OrderSheet
        order={open}
        person={open ? byId.get(open.employee_id) : undefined}
        onClose={() => url.set({ order: null }, false)}
      />
    </div>
  )
}

/// One order, whole — and still nothing to press.
///
/// It reads only what the row already carries, so opening it costs no request
/// and cannot show a figure that disagrees with the line it was opened from.
function OrderSheet({
  order,
  person,
  onClose,
}: {
  order: OvertimeOrderView | undefined
  person: EmployeeSummary | undefined
  onClose: () => void
}) {
  return (
    <Sheet
      open={order !== undefined}
      onClose={onClose}
      title={person?.full_name ?? person?.employee_code ?? "Overtime order"}
      subtitle={order ? overtimeStateLabel(order.state) : undefined}
    >
      {order === undefined ? null : (
        <>
          <Facts>
            <Fact label="Evening">{day(order.on_date)}</Fact>
            <Fact label="Kind of day">{dayKindLabel(order.day_kind)}</Fact>
            <Fact label="Ordered">
              <span className="tabular-nums">
                {minutes(order.planned_minutes)}
              </span>
            </Fact>
            <Fact label="Authorized">
              {order.authorized_minutes === null ? (
                <Quiet>nothing yet</Quiet>
              ) : (
                <span className="text-ink font-medium tabular-nums">
                  {minutes(order.authorized_minutes)}
                </span>
              )}
            </Fact>
            <Fact label="Place">
              <span className="font-mono">{order.place_id}</span>
            </Fact>
            <Fact label="State">
              <Tag tone="warn">{overtimeStateLabel(order.state)}</Tag>
            </Fact>
            <Fact label="Ordered by" wide>
              <span className="font-mono">{order.ordered_by}</span>{" "}
              <span className="text-ink-4">on {day(order.ordered_at)}</span>
              <span className="block">{order.ordered_reason}</span>
            </Fact>
            <Fact label="Their answer" wide>
              {order.answered_by === null ? (
                <Quiet>Not answered</Quiet>
              ) : (
                <>
                  <span className="font-mono">{order.answered_by}</span>{" "}
                  <span className="text-ink-4">
                    on {day(order.answered_at ?? "")}
                  </span>
                  {order.answered_reason && (
                    <span className="block">{order.answered_reason}</span>
                  )}
                </>
              )}
            </Fact>
          </Facts>

          {/* Said out loud, in the one place somebody would go looking for a
              button. A panel with no action in it and no explanation reads as a
              panel that is missing its buttons. */}
          <p className="border-line bg-warn-wash text-ctl text-warn-ink mt-auto border-t px-[18px] py-3">
            The employer&rsquo;s instruction is on this order. The second act —
            the worker&rsquo;s own agreement — is theirs to make, from their own
            sign-in. Recording it from here would be the employer agreeing
            twice, which is what PP 35/2021 art. 26(2) refuses and what the
            server refuses with it.
          </p>
        </>
      )}
    </Sheet>
  )
}
