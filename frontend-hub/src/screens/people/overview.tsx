import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Clock4, FileWarning, Inbox } from "lucide-react"
import { useCallback, useMemo } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { ExceptionQueue, type Exception } from "@/components/ui/exception-queue"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Banner, ErrorState } from "@/components/ui/states"
import { count, day } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import {
  awaitingOvertime,
  expiringContracts,
  listEmployees,
  listWorkforce,
  peopleKeys,
  pendingLeave,
  readMinutesSpan,
  rosterKeys,
  attendancePeriods,
  leaveKeys,
  overtimeKeys,
} from "@/lib/queries/people"
import { UnitChoice, useUnit } from "@/screens/people/parts"

/// The front door: what is waiting on this person, and what is about to go
/// wrong if nobody looks.
///
/// # Exceptions first, and no vanity numbers above them
///
/// `DESIGN.md` is blunt about what an overview is for, and `ExceptionQueue`
/// exists because of it: a screen of green counters tells somebody their day
/// is fine, and a queue of problems tells them what their day *is*. So the
/// queue is at the top, each row carries a severity and exactly one action,
/// and the counters sit underneath as context rather than as the point.
///
/// The queue stays empty until all of its sources have answered; partial data
/// is not evidence that nothing needs attention.

/// # Names, not uuids
///
/// The leave and overtime queues carry `employee_id` and no name — they are
/// views of a decision, not of a person. So this screen resolves them against
/// the workforce it is already allowed to read. A queue that says
/// `emp_174c7e88…` is a queue nobody can triage.
export function PeopleOverview() {
  const navigate = useNavigate()
  const go = useCallback(
    (to: string) => () => navigate({ to } as never),
    [navigate]
  )
  const unit = useUnit()

  const leave = useQuery({
    queryKey: leaveKeys.pending(),
    queryFn: ({ signal }) => pendingLeave(signal),
  })
  const overtime = useQuery({
    queryKey: overtimeKeys.awaiting(),
    queryFn: ({ signal }) => awaitingOvertime(signal),
  })
  const expiring = useQuery({
    queryKey: peopleKeys.expiring(30),
    queryFn: ({ signal }) => expiringContracts({ withinDays: 30 }, signal),
  })
  /// The envelope rather than the rows: `total` is every person the caller may
  /// read, not the size of one page, and that distinction is the whole point
  /// of the count on this screen.
  const workforce = useQuery({
    queryKey: peopleKeys.employees({ status: "ACTIVE", limit: 1 }),
    queryFn: ({ signal }) =>
      listWorkforce({ status: "ACTIVE", limit: 1 }, signal),
  })
  const team = useQuery({
    queryKey: peopleKeys.employees({ status: "ACTIVE", limit: 1000 }),
    queryFn: ({ signal }) =>
      listEmployees({ status: "ACTIVE", limit: 1000 }, signal),
  })
  const periods = useQuery({
    queryKey: rosterKeys.periods(unit.place ?? ""),
    queryFn: ({ signal }) => attendancePeriods(unit.place ?? "", signal),
    enabled: unit.place !== null,
  })

  const named = useMemo(() => {
    const map = new Map<string, string>()
    for (const person of team.data ?? []) {
      map.set(person.employee_id, person.full_name ?? person.employee_code)
    }
    return map
  }, [team.data])

  const who = useCallback((id: string) => named.get(id) ?? id, [named])

  const exceptions = useMemo<Exception[]>(() => {
    const found: Exception[] = []

    // A term that has already run out is a person working without a contract,
    // which is a legal problem rather than a data one — so the negative rows
    // outrank everything else on the screen.
    for (const contract of expiring.data ?? []) {
      const days = Number(contract.days_remaining)
      found.push({
        id: `contract-${contract.employee_id}`,
        title:
          days < 0
            ? `${contract.full_name ?? contract.employee_code}'s contract ended and nobody noticed`
            : `${contract.full_name ?? contract.employee_code}'s contract runs out`,
        detail: `${contract.position} · ends ${day(contract.ends_on)}`,
        amount: days < 0 ? `${Math.abs(days)}d ago` : `${days}d`,
        severity: days < 0 ? "high" : days <= 7 ? "high" : "medium",
        icon: <FileWarning className="size-4" />,
        onOpen: go("/people"),
      })
    }

    for (const request of leave.data ?? []) {
      found.push({
        id: `leave-${request.id}`,
        title: `${who(request.employee_id)} is asking for ${request.leave_type_name.toLowerCase()}`,
        detail: `${day(request.from_date)} — ${day(request.to_date)} · ${request.reason}`,
        amount: `${request.chargeable_days}d`,
        severity: "high",
        icon: <Inbox className="size-4" />,
        onOpen: go("/people/requests"),
      })
    }

    // Medium, and not actionable from here: the answer belongs to the person
    // it was ordered for. An order nobody answers authorizes nothing, which is
    // overtime worked unpaid or not worked at all — so it is worth seeing
    // without being worth a button.
    for (const order of overtime.data ?? []) {
      found.push({
        id: `overtime-${order.id}`,
        title: `${who(order.employee_id)} has not answered an overtime order`,
        detail: `${day(order.on_date)} · ordered by ${order.ordered_by}`,
        amount: readMinutesSpan(order.planned_minutes),
        severity: "medium",
        icon: <Clock4 className="size-4" />,
        onOpen: go("/people/overtime"),
      })
    }

    return found
  }, [expiring.data, leave.data, overtime.data, go, who])

  const open = (periods.data ?? []).filter((one) => one.status !== "CLOSED")

  /// The empty sentence is meaningful only after every source that can put
  /// something in the queue has answered. Keep the sources together so a
  /// slow or refused read can never look like an all-clear.
  const queueRead = {
    isPending:
      leave.isPending ||
      overtime.isPending ||
      expiring.isPending ||
      team.isPending,
    isError:
      leave.isError || overtime.isError || expiring.isError || team.isError,
    error: leave.error ?? overtime.error ?? expiring.error ?? team.error,
    data: exceptions,
    refetch: () => {
      void Promise.all([
        leave.refetch(),
        overtime.refetch(),
        expiring.refetch(),
        team.refetch(),
      ])
    },
  }

  const workforceValue = workforce.isPending
    ? "Loading…"
    : workforce.isError
      ? "Unavailable"
      : count(Number(workforce.data.total))
  const leaveValue = leave.isPending
    ? "Loading…"
    : leave.isError
      ? "Unavailable"
      : count(leave.data.length)
  const overtimeValue = overtime.isPending
    ? "Loading…"
    : overtime.isError
      ? "Unavailable"
      : count(overtime.data.length)
  const periodsValue =
    unit.place === null
      ? "No unit available"
      : periods.isPending
        ? "Loading…"
        : periods.isError
          ? "Unavailable"
          : count(open.length)

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Overview"
        sub={
          unit.employer
            ? "What is waiting on you across the company, and what is about to go wrong."
            : `What is waiting on you at ${unit.name ?? "your place"}.`
        }
        actions={
          <UnitChoice
            place={unit.place}
            places={unit.places}
            onChange={unit.setPlace}
          />
        }
      />

      {queryState(queueRead, {
        loading: "Checking contracts, leave requests and overtime orders…",
        render: (rows) => (
          <ExceptionQueue
            exceptions={rows}
            empty="No contracts are past due or ending in the next 30 days, and no leave requests or overtime orders are waiting."
          />
        ),
      })}

      <KpiStrip className="md:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Working here" value={workforceValue} />
        <Kpi label="Leave waiting on a decision" value={leaveValue} />
        <Kpi label="Overtime unanswered" value={overtimeValue} />
        <Kpi
          label={`Months still open at ${unit.name ?? "your place"}`}
          value={periodsValue}
          delta={
            unit.place !== null &&
            !periods.isPending &&
            !periods.isError &&
            open.length > 0 ? (
              <button
                type="button"
                onClick={go("/people/periods")}
                className="text-left underline decoration-hairline-2 underline-offset-2 hover:decoration-current"
              >
                sign one off
              </button>
            ) : undefined
          }
        />
      </KpiStrip>

      {workforce.isError && (
        <ErrorState
          error={workforce.error}
          onRetry={() => void workforce.refetch()}
        />
      )}
      {unit.place !== null && periods.isError && (
        <ErrorState
          error={periods.error}
          onRetry={() => void periods.refetch()}
        />
      )}

      <Banner tone="info">
        For today’s attendance and worked hours, open{" "}
        <AppLink to="/people/attendance-days">Attendance</AppLink>.
      </Banner>
    </PageContent>
  )
}
