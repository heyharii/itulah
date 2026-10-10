import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { Lock } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, Select } from "@/components/ui/field"
import { PeopleSheet, SheetFoot } from "@/components/ui/people-sheet"
import { PeopleTable } from "@/components/ui/people-table"
import { Pill, Status } from "@/components/ui/pill"
import { Stat, StatStrip } from "@/components/ui/stat-strip"
import { Banner } from "@/components/ui/states"
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
  readMonth,
  rules,
  withdrawOvertime,
  type StoreScope,
} from "@/lib/queries/hr"
import { centreState, describeCentre } from "@/screens/hr/centre"
import {
  Facts,
  Fenced,
  Person,
  personCard,
  PersonPicker,
  Submit,
} from "@/screens/hr/parts"
import {
  personByLogin,
  personName,
  requestState,
  useTeam,
  type Tone,
} from "@/screens/hr/words"
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
/// while it is unanswered, may withdraw it.
export function HrOvertime() {
  const [ordering, setOrdering] = useState(false)
  return (
    <HrWorkspace
      primary={{
        label: "New overtime order",
        onClick: () => setOrdering(true),
      }}
    >
      {(scope) => (
        <Overtime scope={scope} ordering={ordering} onOrdering={setOrdering} />
      )}
    </HrWorkspace>
  )
}

/// An order's state in the module's four words. The worker's answer is the
/// approval here — they agree or they decline — so AGREED is Approved and
/// DECLINED is Rejected; who is being waited on is a fact in the sheet, not
/// part of the state's name.
function orderState(state: string): { label: string; tone: Tone } {
  switch (state) {
    case "AWAITING_CONSENT":
      return requestState("PENDING")
    case "AGREED":
      return requestState("APPROVED")
    case "DECLINED":
      return requestState("REJECTED")
    default:
      return requestState(state)
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
    queryKey: hrKeys.overtime(scope.unit_id),
    queryFn: ({ signal }) => awaitingOvertimeAt(scope.unit_id, signal),
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
        loading: "Reading the overtime orders…",
        what: "this shop's overtime orders",
        render: (queue) => {
          const byId = new Map<string, OvertimeOrderView>()
          for (const order of queue.rows) byId.set(order.id, order)
          for (const history of histories) {
            for (const order of history.data ?? []) {
              if (order.unit_id === scope.unit_id && !byId.has(order.id)) {
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
              <Fenced dropped={queue.elsewhere} place={scope.unit_id} />
              <StatStrip>
                <Stat
                  label="Pending"
                  value={queue.rows.length}
                  tone={queue.rows.length > 0 ? "warn" : undefined}
                />
                <Stat
                  label="Authorised this month"
                  value={readMinutes(authorisedThisMonth)}
                />
                <Stat
                  label="Rejected this month"
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
                empty="No overtime ordered."
                card={(order) => {
                  const state = orderState(order.state)
                  // Authorised hours exist only once the person has agreed;
                  // until then the figure is what was ordered.
                  const authorised = order.authorized_minutes
                  return {
                    ...personCard(team.data, order.employee_id, [
                      `${readDate(order.on_date, true)} · ${dayKindWord(order.day_kind)}`,
                    ]),
                    lead:
                      authorised === null
                        ? {
                            figure: readMinutes(order.planned_minutes),
                            caption: "ordered",
                          }
                        : {
                            figure: readMinutes(authorised),
                            caption: "authorised",
                          },
                    foot: {
                      info: <Status tone={state.tone}>{state.label}</Status>,
                      action: { label: "Open", onClick: () => setOpen(order) },
                    },
                  }
                }}
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
                    cell: (order) => readDate(order.on_date, true),
                  },
                  {
                    key: "kind",
                    header: "Kind",
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
                    cell: (order) => readMonth(order.on_date.slice(0, 7)),
                  },
                  {
                    key: "value",
                    header: "Value",
                    align: "right",
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
                    cell: (order) => {
                      const state = orderState(order.state)
                      return <Status tone={state.tone}>{state.label}</Status>
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

/// The rules the hours are paid under, in one quiet line. Head office's
/// numbers, read rather than restated — a multiplier printed here from memory
/// would be wrong the day head office changes it.
function Rules({ policy }: { policy: readonly PolicyView[] }) {
  if (policy.length === 0) return null
  return (
    <p className="mb-4 text-meta text-body">
      {policy
        .map(
          (rule) =>
            `${rule.label}: ${rule.value}${
              rule.unit === "TIMES"
                ? "×"
                : rule.unit === "HOUR"
                  ? " h"
                  : ` ${rule.unit.toLowerCase()}`
            }`,
        )
        .join(" · ")}
    </p>
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
      id={order.id}
      crumb="Overtime"
      title={personName(team, order.employee_id)}
      sub={`${readDate(order.on_date, true)} · ${dayKindWord(order.day_kind)}`}
      status={<Pill tone={state.tone}>{state.label}</Pill>}
      foot={
        open ? (
          <SheetFoot>
            <Button
              variant="danger"
              disabled={reason.trim() === ""}
              pending={withdraw.isPending}
              onClick={() => withdraw.mutate()}
            >
              {withdraw.isPending ? "Withdrawing…" : "Withdraw order"}
            </Button>
          </SheetFoot>
        ) : undefined
      }
    >
      <Facts
        rows={[
          ["Ordered by", personByLogin(team, order.ordered_by)],
          ["Ordered on", moment(order.ordered_at)],
          ["Hours ordered", readMinutes(order.planned_minutes)],
          [
            "Hours authorised",
            order.authorized_minutes === null
              ? "—"
              : readMinutes(order.authorized_minutes),
          ],
          ["Payroll month", readMonth(order.on_date.slice(0, 7))],
          ["Value", "Set at head office"],
          ["Because", order.ordered_reason, true],
          // Who is being waited on belongs here, not in the state's name.
          open && ["Waiting on", personName(team, order.employee_id)],
          order.answered_at !== null && ["Answered", moment(order.answered_at)],
          order.answered_reason !== null && [
            "Their reason",
            order.answered_reason,
            true,
          ],
          order.withdrawn_by !== null && [
            "Withdrawn by",
            personByLogin(team, order.withdrawn_by),
          ],
          order.withdrawn_reason !== null && [
            "Withdrawn because",
            order.withdrawn_reason,
            true,
          ],
        ]}
      />
      {open && (
        <div className="mt-6 flex flex-col gap-3">
          <Field label="Reason" required>
            <Input
              value={reason}
              placeholder="Delivery moved to Monday"
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          {withdraw.error !== null && (
            <Banner tone="bad">{describeCentre(withdraw.error)}</Banner>
          )}
        </div>
      )}
    </PeopleSheet>
  )
}

/// A new overtime order — the employer's written instruction.
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
      title="New overtime order"
      foot={
        <Submit
          label="Create overtime order"
          pendingLabel="Creating…"
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
          onCancel={onClose}
        />
      }
    >
      <div className="flex flex-col gap-3">
        <PersonPicker
          team={team}
          value={employeeId}
          onChange={setEmployeeId}
          label="Employee"
          required
        />
        <Field label="The day counts as" required>
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
            required
            problem={
              onDate !== "" && onDate < today
                ? "Pick today or later."
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
            required
            problem={
              tooLong ? `At most ${cap} hours on a working day.` : undefined
            }
            hint="e.g. 1.5"
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
        <Field label="Reason" required>
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
