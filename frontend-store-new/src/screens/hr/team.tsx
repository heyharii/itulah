import { useState } from "react"

import { PeopleTable } from "@/components/ui/people-table"
import { PeopleTabs } from "@/components/ui/people-tabs"
import { Stat, StatStrip } from "@/components/ui/stat-strip"
import { readCentidays, readDate, type StoreScope } from "@/lib/queries/hr"
import {
  annualBalance,
  useHireRequests,
  useStaffReads,
} from "@/lib/queries/staff"
import { cn } from "@/lib/utils"
import { centreState } from "@/screens/hr/centre"
import { RequestStaffSheet } from "@/screens/hr/staff-request"
import { RequestedList } from "@/screens/hr/staff-requested"
import { StaffSheet } from "@/screens/hr/staff-sheet"
import { contractLine, endsSoon, hoursText } from "@/screens/hr/staff-words"
import { useTeam } from "@/screens/hr/words"
import { HrWorkspace } from "@/screens/hr/workspace"
import type { EmployeeList, EmployeeSummary } from "@itulah/contract"

/// Staff — who works at this shop, and who it has asked head office for. The
/// prototype's *Staff* (11 Oct 2026).
///
/// Two tabs, **Staff** and **Requested to HO**, and one act: *Request new
/// staff*. The store never adds a person itself — it asks, and head office
/// answers (`staff-request.tsx`, `staff-requested.tsx`).
///
/// # The table
///
/// Name with the employee number under it, position with the grade, the
/// contract (a fixed term shows when it ends, in red once it is within five
/// weeks), the leave left, the hours the rota has them working this week, and
/// how many days they were late in the last seven. A row opens the person
/// (`staff-sheet.tsx`).
///
/// **No pay**, anywhere on this screen — not a locked column, not a "HO"
/// marker: a column that says pay exists and is hidden is still a column about
/// pay, and the prototype has none.
///
/// # What went
///
/// The old Directory also carried a four-figure strip, a search box, an
/// Everyone / Active / Not active switch, a login column and the employment
/// history. The prototype has none of them: a shop is a dozen or two people
/// and everyone is in view, and the history is head office's record. People who
/// are not on the books (not yet started, or gone) are not in the table.
export function HrTeam() {
  const [requesting, setRequesting] = useState(false)
  return (
    <HrWorkspace
      primary={{
        label: "Request new staff",
        onClick: () => setRequesting(true),
      }}
    >
      {(scope) => (
        <Team
          scope={scope}
          requesting={requesting}
          onRequesting={setRequesting}
        />
      )}
    </HrWorkspace>
  )
}

type Tab = "staff" | "requested"

function Team({
  scope,
  requesting,
  onRequesting,
}: {
  scope: StoreScope
  requesting: boolean
  onRequesting: (open: boolean) => void
}) {
  const [tab, setTab] = useState<Tab>("staff")
  const team = useTeam(scope)
  const requests = useHireRequests(scope)

  // On the books: working, or suspended and still employed. Somebody who has
  // not started, or has left, is not staff.
  const staff = (team.data?.rows ?? [])
    .filter(
      (person) => person.status === "ACTIVE" || person.status === "SUSPENDED",
    )
    .sort((left, right) =>
      (left.full_name ?? left.employee_code).localeCompare(
        right.full_name ?? right.employee_code,
      ),
    )
  // What still wants an answer — the rest is history, and a count of history
  // only grows.
  const waiting = (requests.data ?? []).filter(
    (proposal) =>
      proposal.state === "PROPOSED" || proposal.state === "RETURNED",
  ).length

  const endingSoon = staff.filter(endsSoon).length

  return (
    <>
      <StatStrip>
        <Stat label="Staff" value={team.data === undefined ? "—" : staff.length} />
        <Stat
          label="Contracts ending soon"
          value={team.data === undefined ? "—" : endingSoon}
          tone={endingSoon > 0 ? "bad" : undefined}
        />
        <Stat
          label="Waiting on head office"
          value={requests.data === undefined ? "—" : waiting}
        />
      </StatStrip>
      <PeopleTabs
        value={tab}
        onChange={setTab}
        tabs={[
          {
            value: "staff",
            label: "Staff",
            count: team.data === undefined ? undefined : staff.length,
          },
          { value: "requested", label: "Requested to HO", count: waiting },
        ]}
      />
      {centreState(team, {
        loading: "Reading the employees…",
        what: "this shop's workforce",
        render: (page) =>
          tab === "staff" ? (
            <StaffTable scope={scope} team={page} staff={staff} />
          ) : (
            <RequestedList scope={scope} team={page} />
          ),
      })}
      {requesting && (
        <RequestStaffSheet
          scope={scope}
          onSent={() => setTab("requested")}
          onClose={() => onRequesting(false)}
        />
      )}
    </>
  )
}

/// A name over a smaller line — the prototype's two-line cell.
function TwoLine({
  top,
  bottom,
  strong = false,
  warn = false,
}: {
  top: React.ReactNode
  bottom: React.ReactNode
  /// The top line is the row's name.
  strong?: boolean
  /// The bottom line needs somebody: a contract about to end.
  warn?: boolean
}) {
  return (
    <span className="flex min-w-0 flex-col">
      <span
        className={cn(
          "truncate text-cell",
          strong ? "font-medium text-ink" : "text-text",
        )}
      >
        {top}
      </span>
      <span
        className={cn("truncate text-meta", warn ? "text-bad-fg" : "text-mute")}
      >
        {bottom}
      </span>
    </span>
  )
}

function StaffTable({
  scope,
  team,
  staff,
}: {
  scope: StoreScope
  team: EmployeeList
  staff: readonly EmployeeSummary[]
}) {
  const reads = useStaffReads(scope, staff)
  const [open, setOpen] = useState<string | null>(null)
  const opened = staff.find((person) => person.employee_id === open)

  /// "8 days", or a dash while it is coming or when no balance is kept.
  const leaveLeft = (person: EmployeeSummary): string | null => {
    const rows = reads.balances(person.employee_id)
    const annual = rows === undefined ? null : annualBalance(rows)
    return annual === null ? null : readCentidays(annual.centidays)
  }

  return (
    <>
      <PeopleTable
        rows={staff}
        rowKey={(person) => person.employee_id}
        onRowClick={(person) => setOpen(person.employee_id)}
        empty={
          team.rows.length === 0
            ? "Nobody is posted to this shop."
            : "Nobody on the books yet."
        }
        card={(person) => {
          const left = leaveLeft(person)
          const grade = reads.profile(person.employee_id)?.grade
          const scheduled = reads.scheduled(person.employee_id)
          const late = reads.recent(person.employee_id)?.late ?? 0
          return {
            title: person.full_name ?? person.employee_code,
            code: person.employee_code,
            lines: [
              [person.position, grade].filter(Boolean).join(" · ") || null,
              contractLine(person.contract_kind, person.contract_ends_on),
            ],
            lead:
              left === null
                ? { figure: "—", caption: "days left", muted: true }
                : { figure: left, caption: "days left" },
            foot: {
              info:
                [
                  scheduled === undefined
                    ? null
                    : `${hoursText(scheduled)} this week`,
                  late > 0 ? `Late ${late}×` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || undefined,
              action: {
                label: "Open",
                onClick: () => setOpen(person.employee_id),
              },
            },
            tone: endsSoon(person) ? "alert" : undefined,
          }
        }}
        columns={[
          {
            key: "who",
            header: "Name",
            cell: (person) => (
              <TwoLine
                strong
                top={person.full_name ?? person.employee_code}
                bottom={
                  <span className="font-mono">{person.employee_code}</span>
                }
              />
            ),
          },
          {
            key: "position",
            header: "Position",
            cell: (person) => (
              <TwoLine
                top={person.position ?? "—"}
                bottom={reads.profile(person.employee_id)?.grade ?? "—"}
              />
            ),
          },
          {
            key: "contract",
            header: "Contract",
            cell: (person) =>
              person.contract_kind === "PKWT" ? (
                <TwoLine
                  top="PKWT"
                  bottom={
                    person.contract_ends_on === null
                      ? "—"
                      : `ends ${readDate(person.contract_ends_on)}`
                  }
                  warn={endsSoon(person)}
                />
              ) : (
                <span className="text-text">
                  {contractLine(person.contract_kind, person.contract_ends_on)}
                </span>
              ),
          },
          {
            key: "leave",
            header: "Leave left",
            align: "right",
            cell: (person) => {
              const left = leaveLeft(person)
              return left === null ? (
                <span className="text-faint">—</span>
              ) : (
                `${left} days`
              )
            },
          },
          {
            key: "week",
            header: "This week",
            align: "right",
            cell: (person) => {
              const minutes = reads.scheduled(person.employee_id)
              return minutes === undefined ? (
                <span className="text-faint">—</span>
              ) : (
                hoursText(minutes)
              )
            },
          },
          {
            key: "late",
            header: "Late · 7 days",
            align: "right",
            cell: (person) => {
              const late = reads.recent(person.employee_id)?.late ?? 0
              return late > 0 ? (
                <span className="text-bad-fg">{late}</span>
              ) : (
                <span className="text-faint">—</span>
              )
            },
          },
        ]}
      />
      {opened !== undefined && (
        <StaffSheet
          key={opened.employee_id}
          person={opened}
          reads={reads}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  )
}
