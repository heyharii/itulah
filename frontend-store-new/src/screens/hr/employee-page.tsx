import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Hourglass } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { PeopleTabs } from "@/components/ui/people-tabs"
import { Pill } from "@/components/ui/pill"
import { Banner, LoadingState } from "@/components/ui/states"
import { initials } from "@/lib/line"
import { useParam } from "@/lib/params"
import { employeeQuery } from "@/lib/queries/employee"
import {
  employeeProfile,
  hrKeys,
  leaveBalancesOf,
  readCentidays,
  readDate,
  type StoreScope,
} from "@/lib/queries/hr"
import { useLine } from "@/lib/queries/line"
import {
  PAPER_KINDS,
  papersKeys,
  useDossier,
  withdrawDataUpdate,
} from "@/lib/queries/papers"
import { ChangeDataSheet } from "@/screens/hr/change-data"
import { describeCentre } from "@/screens/hr/centre"
import {
  AccessGroup,
  Activity,
  Papers,
  ProfileGroup,
  TimeGroup,
  WorkGroup,
} from "@/screens/hr/employee-groups"
import { Figure, Quiet } from "@/screens/hr/employee-parts"
import { onTheBooks } from "@/screens/hr/staff-words"
import { useTeam } from "@/screens/hr/words"
import type {
  EmployeeDataUpdateView,
  EmployeeDossierView,
  EmployeeView,
  PersonalChanges,
} from "@itulah/contract"

/// One person, as a page — the hub's (`frontend-hub/.../employee-page.tsx`),
/// for a shop.
///
/// The head (their face, name, number, post, shop, state), four figures
/// (Joined · Contract ends · Leave left · Papers), a banner while a change of
/// data waits on head office, the groups **Profile · Work · Time · Access**,
/// and a side column of **Papers** and **Activity**. The hub's fifth group,
/// **Pay**, is head office's alone and is not here, nor are the blocks the
/// relay keeps from a till (`employee-groups.tsx` says which).
///
/// A shop can only ask. **Change Data** files a data update for head office to
/// take; **Reports To** (Work) files a change of boss. Both leave the person's
/// file as it was until head office decides, and say so on the page.
///
/// Reached from Staff at `?employee={id}`, from a row of the list or a card of
/// the chart; the chart opens it on Work, where the line of report is.

const GROUPS = [
  { value: "profile", label: "Profile" },
  { value: "work", label: "Work" },
  { value: "time", label: "Time" },
  { value: "access", label: "Access" },
] as const

type Group = (typeof GROUPS)[number]["value"]

/// What a state of employment is called — the hub's words.
function statusWord(status: string): string {
  switch (status) {
    case "CANDIDATE":
      return "Accepted, not started"
    case "ACTIVE":
      return "Working"
    case "SUSPENDED":
      return "Suspended"
    case "TERMINATED":
      return "Left"
    default:
      return status
  }
}

function statusTone(status: string) {
  switch (status) {
    case "ACTIVE":
      return "ok"
    case "CANDIDATE":
      return "info"
    case "SUSPENDED":
      return "warn"
    default:
      return "neutral"
  }
}

export function EmployeePage({
  scope,
  id,
  onBack,
}: {
  scope: StoreScope
  id: string
  onBack: () => void
}) {
  const section = useParam("section")
  const group: Group = section.value ?? "profile"
  const person = useQuery(employeeQuery(id))
  const dossier = useDossier(id)
  const team = useTeam(scope)
  const summary = team.data?.rows.find((row) => row.employee_id === id)
  const line = useLine(scope, onTheBooks(team.data))
  const [editing, setEditing] = useState(false)

  const waiting = dossier.data?.updates.find((one) => one.state === "PENDING")
  const name =
    dossier.data?.personal?.full_name ??
    summary?.full_name ??
    person.data?.employee_code ??
    "Employee"

  return (
    <div className="flex flex-col gap-5">
      <nav className="flex items-center gap-2 text-[0.9375rem] text-mute">
        <button type="button" className="hover:text-ink" onClick={onBack}>
          Staff
        </button>
        <span aria-hidden>›</span>
        <span className="text-ink">{name}</span>
      </nav>

      {person.isPending ? (
        <LoadingState>Loading the record…</LoadingState>
      ) : person.isError ? (
        <Quiet>{describeCentre(person.error, "this person's record")}</Quiet>
      ) : (
        <>
          <Head
            person={person.data}
            name={name}
            position={summary?.position ?? null}
            canChange={dossier.data !== undefined && waiting === undefined}
            onChange={() => setEditing(true)}
          />
          <Figures
            person={person.data}
            dossier={dossier.data}
            contract={
              summary === undefined
                ? null
                : {
                    kind: summary.contract_kind,
                    endsOn: summary.contract_ends_on,
                  }
            }
          />

          {waiting !== undefined && <WaitingBanner update={waiting} />}

          <PeopleTabs
            value={group}
            onChange={(next) => section.set(next)}
            tabs={GROUPS}
            title="Show"
          />

          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="flex min-w-0 flex-col gap-5">
              {group === "profile" && (
                <ProfileGroup
                  dossier={dossier.data}
                  loading={dossier.isPending}
                  error={dossier.error}
                />
              )}
              {group === "work" && (
                <WorkGroup person={person.data} scope={scope} line={line} />
              )}
              {group === "time" && <TimeGroup employeeId={id} scope={scope} />}
              {group === "access" && <AccessGroup person={person.data} />}
            </div>
            <aside className="flex min-w-0 flex-col gap-5">
              <Papers dossier={dossier.data} />
              <Activity person={person.data} />
            </aside>
          </div>

          {editing && (
            <ChangeDataSheet
              employeeId={id}
              dossier={dossier.data}
              onClose={() => setEditing(false)}
            />
          )}
        </>
      )}
    </div>
  )
}

// ── the head and the four figures ───────────────────────────────────────────

function Head({
  person,
  name,
  position,
  canChange,
  onChange,
}: {
  person: EmployeeView
  name: string
  position: string | null
  canChange: boolean
  onChange: () => void
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-5">
      <div className="flex min-w-0 items-center gap-4">
        <div
          aria-hidden
          className="grid size-14 shrink-0 place-items-center rounded-full bg-soft-2 text-[1.125rem] font-semibold text-body"
        >
          {initials(name)}
        </div>
        <div className="min-w-0">
          <h1 className="text-[1.375rem] leading-7 font-semibold [overflow-wrap:anywhere] text-ink">
            {name}
          </h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.9375rem] text-body">
            <span className="font-mono">{person.employee_code}</span>
            {position !== null && <span>· {position}</span>}
            {person.current_unit_name !== null && (
              <span>· {person.current_unit_name}</span>
            )}
            <Pill tone={statusTone(person.status)}>
              {statusWord(person.status)}
            </Pill>
          </div>
        </div>
      </div>
      {/* One action: a shop asks. While a change waits there is nothing to add
          to it — it is withdrawn or answered first. */}
      {canChange && (
        <div className="flex gap-2">
          <Button variant="primary" onClick={onChange}>
            Change Data
          </Button>
        </div>
      )}
    </div>
  )
}

function Figures({
  person,
  dossier,
  contract,
}: {
  person: EmployeeView
  dossier: EmployeeDossierView | undefined
  contract: { kind: string | null; endsOn: string | null } | null
}) {
  const profile = useQuery({
    queryKey: hrKeys.profile(person.employee_id),
    queryFn: ({ signal }) => employeeProfile(person.employee_id, signal),
    staleTime: 5 * 60_000,
  })
  const balances = useQuery({
    queryKey: hrKeys.balancesOf(person.employee_id),
    queryFn: ({ signal }) => leaveBalancesOf(person.employee_id, signal),
  })

  const hired = person.history.find((event) => event.transition === "HIRE")
  const joined = profile.data?.joined_on ?? hired?.effective_on ?? null
  const left = balances.data?.reduce((sum, row) => sum + row.centidays, 0)
  const missing = dossier?.missing ?? []

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Figure label="Joined">{joined === null ? "—" : readDate(joined)}</Figure>
      <Figure label="Contract Ends">
        {contract === null || contract.kind === null
          ? "—"
          : contract.endsOn === null
            ? `No end · ${contract.kind}`
            : `${readDate(contract.endsOn)} · ${contract.kind}`}
      </Figure>
      <Figure label="Leave Left">
        {left === undefined ? "—" : `${readCentidays(left)} days`}
      </Figure>
      <Figure
        label="Papers"
        tone={
          dossier === undefined ? undefined : missing.length > 0 ? "bad" : "ok"
        }
      >
        {dossier === undefined
          ? "—"
          : missing.length > 0
            ? `${missing.join(", ")} missing`
            : "Complete"}
      </Figure>
    </div>
  )
}

// ── a change, waiting ───────────────────────────────────────────────────────

const PERSONAL_LABELS: readonly [keyof PersonalChanges, string][] = [
  ["full_name", "Full name"],
  ["nik", "NIK"],
  ["birth_date", "Date of birth"],
  ["address", "Address"],
  ["phone", "Phone"],
  ["email", "Email"],
]

/// What a change touches, in words: "address, phone and KK scan".
function changedLabels(update: EmployeeDataUpdateView): string {
  const parts: string[] = []
  for (const [key, text] of PERSONAL_LABELS)
    if (update.personal[key] !== null) parts.push(text)
  if (update.details !== null) parts.push("Personal details")
  for (const paper of update.documents)
    parts.push(
      PAPER_KINDS.find((kind) => kind.kind === paper.kind)?.label ?? paper.kind,
    )
  if (parts.length < 2) return parts.join("").toLowerCase() || "the file"
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`.replace(
    /^(\w)/,
    (first) => first.toLowerCase(),
  )
}

/// A change this shop sent, still with head office. The shop may take it back.
function WaitingBanner({ update }: { update: EmployeeDataUpdateView }) {
  const client = useQueryClient()
  const [problem, setProblem] = useState<unknown>(null)
  const [pending, setPending] = useState(false)

  async function withdraw() {
    setProblem(null)
    setPending(true)
    try {
      await withdrawDataUpdate(update.id, "Withdrawn by the store")
      await client.invalidateQueries({ queryKey: papersKeys.all() })
    } catch (error) {
      setProblem(error)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Banner
        tone="info"
        action={
          <Button
            variant="primary"
            pending={pending}
            onClick={() => void withdraw()}
          >
            Withdraw
          </Button>
        }
      >
        <span className="flex items-center gap-2">
          <Hourglass className="size-4 shrink-0" />
          Waiting on head office · {changedLabels(update)}
        </span>
      </Banner>
      {problem !== null && (
        <Banner tone="bad">{describeCentre(problem)}</Banner>
      )}
    </div>
  )
}
