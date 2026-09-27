import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  Clock4,
  FileWarning,
  Receipt,
  ReceiptText,
  UserPlus,
} from "lucide-react"
import { useCallback, useMemo } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { AppLink } from "@/components/ui/app-link"
import { ExceptionQueue, type Exception } from "@/components/ui/exception-queue"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Banner, ErrorState } from "@/components/ui/states"
import { count, day, money } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import {
  awaitingOvertime,
  claimsKeys,
  expiringContracts,
  hireKeys,
  listClaims,
  listEmployees,
  listHireProposals,
  listRuns,
  listWorkforce,
  payKeys,
  peopleKeys,
  pendingLeave,
  readMinutesSpan,
  rosterKeys,
  attendancePeriods,
  leaveKeys,
  overtimeKeys,
} from "@/lib/queries/people"
import { UnitChoice, useUnit } from "@/screens/people/parts"
import { RequestQueues } from "@/screens/people/requests"

/// The front door, and the one queue: what is waiting on this person, and what
/// is about to go wrong if nobody looks.
///
/// # One screen where there were two
///
/// This screen listed what was waiting and sent people to Requests to decide
/// it — two front doors onto one queue, the second holding the same leave
/// again. The owner asked for a shorter menu on 2026-09-27, so the decisions
/// are made here: the attention list first, then the leave, corrections and
/// swaps the reader decides (`RequestQueues`), then the counters as context.
///
/// # Exceptions first, and no vanity numbers above them
///
/// `DESIGN.md` is blunt about what an overview is for, and `ExceptionQueue`
/// exists because of it: a screen of green counters tells somebody their day
/// is fine, and a queue of problems tells them what their day *is*. So the
/// queue is at the top, each row carries a severity and exactly one action,
/// and the counters sit underneath as context rather than as the point.
///
/// Leave is not a row in it: the leave table below is where leave is decided,
/// and a row pointing at a table on the same page is the same request twice.
/// What the list carries is everything decided on another screen — a claim,
/// a hire request, a payroll run — and what nobody here can decide at all:
/// a contract running out, an overtime order the worker has not answered.
///
/// The queue stays empty until all of its sources have answered; partial data
/// is not evidence that nothing needs attention.

/// # Names, not uuids
///
/// The overtime queue carries `employee_id` and no name — it is a view of a
/// decision, not of a person. So this screen resolves it against the
/// workforce it is already allowed to read. A queue that says
/// `emp_174c7e88…` is a queue nobody can triage.
export function PeopleOverview() {
  const navigate = useNavigate()
  const go = useCallback(
    (to: string, search?: Record<string, string>) => () =>
      navigate({ to, search } as never),
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
  /// Claims waiting on a sanction — bounded by the caller's posting on the
  /// server, the same read the Claims screen's queue makes.
  const claims = useQuery({
    queryKey: claimsKeys.queue(),
    queryFn: ({ signal }) => listClaims({ state: "SUBMITTED" }, signal),
  })
  const hires = useQuery({
    queryKey: hireKeys.list(),
    queryFn: ({ signal }) => listHireProposals(signal),
  })
  /// A run waits on head office alone — a unit's part is sending it, which
  /// it does from Payroll — so a unit never asks.
  const runs = useQuery({
    queryKey: payKeys.runs(),
    queryFn: ({ signal }) => listRuns(signal),
    enabled: unit.employer,
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
    queryKey: rosterKeys.periods(unit.unitId ?? ""),
    queryFn: ({ signal }) => attendancePeriods(unit.unitId ?? "", signal),
    enabled: unit.unitId !== null,
  })

  const named = useMemo(() => {
    const map = new Map<string, string>()
    for (const person of team.data ?? []) {
      map.set(person.employee_id, person.full_name ?? person.employee_code)
    }
    return map
  }, [team.data])

  const who = useCallback((id: string) => named.get(id) ?? id, [named])
  const unitName = useCallback(
    (id: string) => unit.units.find((one) => one.id === id)?.name ?? id,
    [unit.units]
  )

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
        onOpen: go("/people", { employee: contract.employee_id }),
      })
    }

    // Money somebody spent for the company, waiting on the one sanction the
    // person who filed it may not give. Decided on the claim's own sheet,
    // where the receipt and the per-line amounts are.
    for (const claim of claims.data ?? []) {
      found.push({
        id: `claim-${claim.claim_id}`,
        title: `${claim.employee_name ?? claim.employee_code ?? "A claim"} is waiting on a decision`,
        detail: `${claim.claim_number} · ${claim.unit_name ?? claim.unit_id} · filed ${day(claim.posted_on)}`,
        amount: money(claim.claimed_minor),
        severity: "high",
        icon: <ReceiptText className="size-4" />,
        onOpen: go("/people/claims", { claim: claim.claim_id }),
      })
    }

    // A hire request is on one desk at a time: head office's while it is
    // proposed or approved with no record opened, the shop's when it was
    // sent back. Only the reader's own desk is listed.
    for (const hire of hires.data ?? []) {
      const where = hire.unit_name ?? hire.unit_id
      const title = unit.employer
        ? hire.state === "PROPOSED"
          ? `${where} is asking to hire`
          : hire.state === "APPROVED"
            ? `An approved hire at ${where} has no employment record yet`
            : null
        : hire.state === "RETURNED"
          ? `Head office sent a hire request back to ${where}`
          : null
      if (title === null) continue
      found.push({
        id: `hire-${hire.id}`,
        title,
        detail: `Version ${hire.current_version} · asked ${day(hire.created_at)}`,
        amount: `${count(hire.outstanding)} ${hire.outstanding === 1 ? "person" : "people"}`,
        severity: "medium",
        icon: <UserPlus className="size-4" />,
        onOpen: go("/people/hire", { hireProposal: hire.id }),
      })
    }

    // A run a unit has sent is waiting on the second signature, and nothing
    // reaches Finance until it has one.
    for (const run of runs.data ?? []) {
      if (run.state !== "SUBMITTED") continue
      found.push({
        id: `run-${run.id}`,
        title: `${unitName(run.unit_id)}'s payroll for ${run.period} is waiting on approval`,
        detail: run.complete
          ? "Sent by the place"
          : (run.incomplete_because ?? "Sent by the place, incomplete"),
        severity: "high",
        icon: <Receipt className="size-4" />,
        onOpen: go("/people/payroll", { payrollRun: run.id }),
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
  }, [
    expiring.data,
    claims.data,
    hires.data,
    runs.data,
    overtime.data,
    unit.employer,
    go,
    who,
    unitName,
  ])

  const open = (periods.data ?? []).filter((one) => one.status !== "CLOSED")

  /// The empty sentence is meaningful only after every source that can put
  /// something in the queue has answered. Keep the sources together so a
  /// slow or refused read can never look like an all-clear. The runs count
  /// only for head office, the one caller who asks for them.
  const runsPending = unit.employer && runs.isPending
  const queueRead = {
    isPending:
      overtime.isPending ||
      expiring.isPending ||
      claims.isPending ||
      hires.isPending ||
      runsPending ||
      team.isPending,
    isError:
      overtime.isError ||
      expiring.isError ||
      claims.isError ||
      hires.isError ||
      (unit.employer && runs.isError) ||
      team.isError,
    error:
      overtime.error ??
      expiring.error ??
      claims.error ??
      hires.error ??
      (unit.employer ? runs.error : null) ??
      team.error,
    data: exceptions,
    refetch: () => {
      void Promise.all([
        overtime.refetch(),
        expiring.refetch(),
        claims.refetch(),
        hires.refetch(),
        ...(unit.employer ? [runs.refetch()] : []),
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
    unit.unitId === null
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
            unitId={unit.unitId}
            units={unit.units}
            onChange={unit.setUnitId}
          />
        }
      />

      {queryState(queueRead, {
        loading:
          "Checking contracts, claims, hire requests, payroll runs and overtime orders…",
        render: (rows) => (
          <ExceptionQueue
            exceptions={rows}
            empty="No contract is past due or ending in the next 30 days, and no claim, hire request, payroll run or overtime order is waiting."
          />
        ),
      })}

      <RequestQueues />

      <KpiStrip className="md:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Working here" value={workforceValue} />
        <Kpi label="Leave waiting on a decision" value={leaveValue} />
        <Kpi label="Overtime unanswered" value={overtimeValue} />
        <Kpi
          label={`Months still open at ${unit.name ?? "your place"}`}
          value={periodsValue}
          delta={
            unit.unitId !== null &&
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
      {unit.unitId !== null && periods.isError && (
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
