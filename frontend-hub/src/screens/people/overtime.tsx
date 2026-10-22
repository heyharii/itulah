import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef, SortingState } from "@tanstack/react-table"
import { useTable } from "@tanstack/react-table"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { useLayout } from "@/lib/layout"
import { Fab } from "@/components/ui/fab"
import { Day } from "@/components/ui/day"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { Field, Input, Select } from "@/components/ui/field"
import { FilterPanel } from "@/components/ui/filter-panel"
import { PageHeader } from "@/components/ui/page-header"
import { Pill, Status } from "@/components/ui/pill"
import { SubTabs } from "@/components/ui/sub-tabs"
import { Fact, Facts, Sheet } from "@/components/ui/sheet"
import { Banner, EmptyState } from "@/components/ui/states"
import { useFilters } from "@/lib/filters"
import {
  currentMonth,
  overtimeOrdersIn,
  overtimeOrdersKey,
  stepMonth,
  useActiveEmployees,
  type OvertimeShow,
} from "@/lib/queries/hr-time"
import { day, label, weekday } from "@/lib/format"
import {
  awaitingOvertime,
  orderOvertime,
  overtimeKeys,
  overtimeStateLabel,
  readMinutesSpan,
  readOvertimePolicy,
  withdrawOvertime,
  type NewOvertimeOrder,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useSheet } from "@/lib/sheets"
import { tableSetup, type TableSetup } from "@/lib/table"
import {
  CardButton,
  CardFigure,
  CardName,
  PhoneCards,
} from "@/components/ui/phone-cards"
import { HrScope, useUnitFilter } from "@/screens/people/parts"
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

/// Waiting on somebody is the normal state of this list, so it stays grey;
/// only a refusal is coloured.
function stateTone(state: string): "ok" | "bad" | "neutral" {
  switch (state) {
    case "AGREED":
      return "ok"
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
      // Read at render, not from the accessor: the table caches a row's
      // values, and the names arrive after the orders.
      cell: ({ row }) => nameOf(row.original.employee_id),
    },
    {
      accessorKey: "on_date",
      header: "Date",
      size: 170,
      /// "This week" is the whole reason somebody opens this list — an order for
      /// tomorrow night that nobody has answered is the one worth chasing today.
      meta: { filter: { kind: "date" } },
      cell: ({ row }) => weekday(row.original.on_date, true),
    },
    {
      accessorKey: "day_kind",
      header: "Day type",
      size: 130,
      /// Which statutory pay table applies — Kepmenaker 102/2004 has one schedule
      /// for ordinary days and another for rest days and holidays. Never a rate.
      /// Filterable because those are different schedules: "the rest-day and
      /// holiday orders" is one clause and a different conversation.
      meta: { filter: { kind: "option", format: label } },
      cell: ({ row }) => label(row.original.day_kind),
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
      header: "Status",
      size: 230,
      /// The honest form of the question the Authorized column cannot be asked:
      /// waiting, agreed, declined. A fact to read and to narrow by — never a
      /// control. Nothing in this panel can change a state, which is the whole
      /// discipline of this screen.
      meta: { filter: { kind: "option", format: overtimeStateLabel } },
      cell: ({ row }) => (
        <Status tone={stateTone(row.original.state)}>
          {overtimeStateLabel(row.original.state)}
        </Status>
      ),
    },
  ]
}

const SHOWS = [
  { value: "WAITING", label: "Waiting" },
  { value: "AGREED", label: "Agreed" },
  { value: "DECLINED", label: "Declined" },
  { value: "ALL", label: "All" },
] as const

export function Overtime() {
  const phone = useLayout() === "phone"
  const order = useSheet("overtimeOrder")
  const [ordering, setOrdering] = useState(false)
  const { people, nameOf } = useActiveEmployees()
  /// Unit ids are codes; the people list knows what each is called.
  const unitNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const one of people) {
      if (one.unit_id !== null)
        map.set(one.unit_id, one.unit_name ?? one.unit_id)
    }
    return map
  }, [people])
  const columns = useMemo(() => columnsFor(nameOf), [nameOf])
  const [sorting, setSorting] = useState<SortingState>([
    { id: "on_date", desc: false },
  ])

  const policy = useQuery({
    queryKey: overtimeKeys.policy(),
    queryFn: ({ signal }) => readOvertimePolicy(signal),
  })
  /// Which orders: the queue — what nobody has answered, the reason this
  /// screen is opened — or what became of the rest since the start of last
  /// month (owner, 2026-10-16: agreed and declined listed too).
  const [show, setShow] = useState<OvertimeShow>("WAITING")
  const since = `${stepMonth(currentMonth(), -1)}-01`
  const awaiting = useQuery({
    queryKey: overtimeKeys.awaiting(),
    queryFn: ({ signal }) => awaitingOvertime(signal),
    enabled: show === "WAITING",
  })
  const answered = useQuery({
    queryKey: overtimeOrdersKey(show, since),
    queryFn: ({ signal }) => overtimeOrdersIn(show, since, signal),
    enabled: show !== "WAITING",
  })
  const queue = show === "WAITING" ? awaiting : answered

  // The unit is HR's own, kept as you move between its pages.
  const place = useUnitFilter()
  const rows = useMemo(
    () =>
      (queue.data ?? []).filter(
        (row) => place.unitId === null || row.unit_id === place.unitId
      ),
    [queue.data, place.unitId]
  )

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
        title="Overtime"
        actions={
          !phone && (
            <Button
              variant="primary"
              disabled={caps === null}
              onClick={() => setOrdering(true)}
            >
              Order overtime
            </Button>
          )
        }
      />
      {caps !== null && (
        <Fab label="Order overtime" onClick={() => setOrdering(true)} />
      )}

      {/* No caps, no orders. Said plainly rather than shown as an empty list:
          the two look identical and mean opposite things. */}
      {policy.isSuccess && caps === null && (
        <Banner tone="bad" className="mb-4">
          No overtime limits are set, so no overtime can be ordered.
        </Banner>
      )}

      <HrScope
        unit={place}
        lead={
          <SubTabs
            tabs={SHOWS}
            value={show}
            onChange={(next) => setShow(next as OvertimeShow)}
          />
        }
      >
        <FilterPanel model={filters} table={table} />
      </HrScope>

      <Card className="mb-4 overflow-hidden max-md:overflow-visible max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        {queryState(queue, {
          loading: "Reading the orders…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                {show === "WAITING"
                  ? "No orders waiting on an answer."
                  : "No orders since the start of last month."}
              </EmptyState>
            ) : phone ? (
              <PhoneCards
                rows={table.getRowModel().rows.map((one) => one.original)}
                onOpen={(row) => order.open(row.id)}
                empty="No order matches the filters."
                rowId={(row) => row.id}
                spec={{
                  title: (row) => (
                    <CardName
                      name={nameOf(row.employee_id)}
                      line={[
                        `${weekday(row.on_date, true)} · ${label(row.day_kind)}`,
                        unitNames.get(row.unit_id) ?? row.unit_id,
                      ]}
                    />
                  ),
                  lead: (row) => (
                    <CardFigure
                      value={readMinutesSpan(row.planned_minutes)}
                      caption="ordered"
                    />
                  ),
                  foot: (row) => (
                    <Status tone={stateTone(row.state)}>
                      {overtimeStateLabel(row.state)}
                    </Status>
                  ),
                  action: (row) => (
                    <CardButton
                      label="Open"
                      ariaLabel={`Open the order for ${nameOf(row.employee_id)}`}
                      onClick={() => order.open(row.id)}
                    />
                  ),
                }}
              />
            ) : (
              <DataTable<OvertimeOrderView>
                refresh={[queue]}
                table={table}
                onRowClick={(row) => order.open(row.id)}
                isSelected={(row) => row.id === order.value}
                // "Nothing is waiting" is the good outcome this screen hopes
                // for, so a narrowing that produces the same empty box has to
                // say which of the two it is.
                empty="No order matches the filters."
              />
            ),
        })}
      </Card>

      <OrderSheet
        order={open}
        unitName={open === null ? null : (unitNames.get(open.unit_id) ?? null)}
        onClose={order.close}
      />
      <OrderOvertimeSheet open={ordering} onClose={() => setOrdering(false)} />
    </PageContent>
  )
}

function OrderSheet({
  order,
  unitName,
  onClose,
}: {
  order: OvertimeOrderView | null
  unitName: string | null
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
      void client.invalidateQueries({
        queryKey: ["people", "overtime", "orders"],
      })
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
      badge={
        <Pill tone={stateTone(order.state)}>
          {overtimeStateLabel(order.state)}
        </Pill>
      }
    >
      <Facts>
        <Fact term="Employee">{nameOf(order.employee_id)}</Fact>
        <Fact term="Unit">{unitName ?? order.unit_id}</Fact>
        <Fact term="Day type">{label(order.day_kind)}</Fact>
        <Fact term="Ordered">{readMinutesSpan(order.planned_minutes)}</Fact>
        {/* The figure anything downstream may act on. Absent until agreed. */}
        <Fact term="Authorized">
          {order.authorized_minutes === null
            ? "nothing yet"
            : readMinutesSpan(order.authorized_minutes)}
        </Fact>
        <Fact term="Ordered by">{nameOf(order.ordered_by)}</Fact>
        <Fact term="Reason">{order.ordered_reason}</Fact>
        {order.answered_by !== null && (
          <Fact term="Answered by">{nameOf(order.answered_by)}</Fact>
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
          <Field label="Why" required>
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
          Answered orders cannot be taken back.
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
  // The same read as the page: the limits sit beside the minutes they bound.
  const policy = useQuery({
    queryKey: overtimeKeys.policy(),
    queryFn: ({ signal }) => readOvertimePolicy(signal),
    enabled: open,
  })
  const caps = policy.data ?? null

  const issue = useMutation({
    mutationFn: () => orderOvertime(draft),
    onSuccess: () => {
      setFailed(null)
      setDraft(blank)
      void client.invalidateQueries({ queryKey: overtimeKeys.awaiting() })
      void client.invalidateQueries({
        queryKey: ["people", "overtime", "orders"],
      })
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
      footer={
        <div className="flex justify-end gap-2">
          <Button data-cancel variant="quiet" onClick={onClose}>
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
        <Field label="Kind of day">
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
          aside={
            caps === null
              ? undefined
              : `up to ${readMinutesSpan(caps.max_per_day_minutes)} a day, ${readMinutesSpan(caps.max_per_week_minutes)} a week`
          }
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
        <Field label="Why" required>
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
