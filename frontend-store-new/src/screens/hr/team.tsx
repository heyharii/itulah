import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"

import { PeopleTable } from "@/components/ui/people-table"
import { PeopleTabs } from "@/components/ui/people-tabs"
import { Pill } from "@/components/ui/pill"
import { Segmented } from "@/components/ui/segmented"
import { Stat, StatStrip } from "@/components/ui/stat-strip"
import { EmptyState, LoadingState } from "@/components/ui/states"
import { bossName } from "@/lib/line"
import { useParam, type Search } from "@/lib/params"
import { readCentidays, readDate, type StoreScope } from "@/lib/queries/hr"
import { useLine, type LineRead } from "@/lib/queries/line"
import {
  annualBalance,
  currentTerms,
  useHireRequests,
  useStaffReads,
} from "@/lib/queries/staff"
import { cn } from "@/lib/utils"
import { centreState } from "@/screens/hr/centre"
import { EmployeePage } from "@/screens/hr/employee-page"
import { LineChart } from "@/screens/hr/line-chart"
import { LineProblem } from "@/screens/hr/line-pick"
import { NewEmployeeSheet } from "@/screens/hr/new-employee"
import { RequestedList } from "@/screens/hr/staff-requested"
import {
  contractLine,
  endsSoon,
  hireState,
  hoursText,
  onTheBooks,
} from "@/screens/hr/staff-words"
import { useTeam } from "@/screens/hr/words"
import { HrWorkspace } from "@/screens/hr/workspace"
import type {
  EmployeeList,
  EmployeeSummary,
  HireProposalView,
} from "@itulah/contract"

/// Staff — who works at this shop, and who it has asked head office for. The
/// prototype's *Staff* (11 Oct 2026), with its *Chart* (30 Oct 2026) and the
/// hub's person page behind every row and card.
///
/// Two tabs, **Staff** and **Requested to HO**, and one act: **New Employee**.
/// The store never adds a person itself — it files a hire proposal with the
/// person's papers on it, head office approves, and until then the person is a
/// *Waiting for HO* row in the list and cannot be scheduled
/// (`new-employee.tsx`, `staff-requested.tsx`).
///
/// # The table
///
/// Name with the employee number under it, position with the grade, who they
/// report to, the contract (a fixed term shows when it ends, in red once it is
/// within five weeks), the leave left, the hours the rota has them working this
/// week, and how many days they were late in the last seven. A row opens the
/// person's page (`employee-page.tsx`, at `?employee=`).
///
/// # List and Chart
///
/// A switch above the table: **List** is the table, **Chart** is the same
/// people as boxes on their line of report (`line-chart.tsx`). Both read the
/// line from head office one person at a time (`lib/queries/line.ts`). A card
/// opens the person's page on Work, where *Reports To* is changed.
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
  const navigate = useNavigate()
  const employee = useParam("employee")
  const [creating, setCreating] = useState(false)

  /// A push, not a replace: back from a person's page is the list again.
  const open = (id: string, section?: Search["section"]) =>
    void navigate({
      to: ".",
      search: (previous: Search) => ({ ...previous, employee: id, section }),
    })
  const back = () =>
    void navigate({
      to: ".",
      search: (previous: Search) => ({
        ...previous,
        employee: undefined,
        section: undefined,
      }),
    })

  return (
    <HrWorkspace
      primary={
        employee.value === undefined
          ? { label: "New Employee", onClick: () => setCreating(true) }
          : undefined
      }
    >
      {(scope) =>
        employee.value !== undefined ? (
          <EmployeePage scope={scope} id={employee.value} onBack={back} />
        ) : (
          <Team
            scope={scope}
            onOpen={open}
            creating={creating}
            onCreating={setCreating}
          />
        )
      }
    </HrWorkspace>
  )
}

type Tab = "staff" | "requested"
type View = "list" | "chart"

const VIEWS = [
  { value: "list", label: "List" },
  { value: "chart", label: "Chart" },
] as const

function Team({
  scope,
  onOpen,
  creating,
  onCreating,
}: {
  scope: StoreScope
  onOpen: (id: string, section?: Search["section"]) => void
  creating: boolean
  onCreating: (open: boolean) => void
}) {
  const [tab, setTab] = useState<Tab>("staff")
  const [view, setView] = useState<View>("list")
  const team = useTeam(scope)
  const requests = useHireRequests(scope)

  // On the books: working, or suspended and still employed. Somebody who has
  // not started, or has left, is not staff.
  const staff = onTheBooks(team.data)
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
        <Stat
          label="Staff"
          value={team.data === undefined ? "—" : staff.length}
        />
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
            <StaffView
              scope={scope}
              team={page}
              staff={staff}
              view={view}
              onView={setView}
              onOpen={onOpen}
              onRequested={() => setTab("requested")}
            />
          ) : (
            <RequestedList scope={scope} team={page} />
          ),
      })}
      {creating && (
        <NewEmployeeSheet scope={scope} onClose={() => onCreating(false)} />
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

/// The Staff tab: the switch, and either the table or the chart under it.
///
/// Holds what both views share — the reads behind the table and the line of
/// report — so a card and a row open the same page.
function StaffView({
  scope,
  team,
  staff,
  view,
  onView,
  onOpen,
  onRequested,
}: {
  scope: StoreScope
  team: EmployeeList
  staff: readonly EmployeeSummary[]
  view: View
  onView: (next: View) => void
  onOpen: (id: string, section?: Search["section"]) => void
  onRequested: () => void
}) {
  const reads = useStaffReads(scope, staff)
  const line = useLine(scope, staff)
  const requests = useHireRequests(scope)
  // People asked for and not yet answered: not employees, so not in the chart
  // and not on the rota, but the shop has just keyed them in and should see
  // them.
  const asked = (requests.data ?? []).filter(
    (proposal) =>
      proposal.state === "PROPOSED" || proposal.state === "RETURNED",
  )
  const empty =
    team.rows.length === 0
      ? "Nobody is posted to this shop."
      : "Nobody on the books yet."

  return (
    <>
      {/* The same row on a desk and a phone: the switch is not a filter, so it
          stays in the page rather than moving to the dock. */}
      <div className="mb-3.5 flex items-center justify-end">
        <Segmented<View> options={VIEWS} value={view} onChange={onView} />
      </div>
      {view === "list" ? (
        <StaffTable
          staff={staff}
          asked={asked}
          reads={reads}
          line={line}
          empty={empty}
          onOpen={(id) => onOpen(id)}
          onRequested={onRequested}
        />
      ) : staff.length === 0 ? (
        <EmptyState>{empty}</EmptyState>
      ) : line.state === "pending" ? (
        <LoadingState>Reading the line of report…</LoadingState>
      ) : line.state === "failed" ? (
        <LineProblem error={line.error} onRetry={line.refetch} />
      ) : (
        <LineChart line={line.line} onOpen={(id) => onOpen(id, "work")} />
      )}
    </>
  )
}

/// A name, and under it — while head office has a change of boss to decide — a
/// quiet amber pill. The pill is the same one the chart's card wears.
function ReportsToCell({ line, id }: { line: LineRead; id: string }) {
  if (line.state !== "ready") return <span className="text-faint">—</span>
  return (
    <span className="flex flex-col items-start gap-1">
      <span className="text-text">{bossName(line.line, id)}</span>
      {line.line.waiting(id) !== undefined && (
        <Pill tone="warn">Waiting for HO</Pill>
      )}
    </span>
  )
}

/// One row of the list: a person on the books, or somebody asked for.
type Row =
  | { readonly id: string; readonly person: EmployeeSummary }
  | { readonly id: string; readonly asked: HireProposalView }

function StaffTable({
  staff,
  asked,
  reads,
  line,
  empty,
  onOpen,
  onRequested,
}: {
  staff: readonly EmployeeSummary[]
  asked: readonly HireProposalView[]
  reads: ReturnType<typeof useStaffReads>
  line: LineRead
  empty: string
  onOpen: (id: string) => void
  onRequested: () => void
}) {
  /// "8 days", or a dash while it is coming or when no balance is kept.
  const leaveLeft = (person: EmployeeSummary): string | null => {
    const rows = reads.balances(person.employee_id)
    const annual = rows === undefined ? null : annualBalance(rows)
    return annual === null ? null : readCentidays(annual.centidays)
  }

  // The people asked for first: the one just keyed in is the one to look for.
  const rows: Row[] = [
    ...asked.map((proposal) => ({ id: proposal.id, asked: proposal })),
    ...staff.map((person) => ({ id: person.employee_id, person })),
  ]
  const dash = <span className="text-faint">—</span>
  /// A column that has nothing to say about somebody who is not an employee yet.
  const ofPerson =
    (render: (person: EmployeeSummary) => React.ReactNode) => (row: Row) =>
      "person" in row ? render(row.person) : dash

  return (
    <PeopleTable
      rows={rows}
      rowKey={(row) => row.id}
      onRowClick={(row) =>
        "person" in row ? onOpen(row.person.employee_id) : onRequested()
      }
      empty={empty}
      card={(row) => {
        if ("asked" in row) {
          const terms = currentTerms(row.asked)
          const state = hireState(row.asked)
          return {
            title: terms?.candidate_name ?? "New employee",
            lines: [
              terms === undefined
                ? null
                : `${terms.position} · ${contractLine(terms.contract_kind, terms.contract_ends_on)}`,
              terms === undefined ? null : `Joins ${readDate(terms.start_on)}`,
            ],
            foot: {
              info: <Pill tone={state.tone}>{state.label}</Pill>,
              action: { label: "Open", onClick: onRequested },
            },
          }
        }
        const person = row.person
        const left = leaveLeft(person)
        const grade = reads.profile(person.employee_id)?.grade
        const scheduled = reads.scheduled(person.employee_id)
        const late = reads.recent(person.employee_id)?.late ?? 0
        return {
          title: person.full_name ?? person.employee_code,
          code: person.employee_code,
          lines: [
            [person.position, grade].filter(Boolean).join(" · ") || null,
            line.state === "ready"
              ? `Reports To ${bossName(line.line, person.employee_id)}`
              : null,
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
              onClick: () => onOpen(person.employee_id),
            },
          },
          tone: endsSoon(person) ? "alert" : undefined,
        }
      }}
      columns={[
        {
          key: "who",
          header: "Name",
          cell: (row) => {
            if ("person" in row) {
              const person = row.person
              return (
                <TwoLine
                  strong
                  top={person.full_name ?? person.employee_code}
                  bottom={
                    <span className="font-mono">{person.employee_code}</span>
                  }
                />
              )
            }
            const state = hireState(row.asked)
            return (
              <span className="flex min-w-0 flex-col items-start gap-1">
                <span className="max-w-full truncate text-cell font-medium text-ink">
                  {currentTerms(row.asked)?.candidate_name ?? "New employee"}
                </span>
                <Pill tone={state.tone}>{state.label}</Pill>
              </span>
            )
          },
        },
        {
          key: "position",
          header: "Position",
          cell: (row) =>
            "person" in row ? (
              <TwoLine
                top={row.person.position ?? "—"}
                bottom={reads.profile(row.person.employee_id)?.grade ?? "—"}
              />
            ) : (
              <TwoLine
                top={currentTerms(row.asked)?.position ?? "—"}
                bottom="—"
              />
            ),
        },
        {
          key: "reports",
          header: "Reports To",
          cell: ofPerson((person) => (
            <ReportsToCell line={line} id={person.employee_id} />
          )),
        },
        {
          key: "contract",
          header: "Contract",
          className: "whitespace-nowrap",
          cell: (row) => {
            if ("asked" in row) {
              const terms = currentTerms(row.asked)
              return terms === undefined ? (
                dash
              ) : (
                <span className="text-text">
                  {contractLine(terms.contract_kind, terms.contract_ends_on)}
                </span>
              )
            }
            const person = row.person
            return person.contract_kind === "PKWT" ? (
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
            )
          },
        },
        {
          key: "leave",
          header: "Leave left",
          align: "right",
          cell: ofPerson((person) => {
            const left = leaveLeft(person)
            return left === null ? dash : `${left} days`
          }),
        },
        {
          key: "week",
          header: "This week",
          align: "right",
          cell: ofPerson((person) => {
            const minutes = reads.scheduled(person.employee_id)
            return minutes === undefined ? dash : hoursText(minutes)
          }),
        },
        {
          key: "late",
          header: "Late · 7 days",
          align: "right",
          cell: ofPerson((person) => {
            const late = reads.recent(person.employee_id)?.late ?? 0
            return late > 0 ? <span className="text-bad-fg">{late}</span> : dash
          }),
        },
      ]}
    />
  )
}
