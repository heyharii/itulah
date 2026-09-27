import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Banner, EmptyState } from "@/components/ui/states"
import { day } from "@/lib/format"
import {
  listEmployees,
  listUniformIssuances,
  nextKeys,
  peopleKeys,
  readRules,
  recordUniformIssuance,
  useReach,
} from "@/lib/queries/people"

/// Benefits: what the company hands over, and the rules it hands it out by.
///
/// Toko mengadministrasi benefit sesuai aturan HO: the store records a
/// uniform handover and reads the ceilings; the rates and entitlements are
/// head office's rule numbers, shown here from the same table the Policies
/// screen edits. BPJS registration lives with the payroll identity, which is
/// Finance's half of the same person — this screen reads the policy numbers
/// and the uniform ledger, which is what a shop actually acts on.
///
/// The annual entitlement is policy, never a stored balance: a count against
/// it is these rows summed inside the year.

export function Benefits() {
  const client = useQueryClient()
  const reach = useReach()
  const manager =
    reach.data?.role === "ADMIN" || reach.data?.role === "SUPERVISOR"

  const team = useQuery({
    queryKey: peopleKeys.employees({ status: "ACTIVE", limit: 1000 }),
    queryFn: ({ signal }) =>
      listEmployees({ status: "ACTIVE", limit: 1000 }, signal),
  })
  const rules = useQuery({
    queryKey: nextKeys.rules("benefit"),
    queryFn: ({ signal }) => readRules({ group: "benefit" }, signal),
  })
  const statutory = useQuery({
    queryKey: nextKeys.rules("statutory"),
    queryFn: ({ signal }) => readRules({ group: "statutory" }, signal),
  })
  const people = (team.data ?? []).map((person) => ({
    id: person.employee_id,
    name: person.full_name ?? person.employee_code ?? person.employee_id,
  }))
  const nameOf = (id: string) =>
    people.find((person) => person.id === id)?.name ?? id

  return (
    <PageContent>
      <PageHeader
        crumb="People · Payroll"
        title="Benefits"
        sub="Seragam dan plafonnya, dan angka BPJS yang dibaca setiap slip. Tarif dan jatah milik HO; pencatatan milik toko."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>The rules, as they stand</CardTitle>
          </CardHeader>
          <div className="divide-y">
            {(rules.data ?? []).map((rule) => (
              <div
                key={rule.key}
                className="flex items-baseline justify-between gap-3 px-4 py-2"
              >
                <span className="text-body">{rule.label}</span>
                <span className="text-meta text-body">
                  {Number.isInteger(rule.value)
                    ? rule.value.toLocaleString("id-ID")
                    : rule.value}{" "}
                  {rule.unit.toLowerCase()}
                </span>
              </div>
            ))}
            {(statutory.data ?? []).map((rule) => (
              <div
                key={rule.key}
                className="flex items-baseline justify-between gap-3 px-4 py-2"
              >
                <span className="text-body">{rule.label}</span>
                <span className="text-meta text-body">{rule.value}%</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Uniform ledger</CardTitle>
          </CardHeader>
          <UniformLedger team={people} nameOf={nameOf} />
          {manager ? (
            <RecordUniform
              team={people}
              onDone={() =>
                client.invalidateQueries({
                  queryKey: ["people", "next", "uniform"],
                })
              }
            />
          ) : null}
        </Card>
      </div>
    </PageContent>
  )
}

/// One row per person of the unit, each with its own read. A component per
/// person rather than a loop of hooks: the team list grows when the query
/// lands, and a hook count that grows with it is a React violation waiting
/// for the first hire.
function UniformLedger({
  team,
  nameOf,
}: {
  team: { id: string; name: string }[]
  nameOf: (id: string) => string
}) {
  if (team.length === 0) {
    return <EmptyState>Nobody to read yet.</EmptyState>
  }
  return (
    <div className="divide-y">
      {team.map((person) => (
        <UniformOf key={person.id} id={person.id} name={nameOf(person.id)} />
      ))}
    </div>
  )
}

function UniformOf({ id, name }: { id: string; name: string }) {
  const ledger = useQuery({
    queryKey: ["people", "next", "uniform", id],
    queryFn: ({ signal }) => listUniformIssuances(id, signal),
  })
  const rows = ledger.data ?? []
  const thisYear = rows.filter((row) =>
    row.issued_on.startsWith(new Date().toISOString().slice(0, 4))
  )
  const sets = thisYear.reduce((sum, row) => sum + row.sets, 0)
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-2">
      <span className="text-body">{name}</span>
      <span className="text-meta text-body">
        {sets} set this year
        {rows.length > 0 ? (
          <span className="text-mute">
            {" "}
            · last {day(rows[0]?.issued_on ?? "")}
          </span>
        ) : (
          <span className="text-mute"> · none recorded</span>
        )}
      </span>
    </div>
  )
}

function RecordUniform({
  team,
  onDone,
}: {
  team: { id: string; name: string }[]
  onDone: () => void
}) {
  const [employeeId, setEmployeeId] = useState("")
  const [sets, setSets] = useState("1")
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<string | null>(null)
  const record = useMutation({
    mutationFn: () =>
      recordUniformIssuance(employeeId, {
        issued_on: new Date().toISOString().slice(0, 10),
        sets: Number(sets),
        reason,
      }),
    onSuccess: () => {
      onDone()
      setEmployeeId("")
      setSets("1")
      setReason("")
      setFailed(null)
    },
    onError: (error: Error) => setFailed(error.message),
  })
  return (
    <div className="space-y-2 border-t border-hairline p-4">
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Who" required>
          <Select value={employeeId} onChange={setEmployeeId}>
            <option value="">Choose…</option>
            {team.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Sets" required>
          <Input
            inputMode="numeric"
            value={sets}
            onChange={(e) => setSets(e.target.value.replace(/[^\d]/g, ""))}
          />
        </Field>
        <Field label="Why" required>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
      {failed ? <Banner tone="bad">{failed}</Banner> : null}
      <div className="flex justify-end">
        <Button
          variant="primary"
          pending={record.isPending}
          disabled={employeeId === "" || sets === "" || reason.trim() === ""}
          onClick={() => record.mutate()}
        >
          Record the handover
        </Button>
      </div>
    </div>
  )
}
