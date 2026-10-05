import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { PickOne } from "@/components/ui/pick"
import { Pill } from "@/components/ui/pill"
import { MiniCell, MiniRow, MiniTable } from "@/components/ui/rows"
import { EmptyState } from "@/components/ui/states"
import { money } from "@/lib/format"
import {
  jobGrades,
  jobLevels,
  orgKeys,
  retireJobGrade,
  retireJobLevel,
  saveJobGrade,
  saveJobLevel,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"
import { useCanWrite } from "@/lib/session"
import { FormSheet, NameCell } from "@/screens/people/settings-parts"
import {
  figure,
  useRetire,
  useSheetTarget,
} from "@/screens/people/settings-hooks"

type LevelRow = Awaited<ReturnType<typeof jobLevels>>[number]
type GradeRow = Awaited<ReturnType<typeof jobGrades>>[number]

/// Settings › Levels & grades: the ranks people are placed on for the org
/// chart, and the pay bands on them — guidance for whoever agrees somebody's
/// pay, never a refusal.
export function LevelSettings() {
  const canWrite = useCanWrite()
  const level = useSheetTarget<LevelRow>()
  const grade = useSheetTarget<GradeRow>()
  const levels = useQuery({
    queryKey: orgKeys.levels(),
    queryFn: ({ signal }) => jobLevels(signal),
  })

  return (
    <PageContent>
      <PageHeader
        crumb="People"
        title="Levels & grades"
        sub="The ranks people are placed on, and the pay band on each."
        actions={
          canWrite && (
            <>
              <Button variant="ghost" onClick={() => grade.show(null)}>
                New grade
              </Button>
              <Button variant="primary" onClick={() => level.show(null)}>
                New level
              </Button>
            </>
          )
        }
      />
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Job levels</CardTitle>
        </CardHeader>
        <div className="px-4 pb-4">
          {queryState(levels, {
            loading: "Reading the levels…",
            render: (rows) => (
              <>
                {rows.length === 0 ? (
                  <EmptyState>
                    No job level yet. Levels rank people for the org chart — 1
                    is the most senior: Direktur, Manager, Supervisor, Staff.
                    New level adds the first.
                  </EmptyState>
                ) : (
                  <MiniTable
                    head={[
                      { label: "Rank", align: "right" },
                      { label: "Level", align: "left" },
                      { label: "People", align: "right" },
                      { label: "", align: "left" },
                    ]}
                  >
                    {rows.map((row) => (
                      <MiniRow key={row.code}>
                        <MiniCell align="right">{row.rank}</MiniCell>
                        <MiniCell>
                          <NameCell
                            name={row.name}
                            code={row.code}
                            onOpen={() => level.show(row)}
                          />
                        </MiniCell>
                        <MiniCell align="right">{row.members}</MiniCell>
                        <MiniCell>
                          {row.retired && <Pill tone="neutral">Retired</Pill>}
                        </MiniCell>
                      </MiniRow>
                    ))}
                  </MiniTable>
                )}
                <LevelSheet
                  key={level.target.id}
                  open={level.open}
                  onClose={level.close}
                  row={level.target.row}
                />
              </>
            ),
          })}
        </div>
      </Card>
      <GradeList sheet={grade} levels={levels.data ?? []} />
    </PageContent>
  )
}

function LevelSheet({
  open,
  onClose,
  row,
}: {
  open: boolean
  onClose: () => void
  row: LevelRow | null
}) {
  const client = useQueryClient()
  const [code, setCode] = useState(row?.code ?? "")
  const [name, setName] = useState(row?.name ?? "")
  const [rank, setRank] = useState(row ? String(row.rank) : "")
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
      void client.invalidateQueries({ queryKey: orgKeys.levels() })
      void client.invalidateQueries({ queryKey: orgKeys.chart() })
      onClose()
    },
  })
  const retire = useRetire(retireJobLevel, orgKeys.levels())

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={row ? row.name : "New level"}
      id={row?.code}
      error={save.error ?? retire.error}
      saveLabel="Submit"
      saving={save.isPending}
      canSave={
        code.trim() !== "" &&
        name.trim() !== "" &&
        Number(rank) > 0 &&
        reason.trim() !== ""
      }
      onSave={() => save.mutate()}
      danger={
        row && !row.retired
          ? {
              label: "Retire",
              pending: retire.isPending,
              disabled: reason.trim() === "",
              onClick: () =>
                retire.mutate(
                  { code: row.code, reason: reason.trim() },
                  { onSuccess: onClose }
                ),
            }
          : null
      }
    >
      <Field label="Code" required>
        <Input
          value={code}
          readOnly={row !== null}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
      </Field>
      <Field label="Name" required>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Rank" aside="1 is the most senior" required>
        <Input
          inputMode="numeric"
          value={rank}
          onChange={(e) => setRank(e.target.value.replace(/\D/g, ""))}
        />
      </Field>
      <Field label="Why" required hint="Also asked for when retiring.">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </FormSheet>
  )
}

function GradeList({
  sheet,
  levels,
}: {
  sheet: ReturnType<typeof useSheetTarget<GradeRow>>
  levels: readonly LevelRow[]
}) {
  const list = useQuery({
    queryKey: orgKeys.grades(),
    queryFn: ({ signal }) => jobGrades(signal),
  })
  const levelName = new Map(levels.map((one) => [one.code, one.name]))
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Grades</CardTitle>
      </CardHeader>
      <div className="px-4 pb-4">
        {queryState(list, {
          loading: "Reading the grades…",
          render: (rows) => (
            <>
              {rows.length === 0 ? (
                <EmptyState>
                  No grade yet. A grade is a pay band on a level — guidance for
                  whoever agrees somebody&rsquo;s pay, never a refusal. New
                  grade adds the first.
                </EmptyState>
              ) : (
                <MiniTable
                  head={[
                    { label: "Grade", align: "left" },
                    { label: "Level", align: "left" },
                    { label: "Band", align: "right" },
                    { label: "People", align: "right" },
                    { label: "", align: "left" },
                  ]}
                >
                  {rows.map((row) => (
                    <MiniRow key={row.code}>
                      <MiniCell>
                        <NameCell
                          name={row.name}
                          code={
                            row.grade_class !== null
                              ? `${row.code} · class ${row.grade_class}`
                              : row.code
                          }
                          onOpen={() => sheet.show(row)}
                        />
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
                        {row.retired && <Pill tone="neutral">Retired</Pill>}
                      </MiniCell>
                    </MiniRow>
                  ))}
                </MiniTable>
              )}
              <GradeSheet
                key={sheet.target.id}
                open={sheet.open}
                onClose={sheet.close}
                row={sheet.target.row}
                levels={levels}
              />
            </>
          ),
        })}
      </div>
    </Card>
  )
}

function GradeSheet({
  open,
  onClose,
  row,
  levels,
}: {
  open: boolean
  onClose: () => void
  row: GradeRow | null
  levels: readonly LevelRow[]
}) {
  const client = useQueryClient()
  const [code, setCode] = useState(row?.code ?? "")
  const [name, setName] = useState(row?.name ?? "")
  const [level, setLevel] = useState<string | null>(row?.level_code ?? null)
  const [gradeClass, setGradeClass] = useState(row?.grade_class ?? "")
  const [min, setMin] = useState(
    row?.min_minor == null ? "" : String(row.min_minor)
  )
  const [max, setMax] = useState(
    row?.max_minor == null ? "" : String(row.max_minor)
  )
  const [reason, setReason] = useState("")
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
      void client.invalidateQueries({ queryKey: orgKeys.grades() })
      void client.invalidateQueries({ queryKey: orgKeys.chart() })
      onClose()
    },
  })
  const retire = useRetire(retireJobGrade, orgKeys.grades())

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={row ? row.name : "New grade"}
      id={row?.code}
      error={save.error ?? retire.error}
      saveLabel="Submit"
      saving={save.isPending}
      canSave={code.trim() !== "" && name.trim() !== "" && reason.trim() !== ""}
      onSave={() => save.mutate()}
      danger={
        row && !row.retired
          ? {
              label: "Retire",
              pending: retire.isPending,
              disabled: reason.trim() === "",
              onClick: () =>
                retire.mutate(
                  { code: row.code, reason: reason.trim() },
                  { onSuccess: onClose }
                ),
            }
          : null
      }
    >
      <Field label="Code" required>
        <Input
          value={code}
          readOnly={row !== null}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
      </Field>
      <Field label="Name" required>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Level">
        <PickOne
          label="Level"
          choices={levels
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
      <Field label="Why" required hint="Also asked for when retiring.">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </FormSheet>
  )
}
