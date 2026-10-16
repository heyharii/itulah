import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { Lock } from "lucide-react"
import { useState } from "react"

import { Card } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { PeopleSheet, SheetSection } from "@/components/ui/people-sheet"
import { PeopleTable } from "@/components/ui/people-table"
import { PeopleTabs } from "@/components/ui/people-tabs"
import { Pill, Status } from "@/components/ui/pill"
import { Stat, StatStrip } from "@/components/ui/stat-strip"
import {
  hrKeys,
  isoDay,
  readDate,
  recordUniform,
  rulesQuery,
  uniformsOf,
  type StoreScope,
} from "@/lib/queries/hr"
import { centreState } from "@/screens/hr/centre"
import { Facts, Person, personCard, Submit } from "@/screens/hr/parts"
import { RefusedBanner } from "@/screens/hr/refused"
import {
  personByLogin,
  personName,
  teamRows,
  useTeam,
  type Tone,
} from "@/screens/hr/words"
import { HrWorkspace } from "@/screens/hr/workspace"
import { money } from "@itulah/contract/money"
import type {
  EmployeeList,
  PolicyView,
  UniformIssuanceView,
} from "@itulah/contract"

/// Benefits at this shop — the prototype's store Benefits.
///
/// "Toko mengadministrasi benefit sesuai aturan HO": the shop administers,
/// head office sets the rates, the allowances and the ceilings. What a shop
/// records here is the uniform handed over — the person standing in the shop
/// is the one who hands it — and what it reads is the rules. Medical claims
/// are Expenses, not here.
///
/// # BPJS registration is not readable from a till
///
/// The prototype lets a store see who is registered and register them. The
/// numbers live on the payroll identity at the centre, behind head office's
/// `PAY_CHANGE` key, and a store's sign-in is refused them — so this screen
/// shows the contribution rates everybody may read, and says plainly that the
/// registrations are head office's, rather than drawing a column of blanks
/// that would read as "nobody is registered".
export function HrBenefits() {
  return <HrWorkspace>{(scope) => <Benefits scope={scope} />}</HrWorkspace>
}

type Tab = "uniforms" | "bpjs" | "other"

function Benefits({ scope }: { scope: StoreScope }) {
  const [tab, setTab] = useState<Tab>("uniforms")
  const team = useTeam(scope)
  const benefit = useQuery(rulesQuery("benefit"))
  const statutory = useQuery(rulesQuery("statutory"))

  return (
    <>
      {/* On a phone the dock's one chip; on a desk the underline tabs. */}
      <PeopleTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "uniforms", label: "Uniforms" },
          { value: "bpjs", label: "BPJS" },
          { value: "other", label: "THR & other" },
        ]}
      />
      {tab === "uniforms" && (
        <Uniforms
          team={team.data}
          allowance={
            benefit.data?.find(
              (rule) => rule.key === "benefit.uniform_sets_annual",
            )?.value ?? null
          }
        />
      )}
      {tab === "bpjs" &&
        centreState(statutory, {
          loading: "Reading the BPJS rates…",
          what: "the BPJS rates",
          render: (rows) => <Bpjs rates={rows} team={team.data} />,
        })}
      {tab === "other" &&
        centreState(benefit, {
          loading: "Reading the benefit rules…",
          what: "the benefit rules",
          render: (rows) => <Other rules={rows} />,
        })}
    </>
  )
}

// ── uniforms ────────────────────────────────────────────────────────────────

/// One person's uniform ledger, folded to what the list says about them.
interface UniformRow {
  readonly id: string
  readonly loading: boolean
  /// Sets handed over this calendar year.
  readonly thisYear: number
  /// The day of the last handover, if there has ever been one.
  readonly last: string | null
  /// Every handover, newest first.
  readonly ledger: readonly UniformIssuanceView[]
}

/// Where somebody stands against the yearly allowance, in a word. No allowance
/// rule from head office, no word.
function allowanceState(
  given: number,
  allowance: number | null,
): { label: string; tone: Tone } | null {
  if (allowance === null) return null
  if (given >= allowance) return { label: "Allowance given", tone: "ok" }
  const left = allowance - given
  return {
    label: `${left} ${left === 1 ? "set" : "sets"} left`,
    tone: "neutral",
  }
}

function Uniforms({
  team,
  allowance,
}: {
  team: EmployeeList | undefined
  allowance: number | null
}) {
  const people = (team?.rows ?? []).filter(
    (person) => person.status === "ACTIVE",
  )
  const reads = useQueries({
    queries: people.map((person) => ({
      queryKey: hrKeys.uniformsOf(person.employee_id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        uniformsOf(person.employee_id, signal),
    })),
  })
  const refused = reads.find((read) => read.isError)
  const year = String(new Date().getFullYear())
  const [recording, setRecording] = useState<string | null>(null)

  const rows: UniformRow[] = people.map((person, index) => {
    const ledger = [...(reads[index]?.data ?? [])].sort((left, right) =>
      right.issued_on.localeCompare(left.issued_on),
    )
    return {
      id: person.employee_id,
      loading: reads[index]?.isPending ?? true,
      thisYear: ledger
        .filter((row) => row.issued_on.startsWith(year))
        .reduce((sum, row) => sum + row.sets, 0),
      last: ledger[0]?.issued_on ?? null,
      ledger,
    }
  })
  const open = rows.find((row) => row.id === recording)

  return (
    <>
      {refused !== undefined && (
        <RefusedBanner error={refused.error} what="the uniform ledger" />
      )}
      <PeopleTable
        rows={rows}
        rowKey={(row) => row.id}
        onRowClick={(row) => setRecording(row.id)}
        empty="Nobody posted here."
        card={(row) => {
          const state = row.loading
            ? null
            : allowanceState(row.thisYear, allowance)
          return {
            ...personCard(team, row.id, [
              row.loading
                ? undefined
                : row.last === null
                  ? "Nothing handed over yet"
                  : `Last handed over ${readDate(row.last)}`,
            ]),
            lead: {
              figure: row.loading ? "…" : row.thisYear,
              caption: `sets in ${year}`,
              muted: row.loading || row.thisYear === 0,
            },
            foot: {
              info:
                state === null ? undefined : (
                  <Status tone={state.tone}>{state.label}</Status>
                ),
              action: { label: "Open", onClick: () => setRecording(row.id) },
            },
          }
        }}
        columns={[
          {
            key: "who",
            header: "Employee",
            cell: (row) => <Person team={team} id={row.id} />,
          },
          {
            key: "last",
            header: "Last handed over",
            cell: (row) =>
              row.loading ? "…" : row.last === null ? "—" : readDate(row.last),
          },
          {
            key: "year",
            header: `Sets in ${year}`,
            align: "right",
            cell: (row) => (row.loading ? "…" : row.thisYear),
          },
          {
            key: "allowance",
            header: "Allowance",
            align: "right",
            cell: () => (allowance === null ? "—" : `${allowance} a year`),
          },
          {
            key: "state",
            header: "Status",
            cell: (row) => {
              const state = row.loading
                ? null
                : allowanceState(row.thisYear, allowance)
              return state === null ? (
                "—"
              ) : (
                <Status tone={state.tone}>{state.label}</Status>
              )
            },
          },
        ]}
      />
      {open !== undefined && (
        <UniformSheet
          key={open.id}
          row={open}
          team={team}
          year={year}
          allowance={allowance}
          onClose={() => setRecording(null)}
        />
      )}
    </>
  )
}

/// One person's uniforms: what has been handed over, and — while the yearly
/// allowance has room — the form that records the next handover.
function UniformSheet({
  row,
  team,
  year,
  allowance,
  onClose,
}: {
  row: UniformRow
  team: EmployeeList | undefined
  year: string
  allowance: number | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const employeeId = row.id
  const given = row.thisYear
  const full = allowance !== null && given >= allowance
  const left = allowance === null ? 3 : Math.max(1, allowance - given)
  const [sets, setSets] = useState("1")
  const [issuedOn, setIssuedOn] = useState(isoDay(new Date()))
  const [reason, setReason] = useState("")
  const record = useMutation({
    mutationFn: () =>
      recordUniform({ employeeId, issuedOn, sets: Number(sets), reason }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: hrKeys.uniformsOf(employeeId) })
      onClose()
    },
  })
  const role = teamRows(team).find(
    (person) => person.employee_id === employeeId,
  )?.position

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      crumb="Uniform"
      title={personName(team, employeeId)}
      sub={
        allowance === null
          ? `${given} ${given === 1 ? "set" : "sets"} in ${year}`
          : `${given} of ${allowance} sets in ${year}`
      }
      status={full ? <Pill tone="ok">Allowance given</Pill> : undefined}
      foot={
        full ? undefined : (
          <Submit
            label="Create handover"
            pendingLabel="Creating…"
            pending={record.isPending}
            disabled={issuedOn === "" || reason.trim() === ""}
            error={record.error}
            onSubmit={() => record.mutate()}
            onCancel={onClose}
          />
        )
      }
    >
      <Facts
        rows={[
          ["Position", role ?? "—"],
          ["Allowance", allowance === null ? "—" : `${allowance} sets a year`],
          [
            "Last handed over",
            row.last === null ? "Nothing yet" : readDate(row.last),
          ],
        ]}
      />
      {row.ledger.length > 0 && (
        <SheetSection
          title="Handed over"
          aside={row.ledger.length}
          className="mt-6"
        >
          <ul className="flex flex-col divide-y divide-hairline">
            {row.ledger.map((entry) => (
              <li
                key={entry.id}
                className="flex items-baseline justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <span className="min-w-0">
                  <span className="block text-cell text-ink">
                    {readDate(entry.issued_on)}
                  </span>
                  <span className="block truncate text-meta text-mute">
                    {personByLogin(team, entry.recorded_by)}
                  </span>
                </span>
                <span className="shrink-0 text-cell text-ink tabular-nums">
                  {entry.sets} {entry.sets === 1 ? "set" : "sets"}
                </span>
              </li>
            ))}
          </ul>
        </SheetSection>
      )}
      {!full && (
        <SheetSection title="New handover" className="mt-6">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Sets" required>
                <Select value={sets} onChange={setSets}>
                  {Array.from({ length: left }, (_, index) =>
                    String(index + 1),
                  ).map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Handed over on" required>
                <Input
                  type="date"
                  value={issuedOn}
                  max={isoDay(new Date())}
                  onChange={(event) => setIssuedOn(event.target.value)}
                />
              </Field>
            </div>
            <Field label="Reason" required>
              <Input
                value={reason}
                placeholder="New joiner's first set"
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
          </div>
        </SheetSection>
      )}
    </PeopleSheet>
  )
}

// ── BPJS ────────────────────────────────────────────────────────────────────

function rate(rates: readonly PolicyView[], key: string): number | null {
  return rates.find((rule) => rule.key === key)?.value ?? null
}

function Bpjs({
  rates,
  team,
}: {
  rates: readonly PolicyView[]
  team: EmployeeList | undefined
}) {
  const kesCo = rate(rates, "statutory.bpjs_kesehatan_company")
  const tkCo = rate(rates, "statutory.bpjs_ketenagakerjaan_company")
  const kesEmp = rate(rates, "statutory.bpjs_kesehatan_employee")
  const tkEmp = rate(rates, "statutory.bpjs_ketenagakerjaan_employee")
  const pct = (value: number | null) => (value === null ? "—" : `${value}%`)
  const people = (team?.rows ?? []).filter(
    (person) => person.status === "ACTIVE",
  )

  return (
    <>
      {/* The four rates are the same for everybody: a line of figures over
          the list, not a column repeated on every row. */}
      <StatStrip className="md:grid-cols-4">
        <Stat label="Kesehatan, company" value={pct(kesCo)} />
        <Stat label="Kesehatan, employee" value={pct(kesEmp)} />
        <Stat label="Ketenagakerjaan, company" value={pct(tkCo)} />
        <Stat label="Ketenagakerjaan, employee" value={pct(tkEmp)} />
      </StatStrip>
      <PeopleTable
        rows={people}
        rowKey={(person) => person.employee_id}
        empty="Nobody posted here."
        card={(person) => ({
          ...personCard(team, person.employee_id),
          foot: {
            info: (
              <Status tone="neutral">Registration held at head office</Status>
            ),
          },
        })}
        columns={[
          {
            key: "who",
            header: "Employee",
            cell: (person) => <Person team={team} id={person.employee_id} />,
          },
          {
            key: "kes",
            header: "BPJS Kesehatan",
            cell: () => <HeldAtHo />,
          },
          {
            key: "tk",
            header: "BPJS Ketenagakerjaan",
            cell: () => <HeldAtHo />,
          },
          {
            key: "company",
            header: "Company pays",
            align: "right",
            cell: () =>
              kesCo === null || tkCo === null
                ? "—"
                : `${(kesCo + tkCo).toFixed(2)}%`,
          },
          {
            key: "employee",
            header: "Employee pays",
            align: "right",
            cell: () =>
              kesEmp === null || tkEmp === null ? "—" : `${kesEmp + tkEmp}%`,
          },
        ]}
      />
    </>
  )
}

function HeldAtHo() {
  return (
    <span className="inline-flex items-center gap-1 text-mute">
      <Lock className="size-3.5" />
      Held at head office
    </span>
  )
}

// ── THR and the rest ────────────────────────────────────────────────────────

function Other({ rules: rows }: { rules: readonly PolicyView[] }) {
  const shown = rows.filter(
    (rule) => rule.key !== "benefit.uniform_sets_annual",
  )
  return (
    <Card className="divide-y divide-hairline">
      <Line
        title="THR (religious holiday allowance)"
        sub="1 month's base after 12 months · pro rata"
      />
      {shown.map((rule) => (
        <Line
          key={rule.key}
          title={rule.label}
          sub={
            rule.unit === "RUPIAH"
              ? money(rule.value)
              : `${rule.value} ${rule.unit.toLowerCase()}`
          }
        />
      ))}
      <Line
        title="Severance and entitlements"
        sub="Set at head office on leaving"
      />
    </Card>
  )
}

function Line({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="px-4 py-3">
      <span className="block text-cell font-medium text-ink">{title}</span>
      <span className="block text-meta text-body">{sub}</span>
    </div>
  )
}
