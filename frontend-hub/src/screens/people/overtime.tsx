import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Day } from "@/components/ui/day"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Select } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { useFilters } from "@/lib/filters"
import { useActiveEmployees } from "@/lib/queries/hr-time"
import { day } from "@/lib/format"
import type { Tone } from "@/lib/format"
import {
  awaitingOvertime,
  boundedTo,
  orderOvertime,
  overtimeKeys,
  overtimeStateLabel,
  readMinutesSpan,
  readOvertimePolicy,
  useReach,
  withdrawOvertime,
  type NewOvertimeOrder,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import type { OvertimeOrderView } from "@itulah/contract"

/// Overtime: ordered here, agreed somewhere else.
///
/// # There is no "approve" button on this screen, and there must not be
///
/// PP 35/2021 art. 26(2) wants two written acts from two people: the employer's
/// instruction and the worker's own agreement. A manager can order overtime and
/// take an order back; the answer belongs to the person whose evening it is,
/// and it arrives from their phone under a key nobody here holds. A button on
/// this screen that recorded the answer would be the manager agreeing twice —
/// which is the single-consent model the whole design exists to refuse, and the
/// server would refuse it anyway.
///
/// So the state column is a fact to read, not a control. What is waiting is
/// waiting on somebody else.
///
/// # Read `authorized`, not `ordered`
///
/// They are different numbers. An order authorizes nothing until it is agreed
/// to, so the table shows what was asked for and what is actually authorized
/// side by side, and the second is blank in every state but AGREED.

function stateTone(state: string): Tone {
  switch (state) {
    case "AGREED":
      return "ok"
    case "AWAITING_CONSENT":
      return "warn"
    case "DECLINED":
      return "bad"
    default:
      return "neutral"
  }
}

function columnsFor(
  nameOf: (id: string) => string
): ColumnDef<TableSetup, OvertimeOrderView>[] {
  return [
    {
      id: "who",
      accessorFn: (row) => nameOf(row.employee_id),
      header: "Employee",
      size: 190,
      // No filter: narrowing by one person would mean already knowing whose
      // order you were looking for. Who is chased is decided by reading the list.
      cell: ({ row }) => {
        const name = nameOf(row.original.employee_id)
        return name === row.original.employee_id ? (
          <span className="font-mono text-id text-body">{name}</span>
        ) : (
          <span className="text-body">{name}</span>
        )
      },
    },
    {
      accessorKey: "on_date",
      header: "Date",
      size: 130,
      /// "This week" is the whole reason somebody opens this list — an order for
      /// tomorrow night that nobody has answered is the one worth chasing today.
      meta: { filter: { kind: "date" } },
      cell: ({ row }) => day(row.original.on_date),
    },
    {
      accessorKey: "day_kind",
      header: "Day",
      size: 110,
      /// Which statutory pay table applies — Kepmenaker 102/2004 has one schedule
      /// for ordinary days and another for rest days and holidays. Never a rate.
      /// Filterable because those are different schedules: "the rest-day and
      /// holiday orders" is one clause and a different conversation.
      meta: {
        filter: { kind: "option", format: (value) => value.toLowerCase() },
      },
      cell: ({ row }) => row.original.day_kind.toLowerCase(),
    },
    {
      accessorKey: "planned_minutes",
      header: "Ordered",
      size: 110,
      /// Minutes, never hours — the same rule the order form states, and for the
      /// same reason: a fractional hour cannot round-trip.
      meta: { align: "right", filter: { kind: "number", unit: "min" } },
      cell: ({ row }) => readMinutesSpan(row.original.planned_minutes),
    },
    {
      id: "authorized",
      accessorFn: (row) => row.authorized_minutes ?? 0,
      header: "Authorized",
      size: 120,
      /// **Not filterable, and the `?? 0` above is exactly why.** An order
      /// nobody has answered authorizes nothing, which is not the same fact as
      /// an order authorizing zero minutes — the cell draws a dash for precisely
      /// that reason. A number clause would see the stand-in: "authorized is 0"
      /// would gather up every unanswered order and report them as answered for
      /// nothing. State says it truthfully, so State is what this offers.
      meta: { align: "right" },
      /// Blank until the worker agrees. An order nobody answered authorizes
      /// nothing, and a dash says that better than a zero would.
      cell: ({ row }) =>
        row.original.authorized_minutes === null ? (
          <span className="text-mute">—</span>
        ) : (
          readMinutesSpan(row.original.authorized_minutes)
        ),
    },
    {
      accessorKey: "state",
      header: "State",
      size: 190,
      /// The honest form of the question the Authorized column cannot be asked:
      /// waiting, agreed, declined. A fact to read and to narrow by — never a
      /// control. Nothing in this panel can change a state, which is the whole
      /// discipline of this screen.
      meta: { filter: { kind: "option", format: overtimeStateLabel } },
      cell: ({ row }) => (
        <Pill tone={stateTone(row.original.state)}>
          {overtimeStateLabel(row.original.state)}
        </Pill>
      ),
    },
  ]
}

export function Overtime() {
  const order = useSheet("overtimeOrder")
  const [ordering, setOrdering] = useState(false)
  const { nameOf } = useActiveEmployees()
  const columns = useMemo(() => columnsFor(nameOf), [nameOf])
  const [sorting, setSorting] = useState<SortingState>([
    { id: "on_date", desc: false },
  ])
  const reach = useReach()
  const bounded = boundedTo(reach.data)

  const policy = useQuery({
    queryKey: overtimeKeys.policy(),
    queryFn: ({ signal }) => readOvertimePolicy(signal),
  })
  const queue = useQuery({
    queryKey: overtimeKeys.awaiting(),
    queryFn: ({ signal }) => awaitingOvertime(signal),
  })

  const rows = useMemo(() => queue.data ?? [], [queue.data])

  const filters = useFilters(columns)

  const table = useTable(
    useMemo(
      () => ({
        features: tableSetup,
        data: rows,
        columns: filters.columns,
        getRowId: (row: OvertimeOrderView) => row.id,
        state: { columnFilters: filters.columnFilters, sorting },
        onSortingChange: setSorting,
      }),
      [rows, filters.columns, filters.columnFilters, sorting]
    )
  )

  const open = rows.find((row) => row.id === order.value) ?? null
  const caps = policy.data ?? null

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Overtime"
        sub={
          bounded === null
            ? "Ordered by a manager, agreed by the person who will work it."
            : `Ordered at ${bounded}, agreed by the person who will work it.`
        }
        actions={
          <Button
            variant="primary"
            disabled={caps === null}
            onClick={() => setOrdering(true)}
          >
            Order overtime
          </Button>
        }
      />

      {/* No caps, no orders. Said plainly rather than shown as an empty list:
          the two look identical and mean opposite things. */}
      {policy.isSuccess && caps === null ? (
        <Banner tone="bad" className="mb-4">
          No overtime caps have been ratified, so no overtime can be ordered.
          Head office states the daily and weekly limits; there is no default,
          because the figures before PP 35/2021 were different ones.
        </Banner>
      ) : (
        caps !== null && (
          <Banner tone="info" className="mb-4">
            Up to {readMinutesSpan(caps.max_per_day_minutes)} a day and{" "}
            {readMinutesSpan(caps.max_per_week_minutes)} a week. Only orders
            somebody has agreed to count towards the week.
          </Banner>
        )
      )}

      <Toolbar>
        <FilterPanel model={filters} table={table} />
      </Toolbar>

      <Card className="mb-4 overflow-hidden">
        {queryState(queue, {
          loading: "Reading the orders…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                Nothing is waiting on an answer. An order nobody answers
                authorizes nothing, so this list emptying is the good outcome.
                Use Order overtime to ask somebody to work extra hours.
              </EmptyState>
            ) : (
              <DataTable<OvertimeOrderView>
                table={table}
                onRowClick={(row) => order.open(row.id)}
                isSelected={(row) => row.id === order.value}
                // "Nothing is waiting" is the good outcome this screen hopes
                // for, so a narrowing that produces the same empty box has to
                // say which of the two it is.
                empty={
                  <>
                    {rows.length.toLocaleString("id-ID")} orders are here, and
                    none of them match the filters in force.
                  </>
                }
              />
            ),
        })}
      </Card>

      <OrderSheet order={open} onClose={order.close} />
      <OrderOvertimeSheet open={ordering} onClose={() => setOrdering(false)} />
    </PageContent>
  )
}

function OrderSheet({
  order,
  onClose,
}: {
  order: OvertimeOrderView | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const { nameOf } = useActiveEmployees()
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)

  const withdraw = useMutation({
    mutationFn: () => {
      if (order === null) throw new Error("no order is open")
      return withdrawOvertime(order.employee_id, order.id, reason.trim())
    },
    onSuccess: () => {
      setReason("")
      setFailed(null)
      void client.invalidateQueries({ queryKey: overtimeKeys.awaiting() })
      if (order !== null) {
        void client.invalidateQueries({
          queryKey: overtimeKeys.of(order.employee_id),
        })
      }
      onClose()
    },
    onError: (error: Error) => setFailed(error.message),
  })

  if (order === null) return null

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={order.id}
      title={`${readMinutesSpan(order.planned_minutes)} on ${day(order.on_date)}`}
    >
      <Pill tone={stateTone(order.state)}>
        {overtimeStateLabel(order.state)}
      </Pill>

      <Facts>
        <Fact term="Employee">{nameOf(order.employee_id)}</Fact>
        <Fact term="Unit">{order.unit_id}</Fact>
        <Fact term="Day">{order.day_kind.toLowerCase()}</Fact>
        <Fact term="Ordered">{readMinutesSpan(order.planned_minutes)}</Fact>
        {/* The figure anything downstream may act on. Absent until agreed. */}
        <Fact term="Authorized">
          {order.authorized_minutes === null
            ? "nothing yet"
            : readMinutesSpan(order.authorized_minutes)}
        </Fact>
        <Fact term="Ordered by">{order.ordered_by}</Fact>
        <Fact term="Reason">{order.ordered_reason}</Fact>
        {order.answered_by !== null && (
          <Fact term="Answered by">{order.answered_by}</Fact>
        )}
        {order.answered_reason !== null && (
          <Fact term="They said">{order.answered_reason}</Fact>
        )}
      </Facts>

      {failed !== null && (
        <Banner tone="bad" className="mt-4">
          {failed}
        </Banner>
      )}

      {order.state === "AWAITING_CONSENT" ? (
        <div className="mt-4 flex flex-col gap-3">
          {/* Withdrawing is the only act available here. The answer is theirs,
              and this screen has no way to give it. */}
          <Banner tone="info">
            Only {nameOf(order.employee_id)} can answer this — it arrives from
            their own app, under their own name.
          </Banner>
          <Field
            label="Why"
            hint="Recorded against the withdrawal, and required."
            required
          >
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <div>
            <Button
              variant="danger"
              pending={withdraw.isPending}
              disabled={reason.trim() === ""}
              onClick={() => withdraw.mutate()}
            >
              Take the order back
            </Button>
          </div>
        </div>
      ) : (
        // Not a banner. An answered order is a settled fact rather than
        // something to act on, and the four banner tones all claim attention —
        // `info` in this language means *in motion*, which is the opposite of
        // what this says.
        <p className="mt-4 text-meta text-mute">
          {order.state === "AGREED"
            ? "Agreed, and no longer withdrawable — this is a commitment they may have arranged their evening around."
            : "Answered. There is no way back from here, by design."}
        </p>
      )}
    </Sheet>
  )
}

function OrderOvertimeSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const client = useQueryClient()
  const blank: NewOvertimeOrder = {
    employeeId: "",
    onDate: "",
    dayKind: "WORKING",
    plannedMinutes: 120,
    reason: "",
  }
  const [draft, setDraft] = useState<NewOvertimeOrder>(blank)
  const [failed, setFailed] = useState<string | null>(null)

  // The people this caller may order for. The server bounds the list by their
  // posting already, so the picker offers exactly what the order route accepts.
  const { people } = useActiveEmployees()

  const issue = useMutation({
    mutationFn: () => orderOvertime(draft),
    onSuccess: () => {
      setFailed(null)
      setDraft(blank)
      void client.invalidateQueries({ queryKey: overtimeKeys.awaiting() })
      onClose()
    },
    onError: (error: Error) => setFailed(error.message),
  })

  const ready =
    draft.employeeId !== "" &&
    draft.onDate !== "" &&
    draft.plannedMinutes > 0 &&
    draft.reason.trim() !== ""

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setFailed(null)
          onClose()
        }
      }}
      title="Order overtime"
      caption="It authorizes nothing until the person agrees on their own app."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            pending={issue.isPending}
            disabled={!ready}
            onClick={() => issue.mutate()}
          >
            {issue.isPending ? "Ordering…" : "Order it"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3.5">
        {failed !== null && <Banner tone="bad">{failed}</Banner>}

        <Field label="Who" required>
          <Select
            value={draft.employeeId}
            onChange={(next) => setDraft({ ...draft, employeeId: next })}
          >
            <option value="">Choose…</option>
            {people.map((person) => (
              <option key={person.employee_id} value={person.employee_id}>
                {person.full_name ?? person.employee_code}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date" required>
          <Day
            value={draft.onDate}
            onChange={(next) => setDraft({ ...draft, onDate: next })}
          />
        </Field>
        <Field
          label="Kind of day"
          hint="Which statutory pay table applies. A published holiday must be ordered as one — the server checks, and says so."
        >
          <Select
            value={draft.dayKind}
            onChange={(next) =>
              setDraft({
                ...draft,
                dayKind: next as NewOvertimeOrder["dayKind"],
              })
            }
          >
            <option value="WORKING">Ordinary working day</option>
            <option value="REST">Weekly rest day</option>
            <option value="HOLIDAY">Public holiday</option>
          </Select>
        </Field>
        <Field
          label="Minutes"
          required
          hint="Never hours: a fractional hour cannot round-trip."
        >
          <Input
            type="number"
            min={1}
            value={draft.plannedMinutes}
            onChange={(event) =>
              setDraft({
                ...draft,
                plannedMinutes: Number(event.target.value) || 0,
              })
            }
          />
        </Field>
        <Field
          label="Why"
          hint="Recorded against the instruction, and required."
          required
        >
          <Input
            value={draft.reason}
            onChange={(event) =>
              setDraft({ ...draft, reason: event.target.value })
            }
          />
        </Field>
      </div>
    </Sheet>
  )
}
