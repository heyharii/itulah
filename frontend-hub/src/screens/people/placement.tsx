import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Day } from "@/components/ui/day"
import { Field, Input } from "@/components/ui/field"
import { PickOne } from "@/components/ui/pick"
import { KeyValue, SubHead } from "@/components/ui/rows"
import { Banner, EmptyState } from "@/components/ui/states"
import { Timeline } from "@/components/ui/timeline"
import { day } from "@/lib/format"
import {
  departments,
  jobGrades,
  jobLevels,
  orgChart,
  orgKeys,
  placeEmployee,
  placements,
} from "@/lib/queries/people"
import { queryState } from "@/lib/query-state"

/// Where somebody sits in the organisation: department, job level, grade and
/// whom they report to — from a date, kept as a history. A change is a new
/// placement from the day it takes effect; the earlier one stays what it was.
export function PlacementPanel({ employeeId }: { employeeId: string }) {
  const client = useQueryClient()
  const history = useQuery({
    queryKey: orgKeys.placements(employeeId),
    queryFn: ({ signal }) => placements(employeeId, signal),
  })
  const depts = useQuery({
    queryKey: orgKeys.departments(),
    queryFn: ({ signal }) => departments(signal),
  })
  const levels = useQuery({
    queryKey: orgKeys.levels(),
    queryFn: ({ signal }) => jobLevels(signal),
  })
  const grades = useQuery({
    queryKey: orgKeys.grades(),
    queryFn: ({ signal }) => jobGrades(signal),
  })
  const people = useQuery({
    queryKey: orgKeys.chart(),
    queryFn: ({ signal }) => orgChart(signal),
  })

  const current = history.data?.[0]
  const [from, setFrom] = useState("")
  const [department, setDepartment] = useState<string | null>(null)
  const [level, setLevel] = useState<string | null>(null)
  const [grade, setGrade] = useState<string | null>(null)
  const [manager, setManager] = useState<string | null>(null)
  const [reason, setReason] = useState("")
  const [seeded, setSeeded] = useState(false)
  // Start the form from what is in force, once it has been read: a change
  // is usually one field, and retyping the other three invites a slip.
  if (!seeded && history.data !== undefined) {
    setSeeded(true)
    setDepartment(current?.department_code ?? null)
    setLevel(current?.level_code ?? null)
    setGrade(current?.grade_code ?? null)
    setManager(current?.reports_to ?? null)
  }

  const place = useMutation({
    mutationFn: () =>
      placeEmployee(employeeId, {
        effective_from: from,
        department_code: department,
        level_code: level,
        grade_code: grade,
        reports_to: manager,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      setReason("")
      void client.invalidateQueries({
        queryKey: orgKeys.placements(employeeId),
      })
      void client.invalidateQueries({ queryKey: orgKeys.chart() })
      void client.invalidateQueries({ queryKey: orgKeys.departments() })
    },
  })

  return (
    <div className="flex flex-col gap-4">
      {queryState(history, {
        loading: "Reading the placement…",
        render: (rows) =>
          rows.length === 0 ? (
            <EmptyState>
              Not placed yet: no department, level or manager. Place them below;
              until then the org chart shows them at the top, unplaced.
            </EmptyState>
          ) : (
            <div>
              <SubHead aside={`from ${day(rows[0]?.effective_from ?? "")}`}>
                In force
              </SubHead>
              <KeyValue term="Department">
                {rows[0]?.department_name ?? "—"}
              </KeyValue>
              <KeyValue term="Job level">{rows[0]?.level_name ?? "—"}</KeyValue>
              <KeyValue term="Grade">{rows[0]?.grade_name ?? "—"}</KeyValue>
              <KeyValue term="Reports to">
                {rows[0]?.reports_to_name ?? "nobody"}
              </KeyValue>
              {rows.length > 1 && (
                <div className="mt-3">
                  <SubHead>History</SubHead>
                  <Timeline
                    events={rows.map((row, index) => ({
                      id: row.effective_from,
                      title:
                        [row.department_name, row.level_name, row.grade_name]
                          .filter(Boolean)
                          .join(" · ") || "No department or level",
                      detail: `${row.reports_to_name === null ? "reports to nobody" : `reports to ${row.reports_to_name}`} · ${row.placed_by} · ${row.reason}`,
                      at: day(row.effective_from),
                      state: index === 0 ? "current" : "done",
                    }))}
                  />
                </div>
              )}
            </div>
          ),
      })}

      <div>
        <SubHead>Place from a date</SubHead>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="From" required>
            <Day value={from} onChange={setFrom} />
          </Field>
          <Field label="Department">
            <PickOne
              label="Department"
              choices={(depts.data ?? [])
                .filter((one) => !one.retired)
                .map((one) => ({ value: one.code, label: one.name }))}
              value={department}
              onChange={setDepartment}
            />
          </Field>
          <Field label="Job level">
            <PickOne
              label="Job level"
              choices={(levels.data ?? [])
                .filter((one) => !one.retired)
                .map((one) => ({ value: one.code, label: one.name }))}
              value={level}
              onChange={setLevel}
            />
          </Field>
          <Field label="Grade">
            <PickOne
              label="Grade"
              choices={(grades.data ?? [])
                .filter(
                  (one) =>
                    !one.retired &&
                    (level === null ||
                      one.level_code === null ||
                      one.level_code === level)
                )
                .map((one) => ({ value: one.code, label: one.name }))}
              value={grade}
              onChange={setGrade}
            />
          </Field>
          <Field label="Reports to">
            <PickOne
              label="Reports to"
              choices={(people.data ?? [])
                .filter((one) => one.employee_id !== employeeId)
                .map((one) => ({
                  value: one.employee_id,
                  label:
                    one.full_name === null
                      ? one.employee_code
                      : `${one.full_name} · ${one.employee_code}`,
                }))}
              value={manager}
              onChange={setManager}
            />
          </Field>
          <Field label="Why" required>
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </div>
        {place.error !== null && (
          <Banner tone="bad" className="mt-2">
            {place.error.message}
          </Banner>
        )}
        <div className="mt-3">
          <Button
            variant="primary"
            pending={place.isPending}
            disabled={from === "" || reason.trim() === ""}
            onClick={() => place.mutate()}
          >
            Save placement
          </Button>
        </div>
      </div>
    </div>
  )
}
