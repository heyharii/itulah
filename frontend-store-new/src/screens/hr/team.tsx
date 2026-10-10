import { useQuery } from "@tanstack/react-query"
import { Lock, Search, X } from "lucide-react"
import { useState } from "react"

import { DockTools } from "@/components/shell/dock-tools"
import { PeopleSheet, SheetSection } from "@/components/ui/people-sheet"
import { PeopleTable } from "@/components/ui/people-table"
import { Pill, Status } from "@/components/ui/pill"
import { Segmented } from "@/components/ui/segmented"
import { Stat, StatStrip } from "@/components/ui/stat-strip"
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
import { dateLead, Facts, Person, personCard } from "@/screens/hr/parts"
import { personByLogin, useTeam } from "@/screens/hr/words"
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
///
/// # The phone
///
/// A lead card per person — full name, code, role and contract, the day the
/// contract ends as the one figure, the status in the foot. The search and the
/// Everyone / Active / Not active choice are the dock's; the login is a column
/// of the desk's table only.
export function HrTeam() {
  return <HrWorkspace>{(scope) => <Team scope={scope} />}</HrWorkspace>
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

type Show = "all" | "active" | "inactive"

const SHOWING = [
  { value: "all", label: "Everyone" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Not active" },
] as const

function Team({ scope }: { scope: StoreScope }) {
  const team = useTeam(scope)
  const [open, setOpen] = useState<string | null>(null)
  const [typed, setTyped] = useState("")
  const [show, setShow] = useState<Show>("all")

  return centreState(team, {
    loading: "Reading the employees…",
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

      const needle = typed.trim().toLowerCase()
      const shown = rows.filter(
        (person) =>
          (show === "all" ||
            (show === "active"
              ? person.status === "ACTIVE"
              : person.status !== "ACTIVE")) &&
          (needle === "" ||
            [person.full_name, person.employee_code, person.position]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(needle)),
      )

      return (
        <>
          <DockTools
            search={{
              value: typed,
              onChange: setTyped,
              label: "Search employees",
            }}
            status={{
              value: show,
              onChange: (next) => setShow(next as Show),
              options: [
                { value: "all", label: "Everyone", count: rows.length },
                { value: "active", label: "Active", count: active.length },
                {
                  value: "inactive",
                  label: "Not active",
                  count: leaving.length,
                },
              ],
            }}
          />

          <StatStrip>
            <Stat label="Active" value={active.length} />
            <Stat label="Fixed-term (PKWT)" value={fixedTerm.length} />
            <Stat
              label="Contract ends ≤ 45 days"
              value={ending.length}
              tone={ending.length > 0 ? "warn" : undefined}
            />
            <Stat label="Not active" value={leaving.length} />
          </StatStrip>

          {/* The desk's toolbar. On a phone the same two are the dock's. */}
          <div className="mb-3.5 flex flex-wrap items-center gap-[0.4375rem] max-md:hidden">
            <label className="relative min-w-0 flex-[0_1_18rem]">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-line-ico" />
              <input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder="Name, code or role"
                aria-label="Search employees"
                enterKeyHint="search"
                className="h-9 w-full rounded-inner border border-hairline-2 bg-canvas pr-9 pl-8 text-[0.875rem] text-ink shadow-soft outline-none placeholder:text-body hover:border-hairline-strong focus:border-accent pointer-coarse:h-11"
              />
              {typed !== "" && (
                <button
                  type="button"
                  onClick={() => setTyped("")}
                  aria-label="Clear the search"
                  className="absolute top-1/2 right-1 grid size-7 -translate-y-1/2 place-items-center rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-ink pointer-coarse:size-9"
                >
                  <X className="size-4" />
                </button>
              )}
            </label>
            <span className="flex-1" />
            <Segmented<Show>
              value={show}
              onChange={setShow}
              options={SHOWING}
            />
          </div>

          <PeopleTable
            rows={shown}
            rowKey={(person) => person.employee_id}
            onRowClick={(person) => setOpen(person.employee_id)}
            empty={
              rows.length === 0
                ? "Nobody is posted to this shop."
                : "Nobody matches that."
            }
            card={(person) => {
              const left = daysUntil(person.contract_ends_on)
              return {
                ...personCard(page, person.employee_id, [contractWord(person)]),
                code: person.employee_code,
                lead:
                  person.contract_ends_on === null
                    ? undefined
                    : dateLead(person.contract_ends_on, "until"),
                foot: {
                  info: (
                    <Status tone={toneFor(person.status)}>
                      {label(person.status)}
                    </Status>
                  ),
                  action: {
                    label: "Open",
                    onClick: () => setOpen(person.employee_id),
                  },
                },
                tone: left !== null && left <= 30 ? "alert" : undefined,
              }
            }}
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
                card: "hide",
                cell: (person) =>
                  person.username === null ? (
                    <span className="text-bad-fg">None issued</span>
                  ) : (
                    <span className="font-mono text-id">{person.username}</span>
                  ),
              },
              {
                key: "status",
                header: "Status",
                card: "status",
                cell: (person) => (
                  <Status tone={toneFor(person.status)}>
                    {label(person.status)}
                  </Status>
                ),
              },
            ]}
          />

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

/// `PKWT · 12 days left`, for a card's line. Not through `label()`: PKWT and
/// PKWTT are the Act's own initials, and "Pkwtt" is a word nobody in an
/// Indonesian shop has ever read. The day itself is the card's figure.
function contractWord(person: EmployeeSummary): string | null {
  if (person.contract_kind === null) return null
  const left = daysUntil(person.contract_ends_on)
  if (left === null || left > 45) return person.contract_kind
  return `${person.contract_kind} · ${
    left < 0 ? "ended" : `${left} day${left === 1 ? "" : "s"} left`
  }`
}

/// `PKWT · until 31 Dec 2026 · 12 days left`.
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
  const name = summary?.full_name ?? summary?.employee_code ?? employeeId

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={summary?.full_name ? summary.employee_code : undefined}
      crumb="Employee"
      title={name}
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
          loading: "Reading the leave balances…",
          what: "this person's leave balances",
          render: (rows) =>
            rows.length === 0 ? (
              <p className="text-meta text-body">No leave balances yet.</p>
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
          loading: "Reading the employment record…",
          what: "this person's employment record",
          render: (view) =>
            view.assignments.length === 0 && view.history.length === 0 ? (
              <p className="text-meta text-body">No history yet.</p>
            ) : (
              <ul className="flex flex-col gap-3">
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
                      {readDate(event.effective_on)} ·{" "}
                      {personByLogin(team, event.actor)} · {event.reason}
                    </span>
                  </li>
                ))}
              </ul>
            ),
        })}
      </SheetSection>
    </PeopleSheet>
  )
}
