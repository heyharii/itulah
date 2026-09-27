import { useQuery } from "@tanstack/react-query"
import { Lock } from "lucide-react"
import { useState } from "react"

import { PeopleSheet, SheetSection } from "@/components/ui/people-sheet"
import { PeopleTable } from "@/components/ui/people-table"
import { Pill } from "@/components/ui/pill"
import { Stat, StatStrip } from "@/components/ui/stat-strip"
import { EmptyState } from "@/components/ui/states"
import { label, toneFor } from "@/lib/format"
import {
  employeeDetail,
  employeeProfile,
  hrKeys,
  leaveBalancesOf,
  readCentidays,
  readDate,
  type StoreScope,
} from "@/lib/queries/hr"
import { centreState } from "@/screens/hr/centre"
import { Facts, Person } from "@/screens/hr/parts"
import { useTeam } from "@/screens/hr/words"
import { HrWorkspace } from "@/screens/hr/workspace"
import type { EmployeeList, EmployeeSummary } from "@itulah/contract"

/// Who works at this shop — the prototype's store Directory.
///
/// `GET /api/v1/employees?unit_id=…`, the one HR route that narrows by a
/// parameter as well as by the caller's posting — and narrows twice, so the
/// day somebody edits the reconciliation without reading it, the answer
/// narrows rather than widens.
///
/// # What it deliberately does not show
///
/// No base pay: the prototype locks that column for a store (🔒), and the
/// centre agrees — pay is `PAY_CHANGE`, head office's. No NIK, address or date
/// of birth either: "who works here" and "what is this person's NIK" are
/// different questions with different audiences, and a counter tablet is the
/// last place in this estate that should ask the second. Job and grade are
/// read-only here — they change only through an Employment change head office
/// decides.
export function HrTeam() {
  return (
    <HrWorkspace sub="This shop's people. Job, grade and pay change only through a head-office decision — propose one under Employment changes.">
      {(scope) => <Team scope={scope} />}
    </HrWorkspace>
  )
}

/// Whole days from today, or `null` when there is no date. Negative means it
/// has already passed, which a contract list has to be able to say.
function daysUntil(iso: string | null): number | null {
  if (iso === null) return null
  const then = new Date(`${iso}T00:00:00`).getTime()
  if (Number.isNaN(then)) return null
  const now = new Date()
  const midnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime()
  return Math.round((then - midnight) / 86_400_000)
}

function Team({ scope }: { scope: StoreScope }) {
  const team = useTeam(scope)
  const [open, setOpen] = useState<string | null>(null)

  return centreState(team, {
    loading: "Reading who works here…",
    what: "this shop's workforce",
    render: (page) => {
      const rows = page.rows
      const active = rows.filter((person) => person.status === "ACTIVE")
      const fixedTerm = active.filter(
        (person) => person.contract_kind === "PKWT",
      )
      const ending = active.filter((person) => {
        const left = daysUntil(person.contract_ends_on)
        return left !== null && left <= 45
      })
      const leaving = rows.filter((person) => person.status !== "ACTIVE")

      return (
        <>
          <StatStrip>
            <Stat label="Active" value={active.length} />
            <Stat label="Fixed-term (PKWT)" value={fixedTerm.length} />
            <Stat
              label="Contract ends ≤ 45 days"
              value={ending.length}
              tone={ending.length > 0 ? "warn" : undefined}
            />
            <Stat
              label="Not active"
              value={leaving.length}
              sub="candidates, suspended, left"
            />
          </StatStrip>

          {rows.length === 0 ? (
            <EmptyState>
              Head office has nobody posted to {scope.label}. Somebody working
              here who is not on this list has not been posted yet, which is
              HR's paperwork rather than a fault of this screen.
            </EmptyState>
          ) : (
            <PeopleTable
              rows={rows}
              rowKey={(person) => person.employee_id}
              onRowClick={(person) => setOpen(person.employee_id)}
              columns={[
                {
                  key: "who",
                  header: "Employee",
                  cell: (person) => (
                    <Person team={page} id={person.employee_id} />
                  ),
                },
                {
                  key: "code",
                  header: "ID",
                  card: "hide",
                  cell: (person) => (
                    <span className="font-mono text-id">
                      {person.employee_code}
                    </span>
                  ),
                },
                {
                  key: "contract",
                  header: "Contract",
                  card: "meta",
                  cell: (person) => <Contract person={person} />,
                },
                {
                  key: "pay",
                  header: "Base pay",
                  align: "right",
                  card: "hide",
                  cell: () => (
                    <span
                      className="inline-flex items-center gap-1 text-mute"
                      title="Pay is held at head office"
                    >
                      <Lock className="size-3.5" />
                      HO
                    </span>
                  ),
                },
                {
                  key: "login",
                  header: "Login",
                  card: "meta",
                  cell: (person) =>
                    person.username === null ? (
                      <span className="text-bad-fg">none issued</span>
                    ) : (
                      <span className="font-mono text-id">
                        {person.username}
                      </span>
                    ),
                },
                {
                  key: "status",
                  header: "Status",
                  card: "status",
                  cell: (person) => (
                    <Pill tone={toneFor(person.status)}>
                      {label(person.status)}
                    </Pill>
                  ),
                },
              ]}
            />
          )}

          {open !== null && (
            <EmployeeSheet
              key={open}
              employeeId={open}
              team={page}
              onClose={() => setOpen(null)}
            />
          )}
        </>
      )
    },
  })
}

/// `PKWT · 31 Des 2026 · 12 days left`. Not through `label()`: PKWT and PKWTT
/// are the Act's own initials, and "Pkwtt" is a word nobody in an Indonesian
/// shop has ever read.
function Contract({ person }: { person: EmployeeSummary }) {
  if (person.contract_kind === null) return <span className="text-mute">—</span>
  const left = daysUntil(person.contract_ends_on)
  return (
    <span className={left !== null && left <= 30 ? "text-bad-fg" : undefined}>
      {person.contract_kind}
      {person.contract_ends_on !== null &&
        ` · until ${readDate(person.contract_ends_on)}`}
      {left !== null &&
        left <= 45 &&
        (left < 0 ? " · ended" : ` · ${left} day${left === 1 ? "" : "s"} left`)}
    </span>
  )
}

/// One person, opened: where they are posted, what they are, and what leave
/// they have left — the prototype's employee sheet, minus the pay and finance
/// sections a store does not see.
function EmployeeSheet({
  employeeId,
  team,
  onClose,
}: {
  employeeId: string
  team: EmployeeList
  onClose: () => void
}) {
  const summary = team.rows.find((person) => person.employee_id === employeeId)
  const profile = useQuery({
    queryKey: hrKeys.profile(employeeId),
    queryFn: ({ signal }) => employeeProfile(employeeId, signal),
  })
  const detail = useQuery({
    queryKey: hrKeys.employee(employeeId),
    queryFn: ({ signal }) => employeeDetail(employeeId, signal),
  })
  const balances = useQuery({
    queryKey: hrKeys.balancesOf(employeeId),
    queryFn: ({ signal }) => leaveBalancesOf(employeeId, signal),
  })

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      crumb={
        <span className="font-mono">
          {summary?.employee_code ?? employeeId}
        </span>
      }
      title={summary?.full_name ?? summary?.employee_code ?? employeeId}
      sub={summary?.position ?? undefined}
      status={
        summary === undefined ? undefined : (
          <Pill tone={toneFor(summary.status)}>{label(summary.status)}</Pill>
        )
      }
    >
      <SheetSection title="Placement">
        {centreState(profile, {
          loading: "Reading the profile…",
          what: "this person's profile",
          render: (view) => (
            <Facts
              rows={[
                ["Shop", view.unit_name ?? view.unit_id ?? "—"],
                ["Job", view.job_title ?? "—"],
                [
                  "Grade",
                  <span className="inline-flex items-center gap-1">
                    {view.grade ?? "—"}
                    <Lock
                      className="size-3.5 text-mute"
                      aria-label="Head office decides"
                    />
                  </span>,
                ],
                summary !== undefined && [
                  "Contract",
                  <Contract person={summary} />,
                ],
                [
                  "Joined",
                  view.joined_on === null ? "—" : readDate(view.joined_on),
                ],
              ]}
            />
          ),
        })}
      </SheetSection>

      <SheetSection title="Leave left">
        {centreState(balances, {
          loading: "Reading the balances…",
          what: "this person's leave balances",
          render: (rows) =>
            rows.length === 0 ? (
              <p className="text-meta text-body">
                No balance is kept for them yet.
              </p>
            ) : (
              <Facts
                rows={rows.map((row) => [
                  row.name,
                  `${readCentidays(row.centidays)} days${row.pending_centidays > 0 ? ` · ${readCentidays(row.pending_centidays)} asked for` : ""}`,
                ])}
              />
            ),
        })}
      </SheetSection>

      <SheetSection title="History">
        {centreState(detail, {
          loading: "Reading the record…",
          what: "this person's employment record",
          render: (view) => (
            <ul className="flex flex-col gap-2">
              {view.assignments.map((posting) => (
                <li
                  key={`${posting.unit_id}-${posting.valid_from}`}
                  className="text-cell"
                >
                  <span className="text-ink">
                    Posted to {posting.unit_name ?? posting.unit_id}
                  </span>
                  <span className="block text-meta text-mute">
                    {readDate(posting.valid_from)} –{" "}
                    {posting.valid_to === null
                      ? "now"
                      : readDate(posting.valid_to)}{" "}
                    · {posting.reason}
                  </span>
                </li>
              ))}
              {view.history.map((event) => (
                <li
                  key={`${event.transition}-${event.at}`}
                  className="text-cell"
                >
                  <span className="text-ink">{label(event.transition)}</span>
                  <span className="block text-meta text-mute">
                    {readDate(event.effective_on)} · {event.actor} ·{" "}
                    {event.reason}
                  </span>
                </li>
              ))}
            </ul>
          ),
        })}
      </SheetSection>

      <p className="text-meta text-mute">
        Pay, bank details and personal data are held at head office and are not
        read from a till.
      </p>
    </PeopleSheet>
  )
}
