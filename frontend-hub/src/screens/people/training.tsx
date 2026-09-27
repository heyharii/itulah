import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, Input, Select } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Banner, EmptyState } from "@/components/ui/states"
import { day, money } from "@/lib/format"
import {
  defineTrainingProgram,
  listEmployees,
  listTrainingPrograms,
  nominateForTraining,
  nextKeys,
  peopleKeys,
  useReach,
} from "@/lib/queries/people"
import type { TrainingProgramView } from "@itulah/contract"
import { queryState } from "@/lib/query-state"

/// Training: the company's programs, and who is in them.
///
/// Programs and their cost are head office's — the cost is recorded here and
/// Finance's Manpower-development account is the one that eventually carries
/// it. Nominating is the store head's: the person who knows the floor is the
/// one who says who should sit in the room. A program is closed, never
/// deleted, because the rows it carries are the record of who was trained.

export function Training() {
  const client = useQueryClient()
  const reach = useReach()
  const employer = reach.data?.role === "ADMIN"
  const manager = employer || reach.data?.role === "SUPERVISOR"

  const team = useQuery({
    queryKey: peopleKeys.employees({ status: "ACTIVE", limit: 1000 }),
    queryFn: ({ signal }) => listEmployees({ status: "ACTIVE", limit: 1000 }, signal),
  })
  const programs = useQuery({
    queryKey: nextKeys.training(),
    queryFn: ({ signal }) => listTrainingPrograms(signal),
  })
  const people = (team.data ?? []).map((person) => ({ id: person.employee_id, name: person.full_name ?? person.employee_code ?? person.employee_id }))
  const nameOf = (id: string) => people.find((person) => person.id === id)?.name ?? id

  return (
    <PageContent>
      <PageHeader
        crumb="People · Talent"
        title="Training"
        sub="Programs and their cost belong to head office; nominations belong to the store head who knows the floor."
      />

      {employer ? <DefineProgram /> : null}

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Programs</CardTitle>
        </CardHeader>
        {queryState(programs, {
          loading: "Reading the programs…",
          render: () =>
            (programs.data ?? []).length === 0 ? (
              <EmptyState>
                No program has been defined yet. Head office defines them;
                the cost is recorded, never posted from here.
              </EmptyState>
            ) : (
              <div className="divide-y">
                {(programs.data ?? []).map((program) => (
                  <ProgramRow
                    key={program.id}
                    program={program}
                    team={people}
                    nameOf={nameOf}
                    canNominate={manager}
                    onNominate={async (employeeId, reason) => {
                      await nominateForTraining(program.id, { employee_id: employeeId, reason })
                      client.invalidateQueries({ queryKey: nextKeys.training() })
                    }}
                  />
                ))}
              </div>
            ),
        })}
      </Card>
    </PageContent>
  )
}

function ProgramRow({
  program,
  team,
  canNominate,
  onNominate,
}: {
  program: TrainingProgramView
  team: { id: string; name: string }[]
  nameOf: (id: string) => string
  canNominate: boolean
  onNominate: (employeeId: string, reason: string) => Promise<unknown>
}) {
  const client = useQueryClient()
  const [employeeId, setEmployeeId] = useState("")
  const [failed, setFailed] = useState<string | null>(null)
  const nominate = useMutation({
    mutationFn: () => {
      if (employeeId === "") throw new Error("choose a person first")
      return onNominate(employeeId, `nominated for ${program.title}`)
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: nextKeys.training() })
      setEmployeeId("")
      setFailed(null)
    },
    onError: (error: Error) => setFailed(error.message),
  })
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-ink">{program.title}</span>
        <span className="text-meta text-body">
          {day(program.on_date)} · {program.place} · {money(program.cost_minor)}
        </span>
      </div>
      {failed ? <Banner tone="bad">{failed}</Banner> : null}
      {canNominate && program.state === "SCHEDULED" ? (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <div className="w-56">
            <Select value={employeeId} onChange={setEmployeeId}>
              <option value="">Nominate a person…</option>
              {team.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </Select>
          </div>
          <Button size="sm" variant="ghost" disabled={nominate.isPending} onClick={() => nominate.mutate()}>
            Nominate
          </Button>
        </div>
      ) : null}
      <div className="mt-2">
        <Pill tone={program.state === "DONE" ? "ok" : "info"}>
          {program.state === "DONE" ? "Done" : "Scheduled"} · {program.participants} nominated
        </Pill>
      </div>
    </div>
  )
}

function DefineProgram() {
  const client = useQueryClient()
  const [title, setTitle] = useState("")
  const [onDate, setOnDate] = useState("")
  const [place, setPlace] = useState("HO")
  const [cost, setCost] = useState("")
  const [failed, setFailed] = useState<string | null>(null)
  const define = useMutation({
    mutationFn: () =>
      defineTrainingProgram({
        title,
        on_date: onDate,
        place,
        cost_minor: Number(cost === "" ? "0" : cost),
        reason: "program defined by head office",
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: nextKeys.training() })
      setTitle("")
      setOnDate("")
      setCost("")
      setFailed(null)
    },
    onError: (error: Error) => setFailed(error.message),
  })
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Define a program</CardTitle>
      </CardHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Date">
          <Input type="date" value={onDate} onChange={(e) => setOnDate(e.target.value)} />
        </Field>
        <Field label="Where">
          <Input value={place} onChange={(e) => setPlace(e.target.value)} />
        </Field>
        <Field label="Cost per person, whole rupiah">
          <Input inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value.replace(/[^\d]/g, ""))} />
        </Field>
      </div>
      {failed ? <Banner tone="bad">{failed}</Banner> : null}
      <div className="mt-3 flex justify-end">
        <Button
          variant="primary"
          disabled={title.trim() === "" || onDate === "" || define.isPending}
          onClick={() => define.mutate()}
        >
          Define
        </Button>
      </div>
    </Card>
  )
}
