import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { Lock } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { PeopleSheet } from "@/components/ui/people-sheet"
import { PeopleTable } from "@/components/ui/people-table"
import { PeopleTabs } from "@/components/ui/people-tabs"
import { Pill } from "@/components/ui/pill"
import {
  hrKeys,
  isoDay,
  readDate,
  recordUniform,
  rules,
  uniformsOf,
  type StoreScope,
} from "@/lib/queries/hr"
import { centreState } from "@/screens/hr/centre"
import { RefusedBanner } from "@/screens/hr/refused"
import { Facts, Person, Submit } from "@/screens/hr/parts"
import { personName, useTeam } from "@/screens/hr/words"
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
  return (
    <HrWorkspace>
      {(scope) => <Benefits scope={scope} />}
    </HrWorkspace>
  )
}

type Tab = "uniforms" | "bpjs" | "other"

function Benefits({ scope }: { scope: StoreScope }) {
  const [tab, setTab] = useState<Tab>("uniforms")
  const team = useTeam(scope)
  const benefit = useQuery({
    queryKey: hrKeys.rules("benefit"),
    queryFn: ({ signal }) => rules("benefit", signal),
    staleTime: 5 * 60_000,
  })
  const statutory = useQuery({
    queryKey: hrKeys.rules("statutory"),
    queryFn: ({ signal }) => rules("statutory", signal),
    staleTime: 5 * 60_000,
  })

  return (
    <>
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
          loading: "Loading…",
          what: "the BPJS rates",
          render: (rows) => <Bpjs rates={rows} team={team.data} />,
        })}
      {tab === "other" &&
        centreState(benefit, {
          loading: "Loading…",
          what: "the benefit rules",
          render: (rows) => <Other rules={rows} />,
        })}
    </>
  )
}

// ── uniforms ────────────────────────────────────────────────────────────────

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

  const rows = people.map((person, index) => {
    const ledger: readonly UniformIssuanceView[] = reads[index]?.data ?? []
    const latest = [...ledger].sort((left, right) =>
      right.issued_on.localeCompare(left.issued_on),
    )[0]
    return {
      id: person.employee_id,
      loading: reads[index]?.isPending ?? true,
      thisYear: ledger
        .filter((row) => row.issued_on.startsWith(year))
        .reduce((sum, row) => sum + row.sets, 0),
      last: latest?.issued_on ?? null,
    }
  })

  return (
    <>
      {refused !== undefined && (
        <RefusedBanner error={refused.error} what="the uniform ledger" />
      )}
      <PeopleTable
        rows={rows}
        rowKey={(row) => row.id}
        empty="Nobody posted here."
        columns={[
          {
            key: "who",
            header: "Employee",
            cell: (row) => <Person team={team} id={row.id} />,
          },
          {
            key: "last",
            header: "Last handed over",
            card: "meta",
            cell: (row) =>
              row.loading
                ? "…"
                : row.last === null
                  ? "never"
                  : readDate(row.last),
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
            card: "hide",
            cell: () => (allowance === null ? "—" : `${allowance} a year`),
          },
          {
            key: "act",
            header: "",
            card: "action",
            cell: (row) =>
              row.loading ? null : allowance !== null &&
                row.thisYear >= allowance ? (
                <Pill tone="ok">Allowance given</Pill>
              ) : (
                <Button
                  onClick={(event) => {
                    event.stopPropagation()
                    setRecording(row.id)
                  }}
                >
                  Record handover
                </Button>
              ),
          },
        ]}
      />
      {recording !== null && (
        <RecordUniform
          employeeId={recording}
          team={team}
          given={rows.find((row) => row.id === recording)?.thisYear ?? 0}
          allowance={allowance}
          onClose={() => setRecording(null)}
        />
      )}
    </>
  )
}

function RecordUniform({
  employeeId,
  team,
  given,
  allowance,
  onClose,
}: {
  employeeId: string
  team: EmployeeList | undefined
  given: number
  allowance: number | null
  onClose: () => void
}) {
  const client = useQueryClient()
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

  return (
    <PeopleSheet
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      crumb="Benefits · Uniforms"
      title={personName(team, employeeId)}
      sub={
        allowance === null
          ? `${given} set${given === 1 ? "" : "s"} this year`
          : `${given} of ${allowance} sets this year`
      }
      foot={
        <Submit
          label="Record the handover"
          pending={record.isPending}
          disabled={issuedOn === "" || reason.trim() === ""}
          error={record.error}
          onSubmit={() => record.mutate()}
        />
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sets">
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
          <Field label="Handed over on">
            <Input
              type="date"
              value={issuedOn}
              max={isoDay(new Date())}
              onChange={(event) => setIssuedOn(event.target.value)}
            />
          </Field>
        </div>
        <Field
          label="Reason"
        >
          <Input
            value={reason}
            placeholder="New joiner's first set"
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </div>
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
      <PeopleTable
        rows={people}
        rowKey={(person) => person.employee_id}
        empty="Nobody posted here."
        columns={[
          {
            key: "who",
            header: "Employee",
            cell: (person) => <Person team={team} id={person.employee_id} />,
          },
          {
            key: "kes",
            header: "BPJS Kesehatan",
            card: "meta",
            cell: () => <HeldAtHo />,
          },
          {
            key: "tk",
            header: "BPJS Ketenagakerjaan",
            card: "meta",
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
      <Card className="mt-4 px-4 py-3">
        <Facts
          rows={[
            ["Kesehatan, company", pct(kesCo)],
            ["Kesehatan, employee", pct(kesEmp)],
            ["Ketenagakerjaan, company", pct(tkCo)],
            ["Ketenagakerjaan, employee", pct(tkEmp)],
          ]}
        />
      </Card>
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
    <>
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
    </>
  )
}

function Line({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3">
      <span className="min-w-0">
        <span className="block text-cell font-medium text-ink">{title}</span>
        <span className="block text-meta text-body">{sub}</span>
      </span>
      <Pill tone="neutral">HO</Pill>
    </div>
  )
}
