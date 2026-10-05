import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { Lock } from "lucide-react"
import { useState } from "react"

import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { PeopleSheet, SheetSection } from "@/components/ui/people-sheet"
import { PeopleTable } from "@/components/ui/people-table"
import { Pill } from "@/components/ui/pill"
import { Segmented } from "@/components/ui/segmented"
import { Stat, StatStrip } from "@/components/ui/stat-strip"
import { Banner } from "@/components/ui/states"
import { moment } from "@/lib/format"
import {
  attendanceOf,
  closePeriod,
  hrKeys,
  isoMonth,
  monthBounds,
  periodAt,
  punchReadinessAt,
  readMinutes,
  readMonth,
  type StoreScope,
} from "@/lib/queries/hr"
import { centreState } from "@/screens/hr/centre"
import { RefusedBanner } from "@/screens/hr/refused"
import { Facts, Heading, Person, Submit } from "@/screens/hr/parts"
import { useTeam } from "@/screens/hr/words"
import { HrWorkspace } from "@/screens/hr/workspace"
import type {
  CloseReadinessView,
  EmployeeList,
  PeriodView,
} from "@itulah/contract"

/// Period close, for a shop — signing off the month's attendance, and nothing
/// else. Payroll runs are built at head office from the closed period.
///
/// "Store mengusulkan komponen dan menutup data waktu. HR HO menyusun
/// payroll." (`menu-final.md`): a shop never sees a run, a slip or a salary
/// here. It clears what stands in the way, reads the month's attendance per
/// person, and signs the month off; head office builds payroll from what was
/// signed. The one-off figures a shop may propose — an incentive, a *kasbon*
/// instalment — are filed under Employment changes, where the prototype
/// puts the pay components a store may ask for.
///
/// **Closing is the shop's; reopening is head office's.** The centre routes
/// them apart on purpose — a place that could reopen its own close has not
/// closed anything — so this screen has one button, and it only goes one way.
export function HrPeriod() {
  const [which, setWhich] = useState<Which>("last")
  const [closing, setClosing] = useState(false)
  return (
    <HrWorkspace
      actions={
        <Button variant="primary" onClick={() => setClosing(true)}>
          <Lock />
          Close attendance
        </Button>
      }
    >
      {(scope) => (
        <Period
          scope={scope}
          which={which}
          onWhich={setWhich}
          closing={closing}
          onClosing={setClosing}
        />
      )}
    </HrWorkspace>
  )
}

const MONTHS = [
  { value: "last", label: "Last month" },
  { value: "this", label: "This month" },
] as const

type Which = (typeof MONTHS)[number]["value"]

function Period({
  scope,
  which,
  onWhich,
  closing,
  onClosing,
}: {
  scope: StoreScope
  which: Which
  onWhich: (which: Which) => void
  closing: boolean
  onClosing: (open: boolean) => void
}) {
  // Two months and not a calendar: a month is signed off in the first days of
  // the one after it, and every other month is either closed or has not
  // happened.
  const now = new Date()
  const period =
    which === "this"
      ? isoMonth(now)
      : isoMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1))

  const team = useTeam(scope)
  const month = useQuery({
    queryKey: hrKeys.period(scope.unit_id, period),
    queryFn: ({ signal }) => periodAt(scope.unit_id, period, signal),
  })
  const punches = useQuery({
    queryKey: hrKeys.punchReadiness(scope.unit_id, period),
    queryFn: ({ signal }) => punchReadinessAt(scope.unit_id, period, signal),
  })

  return (
    <>
      <div className="mb-4 md:max-w-[20rem]">
        <Segmented options={MONTHS} value={which} onChange={onWhich} />
      </div>

      {centreState(month, {
        loading: "Loading…",
        what: `the ${readMonth(period)} period`,
        render: (view) => (
          <>
            <Status view={view} />
            {view.readiness !== null && <Blockers readiness={view.readiness} />}
            <Heading>{readMonth(view.period)} · per person</Heading>
            <PerPerson
              period={view.period}
              team={team.data}
              connected={punches.data?.punch_source_connected ?? null}
            />

            {closing && (
              <CloseSheet
                scope={scope}
                view={view}
                onClose={() => onClosing(false)}
              />
            )}
          </>
        ),
      })}
    </>
  )
}

/// Where the month stands, and who has acted on it.
function Status({ view }: { view: PeriodView }) {
  const closed = view.status === "CLOSED"
  return (
    <StatStrip>
      <Stat
        label={readMonth(view.period)}
        value={closed ? "Closed · locked" : "Open"}
        tone={closed ? "ok" : "warn"}
      />
      <Stat
        label="Last act"
        value={
          view.history.length === 0
            ? "—"
            : view.history[view.history.length - 1]?.event === "CLOSED"
              ? "Closed"
              : "Reopened"
        }
        sub={
          view.history.length === 0
            ? "nothing has happened yet"
            : `${view.history[view.history.length - 1]?.actor ?? ""} · ${moment(view.history[view.history.length - 1]?.at)}`
        }
      />
      {/* A frequently reopened period is a governance signal, which is why the
          centre makes it a field. Drawn only when it is one. */}
      {view.reopen_count > 0 && (
        <Stat
          label="Reopened by head office"
          value={`${view.reopen_count}×`}
          tone="bad"
        />
      )}
    </StatStrip>
  )
}

/// What stands between this month and a close — the prototype's red callout
/// with a link to where each one is dealt with.
///
/// The counts come from the centre and are recomputed there when the close is
/// pressed: a client supplying its own zeros could close a month over anything
/// it liked, so what is drawn is the shop's position, not its argument.
function Blockers({ readiness }: { readiness: CloseReadinessView }) {
  const items: { text: string; to: string; act: string }[] = []
  if (readiness.unresolved_leave > 0) {
    items.push({
      text: `${readiness.unresolved_leave} leave request${readiness.unresolved_leave === 1 ? "" : "s"} still undecided`,
      to: "/hr/leave",
      act: "Decide leave",
    })
  }
  if (readiness.unanswered_overtime > 0) {
    items.push({
      text: `${readiness.unanswered_overtime} overtime order${readiness.unanswered_overtime === 1 ? "" : "s"} nobody has answered`,
      to: "/hr/overtime",
      act: "See the orders",
    })
  }
  if ((readiness.open_corrections ?? 0) > 0) {
    items.push({
      text: `${readiness.open_corrections} attendance fix${readiness.open_corrections === 1 ? "" : "es"} waiting on a decision`,
      to: "/hr/attendance",
      act: "Decide fixes",
    })
  }
  if ((readiness.unrostered_punch_days ?? 0) > 0) {
    items.push({
      text: `${readiness.unrostered_punch_days} day${readiness.unrostered_punch_days === 1 ? "" : "s"} worked off the rota`,
      to: "/hr/roster",
      act: "Plan those days",
    })
  }

  return (
    <div className="mb-5 flex flex-col gap-3">
      {items.length > 0 ? (
        <Banner tone="bad">
          <b className="font-semibold">
            {items.length} thing{items.length === 1 ? "" : "s"} holding the
            close
          </b>
          <ul className="mt-1.5 flex flex-col gap-1">
            {items.map((item) => (
              <li key={item.to}>
                {item.text} ·{" "}
                <AppLink
                  to={item.to}
                  className="font-medium underline underline-offset-2"
                >
                  {item.act}
                </AppLink>
              </li>
            ))}
          </ul>
        </Banner>
      ) : readiness.can_close ? (
        <Banner tone="ok">
          Ready to close.
        </Banner>
      ) : (
        <Banner tone="warn">
          Head office says it can't close yet.
        </Banner>
      )}

      {/* `null` is NOT ASSESSED, and a zero would be a claim that somebody
          looked and found none. Said in those words. */}
      {!readiness.punches_assessed && (
        <Banner tone="warn">
          No check-in source reported. Attendance not assessed.
        </Banner>
      )}
      {readiness.employees_without_roster > 0 && (
        <Banner tone="info">
          {readiness.employees_without_roster} person
          {readiness.employees_without_roster === 1 ? " is" : "s are"} on the
          books here with no rota this month —{" "}
          <AppLink
            to="/hr/roster"
            className="font-medium underline underline-offset-2"
          >
            plan them
          </AppLink>{" "}
          if they worked.
        </Banner>
      )}
    </div>
  )
}

/// The month per person, read from each person's derived days.
function PerPerson({
  period,
  team,
  connected,
}: {
  period: string
  team: EmployeeList | undefined
  connected: boolean | null
}) {
  const { from, to } = monthBounds(period)
  const people = (team?.rows ?? []).filter(
    (person) => person.status === "ACTIVE",
  )
  const reads = useQueries({
    queries: people.map((person) => ({
      queryKey: hrKeys.attendanceOf(person.employee_id, from, to),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        attendanceOf(person.employee_id, from, to, signal),
    })),
  })
  const refused = reads.find((read) => read.isError)
  const assessed =
    connected ??
    reads.some((read) => read.data?.punch_source_connected === true)

  const rows = people.map((person, index) => {
    const days = reads[index]?.data?.days ?? []
    const rostered = days.filter((day) => day.plan === "SCHEDULED")
    return {
      id: person.employee_id,
      loading: reads[index]?.isPending ?? true,
      rostered: rostered.length,
      present: rostered.filter((day) => day.arrival !== null).length,
      late: rostered.filter((day) => day.outcomes.includes("LATE")).length,
      leave: days.filter((day) => day.outcomes.includes("APPROVED_LEAVE"))
        .length,
      unrecorded: rostered.filter(
        (day) =>
          day.arrival === null && !day.outcomes.includes("APPROVED_LEAVE"),
      ).length,
      overtime: days.reduce(
        (total, day) => total + day.overtime_minutes_agreed,
        0,
      ),
    }
  })
  const figure = (value: number, loading: boolean, needsPunches = false) =>
    loading ? "…" : needsPunches && !assessed ? "—" : value

  return (
    <>
      {refused !== undefined && (
        <RefusedBanner error={refused.error} what="this month's attendance" />
      )}
      <PeopleTable
        rows={rows}
        rowKey={(row) => row.id}
        empty="Nobody is posted here."
        columns={[
          {
            key: "who",
            header: "Employee",
            cell: (row) => <Person team={team} id={row.id} />,
          },
          {
            key: "rostered",
            header: "Rostered",
            align: "right",
            cell: (row) => figure(row.rostered, row.loading),
          },
          {
            key: "present",
            header: "Present",
            align: "right",
            cell: (row) => figure(row.present, row.loading, true),
          },
          {
            key: "late",
            header: "Late",
            align: "right",
            cell: (row) => figure(row.late, row.loading, true),
          },
          {
            key: "leave",
            header: "Leave",
            align: "right",
            cell: (row) => figure(row.leave, row.loading),
          },
          {
            key: "unrecorded",
            header: "Unrecorded",
            align: "right",
            cell: (row) =>
              !row.loading && assessed && row.unrecorded > 0 ? (
                <Pill tone="bad">{row.unrecorded}</Pill>
              ) : (
                figure(row.unrecorded, row.loading, true)
              ),
          },
          {
            key: "overtime",
            header: "Overtime agreed",
            align: "right",
            cell: (row) => (row.loading ? "…" : readMinutes(row.overtime)),
          },
        ]}
      />
    </>
  )
}

/// Sign the month off.
function CloseSheet({
  scope,
  view,
  onClose,
}: {
  scope: StoreScope
  view: PeriodView
  onClose: () => void
}) {
  const client = useQueryClient()
  const [reason, setReason] = useState("")
  const close = useMutation({
    mutationFn: () =>
      closePeriod({ place: scope.unit_id, period: view.period, reason }),
    onSuccess: () => {
      client.invalidateQueries({
        queryKey: hrKeys.period(scope.unit_id, view.period),
      })
      onClose()
    },
  })
  const readiness = view.readiness
  const closed = view.status === "CLOSED" || readiness === null

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      crumb="Period close"
      title={`Close ${readMonth(view.period)}`}
      sub={scope.label}
      status={
        <Pill tone={closed ? "ok" : "warn"}>{closed ? "Closed" : "Open"}</Pill>
      }
      foot={
        closed ? undefined : (
          <div className="flex flex-col gap-3">
            <Field
              label="Reason"
            >
              <Input
                value={reason}
                placeholder={`${readMonth(view.period)} time data checked and complete`}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
            <Submit
              label={`Close ${readMonth(view.period)}`}
              pending={close.isPending}
              disabled={!readiness.can_close || reason.trim() === ""}
              error={close.error}
              onSubmit={() => close.mutate()}
            />
          </div>
        )
      }
    >
      {closed ? (
        <Banner tone="ok">
          Closed and locked.
        </Banner>
      ) : (
        <>
          <SheetSection title="Where it stands">
            <Facts
              rows={[
                ["Leave undecided", readiness.unresolved_leave],
                ["Overtime unanswered", readiness.unanswered_overtime],
                ["Fixes open", readiness.open_corrections ?? "not assessed"],
                [
                  "Days off the rota",
                  readiness.unrostered_punch_days ?? "not assessed",
                ],
                [
                  "On the books, never rostered",
                  readiness.employees_without_roster,
                ],
              ]}
            />
          </SheetSection>
          {!readiness.can_close && (
            <Banner tone="warn" className="mb-4">
              Decide everything above first.
            </Banner>
          )}
        </>
      )}
    </PeopleSheet>
  )
}
