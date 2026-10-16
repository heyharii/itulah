import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Clock4, FileWarning } from "lucide-react"
import { useCallback, useMemo } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { ExceptionQueue, type Exception } from "@/components/ui/exception-queue"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { ErrorState } from "@/components/ui/states"
import { count, weekday } from "@/lib/format"
import { useNameOfLogin } from "@/lib/queries/hr-employees"
import {
  awaitingOvertime,
  expiringContracts,
  listEmployees,
  listWorkforce,
  peopleKeys,
  readMinutesSpan,
  overtimeKeys,
} from "@/lib/queries/people"
import { usePeopleWaitingCount } from "@/screens/people/badges"
import { DelegationsCard } from "@/screens/people/employee-app"
import { useUnit } from "@/screens/people/parts"
import { RequestQueues } from "@/screens/people/requests"

/// HR's front door, Overview › Requests: what is waiting on this person, and
/// what is about to go wrong if nobody looks.
///
/// The figures first, then the one inbox (`RequestQueues`) — every decision
/// the reader owes, in one table — then what nobody here can decide but
/// somebody should see: a contract running out, an overtime order the worker
/// has not answered. That list is drawn only when it holds something, and
/// only once all of its sources have answered; partial data is not evidence
/// that nothing needs attention.
///
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
  const waiting = usePeopleWaitingCount()
  const nameOfLogin = useNameOfLogin()

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
      const name = contract.full_name ?? contract.employee_code
      found.push({
        id: `contract-${contract.employee_id}`,
        title:
          days < 0
            ? `${name}'s contract has ended`
            : `${name}'s contract runs out`,
        detail: `${contract.position} · ends ${weekday(contract.ends_on, true)}`,
        amount: days < 0 ? `${Math.abs(days)}d ago` : `${days}d`,
        severity: days <= 7 ? "high" : "medium",
        icon: <FileWarning className="size-4" />,
        onOpen: go("/people", { employee: contract.employee_id }),
      })
    }

    // Not decided here: the answer belongs to the person it was ordered for.
    // An order nobody answers authorizes nothing, which is overtime worked
    // unpaid or not worked at all — worth seeing without being worth a button.
    for (const order of overtime.data ?? []) {
      found.push({
        id: `overtime-${order.id}`,
        title: `${who(order.employee_id)} has not answered an overtime order`,
        detail: `${weekday(order.on_date, true)} · ordered by ${nameOfLogin(order.ordered_by)}`,
        amount: readMinutesSpan(order.planned_minutes),
        severity: "medium",
        icon: <Clock4 className="size-4" />,
        onOpen: go("/people/overtime"),
      })
    }

    return found
  }, [expiring.data, overtime.data, go, who, nameOfLogin])

  /// Drawn only once every source has answered and something is in it: an
  /// empty "needs attention" card under an inbox is a card people learn to
  /// scroll past.
  const watched =
    overtime.isSuccess &&
    expiring.isSuccess &&
    team.isSuccess &&
    exceptions.length > 0

  const figure = (
    query: { isPending: boolean; isError: boolean },
    value: () => string
  ) => (query.isPending ? "…" : query.isError ? "—" : value())

  return (
    <PageContent>
      <PageHeader title="Overview" />

      <KpiStrip className="md:grid-cols-3 xl:grid-cols-3">
        <Kpi
          label="Working here"
          value={figure(workforce, () =>
            count(Number(workforce.data?.total ?? 0))
          )}
        />
        <Kpi
          label="Waiting on you"
          value={waiting === null ? "…" : count(waiting)}
        />
        <Kpi
          label="Contracts ending in 30 days"
          value={figure(expiring, () => count(expiring.data?.length ?? 0))}
        />
      </KpiStrip>

      {workforce.isError && (
        <ErrorState
          error={workforce.error}
          onRetry={() => void workforce.refetch()}
        />
      )}

      <RequestQueues />

      {watched && <ExceptionQueue className="mt-4" exceptions={exceptions} />}

      {/* A manager's own hand-over (0812); head office sets them for anybody
          in Setup › Approval Delegation. */}
      {!unit.employer && (
        <div className="mt-4">
          <DelegationsCard administrator={false} />
        </div>
      )}
    </PageContent>
  )
}
