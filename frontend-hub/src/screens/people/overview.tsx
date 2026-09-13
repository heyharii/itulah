import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Clock4, FileWarning, Inbox } from "lucide-react"
import { useMemo } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { ExceptionQueue, type Exception } from "@/components/ui/exception-queue"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { PageHeader } from "@/components/ui/page-header"
import { Banner } from "@/components/ui/states"
import { count, day } from "@/lib/format"
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
/// Both HR prototypes lead with this screen, and the module has never had it.
/// Every figure on it comes from a route that already existed — nothing here
/// waited on a new endpoint, which is why it could be built while three other
/// lanes were still moving.
///
/// # What is deliberately absent
///
/// The prototypes' **Hari ini** — who is in, who is late, who has not arrived
/// — is not here, and is not faked. There is no punch source connected yet, so
/// the honest version of that panel is a banner saying so. A grid of people
/// with nobody marked present reads as "everybody is absent" to anyone who
/// does not know the backend, and that is worse than an absence.
///
/// The prototypes' **Persetujuan saya** and **Perlu perhatian** are one queue
/// here rather than two tabs. They differ by who is blocked, not by what the
/// reader does next: five minutes and a list of things is the situation, and
/// splitting it in two is how the second tab stops being opened. Payroll
/// submissions and hire proposals join the same queue as those lanes land.
///
/// # Names, not uuids
///
/// The leave and overtime queues carry `employee_id` and no name — they are
/// views of a decision, not of a person. So this screen resolves them against
/// the workforce it is already allowed to read. A queue that says
/// `emp_174c7e88…` is a queue nobody can triage.
export function PeopleOverview() {
  const navigate = useNavigate()
  const go = (to: string) => () => navigate({ to } as never)
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
    queryFn: ({ signal }) => listWorkforce({ status: "ACTIVE", limit: 1 }, signal),
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

  const who = (id: string) => named.get(id) ?? id

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
  }, [expiring.data, leave.data, overtime.data, named])

  const open = (periods.data ?? []).filter((one) => one.status !== "CLOSED")

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

      <ExceptionQueue
        exceptions={exceptions}
        empty="No contract is running out, no leave is waiting on a decision, and every overtime order has been answered."
      />

      <KpiStrip className="md:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Working here"
          value={
            workforce.data === undefined ? "—" : count(Number(workforce.data.total))
          }
        />
        <Kpi
          label="Leave waiting on a decision"
          value={leave.data === undefined ? "—" : count(leave.data.length)}
        />
        <Kpi
          label="Overtime unanswered"
          value={overtime.data === undefined ? "—" : count(overtime.data.length)}
        />
        <Kpi
          label={`Months still open at ${unit.name ?? "your place"}`}
          value={
            unit.place === null || periods.data === undefined
              ? "—"
              : count(open.length)
          }
          delta={
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

      {/* Last, and stated rather than drawn. This is the panel both prototypes
          put first, and it cannot be built honestly yet. */}
      <Banner tone="info">
        Who is in today is not here: no punch source is connected, so nothing
        knows who arrived. A fingerprint station per unit is being built — until
        it reports, this screen shows what was decided and planned, never what
        was worked.
      </Banner>
    </PageContent>
  )
}
