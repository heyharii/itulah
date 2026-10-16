import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { Lock } from "lucide-react"
import { useState } from "react"

import { DockChoice } from "@/components/shell/dock-tools"
import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { button } from "@/components/ui/button-style"
import { Field, Input } from "@/components/ui/field"
import {
  PeopleSheet,
  SheetFoot,
  SheetSection,
} from "@/components/ui/people-sheet"
import { PeopleTable } from "@/components/ui/people-table"
import { Pill, Status } from "@/components/ui/pill"
import { Segmented } from "@/components/ui/segmented"
import { Stat, StatStrip } from "@/components/ui/stat-strip"
import { Banner } from "@/components/ui/states"
import { moment } from "@/lib/format"
import {
  attendanceOf,
  closePeriod,
  hrKeys,
  isoMonth,
  monthBefore,
  monthBounds,
  periodQuery,
  punchReadinessQuery,
  readMinutes,
  readMonth,
  type StoreScope,
} from "@/lib/queries/hr"
import { centreState, describeCentre } from "@/screens/hr/centre"
import { Facts, Heading, Person, personCard } from "@/screens/hr/parts"
import { RefusedBanner } from "@/screens/hr/refused"
import { personByLogin, useTeam } from "@/screens/hr/words"
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
/// closed anything — so this screen has one act, and it only goes one way.
/// That is why the sheet that does it asks twice: where the month stands and a
/// reason first, then one more press to close.
///
/// # The phone
///
/// "Close attendance" is the dock's round button; the month is the dock's chip.
/// What holds the close is a card of rows each with the way to deal with it,
/// and the month per person is a lead card each — the unrecorded days as the
/// figure, because that is what stops a person's month from closing clean.
export function HrPeriod() {
  const [which, setWhich] = useState<Which>("last")
  const [closing, setClosing] = useState(false)
  return (
    <HrWorkspace
      primary={{
        label: "Close attendance",
        onClick: () => setClosing(true),
        icon: Lock,
      }}
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
  const period = which === "this" ? isoMonth(now) : monthBefore(now)

  const team = useTeam(scope)
  const month = useQuery(periodQuery(scope.unit_id, period))
  const punches = useQuery(punchReadinessQuery(scope.unit_id, period))

  return (
    <>
      {/* The month: the dock's chip on a phone, a switch on a desk. */}
      <DockChoice
        title="Month"
        value={which}
        options={MONTHS}
        onChange={(next) => onWhich(next as Which)}
      />
      <div className="mb-4 max-md:hidden md:max-w-[20rem]">
        <Segmented options={MONTHS} value={which} onChange={onWhich} />
      </div>

      {centreState(month, {
        loading: "Reading the period…",
        what: `the ${readMonth(period)} period`,
        render: (view) => (
          <>
            <Standing view={view} team={team.data} />
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
function Standing({
  view,
  team,
}: {
  view: PeriodView
  team: EmployeeList | undefined
}) {
  const closed = view.status === "CLOSED"
  const last = view.history[view.history.length - 1]
  return (
    <StatStrip>
      <Stat
        label={readMonth(view.period)}
        value={closed ? "Closed" : "Open"}
        tone={closed ? "ok" : "warn"}
      />
      <Stat
        label="Last act"
        value={
          last === undefined
            ? "—"
            : last.event === "CLOSED"
              ? "Closed"
              : "Reopened"
        }
        sub={
          last === undefined
            ? undefined
            : `${personByLogin(team, last.actor)} · ${moment(last.at)}`
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

/// What stands between this month and a close — a card of rows, each with the
/// way to deal with it.
///
/// The counts come from the centre and are recomputed there when the close is
/// pressed: a client supplying its own zeros could close a month over anything
/// it liked, so what is drawn is the shop's position, not its argument.
function Blockers({ readiness }: { readiness: CloseReadinessView }) {
  const items: { text: string; to: string; act: string }[] = []
  if (readiness.unresolved_leave > 0) {
    items.push({
      text: `${readiness.unresolved_leave} leave request${readiness.unresolved_leave === 1 ? "" : "s"} pending`,
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
      text: `${readiness.open_corrections} attendance fix${readiness.open_corrections === 1 ? "" : "es"} pending`,
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
        <div>
          <Heading count={items.length}>Holding the close</Heading>
          <ul className="overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft">
            {items.map((item) => (
              <li
                key={item.to}
                className="flex min-h-14 items-center gap-3 border-b border-hairline px-4 py-2 last:border-b-0"
              >
                <span className="min-w-0 flex-1 text-cell text-ink">
                  {item.text}
                </span>
                <AppLink
                  to={item.to}
                  className={button({ variant: "tint", size: "card" })}
                >
                  {item.act}
                </AppLink>
              </li>
            ))}
          </ul>
        </div>
      ) : readiness.can_close ? (
        <Banner tone="ok">Ready to close.</Banner>
      ) : (
        <Banner tone="warn">Head office says it can't close yet.</Banner>
      )}

      {/* `null` is NOT ASSESSED, and a zero would be a claim that somebody
          looked and found none. Said in those words. */}
      {!readiness.punches_assessed && (
        <Banner tone="warn">
          No check-in source reported. Attendance not assessed.
        </Banner>
      )}
      {readiness.employees_without_roster > 0 && (
        <Banner
          tone="info"
          className="items-center"
          action={
            <AppLink
              to="/hr/roster"
              className={button({ variant: "soft", size: "card" })}
            >
              Plan them
            </AppLink>
          }
        >
          {readiness.employees_without_roster} person
          {readiness.employees_without_roster === 1 ? " is" : "s are"} on the
          books here with no rota this month.
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
        card={(row) => {
          const gaps = assessed && row.unrecorded > 0
          // What the month came to, in one line: nothing that is zero is said.
          const line = row.loading
            ? "Reading the month…"
            : [
                assessed
                  ? `${row.present} of ${row.rostered} present`
                  : `${row.rostered} rostered`,
                assessed && row.late > 0 ? `${row.late} late` : null,
                row.leave > 0 ? `${row.leave} on leave` : null,
                row.overtime > 0
                  ? `${readMinutes(row.overtime)} overtime agreed`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")
          return {
            ...personCard(team, row.id, [line]),
            lead: row.loading
              ? { figure: "…", muted: true }
              : assessed
                ? {
                    figure: row.unrecorded,
                    caption: "unrecorded",
                    muted: row.unrecorded === 0,
                  }
                : { figure: "—", caption: "not assessed", muted: true },
            foot: row.loading
              ? undefined
              : {
                  info: !assessed ? (
                    <Status tone="neutral">Not assessed</Status>
                  ) : gaps ? (
                    <Status tone="bad">Needs fixes</Status>
                  ) : (
                    <Status tone="ok">Complete</Status>
                  ),
                },
            tone: gaps ? "alert" : undefined,
          }
        }}
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
                <Status tone="bad">{row.unrecorded}</Status>
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

/// Sign the month off, in two steps: where it stands and why, then one more
/// press. The foot says which step it is on; nothing is closed on the first.
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
  const [sure, setSure] = useState(false)
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
  const month = readMonth(view.period)

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      crumb="Attendance"
      title={`Close ${month}`}
      sub={scope.label}
      status={
        <Pill tone={closed ? "ok" : "warn"}>{closed ? "Closed" : "Open"}</Pill>
      }
      foot={
        closed ? undefined : (
          <div className="flex flex-col gap-3">
            {close.error !== null && (
              <Banner tone="bad">{describeCentre(close.error)}</Banner>
            )}
            {sure && (
              <p className="text-meta text-body">
                Close {month}? Only head office can reopen it.
              </p>
            )}
            <SheetFoot>
              <Button
                variant="quiet"
                onClick={sure ? () => setSure(false) : onClose}
              >
                {sure ? "Back" : "Cancel"}
              </Button>
              {sure ? (
                <Button
                  variant="primary"
                  pending={close.isPending}
                  onClick={() => close.mutate()}
                >
                  {close.isPending ? "Closing…" : "Close attendance"}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  disabled={!readiness.can_close || reason.trim() === ""}
                  onClick={() => setSure(true)}
                >
                  Close attendance
                </Button>
              )}
            </SheetFoot>
          </div>
        )
      }
    >
      {closed ? (
        <Banner tone="ok">Closed and locked.</Banner>
      ) : (
        <>
          <SheetSection title="Where it stands">
            <Facts
              rows={[
                ["Leave pending", readiness.unresolved_leave],
                ["Overtime unanswered", readiness.unanswered_overtime],
                ["Fixes pending", readiness.open_corrections ?? "Not assessed"],
                [
                  "Days worked off the rota",
                  readiness.unrostered_punch_days ?? "Not assessed",
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
              Clear what is holding the close first.
            </Banner>
          )}
          <Field label="Reason" required>
            <Input
              value={reason}
              placeholder={`${month} time data checked and complete`}
              disabled={sure}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </>
      )}
    </PeopleSheet>
  )
}
