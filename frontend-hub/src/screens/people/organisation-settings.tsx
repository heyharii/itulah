import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Day } from "@/components/ui/day"
import { Checkbox, Field, Input } from "@/components/ui/field"
import { PickOne } from "@/components/ui/pick"
import { Pill } from "@/components/ui/pill"
import {
  KeyValue,
  MiniCell,
  MiniRow,
  MiniTable,
  SubHead,
} from "@/components/ui/rows"
import { Banner, EmptyState } from "@/components/ui/states"
import { day, money } from "@/lib/format"
import {
  checklistTemplates,
  retireChecklistTemplate,
  saveChecklistTemplate,
  businessUnits,
  groupEntities,
  removeGroupEntity,
  saveBusinessUnit,
  saveGroupEntity,
  useReachableUnits,
  departments,
  jobGrades,
  jobLevels,
  orgCompany,
  orgKeys,
  registerBpjs,
  retireDepartment,
  retireJobGrade,
  retireJobLevel,
  saveDepartment,
  saveJobGrade,
  saveJobLevel,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { OWNER_CHOICES, OWNER_LABEL } from "@/screens/people/checklist-owners"

/// Settings › Organisation, as Talenta's Company and Organization settings:
/// who the company is and its BPJS numbers, the departments, the job levels
/// and the grades people are placed on. Where each person sits is on their
/// own sheet (Position); the whole of it is the Org chart.
export function OrganisationSettings() {
  return (
    <>
      <CompanyCard />
      <GroupCard />
      <BusinessUnitsCard />
      <DepartmentsCard />
      <LevelsCard />
      <GradesCard />
      <ChecklistCard />
    </>
  )
}

function useRetire(
  retire: (code: string, reason: string) => Promise<unknown>,
  key: readonly string[]
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ code, reason }: { code: string; reason: string }) =>
      retire(code, reason),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key })
      void client.invalidateQueries({ queryKey: orgKeys.chart() })
    },
  })
}

function CompanyCard() {
  const client = useQueryClient()
  const company = useQuery({
    queryKey: orgKeys.company(),
    queryFn: ({ signal }) => orgCompany(signal),
  })
  const [from, setFrom] = useState("")
  const [npp, setNpp] = useState("")
  const [kesehatan, setKesehatan] = useState("")
  const [risk, setRisk] = useState<string | null>(null)
  const [reason, setReason] = useState("")
  const save = useMutation({
    mutationFn: () =>
      registerBpjs({
        effective_from: from,
        npp: npp.trim() === "" ? null : npp.trim(),
        kesehatan_code: kesehatan.trim() === "" ? null : kesehatan.trim(),
        jkk_risk_class: risk,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      setReason("")
      void client.invalidateQueries({ queryKey: orgKeys.company() })
    },
  })

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Company</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-4 px-4 pb-4">
        {queryState(company, {
          loading: "Reading the company…",
          render: (view) => {
            const current = view.bpjs[0]
            return (
              <div>
                <KeyValue term="Name">
                  {[view.legal_form, view.name].filter(Boolean).join(" ") ||
                    "—"}
                </KeyValue>
                <KeyValue term="Address">{view.address ?? "—"}</KeyValue>
                <KeyValue term="NPWP">{view.tax_id ?? "—"}</KeyValue>
                <KeyValue term="NPP BPJS Ketenagakerjaan">
                  {current?.npp ?? "not stated"}
                </KeyValue>
                <KeyValue term="Kode badan usaha BPJS Kesehatan">
                  {current?.kesehatan_code ?? "not stated"}
                </KeyValue>
                <KeyValue term="JKK risk class">
                  {current?.jkk_risk_class ?? "not stated"}
                </KeyValue>
                <p className="mt-2 text-[0.875rem] text-mute">
                  Name, address and NPWP are the company&rsquo;s own, set in
                  System › Setup.
                </p>
                {view.bpjs.length > 1 && (
                  <div className="mt-3">
                    <SubHead>BPJS registration history</SubHead>
                    <MiniTable head={["From", "NPP", "Kesehatan", "JKK", "By"]}>
                      {view.bpjs.map((row) => (
                        <MiniRow key={row.effective_from}>
                          <MiniCell>{day(row.effective_from)}</MiniCell>
                          <MiniCell>{row.npp ?? "—"}</MiniCell>
                          <MiniCell>{row.kesehatan_code ?? "—"}</MiniCell>
                          <MiniCell>{row.jkk_risk_class ?? "—"}</MiniCell>
                          <MiniCell>{row.registered_by}</MiniCell>
                        </MiniRow>
                      ))}
                    </MiniTable>
                  </div>
                )}
              </div>
            )
          },
        })}
        <SubHead>State the BPJS registration from a date</SubHead>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="From" required>
            <Day value={from} onChange={setFrom} />
          </Field>
          <Field label="NPP BPJS Ketenagakerjaan">
            <Input value={npp} onChange={(e) => setNpp(e.target.value)} />
          </Field>
          <Field label="Kode badan usaha BPJS Kesehatan">
            <Input
              value={kesehatan}
              onChange={(e) => setKesehatan(e.target.value)}
            />
          </Field>
          <Field label="JKK risk class">
            <PickOne
              label="JKK risk class"
              placeholder="Choose…"
              choices={["I", "II", "III", "IV", "V"].map((one) => ({
                value: one,
                label: one,
              }))}
              value={risk}
              onChange={setRisk}
            />
          </Field>
          <Field label="Why" required>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        {save.error !== null && (
          <Banner tone="bad">{save.error.message}</Banner>
        )}
        <div>
          <Button
            variant="primary"
            pending={save.isPending}
            disabled={from === "" || reason.trim() === ""}
            onClick={() => save.mutate()}
          >
            Save registration
          </Button>
        </div>
      </div>
    </Card>
  )
}

function DepartmentsCard() {
  const client = useQueryClient()
  const list = useQuery({
    queryKey: orgKeys.departments(),
    queryFn: ({ signal }) => departments(signal),
  })
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [parent, setParent] = useState<string | null>(null)
  const [reason, setReason] = useState("")
  const save = useMutation({
    mutationFn: () =>
      saveDepartment({
        code: code.trim(),
        name: name.trim(),
        parent_code: parent,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      setCode("")
      setName("")
      setParent(null)
      setReason("")
      void client.invalidateQueries({ queryKey: orgKeys.departments() })
    },
  })
  const retire = useRetire(retireDepartment, orgKeys.departments())
  const rows = list.data ?? []
  const named = new Map(rows.map((row) => [row.code, row.name]))

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Departments</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-4 px-4 pb-4">
        {queryState(list, {
          loading: "Reading the departments…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                No department yet. A department is what somebody works in,
                across stores and head office — Operasional, Keuangan, HR.
              </EmptyState>
            ) : (
              <MiniTable
                head={[
                  "Department",
                  "Inside",
                  { label: "People", align: "right" },
                  "",
                ]}
              >
                {rows.map((row) => (
                  <MiniRow key={row.code}>
                    <MiniCell>
                      <button
                        type="button"
                        className="text-left hover:underline"
                        onClick={() => {
                          setCode(row.code)
                          setName(row.name)
                          setParent(row.parent_code)
                        }}
                      >
                        <span className="block text-[0.875rem] text-ink">
                          {row.name}
                        </span>
                        <span className="font-mono text-[0.875rem] text-mute">
                          {row.code}
                        </span>
                      </button>
                    </MiniCell>
                    <MiniCell>
                      {row.parent_code === null
                        ? "—"
                        : (named.get(row.parent_code) ?? row.parent_code)}
                    </MiniCell>
                    <MiniCell align="right">{row.members}</MiniCell>
                    <MiniCell>
                      {row.retired ? (
                        <Pill tone="neutral">Retired</Pill>
                      ) : (
                        <Button
                          variant="quiet"
                          disabled={reason.trim() === ""}
                          onClick={() =>
                            retire.mutate({
                              code: row.code,
                              reason: reason.trim(),
                            })
                          }
                        >
                          Retire
                        </Button>
                      )}
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
        <SubHead aside="Click a row to edit it">Add or change</SubHead>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Code" required>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="OPS"
            />
          </Field>
          <Field label="Name" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Operasional"
            />
          </Field>
          <Field label="Inside">
            <PickOne
              label="Inside"
              placeholder="Top level"
              choices={rows
                .filter((row) => !row.retired && row.code !== code)
                .map((row) => ({ value: row.code, label: row.name }))}
              value={parent}
              onChange={setParent}
            />
          </Field>
          <Field label="Why" required hint="Also asked for retiring one.">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        {(save.error ?? retire.error) !== null && (
          <Banner tone="bad">{(save.error ?? retire.error)?.message}</Banner>
        )}
        <div>
          <Button
            variant="primary"
            pending={save.isPending}
            disabled={
              code.trim() === "" || name.trim() === "" || reason.trim() === ""
            }
            onClick={() => save.mutate()}
          >
            Save department
          </Button>
        </div>
      </div>
    </Card>
  )
}

function LevelsCard() {
  const client = useQueryClient()
  const list = useQuery({
    queryKey: orgKeys.levels(),
    queryFn: ({ signal }) => jobLevels(signal),
  })
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [rank, setRank] = useState("")
  const [reason, setReason] = useState("")
  const save = useMutation({
    mutationFn: () =>
      saveJobLevel({
        code: code.trim(),
        name: name.trim(),
        rank: Number(rank),
        reason: reason.trim(),
      }),
    onSuccess: () => {
      setCode("")
      setName("")
      setRank("")
      setReason("")
      void client.invalidateQueries({ queryKey: orgKeys.levels() })
    },
  })
  const retire = useRetire(retireJobLevel, orgKeys.levels())
  const rows = list.data ?? []

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Job levels</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-4 px-4 pb-4">
        {queryState(list, {
          loading: "Reading the levels…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                No job level yet. Levels rank people for the org chart — 1 is
                the most senior: Direktur, Manager, Supervisor, Staff.
              </EmptyState>
            ) : (
              <MiniTable
                head={[
                  { label: "Rank", align: "right" },
                  "Level",
                  { label: "People", align: "right" },
                  "",
                ]}
              >
                {rows.map((row) => (
                  <MiniRow key={row.code}>
                    <MiniCell align="right">{row.rank}</MiniCell>
                    <MiniCell>
                      <button
                        type="button"
                        className="text-left hover:underline"
                        onClick={() => {
                          setCode(row.code)
                          setName(row.name)
                          setRank(String(row.rank))
                        }}
                      >
                        <span className="block text-[0.875rem] text-ink">
                          {row.name}
                        </span>
                        <span className="font-mono text-[0.875rem] text-mute">
                          {row.code}
                        </span>
                      </button>
                    </MiniCell>
                    <MiniCell align="right">{row.members}</MiniCell>
                    <MiniCell>
                      {row.retired ? (
                        <Pill tone="neutral">Retired</Pill>
                      ) : (
                        <Button
                          variant="quiet"
                          disabled={reason.trim() === ""}
                          onClick={() =>
                            retire.mutate({
                              code: row.code,
                              reason: reason.trim(),
                            })
                          }
                        >
                          Retire
                        </Button>
                      )}
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
        <SubHead aside="Click a row to edit it">Add or change</SubHead>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Code" required>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="MGR"
            />
          </Field>
          <Field label="Name" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Manager"
            />
          </Field>
          <Field label="Rank" aside="1 is the most senior" required>
            <Input
              inputMode="numeric"
              value={rank}
              onChange={(e) => setRank(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <Field label="Why" required hint="Also asked for retiring one.">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        {(save.error ?? retire.error) !== null && (
          <Banner tone="bad">{(save.error ?? retire.error)?.message}</Banner>
        )}
        <div>
          <Button
            variant="primary"
            pending={save.isPending}
            disabled={
              code.trim() === "" ||
              name.trim() === "" ||
              Number(rank) <= 0 ||
              reason.trim() === ""
            }
            onClick={() => save.mutate()}
          >
            Save level
          </Button>
        </div>
      </div>
    </Card>
  )
}

function GradesCard() {
  const client = useQueryClient()
  const list = useQuery({
    queryKey: orgKeys.grades(),
    queryFn: ({ signal }) => jobGrades(signal),
  })
  const levels = useQuery({
    queryKey: orgKeys.levels(),
    queryFn: ({ signal }) => jobLevels(signal),
  })
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [level, setLevel] = useState<string | null>(null)
  const [gradeClass, setGradeClass] = useState("")
  const [min, setMin] = useState("")
  const [max, setMax] = useState("")
  const [reason, setReason] = useState("")
  const figure = (text: string) => {
    const digits = text.replace(/\D/g, "")
    return digits === "" ? null : Number(digits)
  }
  const save = useMutation({
    mutationFn: () =>
      saveJobGrade({
        code: code.trim(),
        name: name.trim(),
        level_code: level,
        grade_class: gradeClass.trim() === "" ? null : gradeClass.trim(),
        min_minor: figure(min),
        max_minor: figure(max),
        reason: reason.trim(),
      }),
    onSuccess: () => {
      setCode("")
      setName("")
      setLevel(null)
      setGradeClass("")
      setMin("")
      setMax("")
      setReason("")
      void client.invalidateQueries({ queryKey: orgKeys.grades() })
    },
  })
  const retire = useRetire(retireJobGrade, orgKeys.grades())
  const rows = list.data ?? []
  const levelName = new Map(
    (levels.data ?? []).map((one) => [one.code, one.name])
  )

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Grades</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-4 px-4 pb-4">
        {queryState(list, {
          loading: "Reading the grades…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                No grade yet. A grade is a pay band on a level — guidance for
                whoever agrees somebody&rsquo;s pay, never a refusal.
              </EmptyState>
            ) : (
              <MiniTable
                head={[
                  "Grade",
                  "Level",
                  { label: "Band", align: "right" },
                  { label: "People", align: "right" },
                  "",
                ]}
              >
                {rows.map((row) => (
                  <MiniRow key={row.code}>
                    <MiniCell>
                      <button
                        type="button"
                        className="text-left hover:underline"
                        onClick={() => {
                          setCode(row.code)
                          setName(row.name)
                          setLevel(row.level_code)
                          setGradeClass(row.grade_class ?? "")
                          setMin(
                            row.min_minor === null ? "" : String(row.min_minor)
                          )
                          setMax(
                            row.max_minor === null ? "" : String(row.max_minor)
                          )
                        }}
                      >
                        <span className="block text-[0.875rem] text-ink">
                          {row.name}
                        </span>
                        <span className="font-mono text-[0.875rem] text-mute">
                          {row.code}
                          {row.grade_class !== null &&
                            ` · class ${row.grade_class}`}
                        </span>
                      </button>
                    </MiniCell>
                    <MiniCell>
                      {row.level_code === null
                        ? "—"
                        : (levelName.get(row.level_code) ?? row.level_code)}
                    </MiniCell>
                    <MiniCell align="right">
                      {row.min_minor === null && row.max_minor === null
                        ? "—"
                        : `${row.min_minor === null ? "…" : money(row.min_minor)} – ${row.max_minor === null ? "…" : money(row.max_minor)}`}
                    </MiniCell>
                    <MiniCell align="right">{row.members}</MiniCell>
                    <MiniCell>
                      {row.retired ? (
                        <Pill tone="neutral">Retired</Pill>
                      ) : (
                        <Button
                          variant="quiet"
                          disabled={reason.trim() === ""}
                          onClick={() =>
                            retire.mutate({
                              code: row.code,
                              reason: reason.trim(),
                            })
                          }
                        >
                          Retire
                        </Button>
                      )}
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
        <SubHead aside="Click a row to edit it">Add or change</SubHead>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Code" required>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="G3"
            />
          </Field>
          <Field label="Name" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Grade 3"
            />
          </Field>
          <Field label="Level">
            <PickOne
              label="Level"
              placeholder="Any level"
              choices={(levels.data ?? [])
                .filter((one) => !one.retired)
                .map((one) => ({ value: one.code, label: one.name }))}
              value={level}
              onChange={setLevel}
            />
          </Field>
          <Field label="Class">
            <Input
              value={gradeClass}
              onChange={(e) => setGradeClass(e.target.value)}
              placeholder="3A"
            />
          </Field>
          <Field label="Band from">
            <Input
              inputMode="numeric"
              value={min}
              onChange={(e) => setMin(e.target.value)}
            />
          </Field>
          <Field label="Band to">
            <Input
              inputMode="numeric"
              value={max}
              onChange={(e) => setMax(e.target.value)}
            />
          </Field>
          <Field label="Why" required hint="Also asked for retiring one.">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        {(save.error ?? retire.error) !== null && (
          <Banner tone="bad">{(save.error ?? retire.error)?.message}</Banner>
        )}
        <div>
          <Button
            variant="primary"
            pending={save.isPending}
            disabled={
              code.trim() === "" || name.trim() === "" || reason.trim() === ""
            }
            onClick={() => save.mutate()}
          >
            Save grade
          </Button>
        </div>
      </div>
    </Card>
  )
}

const RELATIONS = [
  { value: "HOLDING", label: "Holding" },
  { value: "SUBSIDIARY", label: "Subsidiary" },
  { value: "AFFILIATE", label: "Affiliate" },
]

/// Struktur grup: the holding over this company, and its subsidiaries and
/// affiliates. Records of who they are — this system keeps one company's books.
function GroupCard() {
  const client = useQueryClient()
  const list = useQuery({
    queryKey: orgKeys.group(),
    queryFn: ({ signal }) => groupEntities(signal),
  })
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [relation, setRelation] = useState<string | null>(null)
  const [taxId, setTaxId] = useState("")
  const [reason, setReason] = useState("")
  const refresh = () => client.invalidateQueries({ queryKey: orgKeys.group() })
  const save = useMutation({
    mutationFn: () =>
      saveGroupEntity({
        code: code.trim(),
        name: name.trim(),
        relation: relation ?? "",
        tax_id: taxId.trim() === "" ? null : taxId.trim(),
        reason: reason.trim(),
      }),
    onSuccess: () => {
      setCode("")
      setName("")
      setRelation(null)
      setTaxId("")
      setReason("")
      void refresh()
    },
  })
  const remove = useMutation({
    mutationFn: (one: string) => removeGroupEntity(one),
    onSuccess: () => void refresh(),
  })
  const label = new Map(RELATIONS.map((one) => [one.value, one.label]))

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Group structure</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-4 px-4 pb-4">
        {queryState(list, {
          loading: "Reading the group…",
          render: (rows) =>
            rows.length === 0 ? (
              <EmptyState>
                No group recorded. Add the holding over this company and its
                sister companies, if it has any.
              </EmptyState>
            ) : (
              <MiniTable head={["Company", "Relation", "NPWP", ""]}>
                {rows.map((row) => (
                  <MiniRow key={row.code}>
                    <MiniCell>
                      <button
                        type="button"
                        className="text-left hover:underline"
                        onClick={() => {
                          setCode(row.code)
                          setName(row.name)
                          setRelation(row.relation)
                          setTaxId(row.tax_id ?? "")
                        }}
                      >
                        <span className="block text-[0.875rem] text-ink">
                          {row.name}
                        </span>
                        <span className="font-mono text-[0.875rem] text-mute">
                          {row.code}
                        </span>
                      </button>
                    </MiniCell>
                    <MiniCell>
                      <Pill
                        tone={row.relation === "HOLDING" ? "info" : "neutral"}
                      >
                        {label.get(row.relation) ?? row.relation}
                      </Pill>
                    </MiniCell>
                    <MiniCell>{row.tax_id ?? "—"}</MiniCell>
                    <MiniCell>
                      <Button
                        variant="quiet"
                        pending={remove.isPending}
                        onClick={() => remove.mutate(row.code)}
                      >
                        Remove
                      </Button>
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
        <SubHead aside="Click a row to edit it">Add or change</SubHead>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Code" required>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="INDUK"
            />
          </Field>
          <Field label="Name" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="PT Induk Usaha"
            />
          </Field>
          <Field label="Relation" required>
            <PickOne
              label="Relation"
              placeholder="Choose…"
              choices={RELATIONS}
              value={relation}
              onChange={setRelation}
            />
          </Field>
          <Field label="NPWP">
            <Input value={taxId} onChange={(e) => setTaxId(e.target.value)} />
          </Field>
          <Field label="Why" required>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        {(save.error ?? remove.error) !== null && (
          <Banner tone="bad">{(save.error ?? remove.error)?.message}</Banner>
        )}
        <div>
          <Button
            variant="primary"
            pending={save.isPending}
            disabled={
              code.trim() === "" ||
              name.trim() === "" ||
              relation === null ||
              reason.trim() === ""
            }
            onClick={() => save.mutate()}
          >
            Save group member
          </Button>
        </div>
      </div>
    </Card>
  )
}

/// Strategic business units: units grouped by line of business — retail,
/// online, wholesale — so they can be read together.
function BusinessUnitsCard() {
  const client = useQueryClient()
  const list = useQuery({
    queryKey: orgKeys.businessUnits(),
    queryFn: ({ signal }) => businessUnits(signal),
  })
  const reachable = useReachableUnits()
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [units, setUnits] = useState<readonly string[]>([])
  const [reason, setReason] = useState("")
  const save = useMutation({
    mutationFn: () =>
      saveBusinessUnit({
        code: code.trim(),
        name: name.trim(),
        units: [...units],
        reason: reason.trim(),
      }),
    onSuccess: () => {
      setCode("")
      setName("")
      setUnits([])
      setReason("")
      void client.invalidateQueries({ queryKey: orgKeys.businessUnits() })
    },
  })
  const rows = list.data ?? []
  const unitName = new Map(
    (reachable.data ?? []).map((one) => [one.id, one.name])
  )

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Business units</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-4 px-4 pb-4">
        {queryState(list, {
          loading: "Reading the business units…",
          render: () =>
            rows.length === 0 ? (
              <EmptyState>
                No business unit yet. A business unit groups stores and head
                office by line of business, for reading them together.
              </EmptyState>
            ) : (
              <MiniTable head={["Business unit", "Units"]}>
                {rows.map((row) => (
                  <MiniRow key={row.code}>
                    <MiniCell>
                      <button
                        type="button"
                        className="text-left hover:underline"
                        onClick={() => {
                          setCode(row.code)
                          setName(row.name)
                          setUnits(row.units)
                        }}
                      >
                        <span className="block text-[0.875rem] text-ink">
                          {row.name}
                        </span>
                        <span className="font-mono text-[0.875rem] text-mute">
                          {row.code}
                        </span>
                      </button>
                    </MiniCell>
                    <MiniCell>
                      {row.units.length === 0
                        ? "—"
                        : row.units
                            .map((one) => unitName.get(one) ?? one)
                            .join(", ")}
                    </MiniCell>
                  </MiniRow>
                ))}
              </MiniTable>
            ),
        })}
        <SubHead aside="Click a row to edit it">Add or change</SubHead>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Code" required>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="RETAIL"
            />
          </Field>
          <Field label="Name" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Retail"
            />
          </Field>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {(reachable.data ?? []).map((one) => (
            <Checkbox
              key={one.id}
              label={one.name}
              checked={units.includes(one.id)}
              onChange={(on) =>
                setUnits(
                  on ? [...units, one.id] : units.filter((u) => u !== one.id)
                )
              }
            />
          ))}
        </div>
        <p className="text-[0.875rem] text-mute">
          A unit ticked here leaves whichever business unit it was in.
        </p>
        <Field label="Why" required>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {save.error !== null && (
          <Banner tone="bad">{save.error.message}</Banner>
        )}
        <div>
          <Button
            variant="primary"
            pending={save.isPending}
            disabled={
              code.trim() === "" || name.trim() === "" || reason.trim() === ""
            }
            onClick={() => save.mutate()}
          >
            Save business unit
          </Button>
        </div>
      </div>
    </Card>
  )
}

const KINDS = [
  { value: "ONBOARDING", label: "Onboarding" },
  { value: "SEPARATION", label: "Separation" },
]

/// The onboarding and separation checklists: the tasks every hire (and every
/// leaver) gets, in order, with who does each. A change reaches the next
/// checklist opened; the ones already open keep what they were opened with.
function ChecklistCard() {
  const client = useQueryClient()
  const list = useQuery({
    queryKey: orgKeys.checklistTemplates(),
    queryFn: ({ signal }) => checklistTemplates(signal),
  })
  const [id, setId] = useState("")
  const [label, setLabel] = useState("")
  const [owner, setOwner] = useState<string | null>(null)
  const [kind, setKind] = useState<string | null>("ONBOARDING")
  const [position, setPosition] = useState("")
  const [reason, setReason] = useState("")
  const refresh = () =>
    client.invalidateQueries({ queryKey: orgKeys.checklistTemplates() })
  const save = useMutation({
    mutationFn: () =>
      saveChecklistTemplate({
        id: id.trim(),
        label: label.trim(),
        owner: owner ?? "",
        kind: kind ?? "",
        position: Number(position),
        reason: reason.trim(),
      }),
    onSuccess: () => {
      setId("")
      setLabel("")
      setOwner(null)
      setPosition("")
      setReason("")
      void refresh()
    },
  })
  const retire = useMutation({
    mutationFn: (one: string) => retireChecklistTemplate(one, reason.trim()),
    onSuccess: () => void refresh(),
  })
  const rows = list.data ?? []

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Onboarding & separation checklists</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-4 px-4 pb-4">
        {queryState(list, {
          loading: "Reading the checklists…",
          render: () => (
            <>
              {KINDS.map((one) => (
                <div key={one.value}>
                  <SubHead>{one.label}</SubHead>
                  {rows.filter((row) => row.kind === one.value).length === 0 ? (
                    <p className="text-[0.875rem] text-mute">No task yet.</p>
                  ) : (
                    <MiniTable
                      head={[{ label: "#", align: "right" }, "Task", "Who", ""]}
                    >
                      {rows
                        .filter((row) => row.kind === one.value)
                        .map((row) => (
                          <MiniRow key={row.id}>
                            <MiniCell align="right">{row.position}</MiniCell>
                            <MiniCell>
                              <button
                                type="button"
                                className="text-left hover:underline"
                                onClick={() => {
                                  setId(row.id)
                                  setLabel(row.label)
                                  setOwner(row.owner)
                                  setKind(row.kind)
                                  setPosition(String(row.position))
                                }}
                              >
                                {row.label}
                              </button>
                            </MiniCell>
                            <MiniCell>
                              {OWNER_LABEL[row.owner] ?? row.owner}
                            </MiniCell>
                            <MiniCell>
                              {row.retired ? (
                                <Pill tone="neutral">Retired</Pill>
                              ) : (
                                <Button
                                  variant="quiet"
                                  disabled={reason.trim() === ""}
                                  onClick={() => retire.mutate(row.id)}
                                >
                                  Retire
                                </Button>
                              )}
                            </MiniCell>
                          </MiniRow>
                        ))}
                    </MiniTable>
                  )}
                </div>
              ))}
            </>
          ),
        })}
        <SubHead aside="Click a task to edit it">Add or change a task</SubHead>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Id" required>
            <Input
              value={id}
              onChange={(e) => setId(e.target.value.toLowerCase())}
              placeholder="laptop"
            />
          </Field>
          <Field label="Task" required>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Laptop diserahkan"
            />
          </Field>
          <Field label="Who does it" required>
            <PickOne
              label="Who does it"
              placeholder="Choose…"
              choices={OWNER_CHOICES}
              value={owner}
              onChange={setOwner}
            />
          </Field>
          <Field label="Checklist" required>
            <PickOne
              label="Checklist"
              placeholder="Choose…"
              choices={KINDS}
              value={kind}
              onChange={setKind}
            />
          </Field>
          <Field label="Order" aside="1–99" required>
            <Input
              inputMode="numeric"
              value={position}
              onChange={(e) => setPosition(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <Field label="Why" required hint="Also asked for retiring one.">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        {(save.error ?? retire.error) !== null && (
          <Banner tone="bad">{(save.error ?? retire.error)?.message}</Banner>
        )}
        <div>
          <Button
            variant="primary"
            pending={save.isPending}
            disabled={
              id.trim() === "" ||
              label.trim() === "" ||
              owner === null ||
              kind === null ||
              Number(position) < 1 ||
              reason.trim() === ""
            }
            onClick={() => save.mutate()}
          >
            Save task
          </Button>
        </div>
      </div>
    </Card>
  )
}
