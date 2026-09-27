import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { Lock, Plus } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, Select } from "@/components/ui/field"
import { PeopleSheet, SheetSection } from "@/components/ui/people-sheet"
import { PeopleTable } from "@/components/ui/people-table"
import { Pill } from "@/components/ui/pill"
import { Stat, StatStrip } from "@/components/ui/stat-strip"
import { moment } from "@/lib/format"
import {
  awaitingOvertimeAt,
  hrKeys,
  isoDay,
  isoMonth,
  orderOvertime,
  overtimeOrdersOf,
  readDate,
  readMinutes,
  rules,
  withdrawOvertime,
  type StoreScope,
} from "@/lib/queries/hr"
import { centreState } from "@/screens/hr/centre"
import { Facts, Fenced, Person, PersonPicker, Submit } from "@/screens/hr/parts"
import { personName, useTeam, type Tone } from "@/screens/hr/words"
import { HrWorkspace } from "@/screens/hr/workspace"
import type {
  EmployeeList,
  OvertimeOrderView,
  PolicyView,
} from "@itulah/contract"

/// Overtime at this shop — the prototype's store Overtime: the orders, what
/// each is waiting on, and the rules they are paid under.
///
/// "Kepala toko memerintahkan lembur, karyawan menyetujui di aplikasi": the
/// store head orders, the worker answers on their phone. That is PP 35/2021
/// art. 26(2)'s two written acts from two people, and the centre keeps their
/// keys disjoint — so there is no button here that agrees on somebody's
/// behalf, and an order nobody answers authorises nothing. The value of the
/// hours is head office's to compute (🔒); the shop records the order and,
/// while it is unanswered, may take it back.
export function HrOvertime() {
  const [ordering, setOrdering] = useState(false)
  return (
    <HrWorkspace
      sub="The store head orders overtime, the employee agrees in the app, and only then is it authorised. Head office works out what it is worth."
      actions={
        <Button variant="primary" onClick={() => setOrdering(true)}>
          <Plus />
          Order overtime
        </Button>
      }
    >
      {(scope) => (
        <Overtime scope={scope} ordering={ordering} onOrdering={setOrdering} />
      )}
    </HrWorkspace>
  )
}

/// What an order's state means, said as what it waits for.
function orderState(state: string): { label: string; tone: Tone } {
  switch (state) {
    case "AWAITING_CONSENT":
      return { label: "Waiting on the employee", tone: "warn" }
    case "AGREED":
      return { label: "Agreed · authorised", tone: "ok" }
    case "DECLINED":
      return { label: "Declined", tone: "bad" }
    case "WITHDRAWN":
      return { label: "Withdrawn", tone: "neutral" }
    default:
      return { label: state, tone: "neutral" }
  }
}

function dayKindWord(kind: string): string {
  if (kind === "WORKING") return "Working day"
  if (kind === "REST") return "Rest day"
  if (kind === "HOLIDAY") return "Public holiday"
  return kind
}

function Overtime({
  scope,
  ordering,
  onOrdering,
}: {
  scope: StoreScope
  ordering: boolean
  onOrdering: (open: boolean) => void
}) {
  const team = useTeam(scope)
  const awaiting = useQuery({
    queryKey: hrKeys.overtime(scope.id),
    queryFn: ({ signal }) => awaitingOvertimeAt(scope.id, signal),
  })
  const people = (team.data?.rows ?? []).filter(
    (person) => person.status === "ACTIVE",
  )
  // Every order, answered or not, is only answered per person.
  const histories = useQueries({
    queries: people.map((person) => ({
      queryKey: hrKeys.overtimeOf(person.employee_id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        overtimeOrdersOf(person.employee_id, signal),
    })),
  })
  const policy = useQuery({
    queryKey: hrKeys.rules("overtime"),
    queryFn: ({ signal }) => rules("overtime", signal),
    staleTime: 5 * 60_000,
  })
  const [open, setOpen] = useState<OvertimeOrderView | null>(null)
  const month = isoMonth(new Date())

  return (
    <>
      {centreState(awaiting, {
        loading: "Reading the orders…",
        what: "this shop's overtime orders",
        render: (queue) => {
          const byId = new Map<string, OvertimeOrderView>()
          for (const order of queue.rows) byId.set(order.id, order)
          for (const history of histories) {
            for (const order of history.data ?? []) {
              if (order.unit_id === scope.id && !byId.has(order.id)) {
                byId.set(order.id, order)
              }
            }
          }
          const rows = [...byId.values()].sort((left, right) =>
            right.on_date.localeCompare(left.on_date),
          )
          const authorisedThisMonth = rows
            .filter(
              (order) =>
                order.state === "AGREED" && order.on_date.startsWith(month),
            )
            .reduce(
              (total, order) => total + (order.authorized_minutes ?? 0),
              0,
            )

          return (
            <>
              <Fenced dropped={queue.elsewhere} place={scope.id} />
              <StatStrip>
                <Stat
                  label="Waiting on the employee"
                  value={queue.rows.length}
                  tone={queue.rows.length > 0 ? "warn" : undefined}
                />
                <Stat
                  label="Authorised this month"
                  value={readMinutes(authorisedThisMonth)}
                />
                <Stat
                  label="Declined this month"
                  value={
                    rows.filter(
                      (order) =>
                        order.state === "DECLINED" &&
                        order.on_date.startsWith(month),
                    ).length
                  }
                />
              </StatStrip>

              <Rules policy={policy.data ?? []} />

              <PeopleTable
                rows={rows}
                rowKey={(order) => order.id}
                onRowClick={setOpen}
                empty={`No overtime has been ordered at ${scope.label}.`}
                columns={[
                  {
                    key: "who",
                    header: "Employee",
                    cell: (order) => (
                      <Person team={team.data} id={order.employee_id} />
                    ),
                  },
                  {
                    key: "date",
                    header: "Date",
                    card: "meta",
                    cell: (order) => readDate(order.on_date, true),
                  },
                  {
                    key: "kind",
                    header: "Kind",
                    card: "meta",
                    cell: (order) => dayKindWord(order.day_kind),
                  },
                  {
                    key: "ordered",
                    header: "Ordered",
                    align: "right",
                    cell: (order) => readMinutes(order.planned_minutes),
                  },
                  {
                    key: "authorised",
                    header: "Authorised",
                    align: "right",
                    // Null in every state but AGREED — a figure anything
                    // downstream may act on does not exist until the person
                    // has said yes.
                    cell: (order) =>
                      order.authorized_minutes === null
                        ? "—"
                        : readMinutes(order.authorized_minutes),
                  },
                  {
                    key: "period",
                    header: "Payroll",
                    card: "hide",
                    cell: (order) => readMonthShort(order.on_date),
                  },
                  {
                    key: "value",
                    header: "Value",
                    align: "right",
                    card: "hide",
                    cell: () => (
                      <span
                        className="inline-flex items-center gap-1 text-mute"
                        title="Worked out at head office"
                      >
                        <Lock className="size-3.5" />
                        HO
                      </span>
                    ),
                  },
                  {
                    key: "state",
                    header: "Status",
                    card: "status",
                    cell: (order) => {
                      const state = orderState(order.state)
                      return <Pill tone={state.tone}>{state.label}</Pill>
                    },
                  },
                ]}
              />
            </>
          )
        },
      })}

      {open !== null && (
        <OrderSheet
          key={open.id}
          order={open}
          team={team.data}
          onClose={() => setOpen(null)}
        />
      )}
      {ordering && (
        <OrderForm
          team={team.data}
          policy={policy.data ?? []}
          onClose={() => onOrdering(false)}
        />
      )}
    </>
  )
}

/// `2026-09-14` → `Sep 2026`, the payroll month an order lands in.
function readMonthShort(iso: string): string {
  const parsed = new Date(`${iso.slice(0, 7)}-01T00:00:00`)
  return parsed.toLocaleDateString("id-ID", { month: "short", year: "numeric" })
}

/// The rules the hours are paid under, as the prototype's chips. Head office's
/// numbers, read rather than restated — a multiplier printed here from memory
/// would be wrong the day head office changes it.
function Rules({ policy }: { policy: readonly PolicyView[] }) {
  if (policy.length === 0) return null
  return (
    <div className="mb-4 flex flex-wrap gap-1.5">
      {policy.map((rule) => (
        <Pill key={rule.key} tone="neutral">
          {rule.label}: {rule.value}
          {rule.unit === "TIMES"
            ? "×"
            : rule.unit === "HOUR"
              ? " h"
              : ` ${rule.unit.toLowerCase()}`}
        </Pill>
      ))}
    </div>
  )
}

/// One order, and the one thing the shop may still do to it.
function OrderSheet({
  order,
  team,
  onClose,
}: {
  order: OvertimeOrderView
  team: EmployeeList | undefined
  onClose: () => void
}) {
  const client = useQueryClient()
  const [reason, setReason] = useState("")
  const withdraw = useMutation({
    mutationFn: () =>
      withdrawOvertime({
        employeeId: order.employee_id,
        orderId: order.id,
        reason,
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: hrKeys.queue() })
      onClose()
    },
  })
  const state = orderState(order.state)
  const open = order.state === "AWAITING_CONSENT"

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      crumb={
        <>
          Overtime · <span className="font-mono">{order.id}</span>
        </>
      }
      title={personName(team, order.employee_id)}
      sub={`${readDate(order.on_date, true)} · ${dayKindWord(order.day_kind)}`}
      status={<Pill tone={state.tone}>{state.label}</Pill>}
      foot={
        open ? (
          <div className="flex flex-col gap-3">
            <Field
              label="Why take it back"
              hint="Required. The order and its withdrawal both stay on the record."
            >
              <Input
                value={reason}
                placeholder="Delivery moved to Monday"
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
            <Submit
              label="Withdraw the order"
              pending={withdraw.isPending}
              disabled={reason.trim() === ""}
              error={withdraw.error}
              onSubmit={() => withdraw.mutate()}
            />
          </div>
        ) : undefined
      }
    >
      <SheetSection title="The order">
        <Facts
          rows={[
            ["Ordered by", `${order.ordered_by} · ${moment(order.ordered_at)}`],
            ["Hours", readMinutes(order.planned_minutes)],
            ["Because", order.ordered_reason],
            [
              "Employee's answer",
              order.answered_at === null
                ? "not yet — it waits in their app"
                : `${order.state === "AGREED" ? "Agreed" : "Declined"} · ${moment(order.answered_at)}`,
            ],
            order.answered_reason !== null && [
              "They said",
              order.answered_reason,
            ],
            order.withdrawn_by !== null && [
              "Withdrawn",
              `${order.withdrawn_by}${order.withdrawn_reason === null ? "" : ` · ${order.withdrawn_reason}`}`,
            ],
          ]}
        />
      </SheetSection>
      <SheetSection title="Authorised">
        <Facts
          rows={[
            [
              "Hours",
              order.authorized_minutes === null
                ? "nothing yet"
                : readMinutes(order.authorized_minutes),
            ],
            ["Payroll", readMonthShort(order.on_date)],
            ["Value", "worked out at head office from the kind of day"],
          ]}
        />
      </SheetSection>
      <p className="text-meta text-mute">
        Nobody can agree on the employee's behalf — that is the second of the
        two written acts the law asks for, and it is theirs.
      </p>
    </PeopleSheet>
  )
}

/// Order overtime — the employer's written instruction.
function OrderForm({
  team,
  policy,
  onClose,
}: {
  team: EmployeeList | undefined
  policy: readonly PolicyView[]
  onClose: () => void
}) {
  const client = useQueryClient()
  const today = isoDay(new Date())
  const [employeeId, setEmployeeId] = useState("")
  const [onDate, setOnDate] = useState(today)
  const [dayKind, setDayKind] = useState<"WORKING" | "REST" | "HOLIDAY">(
    "WORKING",
  )
  const [hours, setHours] = useState("")
  const [reason, setReason] = useState("")
  const cap = policy.find(
    (rule) => rule.key === "overtime.workday_max_hours",
  )?.value
  const planned = Number(hours.replace(",", "."))
  const tooLong =
    dayKind === "WORKING" &&
    cap !== undefined &&
    Number.isFinite(planned) &&
    planned > cap

  const order = useMutation({
    mutationFn: () =>
      orderOvertime({
        employeeId,
        onDate,
        dayKind,
        plannedMinutes: Math.round(planned * 60),
        reason,
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: hrKeys.queue() })
      onClose()
    },
  })

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      crumb="Overtime"
      title="Order overtime"
      sub={`${employeeId === "" ? "The employee" : personName(team, employeeId)} must agree in the app before it counts.`}
      foot={
        <Submit
          label="Send the order"
          pending={order.isPending}
          disabled={
            employeeId === "" ||
            onDate === "" ||
            onDate < today ||
            !(planned > 0) ||
            tooLong ||
            reason.trim() === ""
          }
          error={order.error}
          onSubmit={() => order.mutate()}
        />
      }
    >
      <div className="flex flex-col gap-3">
        <PersonPicker
          team={team}
          value={employeeId}
          onChange={setEmployeeId}
          label="Employee"
        />
        <Field label="The day counts as">
          <Select
            value={dayKind}
            onChange={(value) => setDayKind(value as typeof dayKind)}
          >
            <option value="WORKING">A working day</option>
            <option value="REST">A rest day</option>
            <option value="HOLIDAY">A public holiday</option>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Date"
            problem={
              onDate !== "" && onDate < today
                ? "Overtime is ordered before it is worked."
                : undefined
            }
          >
            <Input
              type="date"
              value={onDate}
              min={today}
              onChange={(event) => setOnDate(event.target.value)}
            />
          </Field>
          <Field
            label="Hours"
            problem={
              tooLong ? `At most ${cap} hours on a working day.` : undefined
            }
            hint="1.5 is an hour and a half."
          >
            <Input
              inputMode="decimal"
              value={hours}
              placeholder="2"
              onChange={(event) =>
                setHours(event.target.value.replace(/[^\d.,]/g, ""))
              }
            />
          </Field>
        </div>
        <Field label="Why" hint="The reason is the instruction's record.">
          <Input
            value={reason}
            placeholder="Stock count before the sale"
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </div>
    </PeopleSheet>
  )
}
